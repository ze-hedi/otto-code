import { Type } from "@sinclair/typebox";
import type { ToolInput } from "../../../../agents/pi-agent-types.js";

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

export function makeClarificationTool(agentId: string): ToolInput {
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
