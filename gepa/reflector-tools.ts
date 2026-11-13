// gepa/reflector-tools.ts
// Tools of the GEPA reflector: read the reflective dataset (traces + feedback),
// read the current harness, and mutate it — one tool per action.
// Every mutation is recorded in a change log that submit_mutation persists.

import fs from "fs";
import path from "path";
import { Type } from "typebox";
import type { ToolInput } from "../agents/pi-agent-types.js";
import {
  loadHarness,
  loadSystemPrompt,
  saveSystemPrompt,
  loadTools,
  saveTools,
  loadSkills,
  writeSkill,
  skillDir,
  parseSkillFile,
  renderSkillFile,
} from "./harness.js";

/** One evaluated rollout of the target agent: <tracesDir>/<id>.json */
export interface TraceRecord {
  id: string;
  /** Task given to the target agent */
  input: string;
  /** Final answer of the target agent */
  output?: string;
  /** Metric score, higher is better (usually 0..1) */
  score: number;
  /** Evaluator's textual feedback: what went wrong and why */
  feedback: string;
  /** Execution trace: messages, tool calls, errors… (string or JSON) */
  trajectory?: unknown;
  /** Path of the target agent's session .jsonl (analyzed by trace_analyst) */
  sessionPath?: string;
}

export interface Mutation {
  diagnosis: string;
  expectedEffect: string;
  changes: string[];
  timestamp: string;
}

export interface ReflectorToolsContext {
  /** Candidate directory being mutated (a copy of the parent) */
  candidateDir: string;
  /** Directory holding the TraceRecord JSON files of the parent's minibatch */
  tracesDir: string;
  /** Set by submit_mutation */
  onSubmit?: (mutation: Mutation) => void;
}

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

const EditsSchema = Type.Array(
  Type.Object({
    old_str: Type.String({ description: "Exact text to replace; must occur exactly once" }),
    new_str: Type.String({ description: "Replacement text (empty string deletes old_str)" }),
  }),
  { description: "Applied in order, all or none", minItems: 1 },
);

/** Apply exact-string edits; throws without writing anything if one does not match exactly once. */
function applyEdits(source: string, edits: { old_str: string; new_str: string }[]): string {
  let out = source;
  edits.forEach((e, i) => {
    const count = e.old_str ? out.split(e.old_str).length - 1 : 0;
    if (count !== 1) {
      throw new Error(`Edit #${i + 1}: old_str found ${count} times (must be exactly once). No edit was applied.`);
    }
    out = out.replace(e.old_str, () => e.new_str);
  });
  return out;
}

function loadTraces(tracesDir: string): TraceRecord[] {
  return fs
    .readdirSync(tracesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(tracesDir, f), "utf8")) as TraceRecord);
}

/** Resolve a dotted parameter path ("filters.dateFrom") to a schema node; "" is the root. */
function resolveParam(schema: any, paramPath: string): any {
  let node = schema;
  for (const seg of paramPath.split(".").filter(Boolean)) {
    if (node?.type === "array") node = node.items;
    node = node?.properties?.[seg];
    if (!node) throw new Error(`Parameter "${paramPath}" does not exist in this tool's schema`);
  }
  return node;
}

function renderHarness(dir: string): string {
  const h = loadHarness(dir);
  const lines = ["# System prompt", "", h.systemPrompt || "(empty)", "", "# Tools", ""];
  for (const [name, t] of Object.entries(h.tools)) {
    lines.push(`## ${name}`, "```json", JSON.stringify(t, null, 2), "```", "");
  }
  if (Object.keys(h.tools).length === 0) lines.push("(no tools)", "");
  lines.push("# Skills", "");
  for (const s of Object.values(h.skills)) {
    lines.push(`## ${s.name}`, `description: ${s.description}`);
    if (s.extraFiles.length) lines.push(`files (read-only): ${s.extraFiles.join(", ")}`);
    lines.push("", s.body.trim(), "");
  }
  if (Object.keys(h.skills).length === 0) lines.push("(no skills)");
  return lines.join("\n");
}

