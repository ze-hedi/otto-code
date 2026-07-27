import { v4 as uuidv43 } from "uuid";
import { createHash } from "crypto";
import { MemoryConfigSchema } from "./types.js";
import { captureClientEvent, getOrCreateMem0UserId } from "./telemetry.js";
import { ConfigManager } from "./config.js";
import { EmbedderFactory, LLMFactory, VectorStoreFactory, HistoryManagerFactory } from "./factory.js";
import { DummyHistoryManager } from "./storage.js";
import { getDefaultVectorStoreDbPath } from "./vector-stores.js";
import { parse_vision_messages } from "./utils.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AdditiveExtractionSchema, generateAdditiveExtractionPrompt, extractJson } from "./prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADDITIVE_EXTRACTION_PROMPT = fs.readFileSync(
  path.resolve(__dirname, "../prompts/additive-extraction.md"),
  "utf-8"
);
import { ENTITY_BOOST_WEIGHT, lemmatizeForBm25, extractEntities, extractEntitiesBatch, getBm25Params, normalizeBm25, scoreAndRank } from "./scoring.js";

// src/oss/src/memory/index.ts
var ENTITY_PARAMS = [
  "user_id",
  "agent_id",
  "run_id",
  "userId",
  "agentId",
  "runId"
];
function rejectTopLevelEntityParams(config, methodName) {
  const invalidKeys = Object.keys(config).filter(
    (k) => ENTITY_PARAMS.includes(k)
  );
  if (invalidKeys.length > 0) {
    throw new Error(
      `Top-level entity parameters [${invalidKeys.join(", ")}] are not supported in ${methodName}(). Use filters: { userId: "..." } instead.`
    );
  }
}
function validateAndTrimEntityId(value, name) {
  if (value === void 0) return void 0;
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(
      `Invalid ${name}: cannot be empty or whitespace-only. Provide a valid identifier.`
    );
  }
  if (/\s/.test(trimmed)) {
    throw new Error(
      `Invalid ${name}: cannot contain whitespace. Provide a valid identifier without spaces.`
    );
  }
  return trimmed;
}
function validateSearchParams(threshold, topK) {
  if (threshold !== void 0) {
    if (typeof threshold !== "number" || isNaN(threshold)) {
      throw new Error("threshold must be a valid number");
    }
    if (threshold < 0 || threshold > 1) {
      throw new Error(
        `Invalid threshold: ${threshold}. Must be between 0 and 1 (inclusive).`
      );
    }
  }
  if (topK !== void 0) {
    if (typeof topK !== "number" || isNaN(topK) || !Number.isInteger(topK)) {
      throw new Error("topK must be a valid integer");
    }
    if (topK < 0) {
      throw new Error(`Invalid topK: ${topK}. Must be a non-negative integer.`);
    }
  }
}
var Memory = class _Memory {
  constructor(config = {}) {
    this.config = ConfigManager.mergeConfig(config);
    this.customInstructions = this.config.customInstructions;
    this.retrievalTopK = this.config.retrievalTopK || 10;
    this.embedder = EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config
    );
    this.llm = LLMFactory.create(
      this.config.llm.provider,
      this.config.llm.config
    );
    if (this.config.disableHistory) {
      this.db = new DummyHistoryManager();
    } else {
      this.db = HistoryManagerFactory.create(
        this.config.historyStore.provider,
        this.config.historyStore
      );
    }
    this.collectionName = this.config.vectorStore.config.collectionName;
    this.apiVersion = this.config.version || "v1.0";
    this.telemetryId = "anonymous";
    this._initPromise = this._autoInitialize().catch((error) => {
      this._initError = error instanceof Error ? error : new Error(String(error));
      console.error(this._initError);
    });
  }
  /**
   * If no explicit dimension was provided, runs a probe embedding to
   * detect it. Then creates and initializes the vector store.
   */
  async _autoInitialize() {
    if (!this.config.vectorStore.config.dimension) {
      try {
        const probe = await this.embedder.embed("dimension probe");
        this.config.vectorStore.config.dimension = probe.length;
      } catch (error) {
        throw new Error(
          `Failed to auto-detect embedding dimension from provider '${this.config.embedder.provider}': ${error.message}. Please set 'dimension' in vectorStore.config or 'embeddingDims' in embedder.config explicitly.`
        );
      }
    }
    this.vectorStore = VectorStoreFactory.create(
      this.config.vectorStore.provider,
      this.config.vectorStore.config
    );
    await this.vectorStore.initialize();
    await this._initializeTelemetry();
  }
  /**
   * Ensures that auto-initialization (dimension detection + vector store
   * creation) has completed before any public method proceeds.
   * If a previous init attempt failed, retries automatically.
   */
  async _ensureInitialized() {
    await this._initPromise;
    if (this._initError) {
      this._initError = void 0;
      this._initPromise = this._autoInitialize().catch((error) => {
        this._initError = error instanceof Error ? error : new Error(String(error));
        console.error(this._initError);
      });
      await this._initPromise;
      if (this._initError) {
        throw this._initError;
      }
    }
  }
  async getEntityStore() {
    if (!this._entityStore) {
      const entityCollectionName = `${this.collectionName}_entities`;
      const entityConfig = {
        ...this.config.vectorStore.config,
        collectionName: entityCollectionName
      };
      if (this.config.vectorStore.provider === "memory") {
        const basePath = entityConfig.dbPath || getDefaultVectorStoreDbPath();
        entityConfig.dbPath = basePath.replace(/\.db$/, "_entities.db");
      }
      this._entityStore = VectorStoreFactory.create(
        this.config.vectorStore.provider,
        entityConfig
      );
      await this._entityStore.initialize();
    }
    return this._entityStore;
  }
  /**
   * Normalize a filters object for entity-store scoping: keeps only
   * user_id/agent_id/run_id keys whose values are defined.
   */
  _sessionFiltersFromPayload(payload) {
    const filters = {};
    if (payload.user_id) filters.user_id = payload.user_id;
    if (payload.agent_id) filters.agent_id = payload.agent_id;
    if (payload.run_id) filters.run_id = payload.run_id;
    return filters;
  }
  /**
   * Remove `memoryId` from every entity record scoped to `filters`.
   * If an entity's `linkedMemoryIds` becomes empty after removal, the
   * entity record itself is deleted. Errors on individual entities are
   * swallowed so one bad record does not break the whole operation.
   *
   * No-op if the entity store has not been initialized yet.
   */
  async _removeMemoryFromEntityStore(memoryId, filters) {
    let entityStore;
    try {
      entityStore = await this.getEntityStore();
    } catch (e) {
      console.debug(`Entity store unavailable during cleanup: ${e}`);
      return;
    }
    let rows = [];
    try {
      const listed = await entityStore.list(filters, 1e4);
      rows = Array.isArray(listed) && Array.isArray(listed[0]) ? listed[0] : listed;
    } catch (e) {
      console.debug(`Entity store list failed during cleanup: ${e}`);
      return;
    }
    for (const row of rows) {
      try {
        const payload = row.payload || {};
        const linked = Array.isArray(payload.linkedMemoryIds) ? payload.linkedMemoryIds : [];
        if (!linked.includes(memoryId)) continue;
        const remaining = linked.filter((id) => id !== memoryId);
        if (remaining.length === 0) {
          try {
            await entityStore.delete(row.id);
          } catch (e) {
            console.debug(`Entity delete failed for id=${row.id}: ${e}`);
          }
        } else {
          const newPayload = { ...payload, linkedMemoryIds: remaining };
          const entityText = typeof payload.data === "string" ? payload.data : "";
          if (!entityText) {
            console.debug(
              `Entity id=${row.id} missing 'data'; skipping update during cleanup`
            );
            continue;
          }
          let vec;
          try {
            vec = await this.embedder.embed(entityText);
          } catch (e) {
            console.debug(`Entity re-embed failed for '${entityText}': ${e}`);
            continue;
          }
          try {
            await entityStore.update(row.id, vec, newPayload);
          } catch (e) {
            console.debug(`Entity update failed for id=${row.id}: ${e}`);
          }
        }
      } catch (e) {
        console.debug(`Entity cleanup error for id=${row == null ? void 0 : row.id}: ${e}`);
      }
    }
  }
  /**
   * Extract entities from `text` and link them to `memoryId` in the
   * entity store, scoped to `filters` (user_id / agent_id / run_id).
   *
   * Simpler single-memory variant of Phase 7 in add(): no cross-memory
   * dedup, but still does per-entity "search for existing, update if
   * match >= 0.95 else insert new". Non-fatal errors are swallowed.
   */
  async _linkEntitiesForMemory(memoryId, text, filters) {
    var _a2;
    try {
      const entities = extractEntities(text);
      if (entities.length === 0) return;
      const entityStore = await this.getEntityStore();
      for (const entity of entities) {
        try {
          let entityVec;
          try {
            entityVec = await this.embedder.embed(entity.text);
          } catch (e) {
            console.debug(`Entity embed failed for '${entity.text}': ${e}`);
            continue;
          }
          let matches = [];
          try {
            matches = await entityStore.search(entityVec, 1, filters);
          } catch (e) {
          }
          if (matches.length > 0 && ((_a2 = matches[0].score) != null ? _a2 : 0) >= 0.95) {
            const match = matches[0];
            const payload = match.payload || {};
            const linked = new Set(
              Array.isArray(payload.linkedMemoryIds) ? payload.linkedMemoryIds : []
            );
            linked.add(memoryId);
            payload.linkedMemoryIds = Array.from(linked).sort();
            try {
              await entityStore.update(match.id, entityVec, payload);
            } catch (e) {
              console.debug(`Entity update failed for '${entity.text}': ${e}`);
            }
          } else {
            const entityPayload = {
              data: entity.text,
              entityType: entity.type,
              linkedMemoryIds: [memoryId]
            };
            if (filters.user_id) entityPayload.user_id = filters.user_id;
            if (filters.agent_id) entityPayload.agent_id = filters.agent_id;
            if (filters.run_id) entityPayload.run_id = filters.run_id;
            try {
              await entityStore.insert(
                [entityVec],
                [uuidv43()],
                [entityPayload]
              );
            } catch (e) {
              console.debug(`Entity insert failed for '${entity.text}': ${e}`);
            }
          }
        } catch (e) {
          console.debug(`Entity link error for '${entity.text}': ${e}`);
        }
      }
    } catch (e) {
      console.warn(`Entity linking failed during update: ${e}`);
    }
  }
  buildSessionScope(filters) {
    const parts = [];
    for (const key of ["agent_id", "run_id", "user_id"].sort()) {
      const val = filters[key];
      if (val) parts.push(`${key}=${val}`);
    }
    return parts.join("&");
  }
  async _initializeTelemetry() {
    try {
      await this._getTelemetryId();
      await captureClientEvent("init", this, {
        api_version: this.apiVersion,
        client_type: "Memory",
        collection_name: this.collectionName
      });
    } catch (error) {
    }
  }
  async _getTelemetryId() {
    try {
      if (!this.telemetryId || this.telemetryId === "anonymous" || this.telemetryId === "anonymous-supabase") {
        this.telemetryId = await getOrCreateMem0UserId() || await this.vectorStore.getUserId();
        try {
          await this.vectorStore.setUserId(this.telemetryId);
        } catch (e) {
        }
      }
      return this.telemetryId;
    } catch (error) {
      this.telemetryId = "anonymous";
      return this.telemetryId;
    }
  }
  async _captureEvent(methodName, additionalData = {}) {
    try {
      await this._getTelemetryId();
      await captureClientEvent(methodName, this, {
        ...additionalData,
        api_version: this.apiVersion,
        collection_name: this.collectionName
      });
    } catch (error) {
      console.error(`Failed to capture ${methodName} event:`, error);
    }
  }
  static fromConfig(configDict) {
    try {
      const config = MemoryConfigSchema.parse(configDict);
      return new _Memory(config);
    } catch (e) {
      console.error("Configuration validation error:", e);
      throw e;
    }
  }
  async add(messages, config) {
    if (messages === void 0 || messages === null) {
      throw new Error(
        "messages is required and cannot be undefined or null. Provide a string or array of messages."
      );
    }
    await this._ensureInitialized();
    await this._captureEvent("add", {
      message_count: Array.isArray(messages) ? messages.length : 1,
      has_metadata: !!config.metadata,
      has_filters: !!config.filters
    });
    const { metadata = {}, filters = {}, conversationHistory = [] } = config;
    const userId = validateAndTrimEntityId(config.userId, "userId");
    const agentId = validateAndTrimEntityId(config.agentId, "agentId");
    const runId = validateAndTrimEntityId(config.runId, "runId");
    if (userId) filters.user_id = metadata.user_id = userId;
    if (agentId) filters.agent_id = metadata.agent_id = agentId;
    if (runId) filters.run_id = metadata.run_id = runId;
    if (!filters.user_id && !filters.agent_id && !filters.run_id) {
      throw new Error(
        "One of the filters: userId, agentId or runId is required!"
      );
    }
    const parsedMessages = Array.isArray(messages) ? messages : [{ role: "user", content: messages }];
    const final_parsedMessages = await parse_vision_messages(parsedMessages);
    const vectorStoreResult = await this.addToVectorStore(
      final_parsedMessages,
      metadata,
      filters,
      conversationHistory
    );
    return {
      results: vectorStoreResult
    };
  }
  async addToVectorStore(messages, metadata, filters, conversationHistory = []) {
    var _a2, _b, _c, _d, _e, _f, _g;
    const lastMessages = conversationHistory;
    const parsedMessages = messages.map((m) => m.content).join("\n");
    const queryEmbedding = await this.embedder.embed(parsedMessages);
    const existingResults = await this.vectorStore.search(
      queryEmbedding,
      this.retrievalTopK,
      filters
    );
    const existingMemories = [];
    const uuidMapping = {};
    for (let idx = 0; idx < existingResults.length; idx++) {
      const mem = existingResults[idx];
      uuidMapping[String(idx)] = mem.id;
      existingMemories.push({
        id: String(idx),
        text: (_b = (_a2 = mem.payload) == null ? void 0 : _a2.data) != null ? _b : ""
      });
    }
    let systemPrompt = ADDITIVE_EXTRACTION_PROMPT;
    
    const userPrompt = generateAdditiveExtractionPrompt({
      existingMemories,
      newMessages: parsedMessages,
      lastKMessages: lastMessages,
      customInstructions: this.customInstructions
    });
    let response;
    try {
      response = await this.llm.generateResponse(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { type: "json_object" }
      );
    } catch (e) {
      console.error("LLM extraction failed:", e);
      return [];
    }
    let extractedMemories = [];
    try {
      const cleanResponse = extractJson(response);
      if (cleanResponse && cleanResponse.trim()) {
        try {
          const parsed = AdditiveExtractionSchema.parse(
            JSON.parse(cleanResponse)
          );
          extractedMemories = parsed.memory;
        } catch (e) {
          const fallbackJson = extractJson(cleanResponse);
          extractedMemories = (_d = (_c = JSON.parse(fallbackJson)) == null ? void 0 : _c.memory) != null ? _d : [];
        }
      }
    } catch (e) {
      console.error("Error parsing extraction response:", e);
      extractedMemories = [];
    }
    if (extractedMemories.length === 0) {
      if (typeof this.db.saveMessages === "function") {
        try {
          await this.db.saveMessages(
            messages.map((m) => ({
              role: m.role,
              content: m.content
            })),
            sessionScope
          );
        } catch (e) {
        }
      }
      return [];
    }
    const memTexts = extractedMemories.map((m) => {
      var _a3;
      return (_a3 = m.text) != null ? _a3 : "";
    }).filter((t) => t.length > 0);
    let embedMap = {};
    try {
      const memEmbeddingsList = await this.embedder.embedBatch(memTexts);
      for (let i = 0; i < memTexts.length; i++) {
        embedMap[memTexts[i]] = memEmbeddingsList[i];
      }
    } catch (e) {
      for (const text of memTexts) {
        try {
          embedMap[text] = await this.embedder.embed(text);
        } catch (e2) {
          console.warn(`Failed to embed memory text: ${e2}`);
        }
      }
    }
    const existingHashes = /* @__PURE__ */ new Set();
    for (const mem of existingResults) {
      const h = (_e = mem.payload) == null ? void 0 : _e.hash;
      if (h) existingHashes.add(h);
    }
    const records = [];
    const seenHashes = /* @__PURE__ */ new Set();
    for (const mem of extractedMemories) {
      const text = mem.text;
      if (!text || !(text in embedMap)) continue;
      const memHash = createHash("md5").update(text).digest("hex");
      if (existingHashes.has(memHash) || seenHashes.has(memHash)) {
        continue;
      }
      seenHashes.add(memHash);
      const textLemmatized = lemmatizeForBm25(text);
      const memoryId = uuidv43();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const memPayload = {
        ...metadata,
        data: text,
        textLemmatized,
        hash: memHash,
        createdAt: now,
        updatedAt: now
      };
      if (mem.attributed_to) {
        memPayload.attributedTo = mem.attributed_to;
      }
      if (filters.user_id) memPayload.user_id = filters.user_id;
      if (filters.agent_id) memPayload.agent_id = filters.agent_id;
      if (filters.run_id) memPayload.run_id = filters.run_id;
      records.push({
        memoryId,
        text,
        embedding: embedMap[text],
        payload: memPayload
      });
    }
    if (records.length === 0) {
      if (typeof this.db.saveMessages === "function") {
        try {
          await this.db.saveMessages(
            messages.map((m) => ({
              role: m.role,
              content: m.content
            })),
            sessionScope
          );
        } catch (e) {
        }
      }
      return [];
    }
    const allVectors = records.map((r) => r.embedding);
    const allIds = records.map((r) => r.memoryId);
    const allPayloads = records.map((r) => r.payload);
    try {
      await this.vectorStore.insert(allVectors, allIds, allPayloads);
    } catch (e) {
      for (let i = 0; i < allIds.length; i++) {
        try {
          await this.vectorStore.insert(
            [allVectors[i]],
            [allIds[i]],
            [allPayloads[i]]
          );
        } catch (e2) {
          console.error(`Failed to insert memory ${allIds[i]}: ${e2}`);
        }
      }
    }
    const historyRecords = records.map((r) => ({
      memoryId: r.memoryId,
      previousValue: null,
      newValue: r.text,
      action: "ADD",
      createdAt: r.payload.createdAt,
      updatedAt: void 0,
      isDeleted: 0
    }));
    if (typeof this.db.batchAddHistory === "function") {
      try {
        await this.db.batchAddHistory(historyRecords);
      } catch (e) {
        for (const hr of historyRecords) {
          try {
            await this.db.addHistory(
              hr.memoryId,
              null,
              hr.newValue,
              "ADD",
              hr.createdAt
            );
          } catch (e2) {
            console.error(`Failed to add history for ${hr.memoryId}: ${e2}`);
          }
        }
      }
    } else {
      for (const hr of historyRecords) {
        try {
          await this.db.addHistory(
            hr.memoryId,
            null,
            hr.newValue,
            "ADD",
            hr.createdAt
          );
        } catch (e) {
          console.error(`Failed to add history for ${hr.memoryId}: ${e}`);
        }
      }
    }
    try {
      const allTexts = records.map((r) => r.text);
      const allEntities = extractEntitiesBatch(allTexts);
      const globalEntities = {};
      for (let idx = 0; idx < records.length; idx++) {
        const memoryId = records[idx].memoryId;
        const entities = idx < allEntities.length ? allEntities[idx] : [];
        for (const entity of entities) {
          const key = entity.text.trim().toLowerCase();
          if (key in globalEntities) {
            globalEntities[key].memoryIds.add(memoryId);
          } else {
            globalEntities[key] = {
              entityType: entity.type,
              entityText: entity.text,
              memoryIds: /* @__PURE__ */ new Set([memoryId])
            };
          }
        }
      }
      const orderedKeys = Object.keys(globalEntities);
      if (orderedKeys.length > 0) {
        const entityTexts = orderedKeys.map(
          (k) => globalEntities[k].entityText
        );
        let entityEmbeddings;
        try {
          entityEmbeddings = await this.embedder.embedBatch(entityTexts);
        } catch (e) {
          entityEmbeddings = [];
          for (const t of entityTexts) {
            try {
              entityEmbeddings.push(await this.embedder.embed(t));
            } catch (e2) {
              entityEmbeddings.push(null);
            }
          }
        }
        const valid = [];
        for (let i = 0; i < orderedKeys.length; i++) {
          if (entityEmbeddings[i] !== null) {
            valid.push({ index: i, key: orderedKeys[i] });
          }
        }
        if (valid.length > 0) {
          const entityStore = await this.getEntityStore();
          const toInsertVectors = [];
          const toInsertIds = [];
          const toInsertPayloads = [];
          for (const { index: j, key } of valid) {
            const { entityType, entityText, memoryIds } = globalEntities[key];
            const entityVec = entityEmbeddings[j];
            let matches = [];
            try {
              matches = await entityStore.search(entityVec, 1, filters);
            } catch (e) {
            }
            if (matches.length > 0 && ((_f = matches[0].score) != null ? _f : 0) >= 0.95) {
              const match = matches[0];
              const payload = match.payload || {};
              const linked = new Set((_g = payload.linkedMemoryIds) != null ? _g : []);
              for (const mid of memoryIds) linked.add(mid);
              payload.linkedMemoryIds = Array.from(linked).sort();
              try {
                await entityStore.update(match.id, entityVec, payload);
              } catch (e) {
                console.debug(`Entity update failed for '${entityText}': ${e}`);
              }
            } else {
              const entityPayload = {
                data: entityText,
                entityType,
                linkedMemoryIds: Array.from(memoryIds).sort()
              };
              if (filters.user_id) entityPayload.user_id = filters.user_id;
              if (filters.agent_id) entityPayload.agent_id = filters.agent_id;
              if (filters.run_id) entityPayload.run_id = filters.run_id;
              toInsertVectors.push(entityVec);
              toInsertIds.push(uuidv43());
              toInsertPayloads.push(entityPayload);
            }
          }
          if (toInsertVectors.length > 0) {
            try {
              await entityStore.insert(
                toInsertVectors,
                toInsertIds,
                toInsertPayloads
              );
            } catch (e) {
              console.warn(`Batch entity insert failed: ${e}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Batch entity linking failed: ${e}`);
    }
    if (typeof this.db.saveMessages === "function") {
      try {
        await this.db.saveMessages(
          messages.map((m) => ({
            role: m.role,
            content: m.content
          })),
          sessionScope
        );
      } catch (e) {
      }
    }
    return records.map((r) => ({
      id: r.memoryId,
      memory: r.text,
      metadata: { event: "ADD" }
    }));
  }
  async get(memoryId) {
    await this._ensureInitialized();
    const memory = await this.vectorStore.get(memoryId);
    if (!memory) return null;
    const filters = {
      ...memory.payload.user_id && { user_id: memory.payload.user_id },
      ...memory.payload.agent_id && { agent_id: memory.payload.agent_id },
      ...memory.payload.run_id && { run_id: memory.payload.run_id }
    };
    const memoryItem = {
      id: memory.id,
      memory: memory.payload.data,
      hash: memory.payload.hash,
      createdAt: memory.payload.createdAt,
      updatedAt: memory.payload.updatedAt,
      metadata: {}
    };
    const excludedKeys = /* @__PURE__ */ new Set([
      "userId",
      "agentId",
      "runId",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
      "textLemmatized",
      "attributedTo"
    ]);
    for (const [key, value] of Object.entries(memory.payload)) {
      if (!excludedKeys.has(key)) {
        memoryItem.metadata[key] = value;
      }
    }
    return { ...memoryItem, ...filters };
  }
  async search(query, config) {
    var _a2, _b, _c, _d, _e;
    rejectTopLevelEntityParams(config, "search");
    validateSearchParams(config.threshold, config.topK);
    const normalizedFilters = config.filters ? Object.fromEntries(
      Object.entries({
        ...config.filters,
        user_id: validateAndTrimEntityId(config.filters.user_id, "user_id"),
        agent_id: validateAndTrimEntityId(
          config.filters.agent_id,
          "agent_id"
        ),
        run_id: validateAndTrimEntityId(config.filters.run_id, "run_id")
      }).filter(([, v]) => v !== void 0)
    ) : {};
    await this._ensureInitialized();
    const { topK = 20, threshold = 0.1 } = config;
    await this._captureEvent("search", {
      query_length: query.length,
      topK,
      has_filters: !!config.filters
    });
    let effectiveFilters = { ...normalizedFilters };
    if (this._hasAdvancedOperators(effectiveFilters)) {
      const processedFilters = this._processMetadataFilters(effectiveFilters);
      for (const logicalKey of ["AND", "OR", "NOT"]) {
        delete effectiveFilters[logicalKey];
      }
      for (const fk of Object.keys(effectiveFilters)) {
        if (!["AND", "OR", "NOT", "user_id", "agent_id", "run_id"].includes(fk) && typeof effectiveFilters[fk] === "object" && effectiveFilters[fk] !== null) {
          delete effectiveFilters[fk];
        }
      }
      effectiveFilters = { ...effectiveFilters, ...processedFilters };
    }
    if (!effectiveFilters.user_id && !effectiveFilters.agent_id && !effectiveFilters.run_id) {
      throw new Error(
        "filters must contain at least one of: user_id, agent_id, run_id. Example: filters: { user_id: 'u1' }"
      );
    }
    const queryLemmatized = lemmatizeForBm25(query);
    const queryEntities = extractEntities(query);
    const queryEmbedding = await this.embedder.embed(query);
    const internalLimit = Math.max(topK * 4, 60);
    const semanticResults = await this.vectorStore.search(
      queryEmbedding,
      internalLimit,
      effectiveFilters
    );
    let keywordResults = null;
    if (typeof this.vectorStore.keywordSearch === "function") {
      try {
        keywordResults = (_a2 = await this.vectorStore.keywordSearch(
          queryLemmatized,
          internalLimit,
          effectiveFilters
        )) != null ? _a2 : null;
      } catch (e) {
        keywordResults = null;
      }
    }
    const bm25Scores = {};
    if (keywordResults) {
      const [midpoint, steepness] = getBm25Params(query, queryLemmatized);
      for (const mem of keywordResults) {
        const memId = String(mem.id);
        const rawScore = (_b = mem.score) != null ? _b : 0;
        if (rawScore > 0) {
          bm25Scores[memId] = normalizeBm25(rawScore, midpoint, steepness);
        }
      }
    }
    const entityBoosts = {};
    if (queryEntities.length > 0) {
      try {
        const seen = /* @__PURE__ */ new Set();
        const deduped = [];
        for (const entity of queryEntities.slice(0, 8)) {
          const key = entity.text.trim().toLowerCase();
          if (key && !seen.has(key)) {
            seen.add(key);
            deduped.push(entity);
          }
        }
        if (deduped.length > 0) {
          const entityStore = await this.getEntityStore();
          for (const entity of deduped) {
            try {
              const entityEmbedding = await this.embedder.embed(entity.text);
              const matches = await entityStore.search(
                entityEmbedding,
                500,
                effectiveFilters
              );
              for (const match of matches) {
                const similarity = (_c = match.score) != null ? _c : 0;
                if (similarity < 0.5) continue;
                const payload = match.payload || {};
                const linkedMemoryIds = (_d = payload.linkedMemoryIds) != null ? _d : [];
                if (!Array.isArray(linkedMemoryIds)) continue;
                const numLinked = Math.max(linkedMemoryIds.length, 1);
                const memoryCountWeight = 1 / (1 + 1e-3 * (numLinked - 1) ** 2);
                const boost = similarity * ENTITY_BOOST_WEIGHT * memoryCountWeight;
                for (const memoryId of linkedMemoryIds) {
                  if (memoryId) {
                    const memKey = String(memoryId);
                    entityBoosts[memKey] = Math.max(
                      (_e = entityBoosts[memKey]) != null ? _e : 0,
                      boost
                    );
                  }
                }
              }
            } catch (e) {
            }
          }
        }
      } catch (e) {
        console.warn("Entity boost computation failed:", e);
      }
    }
    const candidates = semanticResults.map((mem) => {
      var _a3;
      return {
        id: String(mem.id),
        score: (_a3 = mem.score) != null ? _a3 : 0,
        payload: mem.payload || {}
      };
    });
    const scoredResults = scoreAndRank(
      candidates,
      bm25Scores,
      entityBoosts,
      threshold != null ? threshold : 0.1,
      topK
    );
    const excludedKeys = /* @__PURE__ */ new Set([
      "user_id",
      "agent_id",
      "run_id",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
      "textLemmatized",
      "attributedTo"
    ]);
    const results = scoredResults.filter((scored) => {
      var _a3;
      return (_a3 = scored.payload) == null ? void 0 : _a3.data;
    }).map((scored) => {
      const payload = scored.payload || {};
      return {
        id: scored.id,
        memory: payload.data,
        hash: payload.hash,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        score: scored.score,
        metadata: Object.entries(payload).filter(([key]) => !excludedKeys.has(key)).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
        ...payload.user_id && { user_id: payload.user_id },
        ...payload.agent_id && { agent_id: payload.agent_id },
        ...payload.run_id && { run_id: payload.run_id }
      };
    });
    return {
      results
    };
  }
  async update(memoryId, data) {
    await this._ensureInitialized();
    await this._captureEvent("update", { memory_id: memoryId });
    const embedding = await this.embedder.embed(data);
    await this.updateMemory(memoryId, data, { [data]: embedding });
    return { message: "Memory updated successfully!" };
  }
  async delete(memoryId) {
    await this._ensureInitialized();
    await this._captureEvent("delete", { memory_id: memoryId });
    await this.deleteMemory(memoryId);
    return { message: "Memory deleted successfully!" };
  }
  async deleteAll(config) {
    await this._ensureInitialized();
    await this._captureEvent("delete_all", {
      has_user_id: !!config.userId,
      has_agent_id: !!config.agentId,
      has_run_id: !!config.runId
    });
    const { userId, agentId, runId } = config;
    const filters = {};
    if (userId) filters.user_id = userId;
    if (agentId) filters.agent_id = agentId;
    if (runId) filters.run_id = runId;
    if (!Object.keys(filters).length) {
      throw new Error(
        "At least one filter is required to delete all memories. If you want to delete all memories, use the `reset()` method."
      );
    }
    const [memories] = await this.vectorStore.list(filters);
    for (const memory of memories) {
      await this.deleteMemory(memory.id);
    }
    return { message: "Memories deleted successfully!" };
  }
  async history(memoryId) {
    await this._ensureInitialized();
    return this.db.getHistory(memoryId);
  }
  async reset() {
    await this._ensureInitialized();
    await this._captureEvent("reset");
    await this.db.reset();
    if (this.config.vectorStore.provider.toLowerCase() !== "langchain") {
      try {
        await this.vectorStore.deleteCol();
      } catch (e) {
        console.error(
          `Failed to delete collection for provider '${this.config.vectorStore.provider}':`,
          e
        );
      }
    } else {
      console.warn(
        "Memory.reset(): Skipping vector store collection deletion as 'langchain' provider is used. Underlying Langchain vector store data is not cleared by this operation."
      );
    }
    if (this._entityStore) {
      try {
        await this._entityStore.deleteCol();
      } catch (e) {
      }
      this._entityStore = void 0;
    }
    this.embedder = EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config
    );
    this.llm = LLMFactory.create(
      this.config.llm.provider,
      this.config.llm.config
    );
    this._initError = void 0;
    this._initPromise = this._autoInitialize().catch((error) => {
      this._initError = error instanceof Error ? error : new Error(String(error));
      console.error(this._initError);
    });
    await this._initPromise;
  }
  async getAll(config) {
    var _a2, _b, _c;
    rejectTopLevelEntityParams(config, "getAll");
    validateSearchParams(void 0, config.topK);
    await this._ensureInitialized();
    const { topK = 20 } = config;
    const filters = Object.fromEntries(
      Object.entries({
        ...config.filters || {},
        user_id: validateAndTrimEntityId((_a2 = config.filters) == null ? void 0 : _a2.user_id, "user_id"),
        agent_id: validateAndTrimEntityId((_b = config.filters) == null ? void 0 : _b.agent_id, "agent_id"),
        run_id: validateAndTrimEntityId((_c = config.filters) == null ? void 0 : _c.run_id, "run_id")
      }).filter(([, v]) => v !== void 0)
    );
    await this._captureEvent("get_all", {
      topK,
      has_user_id: !!filters.user_id,
      has_agent_id: !!filters.agent_id,
      has_run_id: !!filters.run_id
    });
    if (!filters.user_id && !filters.agent_id && !filters.run_id) {
      throw new Error(
        "filters must contain at least one of: user_id, agent_id, run_id. Example: filters: { user_id: 'u1' }"
      );
    }
    const [memories] = await this.vectorStore.list(filters, topK);
    const excludedKeys = /* @__PURE__ */ new Set([
      "user_id",
      "agent_id",
      "run_id",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
      "textLemmatized",
      "attributedTo"
    ]);
    const results = memories.map((mem) => ({
      id: mem.id,
      memory: mem.payload.data,
      hash: mem.payload.hash,
      createdAt: mem.payload.createdAt,
      updatedAt: mem.payload.updatedAt,
      metadata: Object.entries(mem.payload).filter(([key]) => !excludedKeys.has(key)).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
      ...mem.payload.user_id && { user_id: mem.payload.user_id },
      ...mem.payload.agent_id && { agent_id: mem.payload.agent_id },
      ...mem.payload.run_id && { run_id: mem.payload.run_id }
    }));
    return { results };
  }
  async createMemory(data, existingEmbeddings, metadata) {
    const memoryId = uuidv43();
    const embedding = existingEmbeddings[data] || await this.embedder.embed(data);
    const memoryMetadata = {
      ...metadata,
      data,
      hash: createHash("md5").update(data).digest("hex"),
      textLemmatized: lemmatizeForBm25(data),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.vectorStore.insert([embedding], [memoryId], [memoryMetadata]);
    await this.db.addHistory(
      memoryId,
      null,
      data,
      "ADD",
      memoryMetadata.createdAt
    );
    return memoryId;
  }
  async updateMemory(memoryId, data, existingEmbeddings, metadata = {}) {
    const existingMemory = await this.vectorStore.get(memoryId);
    if (!existingMemory) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }
    const prevValue = existingMemory.payload.data;
    const embedding = existingEmbeddings[data] || await this.embedder.embed(data);
    const newMetadata = {
      ...metadata,
      data,
      hash: createHash("md5").update(data).digest("hex"),
      createdAt: existingMemory.payload.createdAt,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...existingMemory.payload.user_id && {
        user_id: existingMemory.payload.user_id
      },
      ...existingMemory.payload.agent_id && {
        agent_id: existingMemory.payload.agent_id
      },
      ...existingMemory.payload.run_id && {
        run_id: existingMemory.payload.run_id
      }
    };
    await this.vectorStore.update(memoryId, embedding, newMetadata);
    await this.db.addHistory(
      memoryId,
      prevValue,
      data,
      "UPDATE",
      newMetadata.createdAt,
      newMetadata.updatedAt
    );
    try {
      const sessionFilters = this._sessionFiltersFromPayload(newMetadata);
      await this._removeMemoryFromEntityStore(memoryId, sessionFilters);
      await this._linkEntitiesForMemory(memoryId, data, sessionFilters);
    } catch (e) {
      console.warn(`Entity store cleanup/link failed during update: ${e}`);
    }
    return memoryId;
  }
  async deleteMemory(memoryId) {
    const existingMemory = await this.vectorStore.get(memoryId);
    if (!existingMemory) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }
    const prevValue = existingMemory.payload.data;
    const sessionFilters = this._sessionFiltersFromPayload(
      existingMemory.payload || {}
    );
    await this.vectorStore.delete(memoryId);
    await this.db.addHistory(
      memoryId,
      prevValue,
      null,
      "DELETE",
      void 0,
      void 0,
      1
    );
    try {
      await this._removeMemoryFromEntityStore(memoryId, sessionFilters);
    } catch (e) {
      console.warn(`Entity store cleanup failed during delete: ${e}`);
    }
    return memoryId;
  }
  /**
   * Check if filters contain advanced operators that need special processing.
   */
  _hasAdvancedOperators(filters) {
    if (!filters || typeof filters !== "object") {
      return false;
    }
    for (const [key, value] of Object.entries(filters)) {
      if (key === "AND" || key === "OR" || key === "NOT") {
        return true;
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const op of Object.keys(value)) {
          if ([
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
          ].includes(op)) {
            return true;
          }
        }
      }
      if (value === "*") {
        return true;
      }
    }
    return false;
  }
  /**
   * Process enhanced metadata filters and convert them to vector store compatible format.
   * Converts AND/OR/NOT to $or/$not format that vector stores can interpret.
   */
  _processMetadataFilters(metadataFilters) {
    const processedFilters = {};
    const processCondition = (key, condition) => {
      if (typeof condition !== "object" || condition === null) {
        if (condition === "*") {
          return { [key]: "*" };
        }
        return { [key]: condition };
      }
      if (Array.isArray(condition)) {
        return { [key]: { in: condition } };
      }
      const result = {};
      const operatorMap = {
        eq: "eq",
        ne: "ne",
        gt: "gt",
        gte: "gte",
        lt: "lt",
        lte: "lte",
        in: "in",
        nin: "nin",
        contains: "contains",
        icontains: "icontains"
      };
      for (const [operator, value] of Object.entries(condition)) {
        if (operator in operatorMap) {
          if (!result[key]) {
            result[key] = {};
          }
          result[key][operatorMap[operator]] = value;
        } else {
          throw new Error(`Unsupported metadata filter operator: ${operator}`);
        }
      }
      return result;
    };
    for (const [key, value] of Object.entries(metadataFilters)) {
      if (key === "AND") {
        if (!Array.isArray(value)) {
          throw new Error("AND operator requires a list of conditions");
        }
        for (const condition of value) {
          for (const [subKey, subValue] of Object.entries(condition)) {
            Object.assign(processedFilters, processCondition(subKey, subValue));
          }
        }
      } else if (key === "OR") {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(
            "OR operator requires a non-empty list of conditions"
          );
        }
        processedFilters["$or"] = [];
        for (const condition of value) {
          const orCondition = {};
          for (const [subKey, subValue] of Object.entries(
            condition
          )) {
            Object.assign(orCondition, processCondition(subKey, subValue));
          }
          processedFilters["$or"].push(orCondition);
        }
      } else if (key === "NOT") {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(
            "NOT operator requires a non-empty list of conditions"
          );
        }
        processedFilters["$not"] = [];
        for (const condition of value) {
          const notCondition = {};
          for (const [subKey, subValue] of Object.entries(
            condition
          )) {
            Object.assign(notCondition, processCondition(subKey, subValue));
          }
          processedFilters["$not"].push(notCondition);
        }
      } else {
        Object.assign(processedFilters, processCondition(key, value));
      }
    }
    return processedFilters;
  }
};

export { Memory, ENTITY_PARAMS, rejectTopLevelEntityParams, validateAndTrimEntityId, validateSearchParams };
