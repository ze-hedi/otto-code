// gepa/reflector.ts
// The GEPA reflector: a RawPiAgent that reads the traces of a harness on a minibatch
// and mutates a copy of that harness (system prompt, tool schemas, skills).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RawPiAgent } from "../agents/raw-pi-agent.js";
import type { EventCallback } from "../agents/pi-agent-types.js";
import { createReflectorTools, type Mutation } from "./reflector-tools.js";
import { createTraceAnalystConfig } from "./trace-analyst.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "reflector-system-prompt.md"), "utf8");

export interface ReflectorConfig {
  /** "provider/model" — use a strong model, reflection quality drives GEPA */
  model: string;
  /** Candidate directory to mutate in place (copy the parent first, see copyHarness) */
  candidateDir: string;
  /** Directory of TraceRecord JSON files from the parent's run on the minibatch */
  tracesDir: string;
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  /** Model of the trace_analyst sub-agents (default: same as `model`) */
  analystModel?: string;
  /** Where session files are written (default: process cwd) */
  playground?: string;
}

export function createReflector(config: ReflectorConfig, onSubmit?: (m: Mutation) => void): RawPiAgent {
  const playground = config.playground ?? process.cwd();
  return new RawPiAgent({
    name: "gepa reflector",
    // fresh session file per reflection, otherwise the next run reloads this one's history
    agentId: `gepa-reflector-${path.basename(config.candidateDir)}-${Date.now()}`,
    model: config.model,
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: config.thinkingLevel ?? "high",
    builtInTools: [],
    playground,
    tools: createReflectorTools({ candidateDir: config.candidateDir, tracesDir: config.tracesDir, onSubmit }),
    subAgents: {
      trace_analyst: createTraceAnalystConfig({
        model: config.analystModel ?? config.model,
        candidateDir: config.candidateDir,
        tracesDir: config.tracesDir,
        playground,
      }),
    },
  });
}

/**
 * Run one reflective mutation. Returns the submitted mutation, or null if the
 * reflector stopped without submitting (treat the candidate as rejected).
 * @param taskDescription - What the target agent is for and how it is scored
 */
export async function reflect(
  config: ReflectorConfig,
  taskDescription: string,
  onEvent?: EventCallback,
): Promise<Mutation | null> {
  let mutation: Mutation | null = null;
  const agent = createReflector(config, (m) => (mutation = m));
  await agent.execute(
    `# Target agent\n${taskDescription}\n\nImprove its harness from the traces of this minibatch.`,
    undefined,
    onEvent,
  );
  return mutation;
}
