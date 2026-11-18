import { RawPiAgent } from "../agents/raw-pi-agent.js";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SUMMARIZER_SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, "./summarizer-prompt.md"),
  "utf-8"
);

export const SUMMARIZER_DEFAULT_MODEL = "anthropic/claude-haiku-4-5";

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface SummarizerInput {
  /** The conversation before the flagged point, in order. */
  messages: ChatMessage[];
  /** The reviewer's remark on the flagged message. */
  remark: string;
}

export interface SummarizerAgentConfig {
  model?: string;
}

function buildUserPrompt(input: SummarizerInput): string {
  const conversation = input.messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
  return `## Conversation\n${conversation}\n\n## Reviewer remark\n${input.remark}`;
}

export async function runSummarizer(
  input: SummarizerInput,
  config: SummarizerAgentConfig = {}
): Promise<string> {
  const agent = new RawPiAgent({
    name: "summarizer",
    model: config.model ?? SUMMARIZER_DEFAULT_MODEL,
    systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
    builtInTools: [],
    playground: process.cwd(),
    tools: [],
  });

  await agent.execute(buildUserPrompt(input));

  const messages = await agent.getMessages();
  const last = [...messages].reverse().find((m: any) => m.role === "assistant") as any;
  const content = last?.content ?? [];
  return content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}
