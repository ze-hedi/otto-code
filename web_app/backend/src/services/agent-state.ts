import { EventEmitter } from "events";

// In-memory per-agent chat state. Shared by the in-process backend and the container runner.

const sessionKeys = new Map<string, string>();
const busyAgents = new Map<string, string>();        // agentId → sessionKey while streaming
const agentEmitters = new Map<string, EventEmitter>(); // per-agent event bus

export function getSessionKey(agentId: string): string {
  return sessionKeys.get(agentId) ?? "main";
}

export function setSessionKey(agentId: string, key: string): void {
  sessionKeys.set(agentId, key);
}

export function markBusy(agentId: string, sessionKey: string): EventEmitter {
  busyAgents.set(agentId, sessionKey);
  const emitter = new EventEmitter();
  agentEmitters.set(agentId, emitter);
  return emitter;
}

export function markIdle(agentId: string): void {
  busyAgents.delete(agentId);
  const emitter = agentEmitters.get(agentId);
  if (emitter) {
    emitter.emit("done");
    emitter.removeAllListeners();
    agentEmitters.delete(agentId);
  }
}

export function getAgentBusyState(agentId: string): { busy: boolean; sessionKey: string | null } {
  const sk = busyAgents.get(agentId);
  return { busy: !!sk, sessionKey: sk ?? null };
}

export function getAgentEmitter(agentId: string): EventEmitter | undefined {
  return agentEmitters.get(agentId);
}
