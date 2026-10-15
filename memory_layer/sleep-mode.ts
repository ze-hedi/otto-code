// sleep-mode.ts
// Offline distillation of agent session JSONL files into persistent Mem0 memories.
//
// Analogy: the brain during sleep replays the day's events and consolidates them
// into long-term memory. This module does the same for agent sessions.
//
// Usage:
//   const sleep = new SleepMode(mem0Config);
//   const result = await sleep.distill(sessionFilePath, { agentId: "my-agent", userId: "user-1" });
//
// Idempotent: tracks progress via a cursor file alongside the session JSONL.
// Re-running on the same file picks up where it left off.

import fs from "fs";
import path from "path";
import readline from "readline";
import { Mem0, type Mem0Config, type Message } from "./mem0.js";

// ── JSONL event types ──────────────────────────────────────────────────────────

interface SessionInitEvent {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

interface ModelChangeEvent {
  type: "model_change";
  id: string;
  parentId: string | null;
  timestamp: string;
  provider: string;
  modelId: string;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; thinkingSignature?: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

interface MessageEvent {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message:
    | { role: "user"; content: ContentBlock[]; timestamp: number }
    | { role: "assistant"; content: ContentBlock[]; timestamp: number; [k: string]: unknown }
    | { role: "toolResult"; toolCallId: string; toolName: string; content: ContentBlock[]; isError: boolean; timestamp: number };
}

interface CompactionEvent {
  type: "compaction_end";
  id: string;
  parentId: string | null;
  timestamp: string;
  errorMessage: string | null;
}

type SessionEvent = SessionInitEvent | ModelChangeEvent | MessageEvent | CompactionEvent | { type: string; [k: string]: unknown };

// ── Cursor (idempotency) ───────────────────────────────────────────────────────

interface Cursor {
  /** Last JSONL event id that was included in a Mem0 add() call */
  lastProcessedId: string | null;
  /** ISO timestamp of the last distillation run */
  lastRunAt: string;
  /** Total turns processed so far */
  turnsProcessed: number;
  /** Total memories extracted so far (as reported by Mem0) */
  memoriesExtracted: number;
}

function cursorPath(sessionFile: string): string {
  return sessionFile.replace(/\.jsonl$/, ".sleep-cursor.json");
}

function loadCursor(sessionFile: string): Cursor {
  const p = cursorPath(sessionFile);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Cursor;
  }
  return { lastProcessedId: null, lastRunAt: new Date(0).toISOString(), turnsProcessed: 0, memoriesExtracted: 0 };
}

function saveCursor(sessionFile: string, cursor: Cursor): void {
  fs.writeFileSync(cursorPath(sessionFile), JSON.stringify(cursor, null, 2), "utf8");
}

// ── Turn extraction ────────────────────────────────────────────────────────────

/**
 * A "turn" is one user message followed by the complete assistant response
 * (which may span multiple assistant message events before the next user message).
 */
interface Turn {
  /** The last event id in this turn (used to advance the cursor) */
  lastEventId: string;
  messages: Message[];
}

/**
 * Parse the JSONL file and extract conversation turns as Mem0-compatible messages.
 *
 * Rules:
 * - user   → keep text blocks, join to string
 * - assistant → keep text blocks only (skip thinking + toolCall — procedural noise)
 * - toolResult → skip (raw command output, not semantic)
 * - compaction_end → skip
 * - Events at or before `afterId` are skipped (cursor resume)
 */
async function extractTurns(sessionFile: string, afterId: string | null): Promise<Turn[]> {
  const events: SessionEvent[] = [];

  await new Promise<void>((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(sessionFile), crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        events.push(JSON.parse(trimmed) as SessionEvent);
      } catch {
        // malformed line — skip
      }
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });

  // Skip events up to and including the cursor position
  let pastCursor = afterId === null;
  const turns: Turn[] = [];
  let currentTurnMessages: Message[] = [];
  let currentTurnLastId: string = "";