/** Read-only tools, shared by the reflector and the trace analysts. */
export function createReadTools(ctx: Pick<ReflectorToolsContext, "candidateDir" | "tracesDir">): ToolInput[] {
  const { candidateDir, tracesDir } = ctx;

  // ── Reflective dataset ─────────────────────────────────────────────────────

  const listTraces: ToolInput = {
    name: "list_traces",
    label: "List traces",
    description:
      "List the evaluated rollouts of the current harness on this minibatch: id, score and the start of the evaluator feedback, worst first.",
    parameters: Type.Object({}),
    promptSnippet: "Overview of the minibatch: which examples failed and why",
    promptGuidelines: ["Call this first, then read the full trace of the failing and borderline examples."],
    execute: async () => {
      const traces = loadTraces(tracesDir).sort((a, b) => a.score - b.score);
      if (traces.length === 0) return text("No traces found.");
      const mean = traces.reduce((s, t) => s + t.score, 0) / traces.length;
      const rows = traces.map(
        (t) =>
          `- ${t.id} | score ${t.score} | session ${t.sessionPath ?? "(none)"} | ${t.feedback.replace(/\s+/g, " ").slice(0, 200)}`,
      );
      return text(`${traces.length} traces, mean score ${mean.toFixed(3)}\n\n${rows.join("\n")}`);
    },
  };

  const readTrace: ToolInput = {
    name: "read_trace",
    label: "Read trace",
    description:
      "Read one rollout in full: the task input, the agent's execution trajectory (reasoning, tool calls, tool results, errors), its final output, the score and the evaluator feedback.",
    parameters: Type.Object({
      id: Type.String({ description: "Trace id as shown by list_traces" }),
      offset: Type.Optional(Type.Number({ description: "Character offset to start from, for long traces (default 0)" })),
    }),
    promptSnippet: "Full trajectory + feedback of one example",
    promptGuidelines: [
      "Locate the exact step where the trajectory diverged from what a correct run would do, and which harness text caused or failed to prevent it.",
    ],
    execute: async (_id, params: { id: string; offset?: number }) => {
      const trace = loadTraces(tracesDir).find((t) => t.id === params.id);
      if (!trace) throw new Error(`No trace with id "${params.id}"`);
      const trajectory =
        typeof trace.trajectory === "string" ? trace.trajectory : JSON.stringify(trace.trajectory ?? null, null, 2);
      const full = [
        `# Trace ${trace.id} — score ${trace.score}`,
        `## Evaluator feedback\n${trace.feedback}`,
        `## Input\n${trace.input}`,
        `## Final output\n${trace.output ?? "(none)"}`,
        `## Trajectory\n${trajectory}`,
      ].join("\n\n");
      const MAX = 40_000;
      const start = params.offset ?? 0;
      const chunk = full.slice(start, start + MAX);
      const more = start + MAX < full.length ? `\n\n[truncated — continue with offset ${start + MAX} of ${full.length}]` : "";
      return text(chunk + more);
    },
  };

  // ── Harness ────────────────────────────────────────────────────────────────

  const readHarness: ToolInput = {
    name: "read_harness",
    label: "Read harness",
    description:
      "Read the current harness of the target agent: full system prompt, every tool schema (description, promptSnippet, promptGuidelines, parameters) and every skill (description + body).",
    parameters: Type.Object({}),
    promptSnippet: "The full text of the harness you are improving",
    promptGuidelines: ["Read it before editing, and again after a series of edits to check the result is coherent."],
    execute: async () => text(renderHarness(candidateDir)),
  };

  return [listTraces, readTrace, readHarness];
}

