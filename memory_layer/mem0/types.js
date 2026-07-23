import { z } from "zod";

var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

var MemoryConfigSchema = z.object({
  version: z.string().optional(),
  embedder: z.object({
    provider: z.string(),
    config: z.object({
      modelProperties: z.record(z.string(), z.any()).optional(),
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      baseURL: z.string().optional(),
      embeddingDims: z.number().optional(),
      url: z.string().optional()
    })
  }),
  vectorStore: z.object({
    provider: z.string(),
    config: z.object({
      collectionName: z.string().optional(),
      dimension: z.number().optional(),
      dbPath: z.string().optional(),
      client: z.any().optional()
    }).passthrough()
  }),
  llm: z.object({
    provider: z.string(),
    config: z.object({
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      modelProperties: z.record(z.string(), z.any()).optional(),
      baseURL: z.string().optional(),
      url: z.string().optional(),
      timeout: z.number().optional()
    })
  }),
  historyDbPath: z.string().optional(),
  customInstructions: z.string().optional(),
  historyStore: z.object({
    provider: z.string(),
    config: z.record(z.string(), z.any())
  }).optional(),
  disableHistory: z.boolean().optional()
});

export { __require, MemoryConfigSchema };
