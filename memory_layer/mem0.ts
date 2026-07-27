// mem0.ts
// Self-contained wrapper for mem0ai OSS in-process memory
// LLM: Anthropic claude-sonnet-4-6 | Embedder: Ollama all-minilm (local, 384 dims)

export interface Message {
  role: string;
  content: string;
}

export interface MemoryItem {
  id: string;
  memory: string;
  hash?: string;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
  metadata?: Record<string, any>;
  user_id?: string;
  agent_id?: string;
  run_id?: string;
}

export interface SearchResult {
  results: MemoryItem[];
}

export interface Mem0Config {
  /** API key for the LLM provider */
  apiKey: string;
  /** LLM provider (e.g. "anthropic", "openai", "groq", "ollama") */
  llmProvider: string;
  /** Model to use for memory extraction */
  llmModel: string;
  /** Embedding provider: "openai" or "ollama" (default: "openai") */
  embedProvider?: "openai" | "ollama";
  /** Embedding model name (default: "text-embedding-3-small" for openai, "all-minilm" for ollama) */
  embedModel?: string;
  /** Embedding dimensions (default: 1536 for openai, 384 for ollama) */
  embedDims?: number;
  /** OpenAI API key for embeddings (defaults to process.env.OPENAI_API_KEY) */
  openaiApiKey?: string;
  /** Ollama base URL (default: "http://localhost:11434") */
  ollamaBaseUrl?: string;
  /** SQLite history db path (default: "memory.db") */
  historyDbPath?: string;
  /** Qdrant collection name (default: "memories") */
  collectionName?: string;
  /** Qdrant URL (default: process.env.QDRANT_URL ?? "http://localhost:6333") */
  qdrantUrl?: string;
  /** Qdrant API key for managed/cloud deployments (default: process.env.QDRANT_API_KEY) */
  qdrantApiKey?: string;
  /** Custom instructions injected into the memory extraction prompt */
  customInstructions?: string;
  /** Number of existing memories to retrieve for dedup/context during add (default: 10) */
  retrievalTopK?: number;
}

export interface AddOptions {
  /** Scope memories to a specific user */
  userId: string;
  /** Scope memories to a specific agent */
  agentId: string;
  /** Scope memories to a specific run/session */
  runId: string;
  /** Additional metadata stored alongside the memory */
  metadata?: Record<string, any>;
  /**
   * Preceding conversation messages for context (resolving pronouns, references).
   * Replaces the SQLite getLastMessages call — pass the last N turns from your agent.
   */
  conversationHistory?: { role: string; content: string }[];
}

export interface SearchOptions {
  /** Scope the search to a specific user */
  userId?: string;
  /** Scope the search to a specific agent */
  agentId?: string;
  /** Scope the search to a specific run/session */
  runId?: string;
  /** Maximum number of results (default: 10) */
  topK?: number;
  /** Minimum similarity threshold 0–1 (default: 0) */
  threshold?: number;
}

export interface GetAllOptions {
  /** Scope to a specific user */
  userId?: string;
  /** Scope to a specific agent */
  agentId?: string;
  /** Scope to a specific run/session */
  runId?: string;
  /** Maximum number of results */
  topK?: number;
}
export class Mem0 {
  private memory: any = null;
  private _config: Mem0Config;

  constructor(config: Mem0Config) {
    this._config = config;
  }

  // Lazy init: dynamic import of mem0ai/oss + Memory construction on first use
  private async _getMemory() {
    if (this.memory) return this.memory;

    const { Memory } = await import("./mem0/index.js");

    const config = this._config;

    const embedProvider = config.embedProvider ?? "openai";
    const isOpenAI = embedProvider === "openai";
    const embedModel = config.embedModel ?? (isOpenAI ? "text-embedding-3-small" : "all-minilm");
    const embedDims = config.embedDims ?? (isOpenAI ? 1536 : 384);

    const embedderConfig = isOpenAI
      ? {
          provider: "openai" as const,
          config: {
            apiKey: config.openaiApiKey ?? process.env.OPENAI_API_KEY,
            model: embedModel,
            embeddingDims: embedDims,
          },
        }
      : {
          provider: "ollama" as const,
          config: {
            model: embedModel,
            baseURL: config.ollamaBaseUrl ?? "http://localhost:11434",
            embeddingDims: embedDims,
          },
        };

    this.memory = new Memory({
      llm: {
        provider: config.llmProvider,
        config: {
          apiKey: config.apiKey,
          model: config.llmModel,
          ...(config.llmBaseURL ? { baseURL: config.llmBaseURL } : {}),
        },
      },
      embedder: embedderConfig,
      vectorStore: {
        provider: "qdrant",
        config: {
          url: config.qdrantUrl ?? process.env.QDRANT_URL,
          ...(config.qdrantApiKey ?? process.env.QDRANT_API_KEY
            ? { apiKey: config.qdrantApiKey ?? process.env.QDRANT_API_KEY }
            : {}),
          collectionName: config.collectionName ?? "memories",
          embeddingModelDims: embedDims,
          dimension: embedDims,
        },
      },
      historyDbPath: config.historyDbPath ?? "memory.db",
      ...(config.customInstructions
        ? { customInstructions: config.customInstructions }
        : {}),
      ...(config.retrievalTopK !== undefined
        ? { retrievalTopK: config.retrievalTopK }
        : {}),
    });

    return this.memory;
  }

