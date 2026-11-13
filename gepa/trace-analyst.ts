// gepa/trace-analyst.ts
// Volatile sub-agent of the reflector: analyzes one session JSONL in its own context
// and returns a structured critique tying the behavior to the harness text.
// Per call: the session overview (segments + entry ids) is its first message, and it
// gets tools bound to that session to navigate it. Several can run in parallel.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Type } from "typebox";
import type { SubAgentToolConfig } from "../agents/pi-agent-types.js";
import { createReadTools } from "./reflector-tools.js";
import { sessionOverview, createSessionTools } from "./session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "trace-analyst-system-prompt.md"), "utf8");

interface AnalystParams {
  session_path: string;
  questions?: string[];
  feedback?: string;
}

export function createTraceAnalystConfig(opts: {
  model: string;
  candidateDir: string;
  tracesDir: string;
  playground?: string;
}): SubAgentToolConfig {
  const readHarness = createReadTools(opts).find((t) => t.name === "read_harness")!;

  return {
    name: "trace_analyst",
    description: [
      "Spawn a Trace Analyst: a fresh sub-agent that analyzes ONE session of the target agent (a pi session .jsonl) in its own context window and returns a structured critique.",
      "It receives a map of the session (segments split by compaction, with the first and last entry id of each) and navigates it with its own tools: compaction summaries, full segments, precise ranges of messages, regex search. It also reads the harness, to tie behavior to the exact text the agent was given.",
      "It forms its own judgment of the run, compares it with the evaluator feedback when you pass it, locates the first message where the run went wrong (cited by entry id), and names the harness text responsible, or says the cause is outside the harness: the model, a tool bug, the task or the evaluator.",
      "Its reply always has these sections: Outcome, Answers (to your questions), Divergence point, Root cause in the harness, Behaviors to preserve, Fix direction, Confidence.",
      "It has no memory between calls and knows only the session and what you pass. It cannot edit the harness.",
    ].join("\n"),
    model: opts.model,
    systemPrompt: SYSTEM_PROMPT,
    builtInTools: [],
    playground: opts.playground,
    tools: [readHarness],
    parameters: Type.Object({
      session_path: Type.String({ description: "Path of the session .jsonl file to analyze, as given in the trace list" }),
      questions: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Specific questions to answer in addition to the standard analysis, e.g. "did the agent load the skill before acting?" or "is the evaluator\'s penalty justified?"',
        }),
      ),
      feedback: Type.Optional(
        Type.String({
          description: "The evaluator's score and feedback for this session, copied as-is. Strongly recommended: without it the analyst judges the run alone.",
        }),
      ),
    }),
    prepare: (params: AnalystParams) => {
      const p = path.resolve(params.session_path);
      if (!p.endsWith(".jsonl") || !fs.existsSync(p)) throw new Error(`Session file not found: ${params.session_path}`);
      const task = [
        `# Session to analyze\n${p}\n\n${sessionOverview(p)}`,
        `# Evaluator feedback\n${params.feedback ?? "(none provided: judge the run yourself)"}`,
        params.questions?.length ? `# Questions from the Reflector\n${params.questions.map((q) => `- ${q}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
      return { task, tools: createSessionTools(p) };
    },
    promptSnippet: "Delegate the deep reading of one session; spawn several at once to analyze a minibatch in parallel",
    promptGuidelines: [
      "To run analysts in parallel, emit all trace_analyst calls in the same turn and call no other tool in that turn. A turn that mixes in an editing tool runs everything sequentially.",
      "Always pass the trace's score and feedback in `feedback`, so the analyst can compare its judgment with the evaluator's.",
      "Spawn one analyst per failing or low-scoring session. Add one or two on high-scoring sessions when you need to know which behaviors must be preserved.",
      "Use questions to test a hypothesis, e.g. after two analysts blame the same tool description, ask others whether their run shows the same misreading.",
      "Treat each report as evidence, not a verdict. When reports conflict, a report has low confidence, or an edit hinges on one specific detail, read that trace yourself with read_trace before editing.",
    ],
  };
}
