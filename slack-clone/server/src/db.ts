import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './password.js';
import type { ChannelRow, UserRow } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'slack.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_color  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE IF NOT EXISTS channels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  is_direct  INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages (channel_id, created_at DESC);
`);

/** Insert the default #general channel and demo users on first run. */
function seed(): void {
  // #general channel
  let general = db
    .prepare('SELECT id FROM channels WHERE name = ? AND is_direct = 0')
    .get('general') as Pick<ChannelRow, 'id'> | undefined;

  if (!general) {
    db.prepare(
      'INSERT INTO channels (id, name, is_direct, created_by, created_at) VALUES (?, ?, 0, NULL, ?)'
    ).run(randomUUID(), 'general', Date.now());
    general = db
      .prepare('SELECT id FROM channels WHERE name = ? AND is_direct = 0')
      .get('general') as Pick<ChannelRow, 'id'> | undefined;
  }

  // Demo users (password: password123)
  const demoUsers = [
    { email: 'alice@demo.com', display: 'Alice', color: '#e01e5a' },
    { email: 'bob@demo.com', display: 'Bob', color: '#2eb67d' },
  ];
  for (const u of demoUsers) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    if (!existing) {
      db.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, avatar_color, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), u.email, hashPassword('password123'), u.display, u.color, Date.now(), null);
    }
  }

  // Add every user to #general
  const generalId = (general as Pick<ChannelRow, 'id'>).id;
  const userIds = db.prepare('SELECT id FROM users').all() as Pick<UserRow, 'id'>[];
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)'
  );
  for (const { id } of userIds) {
    insertMember.run(generalId, id, Date.now());
  }
}

seed();
