// gepa/session.ts
// Compaction-aware access to a pi session JSONL.
//   sessionOverview()     → injected in the sub-agent's first message: segments with first/last entry ids
//   createSessionTools()  → tools bound to one session, to explore it while reasoning
//
// A segment is the run of messages between two compactions:
//   compacted segment i = messages summarized by compaction i
//   live segment        = messages after the last compaction (incl. those kept across it)
// Without compaction there is a single live segment.

import fs from "fs";
import { Type } from "typebox";
import type { ToolInput } from "../agents/pi-agent-types.js";

interface Entry {
  type: string;
  id?: string;
  parentId?: string | null;
  [k: string]: any;
}

export interface SessionStep {
  step: number;
  /** pi entry id (8 hex chars), unique within the session file */
  id: string;
  role: string;
  /** Full rendered text, never truncated */
  text: string;
}

export interface SessionSegment {
  index: number;
  firstStep: number;
  lastStep: number;
  /** Compaction that summarized this segment; absent for the live segment */
  compaction?: { id: string; summary: string; tokensBefore?: number };
}

export interface ParsedSession {
  steps: SessionStep[];
  segments: SessionSegment[];
}

// ── Parsing ────────────────────────────────────────────────────────────────────

function renderMessage(m: any): { role: string; text: string } {
  const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content ?? []);
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "text") parts.push(b.text);
    else if (b.type === "thinking") parts.push(`(thinking) ${b.thinking}`);
    else if (b.type === "toolCall") parts.push(`→ tool_call ${b.name} ${JSON.stringify(b.arguments)}`);
    else if (b.type === "image") parts.push("[image]");
    else parts.push(`[${b.type}]`);
  }
  const role = m.role === "toolResult" ? `tool_result ${m.toolName}${m.isError ? " (ERROR)" : ""}` : m.role;
  return { role, text: parts.join("\n") };
}

/** Active branch of the session tree, root → leaf (skips abandoned branches and earlier appended runs). */
function activeBranch(entries: Entry[]): Entry[] {
  const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id!, e]));
  const branch: Entry[] = [];
  let cur: Entry | undefined = [...entries].reverse().find((e) => e.id);
  while (cur) {
    branch.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return branch.reverse();
}

