import { post, request } from "./client";
import type { AgentBusyState, AgentDoc, SessionInfo } from "./types";
import type { ChatMessage } from "../chat/types";

export const listAgents = (playground?: string) =>
  request<AgentDoc[]>(
    playground ? `/agents?playground=${encodeURIComponent(playground)}` : "/agents",
  );

export const getAgent = (id: string) => request<AgentDoc>(`/agents/${id}`);
export const getStatus = (id: string) => request<AgentBusyState>(`/agents/${id}/status`);
export const getMessages = (id: string) => request<ChatMessage[]>(`/agents/${id}/messages`);
export const listSessions = (id: string) => request<SessionInfo[]>(`/agents/${id}/sessions`);

export const stopAgent = (id: string) => post(`/agents/${id}/stop`);
export const newSession = (id: string) => post<{ sessionKey: string }>(`/agents/${id}/new-session`);
export const loadSession = (id: string, filename: string) =>
  post<{ loaded: boolean }>(`/agents/${id}/load-session`, { filename });
export const deleteSession = (id: string, sessionKey: string) =>
  request<{ ok: boolean }>(`/agents/${id}/sessions/${encodeURIComponent(sessionKey)}`, {
    method: "DELETE",
  });

export const approveTool = (id: string, toolCallId: string) =>
  post(`/agents/${id}/tool-approve`, { toolCallId });
export const rejectTool = (id: string, toolCallId: string, comment?: string) =>
  post(`/agents/${id}/tool-reject`, { toolCallId, comment });
export const answerClarification = (id: string, toolCallId: string, answers: string[]) =>
  post(`/agents/${id}/clarification-answer`, { toolCallId, answers });
