# Minimal Slack Clone — Plan of Action

## 1. Goal
Build a self-contained, minimal Slack clone: a team chat app with real-time
messaging, channels, and direct messages. Single workspace, single server.

## 2. Tech Stack (chosen for consistency with the existing `otto_code` repo)
- **Backend:** Node.js + TypeScript, Express 5, `ws` (WebSocket), `better-sqlite3`
- **Frontend:** React 19 + Vite + TypeScript
- **Auth:** email/password with bcrypt hashing, session token (httpOnly cookie)
- **Realtime:** WebSockets for live messages + presence
- **Database:** SQLite (zero config, single file)

## 3. Feature Scope

### In scope (v1 — minimal)
- Register / login / logout / "who am I"
- Channels: create, join, list (auto-join default `#general`)
- Direct messages: 1:1 conversations
- Send + receive messages in real time
- Delete own messages (soft delete)
- Persistent message history (paginated on channel open)
- Presence: online/offline indicators
- Basic unread badges (nice-to-have)

### Out of scope (v2 — stretch goals)
- Threads, reactions/emoji, file/image upload
- Full-text search, @mentions, push/email notifications
- Message editing
- Multiple workspaces/tenants, roles/permissions
- Horizontal scaling / multiple server instances

## 4. Data Model (SQLite)

- `users`
  - id (TEXT PK, uuid)
  - email (TEXT UNIQUE)
  - password_hash (TEXT)
  - display_name (TEXT)
  - avatar_color (TEXT)
  - created_at (INTEGER)
  - last_seen_at (INTEGER)

- `channels`
  - id (TEXT PK, uuid)
  - name (TEXT UNIQUE)          # lowercase, e.g. "general"
  - is_direct (INTEGER 0/1)     # 1 => a DM conversation
  - created_by (TEXT FK users.id)
  - created_at (INTEGER)

- `channel_members`
  - channel_id (TEXT FK)
  - user_id (TEXT FK)
  - joined_at (INTEGER)
  - PRIMARY KEY (channel_id, user_id)
  # For DMs there are exactly 2 members.

- `messages`
  - id (TEXT PK, uuid)
  - channel_id (TEXT FK)
  - user_id (TEXT FK)
  - body (TEXT)
  - created_at (INTEGER)
  - edited_at (INTEGER NULL)
  - deleted_at (INTEGER NULL)   # soft delete

- `sessions`
  - token (TEXT PK)
  - user_id (TEXT FK)
  - created_at (INTEGER)
  - expires_at (INTEGER)

Presence is tracked **in memory** (Map<userId, socketCount>) and broadcast over
WebSockets; `last_seen_at` is written to DB on connect/disconnect.

## 5. API Surface (REST)

Auth
- POST `/api/auth/register` {email, password, displayName}
- POST `/api/auth/login`    {email, password}
- POST `/api/auth/logout`
- GET  `/api/auth/me`

Channels & DMs
- GET  `/api/channels`               # channels + DMs the user is a member of
- POST `/api/channels`               # create channel {name}
- GET  `/api/channels/:id/members`
- POST `/api/dms`                    # create/get DM {userId}

Messages
- GET  `/api/channels/:id/messages`  # paginated {before?, limit?}
- POST `/api/channels/:id/messages`  # send {body}
- DELETE `/api/messages/:id`          # delete own message (soft delete)

Users
- GET  `/api/users`                  # for DM creation / member list

## 6. WebSocket Events

Client -> Server
- `auth`          {token}                # identify the connection
- `subscribe`     {channelId}            # start receiving messages for a channel
- `unsubscribe`   {channelId}
- `message:send`  {channelId, body}      # send a message
- `presence:ping`                        # heartbeat

Server -> Client
- `message:new`   {message}              # a message in a subscribed channel
- `presence:update` {userId, online}     # someone came online / went offline
- `channel:created` {channel}            # (optional) new channel notification
- `error`         {message}

## 7. Directory Structure

```
slack-clone/
├── PLAN.md
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts        # HTTP + WS server entrypoint
│       ├── db.ts           # SQLite connection + schema + seed
│       ├── auth.ts         # register/login/logout/me + middleware
│       ├── channels.ts     # channels, DMs, membership
│       ├── messages.ts     # send + list messages
│       ├── ws.ts           # WebSocket handling + presence
│       └── types.ts        # shared server types
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api.ts          # REST client
        ├── socket.ts       # WebSocket client
        ├── types.ts
        ├── auth/
        │   ├── Login.tsx
        │   └── Register.tsx
        └── components/
            ├── Sidebar.tsx
            ├── ChannelList.tsx
            ├── DirectMessages.tsx
            ├── ChannelHeader.tsx
            ├── MessageList.tsx
            ├── MessageInput.tsx
            └── UserList.tsx
```

## 8. Milestones (build order)

1. **Scaffold + DB + Auth** — server package, SQLite schema, register/login/logout, session middleware, seed `#general` + a test user.
2. **Channels & DMs (REST)** — create/list/join channels, create/get DMs, membership.
3. **Messaging (REST)** — send messages, fetch paginated history.
4. **Real-time (WebSocket)** — live message delivery, presence tracking, heartbeat.
5. **Frontend UI** — auth screens, sidebar (channels + DMs), message pane, input box, presence indicators.
6. **Polish** — unread badges, empty states, error handling, seed data, README run instructions.

## 9. How to Run (target end state)

```bash
# Terminal 1 — server (http://localhost:4000)
cd slack-clone/server && npm install && npm run dev

# Terminal 2 — client (http://localhost:5173)
cd slack-clone/client && npm install && npm run dev
```

## 10. Decisions Confirmed
- DMs: explicit "New DM" picker from a user list (no auto-create).
- Message delete: in v1 (soft delete).