/** Read tools + harness mutation tools + submit_mutation. */
export function createReflectorTools(ctx: ReflectorToolsContext): ToolInput[] {
  const { candidateDir } = ctx;
  const changes: string[] = [];

  const editSystemPrompt: ToolInput = {
    name: "edit_system_prompt",
    label: "Edit system prompt",
    description: "Make targeted edits to the target agent's system prompt by exact string replacement.",
    parameters: Type.Object({ edits: EditsSchema }),
    promptSnippet: "Targeted find/replace edits on the system prompt",
    promptGuidelines: ["Prefer this over rewrite_system_prompt: small precise edits keep what already works."],
    executionMode: "sequential",
    execute: async (_id, params: { edits: { old_str: string; new_str: string }[] }) => {
      saveSystemPrompt(candidateDir, applyEdits(loadSystemPrompt(candidateDir), params.edits));
      changes.push(`system_prompt: ${params.edits.length} edit(s)`);
      return text(`Applied ${params.edits.length} edit(s) to the system prompt.`);
    },
  };

  const rewriteSystemPrompt: ToolInput = {
    name: "rewrite_system_prompt",
    label: "Rewrite system prompt",
    description: "Replace the target agent's whole system prompt.",
    parameters: Type.Object({ content: Type.String({ description: "The complete new system prompt" }) }),
    promptSnippet: "Full rewrite of the system prompt",
    promptGuidelines: [
      "Only when the prompt's structure itself is the problem; carry over every instruction that the passing traces depend on.",
    ],
    executionMode: "sequential",
    execute: async (_id, params: { content: string }) => {
      saveSystemPrompt(candidateDir, params.content);
      changes.push("system_prompt: rewritten");
      return text("System prompt rewritten.");
    },
  };

  const updateToolSchema: ToolInput = {
    name: "update_tool_schema",
    label: "Update tool schema",
    description:
      "Change the text of one tool's schema as the target agent sees it: description, promptSnippet, promptGuidelines, and parameter descriptions. The tool's name, its parameter structure (names, types, required) and its implementation cannot change.",
    parameters: Type.Object({
      tool: Type.String({ description: "Tool name, as shown by read_harness" }),
      description: Type.Optional(Type.String({ description: "New tool description" })),
      promptSnippet: Type.Optional(Type.String({ description: "New one-line snippet" })),
      promptGuidelines: Type.Optional(
        Type.Array(Type.String(), { description: "New guidelines; replaces the whole list" }),
      ),
      parameterDescriptions: Type.Optional(
        Type.Array(
          Type.Object({
            path: Type.String({
              description: 'Dotted parameter path, e.g. "query" or "filters.dateFrom"; "" for the parameters object itself',
            }),
            description: Type.String({ description: "New description for that parameter" }),
          }),
          { description: "Parameter descriptions to set" },
        ),
      ),
    }),
    promptSnippet: "Rewrite how a tool is described to the agent",
    promptGuidelines: [
      "Use when traces show the agent picking the wrong tool, skipping a tool, or filling its arguments wrongly.",
    ],
    executionMode: "sequential",
    execute: async (_id, params) => {
      const tools = loadTools(candidateDir);
      const tool = tools[params.tool];
      if (!tool) throw new Error(`Unknown tool "${params.tool}". Available: ${Object.keys(tools).join(", ")}`);

      const touched: string[] = [];
      if (params.description !== undefined) (tool.description = params.description), touched.push("description");
      if (params.promptSnippet !== undefined) (tool.promptSnippet = params.promptSnippet), touched.push("promptSnippet");
      if (params.promptGuidelines !== undefined) {
        tool.promptGuidelines = params.promptGuidelines;
        touched.push("promptGuidelines");
      }
      for (const p of params.parameterDescriptions ?? []) {
        if (!tool.parameters) throw new Error(`Tool "${params.tool}" has no parameters`);
        resolveParam(tool.parameters, p.path).description = p.description;
        touched.push(`param:${p.path || "(root)"}`);
      }
      if (touched.length === 0) throw new Error("Nothing to update: pass at least one field");

      saveTools(candidateDir, tools);
      changes.push(`tool ${params.tool}: ${touched.join(", ")}`);
      return text(`Updated ${params.tool}: ${touched.join(", ")}.`);
    },
  };

  const writeSkillTool: ToolInput = {
    name: "write_skill",
    label: "Write skill",
    description:
      "Create a skill, or overwrite an existing skill's SKILL.md. A skill is a procedure the target agent loads on demand when a task matches its description; the description is always visible to the agent, the body only once the skill is loaded.",
    parameters: Type.Object({
      name: Type.String({ description: "Lowercase kebab-case skill name, e.g. \"verify-citations\"" }),
      description: Type.String({
        description: "When to use the skill — the only part the agent sees before loading it, so state the triggering situations",
      }),
      body: Type.String({ description: "Markdown instructions of the skill (no frontmatter)" }),
    }),
    promptSnippet: "Create or overwrite a skill",
    promptGuidelines: [
      "Use a skill for a multi-step procedure needed by a subset of tasks; put always-relevant rules in the system prompt instead.",
    ],
    executionMode: "sequential",
    execute: async (_id, params: { name: string; description: string; body: string }) => {
      const existed = params.name in loadSkills(candidateDir);
      writeSkill(candidateDir, params.name, params.description, params.body);
      changes.push(`skill ${params.name}: ${existed ? "overwritten" : "created"}`);
      return text(`Skill "${params.name}" ${existed ? "overwritten" : "created"}.`);
    },
  };

  const editSkill: ToolInput = {
    name: "edit_skill",
    label: "Edit skill",
    description: "Make targeted edits to an existing skill's description or body by exact string replacement.",
    parameters: Type.Object({
      name: Type.String({ description: "Skill name" }),
      description: Type.Optional(Type.String({ description: "New description (replaces the current one)" })),
      edits: Type.Optional(EditsSchema),
    }),
    promptSnippet: "Targeted edits on a skill",
    executionMode: "sequential",
    execute: async (_id, params) => {
      const file = path.join(skillDir(candidateDir, params.name), "SKILL.md");
      if (!fs.existsSync(file)) throw new Error(`Unknown skill "${params.name}"`);
      const skill = parseSkillFile(fs.readFileSync(file, "utf8"));
      const body = params.edits ? applyEdits(skill.body, params.edits) : skill.body;
      if (params.description === undefined && !params.edits) throw new Error("Nothing to update");
      fs.writeFileSync(file, renderSkillFile(params.name, params.description ?? skill.description, body));
      changes.push(`skill ${params.name}: edited`);
      return text(`Skill "${params.name}" updated.`);
    },
  };

  const deleteSkill: ToolInput = {
    name: "delete_skill",
    label: "Delete skill",
    description: "Delete a skill and all of its files from the harness.",
    parameters: Type.Object({ name: Type.String({ description: "Skill name" }) }),
    promptSnippet: "Remove a skill",
    promptGuidelines: ["Only when traces show the skill misleads the agent or duplicates other instructions."],
    executionMode: "sequential",
    execute: async (_id, params: { name: string }) => {
      const d = skillDir(candidateDir, params.name);
      if (!fs.existsSync(d)) throw new Error(`Unknown skill "${params.name}"`);
      fs.rmSync(d, { recursive: true });
      changes.push(`skill ${params.name}: deleted`);
      return text(`Skill "${params.name}" deleted.`);
    },
  };

  // ── Finish ─────────────────────────────────────────────────────────────────

  const submitMutation: ToolInput = {
    name: "submit_mutation",
    label: "Submit mutation",
    description:
      "Finish the reflection: record the diagnosis and expected effect of your edits. The new harness is then evaluated against its parent.",
    parameters: Type.Object({
      diagnosis: Type.String({ description: "The failure patterns found in the traces and their root cause in the harness" }),
      expected_effect: Type.String({
        description: "Which failing examples should now pass, and why passing ones should not regress",
      }),
    }),
    promptSnippet: "End the reflection with your diagnosis",
    promptGuidelines: ["Call exactly once, after all edits, as your last action."],
    executionMode: "sequential",
    terminate: true,
    execute: async (_id, params: { diagnosis: string; expected_effect: string }) => {
      if (changes.length === 0) throw new Error("No edit was made. Edit the harness before submitting.");
      const mutation: Mutation = {
        diagnosis: params.diagnosis,
        expectedEffect: params.expected_effect,
        changes: [...changes],
        timestamp: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(candidateDir, "mutation.json"), JSON.stringify(mutation, null, 2) + "\n");
      ctx.onSubmit?.(mutation);
      return text(`Mutation submitted (${changes.length} change(s)).`);
    },
  };

  return [
    ...createReadTools(ctx),
    editSystemPrompt,
    rewriteSystemPrompt,
    updateToolSchema,
    writeSkillTool,
    editSkill,
    deleteSkill,
    submitMutation,
  ];
}
