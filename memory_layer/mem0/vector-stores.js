// src/oss/src/vector_stores/memory.ts
import Database from "better-sqlite3";
import fs2 from "fs";
import path2 from "path";

// src/oss/src/utils/sqlite.ts
import fs from "fs";
import os from "os";
import path from "path";
function getDefaultVectorStoreDbPath() {
  return path.join(os.homedir(), ".mem0", "vector_store.db");
}
function ensureSQLiteDirectory(dbPath) {
  if (!dbPath || dbPath === ":memory:" || dbPath.startsWith("file:")) {
    return;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// src/oss/src/vector_stores/memory.ts
var _MemoryVectorStore = class _MemoryVectorStore {
  normalizePayload(payload) {
    for (const [camel, snake] of Object.entries(
      _MemoryVectorStore.CAMEL_TO_SNAKE
    )) {
      if (camel in payload && !(snake in payload)) {
        payload[snake] = payload[camel];
        delete payload[camel];
      }
    }
    return payload;
  }
  constructor(config) {
    this.dimension = config.dimension || 1536;
    this.dbPath = config.dbPath || getDefaultVectorStoreDbPath();
    if (!config.dbPath) {
      const oldDefault = path2.join(process.cwd(), "vector_store.db");
      if (fs2.existsSync(oldDefault) && oldDefault !== this.dbPath) {
        console.warn(
          `[mem0] Default vector_store.db location changed from ${oldDefault} to ${this.dbPath}. Move your existing file or set vectorStore.config.dbPath explicitly.`
        );
      }
    }
    ensureSQLiteDirectory(this.dbPath);
    this.db = new Database(this.dbPath);
    this.init();
  }
  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        payload TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE
      )
    `);
  }
  cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  /**
   * Check if a single field condition matches the payload.
   * Supports comparison operators: eq, ne, gt, gte, lt, lte, in, nin, contains, icontains
   */
  matchFieldCondition(payload, key, value) {
    const payloadValue = payload[key];
    if (typeof value !== "object" || value === null) {
      if (value === "*") {
        return true;
      }
      return payloadValue === value;
    }
    if (Array.isArray(value)) {
      return value.includes(payloadValue);
    }
    if ("eq" in value) {
      return payloadValue === value.eq;
    }
    if ("ne" in value) {
      return payloadValue !== value.ne;
    }
    if ("gt" in value) {
      return payloadValue > value.gt;
    }
    if ("gte" in value) {
      return payloadValue >= value.gte;
    }
    if ("lt" in value) {
      return payloadValue < value.lt;
    }
    if ("lte" in value) {
      return payloadValue <= value.lte;
    }
    if ("in" in value) {
      return Array.isArray(value.in) && value.in.includes(payloadValue);
    }
    if ("nin" in value) {
      return !Array.isArray(value.nin) || !value.nin.includes(payloadValue);
    }
    if ("contains" in value) {
      return typeof payloadValue === "string" && payloadValue.includes(value.contains);
    }
    if ("icontains" in value) {
      return typeof payloadValue === "string" && payloadValue.toLowerCase().includes(value.icontains.toLowerCase());
    }
    return payloadValue === value;
  }
  /**
   * Filter a vector by the given filters.
   * Supports logical operators (AND, OR, NOT) and comparison operators.
   */
  filterVector(vector, filters) {
    if (!filters || Object.keys(filters).length === 0) return true;
    const keyMap = {
      $and: "AND",
      $or: "OR",
      $not: "NOT"
    };
    const normalized = {};
    for (const [key, value] of Object.entries(filters)) {
      const normKey = keyMap[key] || key;
      if (!(normKey in normalized)) {
        normalized[normKey] = value;
      }
    }
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "AND") {
        if (!Array.isArray(value)) {
          throw new Error(
            `AND filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        const allMatch = value.every(
          (sub) => this.filterVector(vector, sub)
        );
        if (!allMatch) return false;
      } else if (key === "OR") {
        if (!Array.isArray(value)) {
          throw new Error(
            `OR filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        const anyMatch = value.some(
          (sub) => this.filterVector(vector, sub)
        );
        if (!anyMatch) return false;
      } else if (key === "NOT") {
        if (!Array.isArray(value)) {
          throw new Error(
            `NOT filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        const noneMatch = value.every(
          (sub) => !this.filterVector(vector, sub)
        );
        if (!noneMatch) return false;
      } else {
        if (!this.matchFieldCondition(vector.payload, key, value)) {
          return false;
        }
      }
    }
    return true;
  }
  async insert(vectors, ids, payloads) {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO vectors (id, vector, payload) VALUES (?, ?, ?)`
    );
    const insertMany = this.db.transaction(
      (vecs, vIds, vPayloads) => {
        for (let i = 0; i < vecs.length; i++) {
          if (vecs[i].length !== this.dimension) {
            throw new Error(
              `Vector dimension mismatch. Expected ${this.dimension}, got ${vecs[i].length}`
            );
          }
          const vectorBuffer = Buffer.from(new Float32Array(vecs[i]).buffer);
          stmt.run(vIds[i], vectorBuffer, JSON.stringify(vPayloads[i]));
        }
      }
    );
    insertMany(vectors, ids, payloads);
  }
  tokenize(text) {
    return text.toLowerCase().split(/\s+/).filter(Boolean);
  }
  async keywordSearch(query, topK = 10, filters) {
    try {
      const rows = this.db.prepare(`SELECT * FROM vectors`).all();
      const candidates = [];
      for (const row of rows) {
        const payload = this.normalizePayload(JSON.parse(row.payload));
        const memoryVector = {
          id: row.id,
          vector: Array.from(
            new Float32Array(
              row.vector.buffer,
              row.vector.byteOffset,
              row.vector.byteLength / 4
            )
          ),
          payload
        };
        if (this.filterVector(memoryVector, filters)) {
          const text = payload.textLemmatized || payload.data || "";
          candidates.push({ id: row.id, payload, tokens: this.tokenize(text) });
        }
      }
      if (candidates.length === 0) {
        return [];
      }
      const tokenizedQuery = this.tokenize(query);
      if (tokenizedQuery.length === 0) {
        return [];
      }
      const k1 = 1.5;
      const b = 0.75;
      const N = candidates.length;
      const avgDocLength = candidates.reduce((sum, c) => sum + c.tokens.length, 0) / N;
      const docFreq = /* @__PURE__ */ new Map();
      for (const term of tokenizedQuery) {
        if (!docFreq.has(term)) {
          let count = 0;
          for (const c of candidates) {
            if (c.tokens.includes(term)) count++;
          }
          docFreq.set(term, count);
        }
      }
      const idf = /* @__PURE__ */ new Map();
      for (const [term, freq] of docFreq) {
        idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
      }
      const scored = candidates.map((candidate) => {
        let score = 0;
        const docLength = candidate.tokens.length;
        for (const term of tokenizedQuery) {
          const tf = candidate.tokens.filter((t) => t === term).length;
          const termIdf = idf.get(term) || 0;
          score += termIdf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * docLength / avgDocLength));
        }
        return { ...candidate, score };
      });
      const results = scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, topK).map((s) => ({
        id: s.id,
        payload: s.payload,
        score: s.score
      }));
      return results;
    } catch (error) {
      console.error("Error during keyword search:", error);
      return null;
    }
  }
  async search(query, topK = 10, filters) {
    if (query.length !== this.dimension) {
      throw new Error(
        `Query dimension mismatch. Expected ${this.dimension}, got ${query.length}`
      );
    }
    const rows = this.db.prepare(`SELECT * FROM vectors`).all();
    const results = [];
    for (const row of rows) {
      const vector = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4
      );
      const payload = this.normalizePayload(JSON.parse(row.payload));
      const memoryVector = {
        id: row.id,
        vector: Array.from(vector),
        payload
      };
      if (this.filterVector(memoryVector, filters)) {
        const score = this.cosineSimilarity(query, Array.from(vector));
        results.push({
          id: memoryVector.id,
          payload: memoryVector.payload,
          score
        });
      }
    }
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return results.slice(0, topK);
  }
  async get(vectorId) {
    const row = this.db.prepare(`SELECT * FROM vectors WHERE id = ?`).get(vectorId);
    if (!row) return null;
    const payload = this.normalizePayload(JSON.parse(row.payload));
    return {
      id: row.id,
      payload
    };
  }
  async update(vectorId, vector, payload) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch. Expected ${this.dimension}, got ${vector.length}`
      );
    }
    const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
    this.db.prepare(`UPDATE vectors SET vector = ?, payload = ? WHERE id = ?`).run(vectorBuffer, JSON.stringify(payload), vectorId);
  }
  async delete(vectorId) {
    this.db.prepare(`DELETE FROM vectors WHERE id = ?`).run(vectorId);
  }
  async deleteCol() {
    this.db.exec(`DROP TABLE IF EXISTS vectors`);
    this.init();
  }
  async list(filters, topK = 100) {
    const rows = this.db.prepare(`SELECT * FROM vectors`).all();
    const results = [];
    for (const row of rows) {
      const payload = this.normalizePayload(JSON.parse(row.payload));
      const memoryVector = {
        id: row.id,
        vector: Array.from(
          new Float32Array(
            row.vector.buffer,
            row.vector.byteOffset,
            row.vector.byteLength / 4
          )
        ),
        payload
      };
      if (this.filterVector(memoryVector, filters)) {
        results.push({
          id: memoryVector.id,
          payload: memoryVector.payload
        });
      }
    }
    return [results.slice(0, topK), results.length];
  }
  async getUserId() {
    const row = this.db.prepare(`SELECT user_id FROM memory_migrations LIMIT 1`).get();
    if (row) {
      return row.user_id;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    this.db.prepare(`INSERT INTO memory_migrations (user_id) VALUES (?)`).run(randomUserId2);
    return randomUserId2;
  }
  async setUserId(userId) {
    this.db.prepare(`DELETE FROM memory_migrations`).run();
    this.db.prepare(`INSERT INTO memory_migrations (user_id) VALUES (?)`).run(userId);
  }
  async initialize() {
    this.init();
  }
};
_MemoryVectorStore.CAMEL_TO_SNAKE = {
  userId: "user_id",
  agentId: "agent_id",
  runId: "run_id"
};
var MemoryVectorStore = _MemoryVectorStore;

