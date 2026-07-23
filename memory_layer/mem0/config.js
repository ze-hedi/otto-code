import { MemoryConfigSchema } from "./types.js";

// src/oss/src/config/defaults.ts
var DEFAULT_MEMORY_CONFIG = {
  disableHistory: false,
  version: "v1.1",
  embedder: {
    provider: "openai",
    config: {
      apiKey: process.env.OPENAI_API_KEY || "",
      model: "text-embedding-3-small"
    }
  },
  vectorStore: {
    provider: "memory",
    config: {
      collectionName: "memories",
      dimension: 1536
    }
  },
  llm: {
    provider: "openai",
    config: {
      baseURL: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY || "",
      model: "gpt-5-mini",
      modelProperties: void 0
    }
  },
  historyStore: {
    provider: "sqlite",
    config: {
      historyDbPath: "memory.db"
    }
  }
};

// src/oss/src/config/manager.ts
var ConfigManager = class {
  static mergeConfig(userConfig = {}) {
    var _a2, _b, _c, _d, _e, _f, _g;
    const mergedConfig = {
      version: userConfig.version || DEFAULT_MEMORY_CONFIG.version,
      embedder: {
        provider: ((_a2 = userConfig.embedder) == null ? void 0 : _a2.provider) || DEFAULT_MEMORY_CONFIG.embedder.provider,
        config: (() => {
          var _a3, _b2, _c2, _d2;
          const defaultConf = DEFAULT_MEMORY_CONFIG.embedder.config;
          const userConf = (_a3 = userConfig.embedder) == null ? void 0 : _a3.config;
          let finalModel = defaultConf.model;
          if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "object") {
            finalModel = userConf.model;
          } else if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "string") {
            finalModel = userConf.model;
          }
          const baseURL = (_c2 = (_b2 = userConf == null ? void 0 : userConf.baseURL) != null ? _b2 : userConf == null ? void 0 : userConf.lmstudio_base_url) != null ? _c2 : userConf == null ? void 0 : userConf.url;
          const embeddingDims = (_d2 = userConf == null ? void 0 : userConf.embeddingDims) != null ? _d2 : userConf == null ? void 0 : userConf.embedding_dims;
          return {
            apiKey: (userConf == null ? void 0 : userConf.apiKey) !== void 0 ? userConf.apiKey : defaultConf.apiKey,
            model: finalModel,
            baseURL,
            url: userConf == null ? void 0 : userConf.url,
            embeddingDims,
            modelProperties: (userConf == null ? void 0 : userConf.modelProperties) !== void 0 ? userConf.modelProperties : defaultConf.modelProperties
          };
        })()
      },
      vectorStore: {
        provider: ((_b = userConfig.vectorStore) == null ? void 0 : _b.provider) || DEFAULT_MEMORY_CONFIG.vectorStore.provider,
        config: (() => {
          var _a3, _b2, _c2;
          const defaultConf = DEFAULT_MEMORY_CONFIG.vectorStore.config;
          const userConf = (_a3 = userConfig.vectorStore) == null ? void 0 : _a3.config;
          const explicitDimension = (userConf == null ? void 0 : userConf.dimension) || ((_c2 = (_b2 = userConfig.embedder) == null ? void 0 : _b2.config) == null ? void 0 : _c2.embeddingDims) || void 0;
          if ((userConf == null ? void 0 : userConf.client) && typeof userConf.client === "object") {
            return {
              client: userConf.client,
              collectionName: userConf.collectionName,
              dimension: explicitDimension,
              ...userConf
              // Include any other passthrough fields from user
            };
          } else {
            return {
              collectionName: (userConf == null ? void 0 : userConf.collectionName) || defaultConf.collectionName,
              dimension: explicitDimension,
              // Ensure client is not carried over from defaults if not provided by user
              client: void 0,
              // Include other passthrough fields from userConf even if no client
              ...userConf
            };
          }
        })()
      },
      llm: {
        provider: ((_c = userConfig.llm) == null ? void 0 : _c.provider) || DEFAULT_MEMORY_CONFIG.llm.provider,
        config: (() => {
          var _a3, _b2, _c2, _d2;
          const defaultConf = DEFAULT_MEMORY_CONFIG.llm.config;
          const userConf = (_a3 = userConfig.llm) == null ? void 0 : _a3.config;
          let finalModel = defaultConf.model;
          if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "object") {
            finalModel = userConf.model;
          } else if ((userConf == null ? void 0 : userConf.model) && typeof userConf.model === "string") {
            finalModel = userConf.model;
          }
          const llmBaseURL = (_d2 = (_c2 = (_b2 = userConf == null ? void 0 : userConf.baseURL) != null ? _b2 : userConf == null ? void 0 : userConf.lmstudio_base_url) != null ? _c2 : userConf == null ? void 0 : userConf.url) != null ? _d2 : defaultConf.baseURL;
          return {
            baseURL: llmBaseURL,
            url: userConf == null ? void 0 : userConf.url,
            apiKey: (userConf == null ? void 0 : userConf.apiKey) !== void 0 ? userConf.apiKey : defaultConf.apiKey,
            model: finalModel,
            modelProperties: (userConf == null ? void 0 : userConf.modelProperties) !== void 0 ? userConf.modelProperties : defaultConf.modelProperties
          };
        })()
      },
      historyDbPath: userConfig.historyDbPath || ((_e = (_d = userConfig.historyStore) == null ? void 0 : _d.config) == null ? void 0 : _e.historyDbPath) || ((_g = (_f = DEFAULT_MEMORY_CONFIG.historyStore) == null ? void 0 : _f.config) == null ? void 0 : _g.historyDbPath),
      customInstructions: userConfig.customInstructions,
      historyStore: (() => {
        var _a3, _b2;
        const defaultHistoryStore = DEFAULT_MEMORY_CONFIG.historyStore;
        const historyProvider = ((_a3 = userConfig.historyStore) == null ? void 0 : _a3.provider) || defaultHistoryStore.provider;
        const isSqlite = historyProvider.toLowerCase() === "sqlite";
        return {
          ...defaultHistoryStore,
          ...userConfig.historyStore,
          provider: historyProvider,
          config: {
            ...isSqlite ? defaultHistoryStore.config : {},
            ...isSqlite && userConfig.historyDbPath ? { historyDbPath: userConfig.historyDbPath } : {},
            ...(_b2 = userConfig.historyStore) == null ? void 0 : _b2.config
          }
        };
      })(),
      disableHistory: userConfig.disableHistory || DEFAULT_MEMORY_CONFIG.disableHistory
    };
    return MemoryConfigSchema.parse(mergedConfig);
  }
};

export { DEFAULT_MEMORY_CONFIG, ConfigManager };
