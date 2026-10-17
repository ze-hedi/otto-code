export type SubAgentPart =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "tool"; name: string; input: string; result?: string; isError?: boolean; status: "running" | "done" };

export type MessagePart =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "tool"; name: string; input: string; result?: string; isError?: boolean; status: "running" | "done"; toolCallId?: string }
  | { type: "subagent"; toolCallId: string; toolName: string; status: "running" | "done"; parts: SubAgentPart[]; result?: string; isError?: boolean }
  | { type: "tool_approval"; toolCallId: string; toolName: string; args: string; status: "pending" | "approved" | "rejected" }
  | { type: "clarification"; toolCallId: string; questions: string[]; answers: string[]; status: "pending" | "answered" };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string; // user messages
  parts: MessagePart[]; // assistant messages
}

export type ChatStatus = "idle" | "streaming" | "disconnected";

export interface ChatState {
  agentId: string;
  messages: ChatMessage[];
  status: ChatStatus;
  /** True once history was fetched at least once in this app run. */
  loaded: boolean;
  error?: string;
}
