import { Type } from "@sinclair/typebox";
import { RawPiAgent } from "../agents/raw-pi-agent.js";
import { ToolInput } from "../agents/pi-agent-types.js";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXTRACTION_SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, "./additive-extraction.md"),
  "utf-8"
);

export interface ExtractedMemory {
  text: string;
  attributed_to: "user" | "assistant";
  linked_memory_ids?: string[];
}

export interface ExistingMemory {
  id: string;
  text: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ExtractionInput {
  newMessages: ChatMessage[];
  existingMemories?: ExistingMemory[];
  lastKMessages?: ChatMessage[];
  summary?: string;
  customInstructions?: string;
  observationDate?: string;
}

export interface ExtractorAgentConfig {
  model?: string;
}

function buildUserPrompt(input: ExtractionInput): string {
  const now = new Date().toISOString().split("T")[0];
  const observationDate = input.observationDate ?? now;

  const sections: string[] = [];

  sections.push(`## Summary\n${input.summary ?? ""}`);

  if (input.lastKMessages && input.lastKMessages.length > 0) {
    const k = input.lastKMessages.length;
    const formatted = input.lastKMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    sections.push(`## Last ${k} Messages\n${formatted}`);
  } else {
    sections.push("## Last 0 Messages\n");
  }

  sections.push("## Recently Extracted Memories\n[]");

  if (input.existingMemories && input.existingMemories.length > 0) {
    sections.push(
      `## Existing Memories\n${JSON.stringify(input.existingMemories)}`
    );
  } else {
    sections.push("## Existing Memories\n[]");
  }

  const newMsgs = input.newMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  sections.push(`## New Messages\n${newMsgs}`);

  sections.push(`## Observation Date\n${observationDate}`);
  sections.push(`## Current Date\n${now}`);

  if (input.customInstructions) {
    sections.push(`## Custom Instructions\n${input.customInstructions}`);
  }

  return sections.join("\n\n");
}

function createExtractMemoriesTool(
  resolve: (memories: ExtractedMemory[]) => void
): ToolInput {
  return {
    name: "extract_memories",
    label: "Extract Memories",
    description:
      "Extract memorable facts from the conversation. Call once with ALL extracted memories. If nothing is worth extracting, call with an empty array.",
    parameters: Type.Object(
      {
        memories: Type.Array(
          Type.Object(
            {
              text: Type.String({
                description:
                  "A self-contained, contextually rich factual statement (15-80 words). Must be understandable on its own with no pronouns — use specific names or 'User'.",
              }),
              attributed_to: Type.Union(
                [Type.Literal("user"), Type.Literal("assistant")],
                {
                  description:
                    "'user' for facts stated by/about the user. 'assistant' for recommendations, plans, or information the assistant provided.",
                }
              ),
              linked_memory_ids: Type.Optional(
                Type.Array(Type.String(), {
                  description:
                    "UUIDs of existing memories this new memory relates to (same entity, updated preference, continuation, contradiction). Empty if none.",
                })
              ),
            },
            { description: "A single extracted memory." }
          ),
          {
            description:
              "List of extracted memories. Pass an empty array [] if nothing is worth extracting.",
          }
        ),
      },
      {
        description:
          "Call this tool exactly once with all memories extracted from the conversation.",
      }
    ),
    promptSnippet:
      "Tool to output all extracted memories from the conversation in a single call.",
    promptGuidelines: [
      "You MUST call this tool exactly once as your final action.",
      "Extract every piece of memorable information as a separate item in the memories array.",
      "If nothing is worth extracting, call with an empty memories array.",
    ],
    terminate: true,
    execute: async (_toolCallId, params) => {
      resolve(params.memories ?? []);
      return { content: [{ type: "text", text: "Memories extracted." }] };
    },
  };
}

export async function runExtraction(
  input: ExtractionInput,
  config: ExtractorAgentConfig = {}
): Promise<ExtractedMemory[]> {
  let resolveMemories: (memories: ExtractedMemory[]) => void;
  const memoriesPromise = new Promise<ExtractedMemory[]>((res) => {
    resolveMemories = res;
  });

  const tool = createExtractMemoriesTool(resolveMemories!);

  const agent = new RawPiAgent({
    name: "memory-extractor",
    model: config.model ?? "anthropic/claude-haiku-4-5",
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    builtInTools: [],
    playground: process.cwd(),
    sessionMode: "memory",
    tools: [tool],
  });

  const userPrompt = buildUserPrompt(input);
  await agent.execute(userPrompt);

  return memoriesPromise;
}
