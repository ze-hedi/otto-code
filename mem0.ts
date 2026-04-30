// mem0.ts
// Self-contained wrapper for mem0ai OSS in-process memory

import { Memory } from "mem0ai/oss";
import type {
  Message,
  MemoryItem,
  SearchResult,
} from "mem0ai/oss";

export type { Message, MemoryItem, SearchResult };

export interface Mem0Config {
  /** OpenAI API key (defaults to process.env.OPENAI_API_KEY) */
  openAiApiKey?: string;
  /** LLM model to use for memory extraction (default: "gpt-4o-mini") */
  llmModel?: string;
  /** Embedding model (default: "text-embedding-3-small") */
  embedModel?: string;
  /** Embedding dimension matching the embed model (default: 1536) */
  embedDimension?: number;
  /** SQLite history db path (default: "memory.db") */
  historyDbPath?: string;
  /** In-memory vector store collection name (default: "memories") */
  collectionName?: string;
  /** Custom instructions injected into the memory extraction prompt */
  customInstructions?: string;
}

export interface AddOptions {
  /** Scope memories to a specific user */
  userId?: string;
  /** Scope memories to a specific agent */
  agentId?: string;
  /** Scope memories to a specific run/session */
  runId?: string;
  /** Additional metadata stored alongside the memory */
  metadata?: Record<string, any>;
  /**
   * When false, stores the raw content without LLM extraction.
   * Useful for explicit memory facts you want to inject directly.
   * Default: true
   */
  infer?: boolean;
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
  private memory: Memory;

  constructor(config: Mem0Config = {}) {
    const apiKey = config.openAiApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key required. Pass openAiApiKey in config or set OPENAI_API_KEY."
      );
    }

    this.memory = new Memory({
      llm: {
        provider: "openai",
        config: {
          apiKey,
          model: config.llmModel ?? "gpt-4o-mini",
        },
      },
      embedder: {
        provider: "openai",
        config: {
          apiKey,
          model: config.embedModel ?? "text-embedding-3-small",
          embeddingDims: config.embedDimension ?? 1536,
        },
      },
      vectorStore: {
        provider: "memory",
        config: {
          collectionName: config.collectionName ?? "memories",
          dimension: config.embedDimension ?? 1536,
        },
      },
      historyDbPath: config.historyDbPath ?? "memory.db",
      ...(config.customInstructions
        ? { customInstructions: config.customInstructions }
        : {}),
    });
  }

  /**
   * Extract and store memories from a conversation or plain text.
   *
   * @param messages - Array of {role, content} turns, or a plain string
   * @param options  - Scoping (userId/agentId/runId) and optional metadata
   */
  async add(
    messages: Message[] | string,
    options: AddOptions = {}
  ): Promise<SearchResult> {
    const { userId, agentId, runId, metadata, infer } = options;
    return this.memory.add(messages, {
      ...(userId !== undefined && { userId }),
      ...(agentId !== undefined && { agentId }),
      ...(runId !== undefined && { runId }),
      ...(metadata !== undefined && { metadata }),
      ...(infer !== undefined && { infer }),
    });
  }

  /**
   * Semantic search over stored memories.
   *
   * @param query   - Natural language question or topic
   * @param options - Scoping and result controls
   */
  async search(query: string, options: SearchOptions = {}): Promise<MemoryItem[]> {
    const { userId, agentId, runId, topK, threshold } = options;
    const result = await this.memory.search(query, {
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
    const { userId, agentId, runId, topK } = options;
    const result = await this.memory.getAll({
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
    return this.memory.get(memoryId);
  }

  /**
   * Update the text of an existing memory.
   */
  async update(memoryId: string, data: string): Promise<{ message: string }> {
    return this.memory.update(memoryId, data);
  }

  /**
   * Delete a single memory by ID.
   */
  async delete(memoryId: string): Promise<{ message: string }> {
    return this.memory.delete(memoryId);
  }

  /**
   * Delete all memories in a scope (userId / agentId / runId).
   * At least one scope field is required to avoid accidental wipes.
   */
  async deleteAll(
    options: Required<Pick<GetAllOptions, "userId" | "agentId" | "runId">> &
      Partial<GetAllOptions>
  ): Promise<{ message: string }> {
    const { userId, agentId, runId } = options;
    return this.memory.deleteAll({
      ...(userId !== undefined && { userId }),
      ...(agentId !== undefined && { agentId }),
      ...(runId !== undefined && { runId }),
    });
  }

  /**
   * Get the edit history of a specific memory.
   */
  async history(memoryId: string): Promise<any[]> {
    return this.memory.history(memoryId);
  }

  /**
   * Expose the raw Memory instance for advanced use-cases.
   */
  getRaw(): Memory {
    return this.memory;
  }
}
