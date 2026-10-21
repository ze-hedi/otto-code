import { randomUUID } from "crypto";
import { QdrantManager } from "./qdrant.js";
import {
  runExtraction,
  type ChatMessage,
  type ExistingMemory,
  type ExtractedMemory,
  type ExtractorAgentConfig,
} from "./extractor_agent.js";

export interface MemoryExtractorConfig {
  sessionId: string;
  agentId: string;
  topK: number;
  qdrant: QdrantManager;
  collectionName: string;
  extractorModel?: string;
}

export class MemoryExtractor {
  private sessionId: string;
  private agentId: string;
  private topK: number;
  private qdrant: QdrantManager;
  private collectionName: string;
  private extractorConfig: ExtractorAgentConfig;

  constructor(config: MemoryExtractorConfig) {
    this.sessionId = config.sessionId;
    this.agentId = config.agentId;
    this.topK = config.topK;
    this.qdrant = config.qdrant;
    this.collectionName = config.collectionName;
    this.extractorConfig = { model: config.extractorModel };
  }

  async run(lastKMessages: ChatMessage[]): Promise<ExtractedMemory[]> {
    if (lastKMessages.length === 0) return [];

    // 1. Build query from the latest messages
    const query = lastKMessages.map((m) => m.content).join("\n");

    // 2. Search Qdrant for related existing memories
    const searchResults = await this.qdrant.search(
      this.collectionName,
      query,
      this.sessionId,
      this.agentId,
      this.topK
    );

    const existingMemories: ExistingMemory[] = searchResults.map((r) => ({
      id: String(r.id),
      text: (r.payload.text as string) ?? "",
    }));

    // 3. Run the extractor agent
    const extracted = await runExtraction(
      {
        newMessages: lastKMessages,
        existingMemories,
        lastKMessages,
      },
      this.extractorConfig
    );

    if (extracted.length === 0) return [];

    // 4. Upsert new facts into Qdrant
    const points = extracted.map((mem) => ({
      id: randomUUID(),
      text: mem.text,
      sessionId: this.sessionId,
      agentId: this.agentId,
      payload: {
        attributed_to: mem.attributed_to,
        ...(mem.linked_memory_ids && { linked_memory_ids: mem.linked_memory_ids }),
      },
    }));

    await this.qdrant.upsert(this.collectionName, points);

    return extracted;
  }
}
