import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

export interface PointPayload {
  [key: string]: unknown;
}

export interface SearchResult {
  id: string | number;
  score: number;
  payload: PointPayload;
}

export interface QdrantManagerConfig {
  url: string;
  apiKey?: string;
  embeddingModel: string;
  embeddingApiKey: string;
  embeddingBaseURL?: string;
}

export class QdrantManager {
  private client: QdrantClient;
  private openai: OpenAI;
  private embeddingModel: string;

  constructor(config: QdrantManagerConfig) {
    this.client = new QdrantClient({
      url: config.url,
      ...(config.apiKey && { apiKey: config.apiKey }),
    });
    this.openai = new OpenAI({
      apiKey: config.embeddingApiKey,
      baseURL: config.embeddingBaseURL ?? "https://openrouter.ai/api/v1",
    });
    this.embeddingModel = config.embeddingModel;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: texts,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  async createCollection(
    name: string,
    vectorSize: number,
    distance: "Cosine" | "Euclid" | "Dot" = "Cosine"
  ): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === name);
    if (exists) return;

    await this.client.createCollection(name, {
      vectors: { size: vectorSize, distance },
    });

    await this.client.createPayloadIndex(name, {
      field_name: "sessionId",
      field_schema: "keyword",
    });
    await this.client.createPayloadIndex(name, {
      field_name: "agentId",
      field_schema: "keyword",
    });
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
  }

  async upsert(
    collection: string,
    points: {
      id: string | number;
      text: string;
      sessionId: string;
      agentId: string;
      payload?: PointPayload;
    }[]
  ): Promise<void> {
    const texts = points.map((p) => p.text);
    const vectors = await this.embedBatch(texts);

    const qdrantPoints = points.map((p, i) => ({
      id: p.id,
      vector: vectors[i],
      payload: {
        ...p.payload,
        text: p.text,
        sessionId: p.sessionId,
        agentId: p.agentId,
      },
    }));

    await this.client.upsert(collection, { points: qdrantPoints });
  }

  async search(
    collection: string,
    query: string,
    sessionId: string,
    agentId: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    const vector = await this.embed(query);

    const results = await this.client.search(collection, {
      vector,
      limit,
      filter: {
        must: [
          { key: "sessionId", match: { value: sessionId } },
          { key: "agentId", match: { value: agentId } },
        ],
      },
    });

    return results.map((r) => ({
      id: r.id,
      score: r.score,
      payload: (r.payload ?? {}) as PointPayload,
    }));
  }

  async get(
    collection: string,
    ids: (string | number)[]
  ): Promise<{ id: string | number; payload: PointPayload }[]> {
    const results = await this.client.retrieve(collection, { ids });
    return results.map((r) => ({
      id: r.id,
      payload: (r.payload ?? {}) as PointPayload,
    }));
  }

  async delete(collection: string, ids: (string | number)[]): Promise<void> {
    await this.client.delete(collection, { points: ids });
  }

  async scroll(
    collection: string,
    filter: Record<string, string>,
    limit: number = 100
  ): Promise<{ id: string | number; payload: PointPayload }[]> {
    const must = Object.entries(filter).map(([key, value]) => ({
      key,
      match: { value },
    }));

    const results = await this.client.scroll(collection, {
      filter: { must },
      limit,
      with_payload: true,
    });

    return (results.points ?? []).map((r) => ({
      id: r.id,
      payload: (r.payload ?? {}) as PointPayload,
    }));
  }

  async collectionExists(name: string): Promise<boolean> {
    const collections = await this.client.getCollections();
    return collections.collections.some((c) => c.name === name);
  }

  async collectionInfo(name: string) {
    return this.client.getCollection(name);
  }
}