  /**
   * Extract and store memories from a conversation or plain text.
   *
   * @param messages - Array of {role, content} turns, or a plain string
   * @param options  - Scoping (userId/agentId/runId) and optional metadata
   */
  async add(
    messages: Message[] | string,
    options: AddOptions
  ): Promise<SearchResult> {
    const memory = await this._getMemory();
    const { userId, agentId, runId, metadata, conversationHistory } = options;
    return memory.add(messages, {
      ...(userId !== undefined && { userId }),
      ...(agentId !== undefined && { agentId }),
      ...(runId !== undefined && { runId }),
      ...(metadata !== undefined && { metadata }),
      ...(conversationHistory !== undefined && { conversationHistory }),
    });
  }

  /**
   * Semantic search over stored memories.
   *
   * @param query   - Natural language question or topic
   * @param options - Scoping and result controls
   */
  async search(query: string, options: SearchOptions = {}): Promise<MemoryItem[]> {
    const memory = await this._getMemory();
    const { userId, agentId, runId, topK, threshold } = options;
    const result = await memory.search(query, {
      filters: {
        ...(userId !== undefined && { user_id: userId }),
        ...(agentId !== undefined && { agent_id: agentId }),
        ...(runId !== undefined && { run_id: runId }),
      },
      ...(topK !== undefined && { topK }),
      ...(threshold !== undefined && { threshold }),
    });
    return result.results;
  }

  /**
   * Retrieve all stored memories, optionally scoped.
   */
  async getAll(options: GetAllOptions = {}): Promise<MemoryItem[]> {
    const memory = await this._getMemory();
    const { userId, agentId, runId, topK } = options;
    const result = await memory.getAll({
      filters: {
        ...(userId !== undefined && { user_id: userId }),
        ...(agentId !== undefined && { agent_id: agentId }),
        ...(runId !== undefined && { run_id: runId }),
      },
      ...(topK !== undefined && { topK }),
    });
    return result.results;
  }

  /**
   * Fetch a single memory by its ID.
   */
  async get(memoryId: string): Promise<MemoryItem | null> {
    const memory = await this._getMemory();
    return memory.get(memoryId);
  }

  /**
   * Update the text of an existing memory.
   */
  async update(memoryId: string, data: string): Promise<{ message: string }> {
    const memory = await this._getMemory();
    return memory.update(memoryId, data);
  }

  /**
   * Delete a single memory by ID.
   */
  async delete(memoryId: string): Promise<{ message: string }> {
    const memory = await this._getMemory();
    return memory.delete(memoryId);
  }

  /**
   * Delete all memories in a scope (userId / agentId / runId).
   * At least one scope field is required to avoid accidental wipes.
   */
  async deleteAll(
    options: Required<Pick<GetAllOptions, "userId" | "agentId" | "runId">> &
      Partial<GetAllOptions>
  ): Promise<{ message: string }> {
    const memory = await this._getMemory();
    const { userId, agentId, runId } = options;
    return memory.deleteAll({
      ...(userId !== undefined && { userId }),
      ...(agentId !== undefined && { agentId }),
      ...(runId !== undefined && { runId }),
    });
  }

  /**
   * Get the edit history of a specific memory.
   */
  async history(memoryId: string): Promise<any[]> {
    const memory = await this._getMemory();
    return memory.history(memoryId);
  }

  /**
   * Expose the raw Memory instance for advanced use-cases.
   */
  async getRaw() {
    return this._getMemory();
  }
}
