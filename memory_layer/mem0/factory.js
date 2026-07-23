import { OpenAIEmbedder, OllamaEmbedder, LMStudioEmbedder, GoogleEmbedder, AzureOpenAIEmbedder, LangchainEmbedder } from "./embedders.js";
import { OpenAILLM, OpenAIStructuredLLM, AnthropicLLM, GroqLLM, MistralLLM, OllamaLLM, LMStudioLLM, DeepSeekLLM, GoogleLLM, AzureOpenAILLM, LangchainLLM } from "./llms.js";
import { MemoryVectorStore, Qdrant, RedisDB, SupabaseDB, LangchainVectorStore, VectorizeDB, AzureAISearch, PGVector } from "./vector-stores.js";
import { SQLiteManager, MemoryHistoryManager, SupabaseHistoryManager } from "./storage.js";

var EmbedderFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "openai":
        return new OpenAIEmbedder(config);
      case "ollama":
        return new OllamaEmbedder(config);
      case "lmstudio":
        return new LMStudioEmbedder(config);
      case "google":
      case "gemini":
        return new GoogleEmbedder(config);
      case "azure_openai":
        return new AzureOpenAIEmbedder(config);
      case "langchain":
        return new LangchainEmbedder(config);
      default:
        throw new Error(`Unsupported embedder provider: ${provider}`);
    }
  }
};
var LLMFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "openai":
        return new OpenAILLM(config);
      case "openai_structured":
        return new OpenAIStructuredLLM(config);
      case "anthropic":
        return new AnthropicLLM(config);
      case "groq":
        return new GroqLLM(config);
      case "ollama":
        return new OllamaLLM(config);
      case "lmstudio":
        return new LMStudioLLM(config);
      case "google":
      case "gemini":
        return new GoogleLLM(config);
      case "azure_openai":
        return new AzureOpenAILLM(config);
      case "mistral":
        return new MistralLLM(config);
      case "langchain":
        return new LangchainLLM(config);
      case "deepseek":
        return new DeepSeekLLM(config);
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
};
var VectorStoreFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "memory":
        return new MemoryVectorStore(config);
      case "qdrant":
        return new Qdrant(config);
      case "redis":
        return new RedisDB(config);
      case "supabase":
        return new SupabaseDB(config);
      case "langchain":
        return new LangchainVectorStore(config);
      case "vectorize":
        return new VectorizeDB(config);
      case "azure-ai-search":
        return new AzureAISearch(config);
      case "pgvector":
        return new PGVector(config);
      default:
        throw new Error(`Unsupported vector store provider: ${provider}`);
    }
  }
};
var HistoryManagerFactory = class {
  static create(provider, config) {
    switch (provider.toLowerCase()) {
      case "sqlite":
        return new SQLiteManager(config.config.historyDbPath || ":memory:");
      case "supabase":
        return new SupabaseHistoryManager({
          supabaseUrl: config.config.supabaseUrl || "",
          supabaseKey: config.config.supabaseKey || "",
          tableName: config.config.tableName || "memory_history"
        });
      case "memory":
        return new MemoryHistoryManager();
      default:
        throw new Error(`Unsupported history store provider: ${provider}`);
    }
  }
};

export { EmbedderFactory, LLMFactory, VectorStoreFactory, HistoryManagerFactory };
