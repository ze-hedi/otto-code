// Usage: tsx observability_tool/run-taxonomy.ts <session.jsonl> [more sessions…]
// Writes the taxonomy to .otto-sessions/.notes/taxonomy.json next to the first session.
import { dirname, join } from "path";
import { loadErrors, notesPathFor } from "./load-errors.js";
import { summariesPathFor, summarizeErrors, type SummarizedError } from "./summarize-errors.js";
import { runTaxonomyAgent } from "./taxonomy_agent.js";

const sessions = process.argv.slice(2);
if (sessions.length === 0) {
  console.error("Usage: run-taxonomy.ts <session.jsonl> [more sessions…]");
  process.exit(1);
}

const errors: SummarizedError[] = [];
for (const session of sessions) {
  const records = loadErrors(session);
  console.log(`${session}: ${records.length} error notes`);
  errors.push(...(await summarizeErrors(records, summariesPathFor(notesPathFor(session)))));
}
if (errors.length === 0) {
  console.log("No error notes found.");
  process.exit(0);
}

const taxonomyPath = join(dirname(sessions[0]), ".notes", "taxonomy.json");
const taxonomy = await runTaxonomyAgent(errors, taxonomyPath);

const counts = new Map<string, number>();
for (const id of Object.values(taxonomy.assignments)) counts.set(id, (counts.get(id) ?? 0) + 1);
for (const c of taxonomy.categories) console.log(`${counts.get(c.id) ?? 0}\t${c.name} — ${c.definition}`);
const unassigned = errors.filter((e) => !taxonomy.assignments[e.noteId]).length;
if (unassigned) console.log(`${unassigned} errors unassigned`);
console.log(`Taxonomy written to ${taxonomyPath}`);