// src/oss/src/vector_stores/qdrant.ts
import { QdrantClient } from "@qdrant/js-client-rest";
import * as fs3 from "fs";
var KEY_MAP = {
  $and: "AND",
  $or: "OR",
  $not: "NOT"
};
var Qdrant = class {
  constructor(config) {
    if (config.client) {
      this.client = config.client;
    } else {
      const params = {};
      if (config.apiKey) {
        params.apiKey = config.apiKey;
      }
      if (config.url) {
        params.url = config.url;
        try {
          const parsedUrl = new URL(config.url);
          params.port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 6333;
        } catch (_) {
          params.port = 6333;
        }
      }
      if (config.host && config.port) {
        params.host = config.host;
        params.port = config.port;
      }
      if (!Object.keys(params).length) {
        params.path = config.path;
        if (!config.onDisk && config.path) {
          if (fs3.existsSync(config.path) && fs3.statSync(config.path).isDirectory()) {
            fs3.rmSync(config.path, { recursive: true });
          }
        }
      }
      this.client = new QdrantClient(params);
    }
    this.collectionName = config.collectionName;
    this.dimension = config.dimension || 1536;
    this.initialize().catch(console.error);
  }
  /**
   * Build a single field condition from a key-value filter pair.
   * Supports enhanced filter syntax with comparison operators.
   */
  buildFieldCondition(key, value) {
    if (typeof value !== "object" || value === null) {
      if (value === "*") {
        return null;
      }
      return { key, match: { value } };
    }
    if (Array.isArray(value)) {
      return { key, match: { any: value } };
    }
    const ops = Object.keys(value);
    const rangeOps = ["gt", "gte", "lt", "lte"];
    const hasRangeOps = ops.some((op) => rangeOps.includes(op));
    const nonRangeOps = ops.filter((op) => !rangeOps.includes(op));
    if (hasRangeOps) {
      if (nonRangeOps.length > 0) {
        throw new Error(
          `Cannot mix range operators (${ops.filter((o) => rangeOps.includes(o)).join(", ")}) with non-range operators (${nonRangeOps.join(", ")}) for field '${key}'. Use AND to combine them as separate conditions.`
        );
      }
      const range = {};
      for (const op of rangeOps) {
        if (op in value) {
          range[op] = value[op];
        }
      }
      return { key, range };
    }
    if ("eq" in value) {
      return { key, match: { value: value.eq } };
    }
    if ("ne" in value) {
      return { key, match: { except: [value.ne] } };
    }
    if ("in" in value) {
      return { key, match: { any: value.in } };
    }
    if ("nin" in value) {
      return { key, match: { except: value.nin } };
    }
    if ("contains" in value || "icontains" in value) {
      const text = value.contains || value.icontains;
      return { key, match: { text } };
    }
    const supportedOps = [
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte",
      "in",
      "nin",
      "contains",
      "icontains"
    ];
    throw new Error(
      `Unsupported filter operator(s) for field '${key}': ${ops.join(", ")}. Supported operators: ${supportedOps.join(", ")}`
    );
  }
  /**
   * Create a Filter object from the provided filters.
   * Supports logical operators (AND, OR, NOT) and comparison operators.
   */
  createFilter(filters) {
    if (!filters || Object.keys(filters).length === 0) return void 0;
    const normalized = {};
    for (const [key, value] of Object.entries(filters)) {
      const normKey = KEY_MAP[key] || key;
      if (!(normKey in normalized)) {
        normalized[normKey] = value;
      }
    }
    const must = [];
    const should = [];
    const mustNot = [];
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "AND" || key === "OR" || key === "NOT") {
        if (!Array.isArray(value)) {
          throw new Error(
            `${key} filter value must be a list of filter dicts, got ${typeof value}`
          );
        }
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            throw new Error(
              `${key} filter list item at index ${i} must be a dict, got ${typeof item}`
            );
          }
        }
        if (key === "AND") {
          for (const sub of value) {
            const built = this.createFilter(sub);
            if (built) {
              must.push(built);
            }
          }
        } else if (key === "OR") {
          for (const sub of value) {
            const built = this.createFilter(sub);
            if (built) {
              should.push(built);
            }
          }
        } else if (key === "NOT") {
          for (const sub of value) {
            const built = this.createFilter(sub);
            if (built) {
              mustNot.push(built);
            }
          }
        }
      } else {
        const condition = this.buildFieldCondition(key, value);
        if (condition !== null) {
          must.push(condition);
        }
      }
    }
    if (must.length === 0 && should.length === 0 && mustNot.length === 0) {
      return void 0;
    }
    return {
      must: must.length > 0 ? must : void 0,
      should: should.length > 0 ? should : void 0,
      must_not: mustNot.length > 0 ? mustNot : void 0
    };
  }
  async insert(vectors, ids, payloads) {
    const points = vectors.map((vector, idx) => ({
      id: ids[idx],
      vector,
      payload: payloads[idx] || {}
    }));
    await this.client.upsert(this.collectionName, {
      points
    });
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    const queryFilter = this.createFilter(filters);
    const results = await this.client.search(this.collectionName, {
      vector: query,
      filter: queryFilter,
      limit: topK
    });
    return results.map((hit) => ({
      id: String(hit.id),
      payload: hit.payload || {},
      score: hit.score
    }));
  }
  async get(vectorId) {
    const results = await this.client.retrieve(this.collectionName, {
      ids: [vectorId],
      with_payload: true
    });
    if (!results.length) return null;
    return {
      id: vectorId,
      payload: results[0].payload || {}
    };
  }
  async update(vectorId, vector, payload) {
    const point = {
      id: vectorId,
      vector,
      payload
    };
    await this.client.upsert(this.collectionName, {
      points: [point]
    });
  }
  async delete(vectorId) {
    await this.client.delete(this.collectionName, {
      points: [vectorId]
    });
  }
  async deleteCol() {
    await this.client.deleteCollection(this.collectionName);
  }
  async list(filters, topK = 100) {
    const scrollRequest = {
      limit: topK,
      filter: this.createFilter(filters),
      with_payload: true,
      with_vectors: false
    };
    const response = await this.client.scroll(
      this.collectionName,
      scrollRequest
    );
    const results = response.points.map((point) => ({
      id: String(point.id),
      payload: point.payload || {}
    }));
    return [results, response.points.length];
  }
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      }
    );
  }
  async getUserId() {
    var _a2;
    try {
      await this.ensureCollection("memory_migrations", 1);
      const result = await this.client.scroll("memory_migrations", {
        limit: 1,
        with_payload: true
      });
      if (result.points.length > 0) {
        return (_a2 = result.points[0].payload) == null ? void 0 : _a2.user_id;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await this.client.upsert("memory_migrations", {
        points: [
          {
            id: this.generateUUID(),
            vector: [0],
            payload: { user_id: randomUserId2 }
          }
        ]
      });
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  async setUserId(userId) {
    try {
      const result = await this.client.scroll("memory_migrations", {
        limit: 1,
        with_payload: true
      });
      const pointId = result.points.length > 0 ? result.points[0].id : this.generateUUID();
      await this.client.upsert("memory_migrations", {
        points: [
          {
            id: pointId,
            vector: [0],
            payload: { user_id: userId }
          }
        ]
      });
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
  async ensureCollection(name, size) {
    var _a2, _b, _c;
    try {
      await this.client.createCollection(name, {
        vectors: {
          size,
          distance: "Cosine"
        }
      });
    } catch (error) {
      if ((error == null ? void 0 : error.status) === 409 || (error == null ? void 0 : error.status) === 401 || (error == null ? void 0 : error.status) === 403) {
        if (name === this.collectionName) {
          try {
            const collectionInfo = await this.client.getCollection(name);
            const vectorConfig = (_b = (_a2 = collectionInfo.config) == null ? void 0 : _a2.params) == null ? void 0 : _b.vectors;
            if (vectorConfig && vectorConfig.size !== size) {
              throw new Error(
                `Collection ${name} exists but has wrong vector size. Expected: ${size}, got: ${vectorConfig.size}`
              );
            }
          } catch (verifyError) {
            if ((_c = verifyError == null ? void 0 : verifyError.message) == null ? void 0 : _c.includes("wrong vector size")) {
              throw verifyError;
            }
            console.warn(
              `Collection '${name}' exists (409) but dimension verification failed: ${(verifyError == null ? void 0 : verifyError.message) || verifyError}. Proceeding anyway.`
            );
          }
        }
      } else {
        throw error;
      }
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    try {
      await this.ensureCollection(this.collectionName, this.dimension);
      await this.ensureCollection("memory_migrations", 1);
    } catch (error) {
      console.error("Error initializing Qdrant:", error);
      throw error;
    }
  }
};

// src/oss/src/vector_stores/vectorize.ts
import Cloudflare from "cloudflare";
var VectorizeDB = class {
  constructor(config) {
    this.client = null;
    this.client = new Cloudflare({ apiToken: config.apiKey });
    this.dimensions = config.dimension || 1536;
    this.indexName = config.indexName;
    this.accountId = config.accountId;
    this.initialize().catch(console.error);
  }
  async insert(vectors, ids, payloads) {
    var _a2;
    try {
      const vectorObjects = vectors.map(
        (vector, index) => ({
          id: ids[index],
          values: vector,
          metadata: payloads[index] || {}
        })
      );
      const ndjsonPayload = vectorObjects.map((v) => JSON.stringify(v)).join("\n");
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}/insert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_a2 = this.client) == null ? void 0 : _a2.apiToken}`
          },
          body: ndjsonPayload
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to insert vectors: ${response.status} ${errorText}`
        );
      }
    } catch (error) {
      console.error("Error inserting vectors:", error);
      throw new Error(
        `Failed to insert vectors: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    var _a2, _b;
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.query(
        this.indexName,
        {
          account_id: this.accountId,
          vector: query,
          filter: filters,
          returnMetadata: "all",
          topK
        }
      ));
      return ((_b = result == null ? void 0 : result.matches) == null ? void 0 : _b.map((match) => ({
        id: match.id,
        payload: match.metadata,
        score: match.score
      }))) || [];
    } catch (error) {
      console.error("Error searching vectors:", error);
      throw new Error(
        `Failed to search vectors: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async get(vectorId) {
    var _a2;
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.getByIds(
        this.indexName,
        {
          account_id: this.accountId,
          ids: [vectorId]
        }
      ));
      if (!(result == null ? void 0 : result.length)) return null;
      return {
        id: vectorId,
        payload: result[0].metadata
      };
    } catch (error) {
      console.error("Error getting vector:", error);
      throw new Error(
        `Failed to get vector: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async update(vectorId, vector, payload) {
    var _a2;
    try {
      const data = {
        id: vectorId,
        values: vector,
        metadata: payload
      };
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}/upsert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_a2 = this.client) == null ? void 0 : _a2.apiToken}`
          },
          body: JSON.stringify(data) + "\n"
          // ndjson format
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to update vector: ${response.status} ${errorText}`
        );
      }
    } catch (error) {
      console.error("Error updating vector:", error);
      throw new Error(
        `Failed to update vector: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async delete(vectorId) {
    var _a2;
    try {
      await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.deleteByIds(this.indexName, {
        account_id: this.accountId,
        ids: [vectorId]
      }));
    } catch (error) {
      console.error("Error deleting vector:", error);
      throw new Error(
        `Failed to delete vector: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async deleteCol() {
    var _a2;
    try {
      await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.delete(this.indexName, {
        account_id: this.accountId
      }));
    } catch (error) {
      console.error("Error deleting collection:", error);
      throw new Error(
        `Failed to delete collection: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async list(filters, topK = 20) {
    var _a2, _b;
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.query(
        this.indexName,
        {
          account_id: this.accountId,
          vector: Array(this.dimensions).fill(0),
          // Dummy vector for listing
          filter: filters,
          topK,
          returnMetadata: "all"
        }
      ));
      const matches = ((_b = result == null ? void 0 : result.matches) == null ? void 0 : _b.map((match) => ({
        id: match.id,
        payload: match.metadata,
        score: match.score
      }))) || [];
      return [matches, matches.length];
    } catch (error) {
      console.error("Error listing vectors:", error);
      throw new Error(
        `Failed to list vectors: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      }
    );
  }
  async getUserId() {
    var _a2, _b, _c;
    try {
      let found = false;
      for await (const index of this.client.vectorize.indexes.list({
        account_id: this.accountId
      })) {
        if (index.name === "memory_migrations") {
          found = true;
        }
      }
      if (!found) {
        await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.create({
          account_id: this.accountId,
          name: "memory_migrations",
          config: {
            dimensions: 1,
            metric: "cosine"
          }
        }));
      }
      const result = await ((_b = this.client) == null ? void 0 : _b.vectorize.indexes.query(
        "memory_migrations",
        {
          account_id: this.accountId,
          vector: [0],
          topK: 1,
          returnMetadata: "all"
        }
      ));
      if (result.matches.length > 0) {
        return result.matches[0].metadata.userId;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const data = {
        id: this.generateUUID(),
        values: [0],
        metadata: { userId: randomUserId2 }
      };
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/memory_migrations/upsert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_c = this.client) == null ? void 0 : _c.apiToken}`
          },
          body: JSON.stringify(data) + "\n"
          // ndjson format
        }
      );
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw new Error(
        `Failed to get user ID: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async setUserId(userId) {
    var _a2, _b;
    try {
      const result = await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.query(
        "memory_migrations",
        {
          account_id: this.accountId,
          vector: [0],
          topK: 1,
          returnMetadata: "all"
        }
      ));
      const pointId = result.matches.length > 0 ? result.matches[0].id : this.generateUUID();
      const data = {
        id: pointId,
        values: [0],
        metadata: { userId }
      };
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/memory_migrations/upsert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            Authorization: `Bearer ${(_b = this.client) == null ? void 0 : _b.apiToken}`
          },
          body: JSON.stringify(data) + "\n"
          // ndjson format
        }
      );
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw new Error(
        `Failed to set user ID: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    var _a2, _b, _c, _d, _e;
    try {
      let indexFound = false;
      for await (const idx of this.client.vectorize.indexes.list({
        account_id: this.accountId
      })) {
        if (idx.name === this.indexName) {
          indexFound = true;
          break;
        }
      }
      if (!indexFound) {
        try {
          await ((_a2 = this.client) == null ? void 0 : _a2.vectorize.indexes.create({
            account_id: this.accountId,
            name: this.indexName,
            config: {
              dimensions: this.dimensions,
              metric: "cosine"
            }
          }));
          const properties2 = ["userId", "agentId", "runId"];
          for (const propertyName of properties2) {
            await ((_b = this.client) == null ? void 0 : _b.vectorize.indexes.metadataIndex.create(
              this.indexName,
              {
                account_id: this.accountId,
                indexType: "string",
                propertyName
              }
            ));
          }
        } catch (err) {
          throw new Error(err);
        }
      }
      const metadataIndexes = await ((_c = this.client) == null ? void 0 : _c.vectorize.indexes.metadataIndex.list(
        this.indexName,
        {
          account_id: this.accountId
        }
      ));
      const existingMetadataIndexes = /* @__PURE__ */ new Set();
      for (const metadataIndex of (metadataIndexes == null ? void 0 : metadataIndexes.metadataIndexes) || []) {
        existingMetadataIndexes.add(metadataIndex.propertyName);
      }
      const properties = ["userId", "agentId", "runId"];
      for (const propertyName of properties) {
        if (!existingMetadataIndexes.has(propertyName)) {
          await ((_d = this.client) == null ? void 0 : _d.vectorize.indexes.metadataIndex.create(
            this.indexName,
            {
              account_id: this.accountId,
              indexType: "string",
              propertyName
            }
          ));
        }
      }
      let found = false;
      for await (const index of this.client.vectorize.indexes.list({
        account_id: this.accountId
      })) {
        if (index.name === "memory_migrations") {
          found = true;
          break;
        }
      }
      if (!found) {
        await ((_e = this.client) == null ? void 0 : _e.vectorize.indexes.create({
          account_id: this.accountId,
          name: "memory_migrations",
          config: {
            dimensions: 1,
            metric: "cosine"
          }
        }));
      }
    } catch (err) {
      throw new Error(err);
    }
  }
};

// src/oss/src/vector_stores/redis.ts
import { createClient } from "redis";
function escapeRedisTagValue(value) {
  return String(value).replace(
    /([,.<>{}\[\]"':;!@#$%^&*()\-+=~|/\\\s])/g,
    "\\$1"
  );
}
var DEFAULT_FIELDS = [
  { name: "memory_id", type: "tag" },
  { name: "hash", type: "tag" },
  { name: "agent_id", type: "tag" },
  { name: "run_id", type: "tag" },
  { name: "user_id", type: "tag" },
  { name: "memory", type: "text" },
  { name: "metadata", type: "text" },
  { name: "created_at", type: "numeric" },
  { name: "updated_at", type: "numeric" },
  {
    name: "embedding",
    type: "vector",
    attrs: {
      algorithm: "flat",
      distance_metric: "cosine",
      datatype: "float32",
      dims: 0
      // Will be set in constructor
    }
  }
];
var EXCLUDED_KEYS = /* @__PURE__ */ new Set([
  "user_id",
  "agent_id",
  "run_id",
  "hash",
  "data",
  "created_at",
  "updated_at"
]);
function toSnakeCase(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value
    ])
  );
}
function toCamelCase(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value
    ])
  );
}
var RedisDB = class {
  constructor(config) {
    this.indexName = config.collectionName;
    this.indexPrefix = `mem0:${config.collectionName}`;
    this.schema = {
      index: {
        name: this.indexName,
        prefix: this.indexPrefix
      },
      fields: DEFAULT_FIELDS.map((field) => {
        if (field.name === "embedding" && field.attrs) {
          return {
            ...field,
            attrs: {
              ...field.attrs,
              dims: config.embeddingModelDims
            }
          };
        }
        return field;
      })
    };
    this.client = createClient({
      url: config.redisUrl,
      username: config.username,
      password: config.password,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error("Max reconnection attempts reached");
            return new Error("Max reconnection attempts reached");
          }
          return Math.min(retries * 100, 3e3);
        }
      }
    });
    this.client.on("error", (err) => console.error("Redis Client Error:", err));
    this.client.on("connect", () => console.log("Redis Client Connected"));
    this.initialize().catch((err) => {
      console.error("Failed to initialize Redis:", err);
      throw err;
    });
  }
  async createIndex() {
    try {
      try {
        await this.client.ft.dropIndex(this.indexName);
      } catch (error) {
      }
      const schema = {};
      for (const field of this.schema.fields) {
        if (field.type === "vector") {
          schema[field.name] = {
            type: "VECTOR",
            ALGORITHM: "FLAT",
            TYPE: "FLOAT32",
            DIM: field.attrs.dims,
            DISTANCE_METRIC: "COSINE",
            INITIAL_CAP: 1e3
          };
        } else if (field.type === "numeric") {
          schema[field.name] = {
            type: "NUMERIC",
            SORTABLE: true
          };
        } else if (field.type === "tag") {
          schema[field.name] = {
            type: "TAG",
            SEPARATOR: "|"
          };
        } else if (field.type === "text") {
          schema[field.name] = {
            type: "TEXT",
            WEIGHT: 1
          };
        }
      }
      await this.client.ft.create(this.indexName, schema, {
        ON: "HASH",
        PREFIX: this.indexPrefix + ":",
        STOPWORDS: []
      });
    } catch (error) {
      console.error("Error creating Redis index:", error);
      throw error;
    }
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    try {
      await this.client.connect();
      console.log("Connected to Redis");
      const modulesResponse = await this.client.moduleList();
      const hasSearch = modulesResponse.some((mod) => {
        if (typeof mod === "object" && !Array.isArray(mod) && mod.name) {
          const name = String(mod.name).toLowerCase();
          return name === "search" || name === "searchlight";
        }
        if (Array.isArray(mod)) {
          const moduleMap = /* @__PURE__ */ new Map();
          for (let i = 0; i < mod.length; i += 2) {
            moduleMap.set(mod[i], mod[i + 1]);
          }
          const name = moduleMap.get("name");
          return (name == null ? void 0 : name.toLowerCase()) === "search" || (name == null ? void 0 : name.toLowerCase()) === "searchlight";
        }
        return false;
      });
      if (!hasSearch) {
        throw new Error(
          "RediSearch module is not loaded. Please ensure Redis Stack is properly installed and running."
        );
      }
      let retries = 0;
      const maxRetries = 3;
      while (retries < maxRetries) {
        try {
          await this.createIndex();
          console.log("Redis index created successfully");
          break;
        } catch (error) {
          console.error(
            `Error creating index (attempt ${retries + 1}/${maxRetries}):`,
            error
          );
          retries++;
          if (retries === maxRetries) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error initializing Redis:", error.message);
      } else {
        console.error("Error initializing Redis:", error);
      }
      throw error;
    }
  }
  async insert(vectors, ids, payloads) {
    const data = vectors.map((vector, idx) => {
      const payload = toSnakeCase(payloads[idx]);
      const id = ids[idx];
      const entry = {
        memory_id: id,
        hash: payload.hash,
        memory: payload.data,
        created_at: new Date(payload.created_at).getTime(),
        embedding: new Float32Array(vector).buffer
      };
      ["agent_id", "run_id", "user_id"].forEach((field) => {
        if (field in payload) {
          entry[field] = payload[field];
        }
      });
      entry.metadata = JSON.stringify(
        Object.fromEntries(
          Object.entries(payload).filter(([key]) => !EXCLUDED_KEYS.has(key))
        )
      );
      return entry;
    });
    try {
      await Promise.all(
        data.map(
          (entry) => this.client.hSet(`${this.indexPrefix}:${entry.memory_id}`, {
            ...entry,
            embedding: Buffer.from(entry.embedding)
          })
        )
      );
    } catch (error) {
      console.error("Error during vector insert:", error);
      throw error;
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    const snakeFilters = filters ? toSnakeCase(filters) : void 0;
    const filterExpr = snakeFilters ? Object.entries(snakeFilters).filter(([_, value]) => value !== null && value !== void 0).map(([key, value]) => `@${key}:{${escapeRedisTagValue(value)}}`).join(" ") : "*";
    const queryVector = new Float32Array(query).buffer;
    const searchOptions = {
      PARAMS: {
        vec: Buffer.from(queryVector)
      },
      RETURN: [
        "memory_id",
        "hash",
        "agent_id",
        "run_id",
        "user_id",
        "memory",
        "metadata",
        "created_at",
        "__vector_score"
      ],
      SORTBY: "__vector_score",
      DIALECT: 2,
      LIMIT: {
        from: 0,
        size: topK
      }
    };
    try {
      const results = await this.client.ft.search(
        this.indexName,
        `${filterExpr} =>[KNN ${topK} @embedding $vec AS __vector_score]`,
        searchOptions
      );
      return results.documents.map((doc) => {
        var _a2;
        const resultPayload = {
          hash: doc.value.hash,
          data: doc.value.memory,
          created_at: new Date(parseInt(doc.value.created_at)).toISOString(),
          ...doc.value.updated_at && {
            updated_at: new Date(parseInt(doc.value.updated_at)).toISOString()
          },
          ...doc.value.agent_id && { agent_id: doc.value.agent_id },
          ...doc.value.run_id && { run_id: doc.value.run_id },
          ...doc.value.user_id && { user_id: doc.value.user_id },
          ...JSON.parse(doc.value.metadata || "{}")
        };
        return {
          id: doc.value.memory_id,
          payload: toCamelCase(resultPayload),
          score: (_a2 = Number(doc.value.__vector_score)) != null ? _a2 : 0
        };
      });
    } catch (error) {
      console.error("Error during vector search:", error);
      throw error;
    }
  }
  async get(vectorId) {
    try {
      const exists = await this.client.exists(
        `${this.indexPrefix}:${vectorId}`
      );
      if (!exists) {
        console.warn(`Memory with ID ${vectorId} does not exist`);
        return null;
      }
      const result = await this.client.hGetAll(
        `${this.indexPrefix}:${vectorId}`
      );
      if (!Object.keys(result).length) return null;
      const doc = {
        memory_id: result.memory_id,
        hash: result.hash,
        memory: result.memory,
        created_at: result.created_at,
        updated_at: result.updated_at,
        agent_id: result.agent_id,
        run_id: result.run_id,
        user_id: result.user_id,
        metadata: result.metadata
      };
      let created_at;
      try {
        if (!result.created_at) {
          created_at = /* @__PURE__ */ new Date();
        } else {
          const timestamp = Number(result.created_at);
          if (timestamp.toString().length === 10) {
            created_at = new Date(timestamp * 1e3);
          } else {
            created_at = new Date(timestamp);
          }
          if (isNaN(created_at.getTime())) {
            console.warn(
              `Invalid created_at timestamp: ${result.created_at}, using current date`
            );
            created_at = /* @__PURE__ */ new Date();
          }
        }
      } catch (error) {
        console.warn(
          `Error parsing created_at timestamp: ${result.created_at}, using current date`
        );
        created_at = /* @__PURE__ */ new Date();
      }
      let updated_at;
      try {
        if (result.updated_at) {
          const timestamp = Number(result.updated_at);
          if (timestamp.toString().length === 10) {
            updated_at = new Date(timestamp * 1e3);
          } else {
            updated_at = new Date(timestamp);
          }
          if (isNaN(updated_at.getTime())) {
            console.warn(
              `Invalid updated_at timestamp: ${result.updated_at}, setting to undefined`
            );
            updated_at = void 0;
          }
        }
      } catch (error) {
        console.warn(
          `Error parsing updated_at timestamp: ${result.updated_at}, setting to undefined`
        );
        updated_at = void 0;
      }
      const payload = {
        hash: doc.hash,
        data: doc.memory,
        created_at: created_at.toISOString(),
        ...updated_at && { updated_at: updated_at.toISOString() },
        ...doc.agent_id && { agent_id: doc.agent_id },
        ...doc.run_id && { run_id: doc.run_id },
        ...doc.user_id && { user_id: doc.user_id },
        ...JSON.parse(doc.metadata || "{}")
      };
      return {
        id: vectorId,
        payload: toCamelCase(payload)
      };
    } catch (error) {
      console.error("Error getting vector:", error);
      throw error;
    }
  }
  async update(vectorId, vector, payload) {
    const snakePayload = toSnakeCase(payload);
    const entry = {
      memory_id: vectorId,
      hash: snakePayload.hash,
      memory: snakePayload.data,
      created_at: new Date(snakePayload.created_at).getTime(),
      updated_at: new Date(snakePayload.updated_at).getTime(),
      embedding: Buffer.from(new Float32Array(vector).buffer)
    };
    ["agent_id", "run_id", "user_id"].forEach((field) => {
      if (field in snakePayload) {
        entry[field] = snakePayload[field];
      }
    });
    entry.metadata = JSON.stringify(
      Object.fromEntries(
        Object.entries(snakePayload).filter(([key]) => !EXCLUDED_KEYS.has(key))
      )
    );
    try {
      await this.client.hSet(`${this.indexPrefix}:${vectorId}`, entry);
    } catch (error) {
      console.error("Error during vector update:", error);
      throw error;
    }
  }
  async delete(vectorId) {
    try {
      const key = `${this.indexPrefix}:${vectorId}`;
      const exists = await this.client.exists(key);
      if (!exists) {
        console.warn(`Memory with ID ${vectorId} does not exist`);
        return;
      }
      const result = await this.client.del(key);
      if (!result) {
        throw new Error(`Failed to delete memory with ID ${vectorId}`);
      }
      console.log(`Successfully deleted memory with ID ${vectorId}`);
    } catch (error) {
      console.error("Error deleting memory:", error);
      throw error;
    }
  }
  async deleteCol() {
    await this.client.ft.dropIndex(this.indexName);
  }
  async list(filters, topK = 100) {
    const snakeFilters = filters ? toSnakeCase(filters) : void 0;
    const filterExpr = snakeFilters ? Object.entries(snakeFilters).filter(([_, value]) => value !== null && value !== void 0).map(([key, value]) => `@${key}:{${escapeRedisTagValue(value)}}`).join(" ") : "*";
    const searchOptions = {
      SORTBY: "created_at",
      SORTDIR: "DESC",
      LIMIT: {
        from: 0,
        size: topK
      }
    };
    const results = await this.client.ft.search(
      this.indexName,
      filterExpr,
      searchOptions
    );
    const items = results.documents.map((doc) => ({
      id: doc.value.memory_id,
      payload: toCamelCase({
        hash: doc.value.hash,
        data: doc.value.memory,
        created_at: new Date(parseInt(doc.value.created_at)).toISOString(),
        ...doc.value.updated_at && {
          updated_at: new Date(parseInt(doc.value.updated_at)).toISOString()
        },
        ...doc.value.agent_id && { agent_id: doc.value.agent_id },
        ...doc.value.run_id && { run_id: doc.value.run_id },
        ...doc.value.user_id && { user_id: doc.value.user_id },
        ...JSON.parse(doc.value.metadata || "{}")
      })
    }));
    return [items, results.total];
  }
  async close() {
    await this.client.quit();
  }
  async getUserId() {
    try {
      const userId = await this.client.get("memory_migrations:1");
      if (userId) {
        return userId;
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await this.client.set("memory_migrations:1", randomUserId2);
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  async setUserId(userId) {
    try {
      await this.client.set("memory_migrations:1", userId);
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
};

// src/oss/src/vector_stores/supabase.ts
import { createClient as createClient2 } from "@supabase/supabase-js";
var SupabaseDB = class {
  constructor(config) {
    this.client = createClient2(config.supabaseUrl, config.supabaseKey);
    this.tableName = config.tableName;
    this.embeddingColumnName = config.embeddingColumnName || "embedding";
    this.metadataColumnName = config.metadataColumnName || "metadata";
    this.initialize().catch((err) => {
      console.error("Failed to initialize Supabase:", err);
      throw err;
    });
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    try {
      const testVector = Array(1536).fill(0);
      try {
        await this.client.from(this.tableName).delete().eq("id", "test_vector");
      } catch (e) {
      }
      const { error: insertError } = await this.client.from(this.tableName).insert({
        id: "test_vector",
        [this.embeddingColumnName]: testVector,
        [this.metadataColumnName]: {}
      }).select();
      if (insertError && insertError.code !== "23505") {
        console.error("Test insert error:", insertError);
        throw new Error(
          `Vector operations failed. Please ensure:
1. The vector extension is enabled
2. The table "${this.tableName}" exists with correct schema
3. The match_vectors function is created

RUN THE FOLLOWING SQL IN YOUR SUPABASE SQL EDITOR:

-- Enable the vector extension
create extension if not exists vector;

-- Create the memories table
create table if not exists memories (
  id text primary key,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc', now()),
  updated_at timestamp with time zone default timezone('utc', now())
);

-- Create the memory migrations table
create table if not exists memory_migrations (
  user_id text primary key,
  created_at timestamp with time zone default timezone('utc', now())
);

-- Create the vector similarity search function
create or replace function match_vectors(
  query_embedding vector(1536),
  match_count int,
  filter jsonb default '{}'::jsonb
)
returns table (
  id text,
  similarity float,
  metadata jsonb
)
language plpgsql
as $$
begin
  return query
  select
    t.id::text,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.metadata
  from memories t
  where case
    when filter::text = '{}'::text then true
    else t.metadata @> filter
  end
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

See the SQL migration instructions in the code comments.`
        );
      }
      try {
        await this.client.from(this.tableName).delete().eq("id", "test_vector");
      } catch (e) {
      }
      console.log("Connected to Supabase successfully");
    } catch (error) {
      console.error("Error during Supabase initialization:", error);
      throw error;
    }
  }
  async insert(vectors, ids, payloads) {
    try {
      const data = vectors.map((vector, idx) => ({
        id: ids[idx],
        [this.embeddingColumnName]: vector,
        [this.metadataColumnName]: {
          ...payloads[idx],
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
      const { error } = await this.client.from(this.tableName).insert(data);
      if (error) throw error;
    } catch (error) {
      console.error("Error during vector insert:", error);
      throw error;
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    try {
      const rpcQuery = {
        query_embedding: query,
        match_count: topK
      };
      if (filters) {
        rpcQuery.filter = filters;
      }
      const { data, error } = await this.client.rpc("match_vectors", rpcQuery);
      if (error) throw error;
      if (!data) return [];
      const results = data;
      return results.map((result) => ({
        id: result.id,
        payload: result.metadata,
        score: result.similarity
      }));
    } catch (error) {
      console.error("Error during vector search:", error);
      throw error;
    }
  }
  async get(vectorId) {
    try {
      const { data, error } = await this.client.from(this.tableName).select("*").eq("id", vectorId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        payload: data[this.metadataColumnName]
      };
    } catch (error) {
      console.error("Error getting vector:", error);
      throw error;
    }
  }
  async update(vectorId, vector, payload) {
    try {
      const { error } = await this.client.from(this.tableName).update({
        [this.embeddingColumnName]: vector,
        [this.metadataColumnName]: {
          ...payload,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      }).eq("id", vectorId);
      if (error) throw error;
    } catch (error) {
      console.error("Error during vector update:", error);
      throw error;
    }
  }
  async delete(vectorId) {
    try {
      const { error } = await this.client.from(this.tableName).delete().eq("id", vectorId);
      if (error) throw error;
    } catch (error) {
      console.error("Error deleting vector:", error);
      throw error;
    }
  }
  async deleteCol() {
    try {
      const { error } = await this.client.from(this.tableName).delete().neq("id", "");
      if (error) throw error;
    } catch (error) {
      console.error("Error deleting collection:", error);
      throw error;
    }
  }
  async list(filters, topK = 100) {
    try {
      let query = this.client.from(this.tableName).select("*", { count: "exact" }).limit(topK);
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(`${this.metadataColumnName}->>${key}`, value);
        });
      }
      const { data, error, count } = await query;
      if (error) throw error;
      const results = data.map((item) => ({
        id: item.id,
        payload: item[this.metadataColumnName]
      }));
      return [results, count || 0];
    } catch (error) {
      console.error("Error listing vectors:", error);
      throw error;
    }
  }
  async getUserId() {
    try {
      const { data: tableExists } = await this.client.from("memory_migrations").select("user_id").limit(1);
      if (!tableExists || tableExists.length === 0) {
        const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const { error: insertError } = await this.client.from("memory_migrations").insert({ user_id: randomUserId2 });
        if (insertError) throw insertError;
        return randomUserId2;
      }
      const { data, error } = await this.client.from("memory_migrations").select("user_id").limit(1);
      if (error) throw error;
      if (!data || data.length === 0) {
        const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const { error: insertError } = await this.client.from("memory_migrations").insert({ user_id: randomUserId2 });
        if (insertError) throw insertError;
        return randomUserId2;
      }
      return data[0].user_id;
    } catch (error) {
      console.error("Error getting user ID:", error);
      return "anonymous-supabase";
    }
  }
  async setUserId(userId) {
    try {
      const { error: deleteError } = await this.client.from("memory_migrations").delete().neq("user_id", "");
      if (deleteError) throw deleteError;
      const { error: insertError } = await this.client.from("memory_migrations").insert({ user_id: userId });
      if (insertError) throw insertError;
    } catch (error) {
      console.error("Error setting user ID:", error);
    }
  }
};

// src/oss/src/vector_stores/langchain.ts
import { Document } from "@langchain/core/documents";
var LangchainVectorStore = class {
  // Simple in-memory user ID
  constructor(config) {
    this.storeUserId = "anonymous-langchain-user";
    var _a2, _b;
    if (!config.client || typeof config.client !== "object") {
      throw new Error(
        "Langchain vector store provider requires an initialized Langchain VectorStore instance passed via the 'client' field."
      );
    }
    if (typeof config.client.addVectors !== "function" || typeof config.client.similaritySearchVectorWithScore !== "function") {
      throw new Error(
        "Provided Langchain 'client' does not appear to be a valid Langchain VectorStore (missing addVectors or similaritySearchVectorWithScore method)."
      );
    }
    this.lcStore = config.client;
    this.dimension = config.dimension;
    if (!this.dimension && ((_a2 = this.lcStore.embeddings) == null ? void 0 : _a2.embeddingDimension)) {
      this.dimension = this.lcStore.embeddings.embeddingDimension;
    }
    if (!this.dimension && ((_b = this.lcStore.embedding) == null ? void 0 : _b.embeddingDimension)) {
      this.dimension = this.lcStore.embedding.embeddingDimension;
    }
    if (!this.dimension) {
      console.warn(
        "LangchainVectorStore: Could not determine embedding dimension. Input validation might be skipped."
      );
    }
  }
  // --- Method Mappings ---
  async insert(vectors, ids, payloads) {
    if (!ids || ids.length !== vectors.length) {
      throw new Error(
        "IDs array must be provided and have the same length as vectors."
      );
    }
    if (this.dimension) {
      vectors.forEach((v, i) => {
        if (v.length !== this.dimension) {
          throw new Error(
            `Vector dimension mismatch at index ${i}. Expected ${this.dimension}, got ${v.length}`
          );
        }
      });
    }
    const documents = payloads.map((payload, i) => {
      return new Document({
        pageContent: "",
        // Add required empty pageContent
        metadata: { ...payload, _mem0_id: ids[i] }
      });
    });
    try {
      await this.lcStore.addVectors(vectors, documents, { ids });
    } catch (e) {
      console.warn(
        "Langchain store might not support custom IDs on insert. Trying without IDs.",
        e
      );
      await this.lcStore.addVectors(vectors, documents);
    }
  }
  async keywordSearch() {
    return null;
  }
  async search(query, topK = 5, filters) {
    if (this.dimension && query.length !== this.dimension) {
      throw new Error(
        `Query vector dimension mismatch. Expected ${this.dimension}, got ${query.length}`
      );
    }
    const results = await this.lcStore.similaritySearchVectorWithScore(
      query,
      topK
      // Do not pass lcFilter here
    );
    return results.map(([doc, score]) => ({
      id: doc.metadata._mem0_id || "unknown_id",
      payload: doc.metadata,
      score
    }));
  }
  // --- Methods with No Direct Langchain Equivalent (Throwing Errors) ---
  async get(vectorId) {
    console.error(
      `LangchainVectorStore: The 'get' method is not directly supported by most Langchain VectorStores.`
    );
    throw new Error(
      "Method 'get' not reliably supported by LangchainVectorStore wrapper."
    );
  }
  async update(vectorId, vector, payload) {
    console.error(
      `LangchainVectorStore: The 'update' method is not directly supported. Use delete followed by insert.`
    );
    throw new Error(
      "Method 'update' not supported by LangchainVectorStore wrapper."
    );
  }
  async delete(vectorId) {
    if (typeof this.lcStore.delete === "function") {
      try {
        console.warn(
          "LangchainVectorStore: Attempting delete via filter on '_mem0_id'. Success depends on the specific Langchain VectorStore's delete implementation."
        );
        await this.lcStore.delete({ filter: { _mem0_id: vectorId } });
      } catch (e) {
        console.error(
          `LangchainVectorStore: Delete failed. Underlying store's delete method might expect different arguments or filters. Error: ${e}`
        );
        throw new Error(`Delete failed in underlying Langchain store: ${e}`);
      }
    } else {
      console.error(
        `LangchainVectorStore: The underlying Langchain store instance does not seem to support a 'delete' method.`
      );
      throw new Error(
        "Method 'delete' not available on the provided Langchain VectorStore client."
      );
    }
  }
  async list(filters, topK = 100) {
    console.error(
      `LangchainVectorStore: The 'list' method is not supported by the generic LangchainVectorStore wrapper.`
    );
    throw new Error(
      "Method 'list' not supported by LangchainVectorStore wrapper."
    );
  }
  async deleteCol() {
    console.error(
      `LangchainVectorStore: The 'deleteCol' method is not supported by the generic LangchainVectorStore wrapper.`
    );
    throw new Error(
      "Method 'deleteCol' not supported by LangchainVectorStore wrapper."
    );
  }
  // --- Wrapper-Specific Methods (In-Memory User ID) ---
  async getUserId() {
    return this.storeUserId;
  }
  async setUserId(userId) {
    this.storeUserId = userId;
  }
  async initialize() {
    return Promise.resolve();
  }
};

// src/oss/src/vector_stores/azure_ai_search.ts
import {
  SearchClient,
  SearchIndexClient,
  AzureKeyCredential
} from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";
var AzureAISearch = class {
  constructor(config) {
    this.serviceName = config.serviceName;
    this.indexName = config.collectionName;
    this.embeddingModelDims = config.embeddingModelDims;
    this.compressionType = config.compressionType || "none";
    this.useFloat16 = config.useFloat16 || false;
    this.hybridSearch = config.hybridSearch || false;
    this.vectorFilterMode = config.vectorFilterMode || "preFilter";
    this.apiKey = config.apiKey;
    const serviceEndpoint = `https://${this.serviceName}.search.windows.net`;
    const credential = this.apiKey && this.apiKey !== "" && this.apiKey !== "your-api-key" ? new AzureKeyCredential(this.apiKey) : new DefaultAzureCredential();
    this.searchClient = new SearchClient(
      serviceEndpoint,
      this.indexName,
      credential
    );
    this.indexClient = new SearchIndexClient(serviceEndpoint, credential);
    this.initialize().catch(console.error);
  }
  /**
   * Initialize the Azure AI Search index if it doesn't exist
   */
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    try {
      const collections = await this.listCols();
      if (!collections.includes(this.indexName)) {
        await this.createCol();
      }
    } catch (error) {
      console.error("Error initializing Azure AI Search:", error);
      throw error;
    }
  }
  /**
   * Create a new index in Azure AI Search
   */
  async createCol() {
    const vectorType = this.useFloat16 ? "Collection(Edm.Half)" : "Collection(Edm.Single)";
    const compressionConfigurations = [];
    let compressionName = void 0;
    if (this.compressionType === "scalar") {
      compressionName = "myCompression";
      compressionConfigurations.push({
        kind: "scalarQuantization",
        compressionName
      });
    } else if (this.compressionType === "binary") {
      compressionName = "myCompression";
      compressionConfigurations.push({
        kind: "binaryQuantization",
        compressionName
      });
    }
    const fields = [
      {
        name: "id",
        type: "Edm.String",
        key: true
      },
      {
        name: "user_id",
        type: "Edm.String",
        filterable: true
      },
      {
        name: "run_id",
        type: "Edm.String",
        filterable: true
      },
      {
        name: "agent_id",
        type: "Edm.String",
        filterable: true
      },
      {
        name: "vector",
        type: vectorType,
        searchable: true,
        vectorSearchDimensions: this.embeddingModelDims,
        vectorSearchProfileName: "my-vector-config"
      },
      {
        name: "payload",
        type: "Edm.String",
        searchable: true
      }
    ];
    const vectorSearch = {
      profiles: [
        {
          name: "my-vector-config",
          algorithmConfigurationName: "my-algorithms-config",
          compressionName: this.compressionType !== "none" ? compressionName : void 0
        }
      ],
      algorithms: [
        {
          kind: "hnsw",
          name: "my-algorithms-config"
        }
      ],
      compressions: compressionConfigurations
    };
    const index = {
      name: this.indexName,
      fields,
      vectorSearch
    };
    await this.indexClient.createOrUpdateIndex(index);
  }
  /**
   * Generate a document for insertion
   */
  generateDocument(vector, payload, id) {
    const document = {
      id,
      vector,
      payload: JSON.stringify(payload)
    };
    for (const field of ["user_id", "run_id", "agent_id"]) {
      if (field in payload) {
        document[field] = payload[field];
      }
    }
    return document;
  }
  /**
   * Insert vectors into the index
   */
  async insert(vectors, ids, payloads) {
    console.log(
      `Inserting ${vectors.length} vectors into index ${this.indexName}`
    );
    const documents = vectors.map(
      (vector, idx) => this.generateDocument(vector, payloads[idx] || {}, ids[idx])
    );
    const response = await this.searchClient.uploadDocuments(documents);
    for (const result of response.results) {
      if (!result.succeeded) {
        throw new Error(
          `Insert failed for document ${result.key}: ${result.errorMessage}`
        );
      }
    }
  }
  /**
   * Sanitize filter keys to remove non-alphanumeric characters
   */
  sanitizeKey(key) {
    return key.replace(/[^\w]/g, "");
  }
  /**
   * Build OData filter expression from SearchFilters
   */
  buildFilterExpression(filters) {
    const filterConditions = [];
    for (const [key, value] of Object.entries(filters)) {
      const safeKey = this.sanitizeKey(key);
      if (typeof value === "string") {
        const safeValue = value.replace(/'/g, "''");
        filterConditions.push(`${safeKey} eq '${safeValue}'`);
      } else {
        filterConditions.push(`${safeKey} eq ${value}`);
      }
    }
    return filterConditions.join(" and ");
  }
  /**
   * Extract JSON from payload string
   * Handles cases where payload might have extra text
   */
  extractJson(payload) {
    try {
      JSON.parse(payload);
      return payload;
    } catch (e) {
      const match = payload.match(/\{.*\}/s);
      return match ? match[0] : payload;
    }
  }
  /**
   * Keyword search using Azure AI Search native full-text (BM25) capabilities
   */
  async keywordSearch(query, topK = 5, filters) {
    try {
      const filterExpression = filters ? this.buildFilterExpression(filters) : void 0;
      const searchResults = await this.searchClient.search(query, {
        filter: filterExpression,
        top: topK,
        searchFields: ["payload"]
      });
      const results = [];
      for await (const result of searchResults.results) {
        const payloadStr = result.document.payload;
        const payload = JSON.parse(this.extractJson(payloadStr));
        results.push({
          id: result.document.id,
          score: result.score,
          payload
        });
      }
      return results;
    } catch (error) {
      console.error("Error during keyword search:", error);
      return null;
    }
  }
  /**
   * Search for similar vectors
   */
  async search(query, topK = 5, filters) {
    const filterExpression = filters ? this.buildFilterExpression(filters) : void 0;
    const vectorQuery = {
      kind: "vector",
      vector: query,
      kNearestNeighborsCount: topK,
      fields: ["vector"]
    };
    let searchResults;
    if (this.hybridSearch) {
      searchResults = await this.searchClient.search("*", {
        vectorSearchOptions: {
          queries: [vectorQuery],
          filterMode: this.vectorFilterMode
        },
        filter: filterExpression,
        top: topK,
        searchFields: ["payload"]
      });
    } else {
      searchResults = await this.searchClient.search("*", {
        vectorSearchOptions: {
          queries: [vectorQuery],
          filterMode: this.vectorFilterMode
        },
        filter: filterExpression,
        top: topK
      });
    }
    const results = [];
    for await (const result of searchResults.results) {
      const payloadStr = result.document.payload;
      const payload = JSON.parse(this.extractJson(payloadStr));
      results.push({
        id: result.document.id,
        score: result.score,
        payload
      });
    }
    return results;
  }
  /**
   * Delete a vector by ID
   */
  async delete(vectorId) {
    const response = await this.searchClient.deleteDocuments([
      { id: vectorId }
    ]);
    for (const result of response.results) {
      if (!result.succeeded) {
        throw new Error(
          `Delete failed for document ${vectorId}: ${result.errorMessage}`
        );
      }
    }
    console.log(
      `Deleted document with ID '${vectorId}' from index '${this.indexName}'.`
    );
  }
  /**
   * Update a vector and its payload
   */
  async update(vectorId, vector, payload) {
    const document = { id: vectorId };
    if (vector) {
      document.vector = vector;
    }
    if (payload) {
      document.payload = JSON.stringify(payload);
      for (const field of ["user_id", "run_id", "agent_id"]) {
        if (field in payload) {
          document[field] = payload[field];
        }
      }
    }
    const response = await this.searchClient.mergeOrUploadDocuments([document]);
    for (const result of response.results) {
      if (!result.succeeded) {
        throw new Error(
          `Update failed for document ${vectorId}: ${result.errorMessage}`
        );
      }
    }
  }
  /**
   * Retrieve a vector by ID
   */
  async get(vectorId) {
    try {
      const result = await this.searchClient.getDocument(vectorId);
      const payloadStr = result.payload;
      const payload = JSON.parse(this.extractJson(payloadStr));
      return {
        id: result.id,
        payload
      };
    } catch (error) {
      if ((error == null ? void 0 : error.statusCode) === 404) {
        return null;
      }
      throw error;
    }
  }
  /**
   * List all collections (indexes)
   */
  async listCols() {
    const names = [];
    for await (const index of this.indexClient.listIndexes()) {
      names.push(index.name);
    }
    return names;
  }
  /**
   * Delete the index
   */
  async deleteCol() {
    await this.indexClient.deleteIndex(this.indexName);
  }
  /**
   * Get information about the index
   */
  async colInfo() {
    const index = await this.indexClient.getIndex(this.indexName);
    return {
      name: index.name,
      fields: index.fields
    };
  }
  /**
   * List all vectors in the index
   */
  async list(filters, topK = 100) {
    const filterExpression = filters ? this.buildFilterExpression(filters) : void 0;
    const searchResults = await this.searchClient.search("*", {
      filter: filterExpression,
      top: topK
    });
    const results = [];
    for await (const result of searchResults.results) {
      const payloadStr = result.document.payload;
      const payload = JSON.parse(this.extractJson(payloadStr));
      results.push({
        id: result.document.id,
        score: result.score,
        payload
      });
    }
    return [results, results.length];
  }
  /**
   * Generate a random user ID
   */
  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
      }
    );
  }
  /**
   * Get user ID from memory_migrations collection
   * Required by VectorStore interface
   */
  async getUserId() {
    try {
      const collections = await this.listCols();
      const migrationIndexExists = collections.includes("memory_migrations");
      if (!migrationIndexExists) {
        const migrationIndex = {
          name: "memory_migrations",
          fields: [
            {
              name: "id",
              type: "Edm.String",
              key: true
            },
            {
              name: "user_id",
              type: "Edm.String",
              searchable: false,
              filterable: true
            }
          ]
        };
        await this.indexClient.createOrUpdateIndex(migrationIndex);
      }
      const searchResults = await this.searchClient.search("*", {
        top: 1
      });
      for await (const result of searchResults.results) {
        const userId = result.document.user_id;
        if (userId) {
          return userId;
        }
      }
      const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await this.searchClient.uploadDocuments([
        {
          id: this.generateUUID(),
          user_id: randomUserId2
        }
      ]);
      return randomUserId2;
    } catch (error) {
      console.error("Error getting user ID:", error);
      throw error;
    }
  }
  /**
   * Set user ID in memory_migrations collection
   * Required by VectorStore interface
   */
  async setUserId(userId) {
    try {
      const searchResults = await this.searchClient.search("*", {
        top: 1
      });
      let pointId = this.generateUUID();
      for await (const result of searchResults.results) {
        pointId = result.document.id;
        break;
      }
      await this.searchClient.mergeOrUploadDocuments([
        {
          id: pointId,
          user_id: userId
        }
      ]);
    } catch (error) {
      console.error("Error setting user ID:", error);
      throw error;
    }
  }
  /**
   * Reset the index by deleting and recreating it
   */
  async reset() {
    console.log(`Resetting index ${this.indexName}...`);
    try {
      await this.deleteCol();
      await this.createCol();
    } catch (error) {
      console.error(`Error resetting index ${this.indexName}:`, error);
      throw error;
    }
  }
};

// src/oss/src/vector_stores/pgvector.ts
import pkg from "pg";
var { Client, escapeIdentifier } = pkg;
var SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
function validateIdentifier(name, label = "identifier") {
  if (!SAFE_IDENTIFIER_RE.test(name)) {
    throw new Error(
      `Invalid ${label} '${name}': only letters, digits, and underscores are allowed, must start with a letter or underscore, and be at most 128 characters.`
    );
  }
  return name;
}
function escapeFilterKey(key) {
  if (!SAFE_IDENTIFIER_RE.test(key)) {
    throw new Error(
      `Invalid filter key '${key}': only letters, digits, and underscores are allowed.`
    );
  }
  return key;
}
var PGVector = class {
  constructor(config) {
    this.collectionName = validateIdentifier(
      config.collectionName || "memories",
      "collectionName"
    );
    this.useDiskann = config.diskann || false;
    this.useHnsw = config.hnsw || false;
    this.dbName = validateIdentifier(config.dbname || "vector_store", "dbname");
    this.config = config;
    this.client = new Client({
      database: "postgres",
      // Initially connect to default postgres database
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port
    });
    this.initialize().catch(console.error);
  }
  col() {
    return escapeIdentifier(this.collectionName);
  }
  async initialize() {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }
  async _doInitialize() {
    try {
      await this.client.connect();
      const dbExists = await this.checkDatabaseExists(this.dbName);
      if (!dbExists) {
        await this.createDatabase(this.dbName);
      }
      await this.client.end();
      this.client = new Client({
        database: this.dbName,
        user: this.config.user,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port
      });
      await this.client.connect();
      await this.client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS memory_migrations (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE
        )
      `);
      const collections = await this.listCols();
      if (!collections.includes(this.collectionName)) {
        await this.createCol(this.config.embeddingModelDims);
      }
    } catch (error) {
      console.error("Error during initialization:", error);
      throw error;
    }
  }
  async checkDatabaseExists(dbName) {
    const result = await this.client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    return result.rows.length > 0;
  }
  async createDatabase(dbName) {
    await this.client.query(`CREATE DATABASE ${escapeIdentifier(dbName)}`);
  }
  async createCol(embeddingModelDims) {
    const dims = Math.floor(embeddingModelDims);
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.col()} (
        id UUID PRIMARY KEY,
        vector vector(${dims}),
        payload JSONB
      );
    `);
    if (this.useDiskann && embeddingModelDims < 2e3) {
      try {
        const result = await this.client.query(
          "SELECT * FROM pg_extension WHERE extname = 'vectorscale'"
        );
        if (result.rows.length > 0) {
          await this.client.query(`
            CREATE INDEX IF NOT EXISTS ${escapeIdentifier(this.collectionName + "_diskann_idx")}
            ON ${this.col()}
            USING diskann (vector);
          `);
        }
      } catch (error) {
        console.warn("DiskANN index creation failed:", error);
      }
    } else if (this.useHnsw) {
      try {
        await this.client.query(`
          CREATE INDEX IF NOT EXISTS ${escapeIdentifier(this.collectionName + "_hnsw_idx")}
          ON ${this.col()}
          USING hnsw (vector vector_cosine_ops);
        `);
      } catch (error) {
        console.warn("HNSW index creation failed:", error);
      }
    }
  }
  async insert(vectors, ids, payloads) {
    const values = vectors.map((vector, i) => ({
      id: ids[i],
      vector: `[${vector.join(",")}]`,
      payload: payloads[i]
    }));
    const query = `
      INSERT INTO ${this.col()} (id, vector, payload)
      VALUES ($1, $2::vector, $3::jsonb)
    `;
    await Promise.all(
      values.map(
        (value) => this.client.query(query, [value.id, value.vector, value.payload])
      )
    );
  }
  async keywordSearch(query, topK = 5, filters) {
    try {
      const filterConditions = [];
      const filterValues = [query, topK];
      let filterIndex = 3;
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const safeKey = escapeFilterKey(key);
          filterConditions.push(`payload->>'${safeKey}' = $${filterIndex}`);
          filterValues.push(value);
          filterIndex++;
        }
      }
      const filterClause = filterConditions.length > 0 ? "AND " + filterConditions.join(" AND ") : "";
      const searchQuery = `
        SELECT id, ts_rank_cd(to_tsvector('simple', payload->>'textLemmatized'), plainto_tsquery('simple', $1)) AS score, payload
        FROM ${this.col()}
        WHERE to_tsvector('simple', payload->>'textLemmatized') @@ plainto_tsquery('simple', $1)
        ${filterClause}
        ORDER BY score DESC
        LIMIT $2
      `;
      const result = await this.client.query(searchQuery, filterValues);
      return result.rows.map((row) => ({
        id: row.id,
        payload: row.payload,
        score: row.score
      }));
    } catch (error) {
      console.error("Error during keyword search:", error);
      return null;
    }
  }
  async search(query, topK = 5, filters) {
    const filterConditions = [];
    const queryVector = `[${query.join(",")}]`;
    const filterValues = [queryVector, topK];
    let filterIndex = 3;
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        const safeKey = escapeFilterKey(key);
        filterConditions.push(`payload->>'${safeKey}' = $${filterIndex}`);
        filterValues.push(value);
        filterIndex++;
      }
    }
    const filterClause = filterConditions.length > 0 ? "WHERE " + filterConditions.join(" AND ") : "";
    const searchQuery = `
      SELECT id, vector <=> $1::vector AS distance, payload
      FROM ${this.col()}
      ${filterClause}
      ORDER BY distance
      LIMIT $2
    `;
    const result = await this.client.query(searchQuery, filterValues);
    return result.rows.map((row) => ({
      id: row.id,
      payload: row.payload,
      score: Math.max(0, Math.min(1, 1 - Number(row.distance)))
    }));
  }
  async get(vectorId) {
    const result = await this.client.query(
      `SELECT id, payload FROM ${this.col()} WHERE id = $1`,
      [vectorId]
    );
    if (result.rows.length === 0) return null;
    return {
      id: result.rows[0].id,
      payload: result.rows[0].payload
    };
  }
  async update(vectorId, vector, payload) {
    const vectorStr = `[${vector.join(",")}]`;
    await this.client.query(
      `
      UPDATE ${this.col()}
      SET vector = $1::vector, payload = $2::jsonb
      WHERE id = $3
      `,
      [vectorStr, payload, vectorId]
    );
  }
  async delete(vectorId) {
    await this.client.query(`DELETE FROM ${this.col()} WHERE id = $1`, [
      vectorId
    ]);
  }
  async deleteCol() {
    await this.client.query(`DROP TABLE IF EXISTS ${this.col()}`);
  }
  async listCols() {
    const result = await this.client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    return result.rows.map((row) => row.table_name);
  }
  async list(filters, topK = 100) {
    const filterConditions = [];
    const filterValues = [];
    let paramIndex = 1;
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        const safeKey = escapeFilterKey(key);
        filterConditions.push(`payload->>'${safeKey}' = $${paramIndex}`);
        filterValues.push(value);
        paramIndex++;
      }
    }
    const filterClause = filterConditions.length > 0 ? "WHERE " + filterConditions.join(" AND ") : "";
    const listQuery = `
      SELECT id, payload
      FROM ${this.col()}
      ${filterClause}
      LIMIT $${paramIndex}
    `;
    const countQuery = `
      SELECT COUNT(*)
      FROM ${this.col()}
      ${filterClause}
    `;
    filterValues.push(topK);
    const [listResult, countResult] = await Promise.all([
      this.client.query(listQuery, filterValues),
      this.client.query(countQuery, filterValues.slice(0, -1))
      // Remove limit parameter for count query
    ]);
    const results = listResult.rows.map((row) => ({
      id: row.id,
      payload: row.payload
    }));
    return [results, parseInt(countResult.rows[0].count)];
  }
  async close() {
    await this.client.end();
  }
  async getUserId() {
    const result = await this.client.query(
      "SELECT user_id FROM memory_migrations LIMIT 1"
    );
    if (result.rows.length > 0) {
      return result.rows[0].user_id;
    }
    const randomUserId2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await this.client.query(
      "INSERT INTO memory_migrations (user_id) VALUES ($1)",
      [randomUserId2]
    );
    return randomUserId2;
  }
  async setUserId(userId) {
    await this.client.query("DELETE FROM memory_migrations");
    await this.client.query(
      "INSERT INTO memory_migrations (user_id) VALUES ($1)",
      [userId]
    );
  }
};

export {
  MemoryVectorStore, Qdrant, VectorizeDB, RedisDB, SupabaseDB,
  LangchainVectorStore, AzureAISearch, PGVector,
  getDefaultVectorStoreDbPath, ensureSQLiteDirectory,
  toSnakeCase, toCamelCase, validateIdentifier, escapeFilterKey, escapeRedisTagValue
};