  for (const event of events) {
    if (!pastCursor) {
      if ("id" in event && event.id === afterId) pastCursor = true;
      continue;
    }

    if (event.type !== "message") continue;

    const msgEvent = event as MessageEvent;
    const { role } = msgEvent.message;
    const eventId = msgEvent.id;

    if (role === "toolResult") continue; // skip tool noise

    if (role === "user") {
      // Flush the previous turn if it has content
      if (currentTurnMessages.length > 0) {
        turns.push({ lastEventId: currentTurnLastId, messages: currentTurnMessages });
        currentTurnMessages = [];
      }
      const text = extractText(msgEvent.message.content as ContentBlock[]);
      if (text) {
        currentTurnMessages.push({ role: "user", content: text });
        currentTurnLastId = eventId;
      }
      continue;
    }

    if (role === "assistant") {
      // Always advance the cursor past this event, even if it has no extractable text
      // (e.g. pure tool-call messages). This ensures the cursor moves past tool-heavy turns.
      currentTurnLastId = eventId;
      const text = extractText(msgEvent.message.content as ContentBlock[], /* textOnly */ true);
      if (text) {
        currentTurnMessages.push({ role: "assistant", content: text });
      }
      continue;
    }
  }

  // Flush final turn
  if (currentTurnMessages.length > 0) {
    turns.push({ lastEventId: currentTurnLastId, messages: currentTurnMessages });
  }

  return turns;
}

/**
 * Collapse content blocks into a plain string for Mem0.
 * @param textOnly - when true, skip thinking blocks (used for assistant messages)
 */
function extractText(blocks: ContentBlock[], textOnly = false): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => {
      if (b.type === "text") return true;
      if (!textOnly && b.type === "thinking") return false; // always skip thinking
      return false;
    })
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface SleepOptions {
  /** Stable agent identity — scopes memories to this agent across all sessions */
  agentId: string;
  /** Optional user scope */
  userId?: string;
  /**
   * How many messages to feed to Mem0 per add() call.
   * Smaller windows = more precise extraction but more LLM calls.
   * Default: 6 (3 turns)
   */
  windowSize?: number;
  /**
   * How many preceding messages to pass as conversationHistory for pronoun resolution.
   * Default: 4
   */
  historyContext?: number;
  /** Called after each Mem0 add() with progress info */
  onProgress?: (info: ProgressInfo) => void;
}

export interface ProgressInfo {
  sessionFile: string;
  turnsTotal: number;
  turnsProcessed: number;
  memoriesExtracted: number;
}

export interface DistillResult {
  sessionFile: string;
  /** Session ID from the JSONL header */
  sessionId: string;
  turnsProcessed: number;
  memoriesExtracted: number;
  skipped: number;
  durationMs: number;
}

export class SleepMode {
  private _mem0: Mem0;

  constructor(config: Mem0Config) {
    this._mem0 = new Mem0(config);
  }

