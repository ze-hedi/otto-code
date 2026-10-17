import type { MessagePart, SubAgentPart } from "./types";

const MAX_RESULT = 1500;

function stringify(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2) ?? "";
  return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + "\n... (truncated)" : s;
}

function appendText<T extends { type: string; content?: string }>(
  list: T[],
  kind: "thinking" | "text",
  text: string,
): T[] {
  const last = list[list.length - 1];
  if (last && last.type === kind) {
    return [...list.slice(0, -1), { ...last, content: (last.content ?? "") + text }];
  }
  return [...list, { type: kind, content: text } as unknown as T];
}

function finishSubTool(parts: SubAgentPart[], ev: any): SubAgentPart[] {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === "tool" && p.name === ev.name && p.status === "running") {
      const next = [...parts];
      next[i] = { ...p, result: stringify(ev.result), isError: ev.isError, status: "done" };
      return next;
    }
  }
  return parts;
}

function applySubagentEvent(parts: MessagePart[], ev: any): MessagePart[] {
  let next = parts;
  // Promote the plain tool part to a sub-agent part on the first sub-event.
  const toolIdx = next.findIndex((p) => p.type === "tool" && p.toolCallId === ev.toolCallId);
  if (toolIdx !== -1) {
    const old = next[toolIdx] as Extract<MessagePart, { type: "tool" }>;
    next = [...next];
    next[toolIdx] = {
      type: "subagent",
      toolCallId: ev.toolCallId,
      toolName: old.name,
      status: "running",
      parts: [],
    };
  }
  const idx = next.findIndex((p) => p.type === "subagent" && p.toolCallId === ev.toolCallId);
  if (idx === -1) return next;
  const sa = next[idx] as Extract<MessagePart, { type: "subagent" }>;

  let sub = sa.parts;
  if (ev.subType === "thinking" && ev.text) sub = appendText(sub, "thinking", ev.text);
  else if (ev.subType === "delta" && ev.text) sub = appendText(sub, "text", ev.text);
  else if (ev.subType === "tool_start")
    sub = [...sub, { type: "tool", name: ev.name, input: JSON.stringify(ev.args, null, 2), status: "running" }];
  else if (ev.subType === "tool_end") sub = finishSubTool(sub, ev);

  next = [...next];
  next[idx] = { ...sa, parts: sub };
  return next;
}

function applyToolEnd(parts: MessagePart[], ev: any): MessagePart[] {
  let next = parts;
  if (ev.toolCallId) {
    // A finished tool call can no longer be waiting on a clarification.
    next = next.filter((p) => !(p.type === "clarification" && p.toolCallId === ev.toolCallId));
    const saIdx = next.findIndex((p) => p.type === "subagent" && p.toolCallId === ev.toolCallId);
    if (saIdx !== -1) {
      const sa = next[saIdx] as Extract<MessagePart, { type: "subagent" }>;
      next = [...next];
      next[saIdx] = { ...sa, result: stringify(ev.result), isError: ev.isError, status: "done" };
      return next;
    }
  }
  for (let i = next.length - 1; i >= 0; i--) {
    const p = next[i];
    if (
      p.type === "tool" &&
      p.status === "running" &&
      (ev.toolCallId ? p.toolCallId === ev.toolCallId : p.name === ev.name)
    ) {
      next = [...next];
      next[i] = { ...p, result: stringify(ev.result), isError: ev.isError, status: "done" };
      return next;
    }
  }
  return next;
}

/** Pure: applies one SSE event from the backend to an assistant message's parts. */
export function applyEvent(parts: MessagePart[], ev: any): MessagePart[] {
  switch (ev?.type) {
    case "thinking":
      return ev.text ? appendText(parts, "thinking", ev.text) : parts;
    case "delta":
      return ev.text ? appendText(parts, "text", ev.text) : parts;
    case "tool_start":
      return [
        ...parts,
        {
          type: "tool",
          name: ev.name,
          input: JSON.stringify(ev.args, null, 2),
          status: "running",
          toolCallId: ev.toolCallId,
        },
      ];
    case "subagent_event":
      return applySubagentEvent(parts, ev);
    case "tool_approval_required":
      return [
        ...parts,
        {
          type: "tool_approval",
          toolCallId: ev.toolCallId,
          toolName: ev.name,
          args: JSON.stringify(ev.args, null, 2),
          status: "pending",
        },
      ];
    case "clarification_required":
      return [
        ...parts,
        {
          type: "clarification",
          toolCallId: ev.toolCallId,
          questions: ev.questions,
          answers: (ev.questions as string[]).map(() => ""),
          status: "pending",
        },
      ];
    case "tool_end":
      return applyToolEnd(parts, ev);
    case "error":
      return [...parts, { type: "text", content: `Error: ${ev.message}` }];
    default:
      return parts;
  }
}
