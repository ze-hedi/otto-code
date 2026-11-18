import { RawPiAgent } from "../agents/raw-pi-agent.js";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { SummarizedError } from "./summarize-errors.js";
import { createTaxonomyTools, loadTaxonomy, type Taxonomy } from "./taxonomy-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TAXONOMY_SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, "./taxonomy-prompt.md"),
  "utf-8"
);

export const TAXONOMY_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export interface TaxonomyAgentConfig {
  model?: string;
}

function buildUserPrompt(errors: SummarizedError[], existing: Taxonomy): string {
  const categories = existing.categories.length
    ? existing.categories.map((c) => `- ${c.id} | ${c.name}: ${c.definition}`).join("\n")
    : "(none yet)";
  const body = errors
    .map(
      (e) =>
        `<error id="${e.noteId}">\n## Summary\n${e.summary}\n\n## Flagged message\n${e.message}\n\n## Remark\n${e.remark}\n</error>`
    )
    .join("\n\n");
  return `## Existing categories\n${categories}\n\n## Errors\n${body}`;
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
  });

  await agent.execute(buildUserPrompt(errors, loadTaxonomy(taxonomyPath)));
  return loadTaxonomy(taxonomyPath);
}
