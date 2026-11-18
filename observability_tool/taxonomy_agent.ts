import { RawPiAgent } from "../agents/raw-pi-agent.js";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { SubAgentToolConfig } from "../agents/pi-agent-types.js";
import type { SummarizedError } from "./summarize-errors.js";
import {
  createAssignerTools,
  createTaxonomyTools,
  formatCategories,
  loadTaxonomy,
  type Taxonomy,
} from "./taxonomy-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TAXONOMY_SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, "./taxonomy-prompt.md"),
  "utf-8"
);

export const ASSIGNER_SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, "./assigner-prompt.md"),
  "utf-8"
);

export const TAXONOMY_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
export const ASSIGNER_DEFAULT_MODEL = "anthropic/claude-haiku-4-5";

/** Above this, the orchestrator discovers categories from a sample. */
const FULL_READ_LIMIT = 150;
const DISCOVERY_SAMPLE = 100;

export interface TaxonomyAgentConfig {
  model?: string;
  assignerModel?: string;
}

function formatErrors(errors: SummarizedError[]): string {
  return errors
    .map(
      (e) =>
        `<error id="${e.noteId}">\n## Summary\n${e.summary}\n\n## Flagged message\n${e.message}\n\n## Remark\n${e.remark}\n</error>`
    )
    .join("\n\n");
}

function sample<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function buildUserPrompt(errors: SummarizedError[], existing: Taxonomy): string {
  const categories = `## Existing categories\n${formatCategories(existing)}`;
  if (errors.length <= FULL_READ_LIMIT) {
    return `${categories}\n\n## Errors (${errors.length}, all of them)\n${formatErrors(errors)}`;
  }
  const ids = errors.map((e) => e.noteId).join(", ");
  return (
    `${categories}\n\n## Discovery sample (${DISCOVERY_SAMPLE} of ${errors.length} errors)\n` +
    `${formatErrors(sample(errors, DISCOVERY_SAMPLE))}\n\n## All error ids\n${ids}`
  );
}

/** Volatile sub-agent: labels one batch against the categories as they are at call time. */
export function createAssignerSubAgent(
  errors: SummarizedError[],
  taxonomyPath: string,
  model: string
): SubAgentToolConfig {
  const byId = new Map(errors.map((e) => [e.noteId, e]));
  return {
    name: "assign_errors",
    description: "Assign a batch of errors to the existing categories. Returns a report.",
    promptGuidelines: [
      "Batches of about 20 ids; at most 3 calls in the same turn.",
      "Create the categories before calling it: it cannot create any.",
    ],
    model,
    systemPrompt: ASSIGNER_SYSTEM_PROMPT,
    builtInTools: [],
    // Sub-agent session files land next to the notes, not in the cwd.
    playground: dirname(taxonomyPath),
    parameters: Type.Object({
      noteIds: Type.Array(Type.String(), { description: "Ids of the errors to assign" }),
      focus: Type.Optional(Type.String({ description: "Optional instruction for this batch" })),
    }),
    prepare: ({ noteIds, focus }: { noteIds: string[]; focus?: string }) => {
      const unknown = noteIds.filter((id) => !byId.has(id));
      if (unknown.length) throw new Error(`unknown noteIds: ${unknown.join(", ")}`);
      const batch = noteIds.map((id) => byId.get(id)!);
      const task =
        `## Categories\n${formatCategories(loadTaxonomy(taxonomyPath))}\n\n` +
        (focus ? `## Focus\n${focus}\n\n` : "") +
        `## Errors\n${formatErrors(batch)}`;
      return { task, tools: createAssignerTools(taxonomyPath, new Set(noteIds)) };
    },
  };
}

export async function runTaxonomyAgent(
  errors: SummarizedError[],
  taxonomyPath: string,
  config: TaxonomyAgentConfig = {}
): Promise<Taxonomy> {
  const agent = new RawPiAgent({
    name: "taxonomy",
    model: config.model ?? TAXONOMY_DEFAULT_MODEL,
    systemPrompt: TAXONOMY_SYSTEM_PROMPT,
    builtInTools: [],
    playground: process.cwd(),
    tools: createTaxonomyTools(taxonomyPath, new Set(errors.map((e) => e.noteId))),
    subAgents: {
      assign_errors: createAssignerSubAgent(
        errors,
        taxonomyPath,
        config.assignerModel ?? ASSIGNER_DEFAULT_MODEL
      ),
    },
  });

  await agent.execute(buildUserPrompt(errors, loadTaxonomy(taxonomyPath)));
  return loadTaxonomy(taxonomyPath);
}