export function parseSession(sessionPath: string): ParsedSession {
  const entries: Entry[] = fs
    .readFileSync(sessionPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  const steps: SessionStep[] = [];
  const segments: SessionSegment[] = [];
  const stepOfId = new Map<string, number>();
  let segmentStart = 1;

  for (const e of activeBranch(entries)) {
    if (e.type === "message") {
      const step = steps.length + 1;
      stepOfId.set(e.id!, step);
      steps.push({ step, id: e.id!, ...renderMessage(e.message) });
    } else if (e.type === "compaction" && steps.length >= segmentStart) {
      segments.push({
        index: segments.length + 1,
        firstStep: segmentStart,
        lastStep: steps.length,
        compaction: { id: e.id!, summary: e.summary, tokensBefore: e.tokensBefore },
      });
      // the next segment starts at the first kept message (may overlap the end of this one)
      segmentStart = (e.firstKeptEntryId && stepOfId.get(e.firstKeptEntryId)) || steps.length + 1;
    }
  }
  if (steps.length >= segmentStart) {
    segments.push({ index: segments.length + 1, firstStep: segmentStart, lastStep: steps.length });
  }
  return { steps, segments };
}

// ── Rendering ──────────────────────────────────────────────────────────────────

const stepHeader = (s: SessionStep) => `[${s.step}] ${s.id} ${s.role}`;

function preview(s: SessionStep, max = 160): string {
  const flat = s.text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function describeSegment(seg: SessionSegment, steps: SessionStep[]): string {
  const first = steps[seg.firstStep - 1];
  const last = steps[seg.lastStep - 1];
  const n = seg.lastStep - seg.firstStep + 1;
  const kind = seg.compaction
    ? `compacted by ${seg.compaction.id}${seg.compaction.tokensBefore ? `, ${seg.compaction.tokensBefore} tokens` : ""}`
    : "live, never compacted";
  return `segment ${seg.index}: ${first.id} → ${last.id}  (steps ${seg.firstStep}–${seg.lastStep}, ${n} messages, ${kind})`;
}

/** The map of the session, injected in the sub-agent's first message. */
export function sessionOverview(sessionPath: string): string {
  const { steps, segments } = parseSession(sessionPath);
  if (steps.length === 0) return "The session is empty.";
  const lines = [
    `The session has ${steps.length} messages in ${segments.length} segment(s). Messages are identified by their entry id (8 hex chars); [n] is their position.`,
    "",
    ...segments.map((seg) => describeSegment(seg, steps)),
  ];
  const overlap = segments.slice(1).filter((s, i) => s.firstStep <= segments[i].lastStep);
  if (overlap.length) {
    lines.push("", "A segment can start with messages kept across the previous compaction (overlapping steps).");
  }
  return lines.join("\n");
}

function page(text: string, offset = 0, max = 40_000): string {
  const more = offset + max < text.length ? `\n\n[truncated — continue with offset ${offset + max} of ${text.length}]` : "";
  return text.slice(offset, offset + max) + more;
}

// ── Sub-agent tools ────────────────────────────────────────────────────────────

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

/** Tools bound to one session: the sub-agent passes segment numbers and entry ids, never paths. */
export function createSessionTools(sessionPath: string): ToolInput[] {
  const parsed = parseSession(sessionPath);
  const { steps, segments } = parsed;

  const getSegment = (i: number) => {
    const seg = segments[i - 1];
    if (!seg) throw new Error(`No segment ${i}; the session has ${segments.length}`);
    return seg;
  };
  const stepOf = (id: string) => {
    const s = steps.find((x) => x.id === id);
    if (!s) throw new Error(`No message with id "${id}"`);
    return s.step;
  };
  const renderSteps = (from: number, to: number) =>
    steps.slice(from - 1, to).map((s) => `${stepHeader(s)}\n${s.text}`).join("\n\n");

  const readSummary: ToolInput = {
    name: "read_summary",
    label: "Read summary",
    description: "Read the compaction summary of a compacted segment: what the agent had done in that part of the session, as the agent itself recorded it.",
    parameters: Type.Object({ segment: Type.Number({ description: "Segment number" }) }),
    promptSnippet: "Cheap overview of a compacted segment",
    promptGuidelines: ["Read summaries first to locate the segment where things went wrong, then open it with read_segment."],
    execute: async (_id, p: { segment: number }) => {
      const seg = getSegment(p.segment);
      if (!seg.compaction) return text(`Segment ${seg.index} is live (never compacted): read it with read_segment.`);
      return text(`# Summary of segment ${seg.index} (compaction ${seg.compaction.id})\n\n${seg.compaction.summary}`);
    },
  };

  const readSegment: ToolInput = {
    name: "read_segment",
    label: "Read segment",
    description: "Read every message of a segment in full: user messages, assistant text and thinking, tool calls with arguments, tool results. Paged for long segments.",
    parameters: Type.Object({
      segment: Type.Number({ description: "Segment number" }),
      offset: Type.Optional(Type.Number({ description: "Character offset, to continue a truncated read (default 0)" })),
    }),
    promptSnippet: "Full raw messages of one segment",
    execute: async (_id, p: { segment: number; offset?: number }) => {
      const seg = getSegment(p.segment);
      return text(page(`# ${describeSegment(seg, steps)}\n\n${renderSteps(seg.firstStep, seg.lastStep)}`, p.offset));
    },
  };

  const readRange: ToolInput = {
    name: "read_range",
    label: "Read range",
    description: "Read the messages from one entry id to another (inclusive), in full. Use it to examine a precise part of the session, across segment boundaries if needed.",
    parameters: Type.Object({
      from_id: Type.String({ description: "Entry id of the first message" }),
      to_id: Type.Optional(Type.String({ description: "Entry id of the last message (default: same as from_id)" })),
      offset: Type.Optional(Type.Number({ description: "Character offset, to continue a truncated read (default 0)" })),
    }),
    promptSnippet: "Full text of a precise range of messages",
    promptGuidelines: ["Cite messages by their entry id in your analysis so they can be checked with read_range."],
    execute: async (_id, p: { from_id: string; to_id?: string; offset?: number }) => {
      const a = stepOf(p.from_id);
      const b = stepOf(p.to_id ?? p.from_id);
      return text(page(renderSteps(Math.min(a, b), Math.max(a, b)), p.offset));
    },
  };

  const searchSession: ToolInput = {
    name: "search_session",
    label: "Search session",
    description: "Find the messages whose text matches a regular expression (case-insensitive). Returns the entry id, position, segment and a short preview of each match.",
    parameters: Type.Object({
      pattern: Type.String({ description: 'Regular expression, e.g. "tool_call verify" or "error|failed"' }),
    }),
    promptSnippet: "Jump to the messages that mention something",
    execute: async (_id, p: { pattern: string }) => {
      const re = new RegExp(p.pattern, "i");
      const hits = steps.filter((s) => re.test(`${s.role}\n${s.text}`));
      if (hits.length === 0) return text("No match.");
      const segOf = (step: number) => segments.filter((g) => step >= g.firstStep && step <= g.lastStep).map((g) => g.index).join("/");
      const rows = hits.slice(0, 50).map((s) => `${stepHeader(s)} (segment ${segOf(s.step)}): ${preview(s)}`);
      return text(`${hits.length} match(es)${hits.length > 50 ? ", first 50 shown" : ""}\n\n${rows.join("\n")}`);
    },
  };

  return [readSummary, readSegment, readRange, searchSession];
}
