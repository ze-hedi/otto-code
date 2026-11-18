import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { readJsonl, type ErrorRecord } from "./load-errors.js";
import { runSummarizer } from "./summarizer_agent.js";

/** The compact form the taxonomy agent reads. */
export interface SummarizedError {
  noteId: string;
  summary: string;
  message: string;
  remark: string;
}

const CONCURRENCY = 4;

export function summariesPathFor(notesPath: string): string {
  return notesPath.replace(/-notes\.jsonl$/, "-summaries.jsonl");
}

/** Summarizes each record once; cached summaries are reused. */
export async function summarizeErrors(
  records: ErrorRecord[],
  cachePath: string
): Promise<SummarizedError[]> {
  const cached = new Map<string, string>(
    existsSync(cachePath) ? readJsonl(cachePath).map((c) => [c.noteId, c.summary]) : []
  );
  mkdirSync(dirname(cachePath), { recursive: true });

  const todo = records.filter((r) => !cached.has(r.noteId));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const r = todo[next++];
      const summary = await runSummarizer({ messages: r.before, remark: r.remark });
      cached.set(r.noteId, summary);
      appendFileSync(cachePath, JSON.stringify({ noteId: r.noteId, summary }) + "\n");
      console.log(`summarized ${r.noteId}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return records.map((r) => ({
    noteId: r.noteId,
    summary: cached.get(r.noteId)!,
    message: r.message,
    remark: r.remark,
  }));
}