  /**
   * Distill a single session JSONL file into Mem0 memories.
   * Idempotent — safe to call multiple times; resumes from cursor.
   */
  async distill(sessionFile: string, options: SleepOptions): Promise<DistillResult> {
    const start = Date.now();
    const { agentId, userId, windowSize = 6, historyContext = 4, onProgress } = options;

    if (!fs.existsSync(sessionFile)) {
      throw new Error(`Session file not found: ${sessionFile}`);
    }

    // Read the session ID from line 1
    const sessionId = readSessionId(sessionFile);

    // Load cursor for idempotent resume
    const cursor = loadCursor(sessionFile);

    // Extract new turns since last run
    const turns = await extractTurns(sessionFile, cursor.lastProcessedId);

    if (turns.length === 0) {
      return {
        sessionFile,
        sessionId,
        turnsProcessed: 0,
        memoriesExtracted: 0,
        skipped: cursor.turnsProcessed,
        durationMs: Date.now() - start,
      };
    }

    // Filter out turns that only have a user message (no assistant text reply) —
    // those are pure tool-call turns with no semantic content to distill.
    const semanticTurns = turns.filter((t) => t.messages.length >= 2);

    // Flatten into a message stream, tracking which turn each message belongs to
    const allMessages: Array<Message & { _turnId: string }> = semanticTurns.flatMap((t) =>
      t.messages.map((m) => ({ ...m, _turnId: t.lastEventId }))
    );

    let memoriesExtracted = 0;
    let lastProcessedId = cursor.lastProcessedId;

    // Slide a window of `windowSize` messages, stepping by windowSize/2 for overlap
    // so context boundaries don't split a topic mid-extraction
    const step = Math.max(2, Math.floor(windowSize / 2));

    for (let i = 0; i < allMessages.length; i += step) {
      const window = allMessages.slice(i, i + windowSize);
      if (window.length === 0) break;

      // conversationHistory = messages before this window (for pronoun resolution)
      const historyStart = Math.max(0, i - historyContext);
      const conversationHistory = allMessages
        .slice(historyStart, i)
        .map(({ role, content }) => ({ role, content }));

      const messages: Message[] = window.map(({ role, content }) => ({ role, content }));

      const result = await this._mem0.add(messages, {
        agentId,
        ...(userId ? { userId } : { userId: agentId }), // fallback: scope to agent
        runId: sessionId,
        conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
        metadata: { sessionFile: path.basename(sessionFile), distilledAt: new Date().toISOString() },
      });

      memoriesExtracted += result.results.length;
      // Advance cursor to the last event id seen in this window
      lastProcessedId = window[window.length - 1]._turnId;

      // Save cursor after every window — crashes don't lose progress
      saveCursor(sessionFile, {
        lastProcessedId,
        lastRunAt: new Date().toISOString(),
        turnsProcessed: cursor.turnsProcessed + Math.min(i + window.length, allMessages.length),
        memoriesExtracted: cursor.memoriesExtracted + memoriesExtracted,
      });

      onProgress?.({
        sessionFile,
        turnsTotal: semanticTurns.length,
        turnsProcessed: Math.min(i + step, allMessages.length),
        memoriesExtracted,
      });
    }

    return {
      sessionFile,
      sessionId,
      turnsProcessed: turns.length,
      memoriesExtracted,
      skipped: cursor.turnsProcessed,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Distill all JSONL files in a session directory.
   * Processes files in chronological order (oldest first).
   */
  async distillAll(sessionDir: string, options: SleepOptions): Promise<DistillResult[]> {
    if (!fs.existsSync(sessionDir)) {
      throw new Error(`Session directory not found: ${sessionDir}`);
    }

    const files = fs
      .readdirSync(sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(sessionDir, f))
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs); // oldest first

    const results: DistillResult[] = [];
    for (const file of files) {
      const result = await this.distill(file, options);
      results.push(result);
    }
    return results;
  }

  /**
   * Retrieve all memories distilled for an agent (optionally scoped to a user).
   */
  async recall(agentId: string, userId?: string) {
    return this._mem0.getAll({
      agentId,
      ...(userId ? { userId } : { userId: agentId }),
    });
  }

  /**
   * Search memories distilled for an agent.
   */
  async search(query: string, agentId: string, userId?: string) {
    return this._mem0.search(query, {
      agentId,
      ...(userId ? { userId } : { userId: agentId }),
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readSessionId(sessionFile: string): string {
  const firstLine = fs.readFileSync(sessionFile, "utf8").split("\n")[0]?.trim();
  if (!firstLine) return path.basename(sessionFile, ".jsonl");
  try {
    const parsed = JSON.parse(firstLine) as SessionEvent;
    if (parsed.type === "session" && "id" in parsed) return (parsed as SessionInitEvent).id;
  } catch {
    // fall through
  }
  return path.basename(sessionFile, ".jsonl");
}
