import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage, ChatState, MessagePart } from "./types";

interface ChatsStore {
  chats: Record<string, ChatState>;
}

export const useChatStore = create<ChatsStore>(() => ({ chats: {} }));

const blank = (agentId: string): ChatState => ({
  agentId,
  messages: [],
  status: "idle",
  loaded: false,
});

export function patchChat(agentId: string, patch: Partial<ChatState>) {
  useChatStore.setState((s) => ({
    chats: { ...s.chats, [agentId]: { ...(s.chats[agentId] ?? blank(agentId)), ...patch } },
  }));
}

export function setMessages(agentId: string, messages: ChatMessage[]) {
  patchChat(agentId, { messages });
}

export function getChat(agentId: string): ChatState {
  return useChatStore.getState().chats[agentId] ?? blank(agentId);
}

/** Applies `fn` to the parts of the last assistant message (creating it if missing). */
export function updateLastAssistantParts(
  agentId: string,
  fn: (parts: MessagePart[]) => MessagePart[],
) {
  const chat = getChat(agentId);
  const messages = [...chat.messages];
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    messages[messages.length - 1] = { ...last, parts: fn(last.parts) };
  } else {
    messages.push({ role: "assistant", content: "", parts: fn([]) });
  }
  patchChat(agentId, { messages });
}

export function updatePart(
  agentId: string,
  toolCallId: string,
  fn: (p: MessagePart) => MessagePart,
) {
  updateLastAssistantParts(agentId, (parts) =>
    parts.map((p) => ("toolCallId" in p && p.toolCallId === toolCallId ? fn(p) : p)),
  );
}

// ── Recents: persisted so the Chats tab survives an app restart ───────────────

export interface RecentChat {
  agentId: string;
  name: string;
  projectId?: string;
  lastUsed: number;
}

interface RecentsStore {
  recents: RecentChat[];
  touch: (r: Omit<RecentChat, "lastUsed">) => void;
  remove: (agentId: string) => void;
}

export const useRecents = create<RecentsStore>()(
  persist(
    (set) => ({
      recents: [],
      touch: (r) =>
        set((s) => ({
          recents: [
            { ...r, lastUsed: Date.now() },
            ...s.recents.filter((x) => x.agentId !== r.agentId),
          ].slice(0, 50),
        })),
      remove: (agentId) => set((s) => ({ recents: s.recents.filter((x) => x.agentId !== agentId) })),
    }),
    { name: "otto-recents", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
