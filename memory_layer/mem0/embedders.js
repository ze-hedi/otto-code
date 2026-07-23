// src/oss/src/embeddings/openai.ts
import OpenAI from "openai";
var OpenAIEmbedder = class {
  constructor(config) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || config.url
    });
    this.model = config.model || "text-embedding-3-small";
    this.embeddingDims = config.embeddingDims;
  }
  async embed(text) {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text,
      ...this.embeddingDims !== void 0 && {
        dimensions: this.embeddingDims
      }
    });
    return response.data[0].embedding;
  }
  async embedBatch(texts) {
    const MAX_BATCH = 100;
    const allEmbeddings = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const chunk = texts.slice(i, i + MAX_BATCH);
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: chunk,
        ...this.embeddingDims !== void 0 && {
          dimensions: this.embeddingDims
        }
      });
      allEmbeddings.push(
        ...response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
      );
    }
    return allEmbeddings;
  }
};

// src/oss/src/embeddings/ollama.ts
import { Ollama } from "ollama";

// src/oss/src/utils/logger.ts
var logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  debug: (message) => console.debug(`[DEBUG] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`)
};

// src/oss/src/embeddings/ollama.ts
var OllamaEmbedder = class _OllamaEmbedder {
  constructor(config) {
    // Using this variable to avoid calling the Ollama server multiple times
    this.initialized = false;
    this.ollama = new Ollama({
      host: config.url || config.baseURL || "http://localhost:11434"
    });
    this.model = config.model || "nomic-embed-text:latest";
    this.embeddingDims = config.embeddingDims || 768;
    this.ensureModelExists().catch((err) => {
      logger.error(`Error ensuring model exists: ${err}`);
    });
  }
  async embed(text) {
    try {
      await this.ensureModelExists();
    } catch (err) {
      logger.error(`Error ensuring model exists: ${err}`);
    }
    const input = typeof text === "string" ? text : JSON.stringify(text);
    const response = await this.ollama.embed({
      model: this.model,
      input
    });
    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error(
        `Ollama embed() returned no embeddings for model '${this.model}'`
      );
    }
    return response.embeddings[0];
  }
  async embedBatch(texts) {
    const response = await Promise.all(texts.map((text) => this.embed(text)));
    return response;
  }
  static normalizeModelName(name) {
    return name.includes(":") ? name : `${name}:latest`;
  }
  async ensureModelExists() {
    if (this.initialized) {
      return true;
    }
    const local_models = await this.ollama.list();
    const target = _OllamaEmbedder.normalizeModelName(this.model);
    if (!local_models.models.find(
      (m) => _OllamaEmbedder.normalizeModelName(m.name) === target
    )) {
      logger.info(`Pulling model ${this.model}...`);
      await this.ollama.pull({ model: this.model });
    }
    this.initialized = true;
    return true;
  }
};

// src/oss/src/embeddings/lmstudio.ts
import OpenAI2 from "openai";
var DEFAULT_BASE_URL = "http://localhost:1234/v1";
var DEFAULT_MODEL = "nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.f16.gguf";
var DEFAULT_LMSTUDIO_API_KEY = "lm-studio";
var LMStudioEmbedder = class {
  constructor(config) {
    var _a2, _b;
    const baseURL = (_b = (_a2 = config.baseURL) != null ? _a2 : config.url) != null ? _b : DEFAULT_BASE_URL;
    const apiKey = config.apiKey || DEFAULT_LMSTUDIO_API_KEY;
    this.openai = new OpenAI2({ apiKey, baseURL: String(baseURL) });
    this.model = config.model || DEFAULT_MODEL;
  }
  async embed(text) {
    const normalized = typeof text === "string" ? text.replace(/\n/g, " ") : String(text);
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: normalized,
        encoding_format: "float"
      });
      return response.data[0].embedding;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio embedder failed: ${message}`);
    }
  }
  async embedBatch(texts) {
    const normalized = texts.map(
      (t) => typeof t === "string" ? t.replace(/\n/g, " ") : String(t)
    );
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: normalized,
        encoding_format: "float"
      });
      return response.data.map((item) => item.embedding);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio embedder failed: ${message}`);
    }
  }
};

// src/oss/src/embeddings/google.ts
import { GoogleGenAI } from "@google/genai";
var GoogleEmbedder = class {
  constructor(config) {
    this.google = new GoogleGenAI({
      apiKey: config.apiKey || process.env.GOOGLE_API_KEY
    });
    this.model = config.model || "gemini-embedding-001";
    this.embeddingDims = config.embeddingDims;
  }
  async embed(text) {
    const response = await this.google.models.embedContent({
      model: this.model,
      contents: text,
      ...this.embeddingDims !== void 0 && {
        config: { outputDimensionality: this.embeddingDims }
      }
    });
    return response.embeddings[0].values;
  }
  async embedBatch(texts) {
    const response = await this.google.models.embedContent({
      model: this.model,
      contents: texts,
      ...this.embeddingDims !== void 0 && {
        config: { outputDimensionality: this.embeddingDims }
      }
    });
    return response.embeddings.map((item) => item.values);
  }
};

// src/oss/src/embeddings/azure.ts
import { AzureOpenAI as AzureOpenAI2 } from "openai";
var AzureOpenAIEmbedder = class {
  constructor(config) {
    var _a2;
    if (!config.apiKey || !((_a2 = config.modelProperties) == null ? void 0 : _a2.endpoint)) {
      throw new Error("Azure OpenAI requires both API key and endpoint");
    }
    const { endpoint, ...rest } = config.modelProperties;
    this.client = new AzureOpenAI2({
      apiKey: config.apiKey,
      endpoint,
      ...rest
    });
    this.model = config.model || "text-embedding-3-small";
    this.embeddingDims = config.embeddingDims;
  }
  async embed(text) {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      ...this.embeddingDims !== void 0 && {
        dimensions: this.embeddingDims
      }
    });
    return response.data[0].embedding;
  }
  async embedBatch(texts) {
    const MAX_BATCH = 100;
    const allEmbeddings = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const chunk = texts.slice(i, i + MAX_BATCH);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: chunk,
        ...this.embeddingDims !== void 0 && {
          dimensions: this.embeddingDims
        }
      });
      allEmbeddings.push(
        ...response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
      );
    }
    return allEmbeddings;
  }
};

// src/oss/src/embeddings/langchain.ts
var LangchainEmbedder = class {
  // Some LC embedders have batch size
  constructor(config) {
    if (!config.model || typeof config.model !== "object") {
      throw new Error(
        "Langchain embedder provider requires an initialized Langchain Embeddings instance passed via the 'model' field in the embedder config."
      );
    }
    if (typeof config.model.embedQuery !== "function" || typeof config.model.embedDocuments !== "function") {
      throw new Error(
        "Provided Langchain 'instance' in the 'model' field does not appear to be a valid Langchain Embeddings instance (missing embedQuery or embedDocuments method)."
      );
    }
    this.embedderInstance = config.model;
    this.batchSize = this.embedderInstance.batchSize;
  }
  async embed(text) {
    try {
      return await this.embedderInstance.embedQuery(text);
    } catch (error) {
      console.error("Error embedding text with Langchain Embedder:", error);
      throw error;
    }
  }
  async embedBatch(texts) {
    try {
      return await this.embedderInstance.embedDocuments(texts);
    } catch (error) {
      console.error("Error embedding batch with Langchain Embedder:", error);
      throw error;
    }
  }
};

export { OpenAIEmbedder, OllamaEmbedder, LMStudioEmbedder, GoogleEmbedder, AzureOpenAIEmbedder, LangchainEmbedder };
