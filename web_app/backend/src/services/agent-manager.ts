import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";
import { Collection } from "mongodb";
import { Type } from "@sinclair/typebox";
import { RawPiAgent } from "../../../../agents/raw-pi-agent.js";
import type { RawPiAgentConfig, ToolInput } from "../../../../agents/pi-agent-configs.js";
import { getDb } from "../db/mongo.js";
import type { AgentDocument, SerializableAgentConfig } from "../types.js";

const activeAgents = new Map<string, RawPiAgent>();
const sessionKeys = new Map<string, string>();
const busyAgents = new Map<string, string>();        // agentId → sessionKey while streaming
const agentEmitters = new Map<string, EventEmitter>(); // per-agent event bus

// ── Clarification tool plumbing ───────────────────────────────────────────────

type ClarificationCallback = (toolCallId: string, questions: string[]) => void;
const clarificationCallbacks = new Map<string, ClarificationCallback>();
const pendingClarifications = new Map<string, (answers: string[]) => void>();

export function setClarificationCallback(agentId: string, cb: ClarificationCallback): void {
  clarificationCallbacks.set(agentId, cb);
}

export function resolveClarification(toolCallId: string, answers: string[]): boolean {
  const resolve = pendingClarifications.get(toolCallId);
  if (!resolve) return false;
  pendingClarifications.delete(toolCallId);
  resolve(answers);
  return true;
}

function makeClarificationTool(agentId: string): ToolInput {
  return {
    name: "clarification_tool",
    label: "clarification tool",
    description: "a tool that should be called to ask for clarification from the user",
    parameters: Type.Object({
      questions: Type.Array(Type.String({ description: "a question that helps you gather clarifications about what to do" }))
    }, { description: "a set of questions that will help get more context for an optimal response" }),
    promptSnippet: "clarification tool that helps you get more context from the user through questions",
    promptGuidelines: ["call this tool when you need more details to help you orient your response to the optimal response"],
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const questions: string[] = params.questions;
      const answers = await new Promise<string[]>((resolve, reject) => {
        if (signal?.aborted) { reject(new Error("aborted")); return; }
        pendingClarifications.set(toolCallId, resolve);
        const cb = clarificationCallbacks.get(agentId);
        cb?.(toolCallId, questions);
        signal?.addEventListener("abort", () => {
          pendingClarifications.delete(toolCallId);
          reject(new Error("aborted"));
        }, { once: true });
      });
      const result = questions.map((q, i) => `Q: ${q}\nA: ${answers[i] ?? ""}`).join("\n\n");
      return { content: [{ type: "text", text: result }] };
    },
  };
}

export function getSessionKey(agentId: string): string {
  return sessionKeys.get(agentId) ?? "main";
}

export function setSessionKey(agentId: string, key: string): void {
  sessionKeys.set(agentId, key);
}

const API_KEY_ENV: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

function resolveApiKey(model: string): string | undefined {
  const provider = model.split("/")[0];
  const envVar = API_KEY_ENV[provider];
  return envVar ? process.env[envVar] : undefined;
}

function getCollection(): Collection<AgentDocument> {
  return getDb().collection<AgentDocument>("agents");
}

export async function createAgent(config: SerializableAgentConfig): Promise<AgentDocument> {
  const agentId = uuidv4();
  const now = new Date();

  const rawConfig: RawPiAgentConfig = {
    name: config.name,
    model: config.model,
    apiKey: resolveApiKey(config.model),
    systemPrompt: config.systemPrompt,
    playground: config.playground,
    workingDir: config.workingDir,
    builtInTools: config.builtInTools,
    mcpServers: config.mcpServers,
    mcpConnectionTimeout: config.mcpConnectionTimeout,
    toolCallGuardrails: config.toolCallGuardrails,
    thinkingLevel: config.thinkingLevel,
    compaction: config.compaction,
    ...(config.subAgents && { subAgents: config.subAgents }),
  };

  if (config.clarificationTool) {
    rawConfig.tools = [...(rawConfig.tools ?? []), makeClarificationTool(agentId)];
  }

  const agent = new RawPiAgent(rawConfig);
  activeAgents.set(agentId, agent);

  const doc: AgentDocument = {
    agent_id: agentId,
    config,
    status: "active",
    created_at: now,
    updated_at: now,
  };

  await getCollection().insertOne(doc);
  return doc;
}

export function getActiveAgent(agentId: string): RawPiAgent | undefined {
  return activeAgents.get(agentId);
}

/** Get or re-hydrate an agent: if not in memory, recreate from DB doc. */
export async function getOrActivateAgent(agentId: string): Promise<RawPiAgent | null> {
  const existing = activeAgents.get(agentId);
  if (existing) return existing;

  const doc = await getCollection().findOne({ agent_id: agentId });
  if (!doc) return null;

  const config = doc.config;
  const rawConfig: RawPiAgentConfig = {
    name: config.name,
    model: config.model,
    apiKey: resolveApiKey(config.model),
    systemPrompt: config.systemPrompt,
    playground: config.playground,
    workingDir: config.workingDir,
    builtInTools: config.builtInTools,
    mcpServers: config.mcpServers,
    mcpConnectionTimeout: config.mcpConnectionTimeout,
    toolCallGuardrails: config.toolCallGuardrails,
    thinkingLevel: config.thinkingLevel,
    compaction: config.compaction,
    ...(config.subAgents && { subAgents: config.subAgents }),
  };

  if (config.clarificationTool) {
    rawConfig.tools = [...(rawConfig.tools ?? []), makeClarificationTool(agentId)];
  }

  const agent = new RawPiAgent(rawConfig);
  activeAgents.set(agentId, agent);
  return agent;
}

export async function getAgentDoc(agentId: string): Promise<AgentDocument | null> {
  return getCollection().findOne({ agent_id: agentId });
}

export async function getAllAgentDocs(playground?: string): Promise<AgentDocument[]> {
  const filter = playground ? { "config.playground": playground } : {};
  return getCollection().find(filter).toArray();
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  const agent = activeAgents.get(agentId);
  if (agent) {
    await agent.disconnectMcp().catch(() => {});
    activeAgents.delete(agentId);
  }
  markIdle(agentId);
  const result = await getCollection().deleteOne({ agent_id: agentId });
  return result.deletedCount > 0;
}

// ── Busy state & event bus ──────────────────────────────────────────────────

export function markBusy(agentId: string, sessionKey: string): EventEmitter {
  busyAgents.set(agentId, sessionKey);
  const emitter = new EventEmitter();
  agentEmitters.set(agentId, emitter);
  return emitter;
}

export function markIdle(agentId: string): void {
  busyAgents.delete(agentId);
  const emitter = agentEmitters.get(agentId);
  if (emitter) {
    emitter.emit("done");
    emitter.removeAllListeners();
    agentEmitters.delete(agentId);
  }
}

export function getAgentBusyState(agentId: string): { busy: boolean; sessionKey: string | null } {
  const sk = busyAgents.get(agentId);
  return { busy: !!sk, sessionKey: sk ?? null };
}

export function getAgentEmitter(agentId: string): EventEmitter | undefined {
  return agentEmitters.get(agentId);
}
