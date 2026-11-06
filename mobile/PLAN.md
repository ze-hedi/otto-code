# Otto Mobile — Plan (agents only)

A standalone React Native (Expo, TypeScript) app. It only consumes the existing
backend over REST + SSE. No shared code with `web_app`, no auth yet, no backend
changes.

## 1. Scope

**In**
- Projects list.
- Per project: its agents (read-only, no editing).
- Chat with an agent, streamed (text, thinking, tool calls, sub-agents).
- Several chats streaming at once, one per agent. They keep streaming when the
  user leaves the screen.
- Tool approve/reject and clarification answers.
- Stop, new session, resume/delete past sessions.
- Settings: backend URL.

**Out**: workflows, dashboards, agent/project editing, auth, push notifications.

## 2. Backend behaviour we design around (verified in `web_app/backend/src`)

| Fact | Consequence for the app |
|---|---|
| Busy state is per **agent**; `POST /agents/:id/chat` returns 409 if busy | One stream per agent. Parallelism = different agents. The app never sends while an agent is streaming. |
| One active session per agent (`new-session` / `load-session` switch it) | Sessions of one agent are sequential. Switching is blocked while the agent streams. |
| A chat keeps running if the client disconnects | Leaving a screen or losing the connection never kills a run. |
| `GET /agents/:id/events` attaches to a running chat but **does not replay** | To resume: `GET /messages` first, then attach to `/events`. Tokens emitted in the gap are lost until the run finishes; a final `/messages` refetch fixes the view. |
| Project has only `name` + `path` | Agents of a project come from `GET /agents?playground=<project.path>`, same as the web app. |

## 3. Stack

Expo (SDK 54) · TypeScript strict · Expo Router · TanStack Query (REST lists) ·
Zustand (live chat state + persisted settings) · `expo/fetch` for streaming POST ·
`react-native-markdown-display` · AsyncStorage.

## 4. Architecture

```
mobile/
  app/
    _layout.tsx               providers, hydration gate, foreground resync
    (tabs)/index.tsx          Projects
    (tabs)/chats.tsx          Chats tab: every opened agent chat + live status
    (tabs)/settings.tsx       Backend URL
    project/[id].tsx          Agents of a project
    chat/[agentId].tsx        Chat screen
    sessions/[agentId].tsx    Past sessions (resume / delete)
  src/
    api/                      typed REST client (client, types, projects, agents)
    sse/readSSE.ts            streaming POST/GET -> async iterator of events
    chat/
      types.ts                message + part types
      eventReducer.ts         pure: (parts, event) -> parts
      chatStore.ts            Zustand: chats by agentId + persisted recents
      ChatManager.ts          owns every stream (module singleton)
    components/               MessageView, PartView, Approval/Clarification cards
    settings.ts               persisted base URL
```

**Rule: screens never own a stream.** `ChatManager` does; screens subscribe to
the store. That is what lets a chat keep streaming after navigation.

## 5. Concurrency

- `ChatManager` keeps `Map<agentId, AbortController>` for live connections.
- `status` per chat: `idle | streaming | disconnected`.
- Send: optimistic user bubble + empty assistant bubble -> `POST /chat` stream ->
  events through `eventReducer` into the store. 409 => attach to `/events` instead.
- Open chat: if a live connection exists, do nothing. Otherwise `GET /messages`,
  `GET /status`; if busy, attach to `/events`.
- App returns to foreground: `resync` every chat that was streaming or
  disconnected (drop the possibly dead socket, then the "open chat" flow).
- Recents (agent id + name + project) are persisted so the Chats tab survives an
  app restart and can discover agents that are still running server-side.

## 6. Screens -> endpoints

| Screen | Endpoints |
|---|---|
| Projects | `GET /projects` |
| Project | `GET /projects`, `GET /agents?playground=` |
| Chat | `GET /agents/:id`, `/messages`, `/status`, `POST /chat` (SSE), `GET /events` (SSE), `POST /stop` |
| Approvals | `POST /tool-approve`, `/tool-reject`, `/clarification-answer` |
| New session | `POST /new-session` |
| Sessions | `GET /sessions`, `POST /load-session`, `DELETE /sessions/:key` |

## 7. Milestones

- **M1 Skeleton:** settings, API client, Projects, Project -> agents.
- **M2 Chat:** streaming, markdown, thinking/tool/sub-agent parts, stop, history.
- **M3 Concurrency:** ChatManager + store, Chats tab, survive navigation.
- **M4 Resilience:** foreground resync, 409 handling, approvals, clarifications,
  sessions list/resume/delete.
- **Later:** auth, push notifications for approvals, workflows (needs backend
  work: global `currentWorkflow`, abort-on-disconnect), event replay in backend.

## 8. Risks

- Streaming POST on React Native: verify on a real iOS and Android device first.
- No event replay: mid-stream tokens can be missed across a reconnect.
- iOS/Android block plain HTTP by default; Expo config enables it for dev
  (`usesCleartextTraffic`, ATS exception). Use HTTPS before shipping.
- The phone must reach the backend (LAN IP, not `localhost`), and the backend
  must listen on `0.0.0.0` (Express does by default).
