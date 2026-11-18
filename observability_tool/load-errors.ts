import { existsSync, readFileSync } from "fs";
import { basename, dirname, join } from "path";
import type { ChatMessage } from "./summarizer_agent.js";

export interface ErrorRecord {
  noteId: string;
  sessionKey: string;
  entryId: string;
  /** The branch before the flagged entry, in order. */
  before: ChatMessage[];
  /** The flagged message itself, rendered as text. */
  message: string;
  remark: string;
}

const MAX_BLOCK_CHARS = 500;

export function readJsonl(path: string): any[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function truncate(s: string): string {
  return s.length > MAX_BLOCK_CHARS ? `${s.slice(0, MAX_BLOCK_CHARS)}…[truncated]` : s;
}

function renderContent(content: any): string {
  if (typeof content === "string") return content;
  return (content ?? [])
    .map((b: any) => {
      if (b.type === "text") return b.text;
      if (b.type === "toolCall") return `[tool: ${b.name}(${truncate(JSON.stringify(b.arguments))})]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toChatMessage(entry: any): ChatMessage | null {
  const m = entry.message;
  if (entry.type !== "message" || !m) return null;
  if (m.role === "toolResult") {
    return { role: "tool", content: `[result of ${m.toolName}: ${truncate(renderContent(m.content))}]` };
  }
  if (m.role !== "user" && m.role !== "assistant") return null;
  return { role: m.role, content: renderContent(m.content) };
}

/** `<dir>/<agent>-<key>.jsonl` → `<dir>/.notes/<agent>-<key>-notes.jsonl` */
export function notesPathFor(sessionPath: string): string {
  return join(dirname(sessionPath), ".notes", basename(sessionPath, ".jsonl") + "-notes.jsonl");
}

export function loadErrors(sessionPath: string): ErrorRecord[] {
  const notesPath = notesPathFor(sessionPath);
  if (!existsSync(notesPath)) return [];

  const entries = readJsonl(sessionPath);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const sessionKey = basename(sessionPath, ".jsonl");

  const records: ErrorRecord[] = [];
  for (const note of readJsonl(notesPath)) {
    // Older notes predate kinds and are treated as errors.
    if (note.kind && note.kind !== "error") continue;
    const flagged = byId.get(note.entryId);
    // DECISION: notes on sub-agent timelines point into another file; skipped for now.
    if (!flagged) continue;

    const branch: any[] = [];
    for (let e = byId.get(flagged.parentId); e; e = byId.get(e.parentId)) branch.unshift(e);

    records.push({
      noteId: note.id,
      sessionKey,
      entryId: note.entryId,
      before: branch.map(toChatMessage).filter((m): m is ChatMessage => m !== null),
      message: toChatMessage(flagged)?.content ?? "",
      remark: note.text,
    });
  }
  return records;
}
