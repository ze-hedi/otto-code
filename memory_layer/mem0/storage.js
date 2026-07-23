import Database2 from "better-sqlite3";
import { randomUUID } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { v4 as uuidv42 } from "uuid";
import { createClient as createClient3 } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// src/oss/src/vector_stores/qdrant.ts (helper used by SQLiteManager)
function ensureSQLiteDirectory(dbPath) {
  if (!dbPath || dbPath === ":memory:" || dbPath.startsWith("file:")) {
    return;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// src/oss/src/storage/SQLiteManager.ts
var SQLiteManager = class {
  constructor(dbPath) {
    ensureSQLiteDirectory(dbPath);
    this.db = new Database2(dbPath);
    this.init();
  }
  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        action TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        is_deleted INTEGER DEFAULT 0
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_scope TEXT,
        role TEXT,
        content TEXT,
        name TEXT,
        created_at TEXT
      )
    `);
    this.stmtInsert = this.db.prepare(
      `INSERT INTO memory_history
      (memory_id, previous_value, new_value, action, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtSelect = this.db.prepare(
      "SELECT * FROM memory_history WHERE memory_id = ? ORDER BY id DESC"
    );
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    this.stmtInsert.run(
      memoryId,
      previousValue,
      newValue,
      action,
      createdAt != null ? createdAt : null,
      updatedAt != null ? updatedAt : null,
      isDeleted
    );
  }
  async getHistory(memoryId) {
    return this.stmtSelect.all(memoryId);
  }
  async saveMessages(messages, sessionScope) {
    if (!messages.length) return;
    const insertMsg = this.db.prepare(
      `INSERT INTO messages (id, session_scope, role, content, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const evict = this.db.prepare(
      `DELETE FROM messages WHERE session_scope = ? AND id NOT IN (
         SELECT id FROM (
           SELECT id FROM messages WHERE session_scope = ? ORDER BY created_at DESC LIMIT 10
         )
       )`
    );
    const txn = this.db.transaction(() => {
      var _a2;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      for (const msg of messages) {
        insertMsg.run(
          randomUUID(),
          sessionScope,
          msg.role,
          msg.content,
          (_a2 = msg.name) != null ? _a2 : null,
          now
        );
      }
      evict.run(sessionScope, sessionScope);
    });
    txn();
  }
  async getLastMessages(sessionScope, limit = 10) {
    const rows = this.db.prepare(
      `SELECT role, content, name, created_at FROM (
           SELECT role, content, name, created_at
           FROM messages
           WHERE session_scope = ?
           ORDER BY created_at DESC
           LIMIT ?
         ) ORDER BY created_at ASC`
    ).all(sessionScope, limit);
    return rows.map((r) => ({
      role: r.role,
      content: r.content,
      ...r.name != null ? { name: r.name } : {},
      createdAt: r.created_at
    }));
  }
  async batchAddHistory(records) {
    const txn = this.db.transaction(() => {
      var _a2, _b, _c;
      for (const record of records) {
        this.stmtInsert.run(
          record.memoryId,
          record.previousValue,
          record.newValue,
          record.action,
          (_a2 = record.createdAt) != null ? _a2 : null,
          (_b = record.updatedAt) != null ? _b : null,
          (_c = record.isDeleted) != null ? _c : 0
        );
      }
    });
    txn();
  }
  async reset() {
    this.db.exec("DROP TABLE IF EXISTS memory_history");
    this.db.exec("DROP TABLE IF EXISTS messages");
    this.init();
  }
  close() {
    this.db.close();
  }
};

// src/oss/src/storage/MemoryHistoryManager.ts
var MemoryHistoryManager = class {
  constructor() {
    this.memoryStore = /* @__PURE__ */ new Map();
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    const historyEntry = {
      id: uuidv4(),
      memory_id: memoryId,
      previous_value: previousValue,
      new_value: newValue,
      action,
      created_at: createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: updatedAt || null,
      is_deleted: isDeleted
    };
    this.memoryStore.set(historyEntry.id, historyEntry);
  }
  async getHistory(memoryId) {
    return Array.from(this.memoryStore.values()).filter((entry) => entry.memory_id === memoryId).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ).slice(0, 100);
  }
  async reset() {
    this.memoryStore.clear();
  }
  close() {
    return;
  }
};

// src/oss/src/storage/SupabaseHistoryManager.ts
var SupabaseHistoryManager = class {
  constructor(config) {
    this.tableName = config.tableName || "memory_history";
    this.supabase = createClient3(config.supabaseUrl, config.supabaseKey);
    this.initializeSupabase().catch(console.error);
  }
  async initializeSupabase() {
    const { error } = await this.supabase.from(this.tableName).select("id").limit(1);
    if (error) {
      console.error(
        "Error: Table does not exist. Please run this SQL in your Supabase SQL Editor:"
      );
      console.error(`
create table ${this.tableName} (
  id text primary key,
  memory_id text not null,
  previous_value text,
  new_value text,
  action text not null,
  created_at timestamp with time zone default timezone('utc', now()),
  updated_at timestamp with time zone,
  is_deleted integer default 0
);
      `);
      throw error;
    }
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    const historyEntry = {
      id: uuidv42(),
      memory_id: memoryId,
      previous_value: previousValue,
      new_value: newValue,
      action,
      created_at: createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: updatedAt || null,
      is_deleted: isDeleted
    };
    const { error } = await this.supabase.from(this.tableName).insert(historyEntry);
    if (error) {
      console.error("Error adding history to Supabase:", error);
      throw error;
    }
  }
  async getHistory(memoryId) {
    const { data, error } = await this.supabase.from(this.tableName).select("*").eq("memory_id", memoryId).order("created_at", { ascending: false }).limit(100);
    if (error) {
      console.error("Error getting history from Supabase:", error);
      throw error;
    }
    return data || [];
  }
  async reset() {
    const { error } = await this.supabase.from(this.tableName).delete().neq("id", "");
    if (error) {
      console.error("Error resetting Supabase history:", error);
      throw error;
    }
  }
  close() {
    return;
  }
};

// src/oss/src/storage/DummyHistoryManager.ts
var DummyHistoryManager = class {
  constructor() {
  }
  async addHistory(memoryId, previousValue, newValue, action, createdAt, updatedAt, isDeleted = 0) {
    return;
  }
  async getHistory(memoryId) {
    return [];
  }
  async reset() {
    return;
  }
  close() {
    return;
  }
};

export { SQLiteManager, MemoryHistoryManager, SupabaseHistoryManager, DummyHistoryManager };
