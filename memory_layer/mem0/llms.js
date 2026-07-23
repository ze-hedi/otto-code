// src/oss/src/llms/openai.ts
import OpenAI3 from "openai";
var OpenAILLM = class {
  constructor(config) {
    this.openai = new OpenAI3({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      ...config.timeout != null && { timeout: config.timeout }
    });
    this.model = config.model || "gpt-5-mini";
  }
  async generateResponse(messages, responseFormat, tools) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model,
      response_format: responseFormat,
      ...tools && { tools, tool_choice: "auto" }
    });
    const response = completion.choices[0].message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model
    });
    const response = completion.choices[0].message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
};

// src/oss/src/llms/openai_structured.ts
import OpenAI4 from "openai";
var OpenAIStructuredLLM = class {
  constructor(config) {
    this.openai = new OpenAI4({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      ...config.timeout != null && { timeout: config.timeout }
    });
    this.model = config.model || "gpt-5-mini";
  }
  async generateResponse(messages, responseFormat, tools) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      model: this.model,
      ...tools ? {
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
          }
        })),
        tool_choice: "auto"
      } : responseFormat ? {
        response_format: {
          type: responseFormat.type
        }
      } : {}
    });
    const response = completion.choices[0].message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      model: this.model
    });
    const response = completion.choices[0].message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
};

// src/oss/src/llms/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
var AnthropicLLM = class {
  constructor(config) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }
    this.client = new Anthropic({ apiKey });
    this.model = config.model || "claude-3-sonnet-20240229";
  }
  async generateResponse(messages, responseFormat) {
    const systemMessage = messages.find((msg) => msg.role === "system");
    const otherMessages = messages.filter((msg) => msg.role !== "system");
    const response = await this.client.messages.create({
      model: this.model,
      messages: otherMessages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : msg.content.image_url.url
      })),
      system: typeof (systemMessage == null ? void 0 : systemMessage.content) === "string" ? systemMessage.content : void 0,
      max_tokens: 4096
    });
    const firstBlock = response.content[0];
    if (firstBlock.type === "text") {
      return firstBlock.text;
    } else {
      throw new Error("Unexpected response type from Anthropic API");
    }
  }
  async generateChat(messages) {
    const response = await this.generateResponse(messages);
    return {
      content: response,
      role: "assistant"
    };
  }
};

// src/oss/src/llms/groq.ts
import { Groq } from "groq-sdk";
var GroqLLM = class {
  constructor(config) {
    const apiKey = config.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("Groq API key is required");
    }
    this.client = new Groq({ apiKey });
    this.model = config.model || "llama3-70b-8192";
  }
  async generateResponse(messages, responseFormat) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      response_format: responseFormat
    });
    return response.choices[0].message.content || "";
  }
  async generateChat(messages) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      }))
    });
    const message = response.choices[0].message;
    return {
      content: message.content || "",
      role: message.role
    };
  }
};

// src/oss/src/llms/mistral.ts
import { Mistral } from "@mistralai/mistralai";
var MistralLLM = class {
  constructor(config) {
    if (!config.apiKey) {
      throw new Error("Mistral API key is required");
    }
    this.client = new Mistral({
      apiKey: config.apiKey
    });
    this.model = config.model || "mistral-tiny-latest";
  }
  // Helper function to convert content to string
  contentToString(content) {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((chunk) => {
        if (chunk.type === "text") {
          return chunk.text;
        } else {
          return JSON.stringify(chunk);
        }
      }).join("");
    }
    return String(content || "");
  }
  async generateResponse(messages, responseFormat, tools) {
    const response = await this.client.chat.complete({
      model: this.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      })),
      ...tools && { tools },
      ...responseFormat && { response_format: responseFormat }
    });
    if (!response || !response.choices || response.choices.length === 0) {
      return "";
    }
    const message = response.choices[0].message;
    if (!message) {
      return "";
    }
    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        content: this.contentToString(message.content),
        role: message.role || "assistant",
        toolCalls: message.toolCalls.map((call) => ({
          name: call.function.name,
          arguments: typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments)
        }))
      };
    }
    return this.contentToString(message.content);
  }
  async generateChat(messages) {
    const formattedMessages = messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
    }));
    const response = await this.client.chat.complete({
      model: this.model,
      messages: formattedMessages
    });
    if (!response || !response.choices || response.choices.length === 0) {
      return {
        content: "",
        role: "assistant"
      };
    }
    const message = response.choices[0].message;
    return {
      content: this.contentToString(message.content),
      role: message.role || "assistant"
    };
  }
};

// src/oss/src/llms/ollama.ts
import { Ollama as Ollama2 } from "ollama";
var logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  debug: (message) => console.debug(`[DEBUG] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`)
};
var OllamaLLM = class {
  constructor(config) {
    // Using this variable to avoid calling the Ollama server multiple times
    this.initialized = false;
    this.ollama = new Ollama2({
      host: config.url || config.baseURL || "http://localhost:11434"
    });
    this.model = config.model || "llama3.1:8b";
    this.ensureModelExists().catch((err) => {
      logger.error(`Error ensuring model exists: ${err}`);
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      await this.ensureModelExists();
    } catch (err) {
      logger.error(`Error ensuring model exists: ${err}`);
    }
    const completion = await this.ollama.chat({
      model: this.model,
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      ...(responseFormat == null ? void 0 : responseFormat.type) === "json_object" && { format: "json" },
      ...tools && { tools, tool_choice: "auto" }
    });
    const response = completion.message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: JSON.stringify(call.function.arguments)
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    try {
      await this.ensureModelExists();
    } catch (err) {
      logger.error(`Error ensuring model exists: ${err}`);
    }
    const completion = await this.ollama.chat({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model
    });
    const response = completion.message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
  async ensureModelExists() {
    if (this.initialized) {
      return true;
    }
    const local_models = await this.ollama.list();
    if (!local_models.models.find((m) => m.name === this.model)) {
      logger.info(`Pulling model ${this.model}...`);
      await this.ollama.pull({ model: this.model });
    }
    this.initialized = true;
    return true;
  }
};

// src/oss/src/llms/lmstudio.ts
var DEFAULT_BASE_URL2 = "http://localhost:1234/v1";
var DEFAULT_MODEL2 = "lmstudio-community/Meta-Llama-3.1-70B-Instruct-GGUF/Meta-Llama-3.1-70B-Instruct-IQ2_M.gguf";
var DEFAULT_LMSTUDIO_API_KEY2 = "lm-studio";
var LMStudioLLM = class extends OpenAILLM {
  constructor(config) {
    var _a2;
    super({
      ...config,
      apiKey: config.apiKey || DEFAULT_LMSTUDIO_API_KEY2,
      baseURL: (_a2 = config.baseURL) != null ? _a2 : DEFAULT_BASE_URL2,
      model: config.model || DEFAULT_MODEL2
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LM Studio LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/deepseek.ts
var DeepSeekLLM = class extends OpenAILLM {
  constructor(config) {
    const apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("DeepSeek API key is required");
    }
    super({
      ...config,
      apiKey,
      baseURL: config.baseURL || process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com",
      model: config.model || "deepseek-chat"
    });
  }
  async generateResponse(messages, responseFormat, tools) {
    try {
      return await super.generateResponse(messages, responseFormat, tools);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`DeepSeek LLM failed: ${message}`);
    }
  }
  async generateChat(messages) {
    try {
      return await super.generateChat(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`DeepSeek LLM failed: ${message}`);
    }
  }
};

// src/oss/src/llms/google.ts
import { GoogleGenAI as GoogleGenAI2 } from "@google/genai";
var GoogleLLM = class {
  constructor(config) {
    this.google = new GoogleGenAI2({ apiKey: config.apiKey });
    this.model = config.model || "gemini-2.0-flash";
  }
  async generateResponse(messages, responseFormat, tools) {
    var _a2;
    const contents = messages.map((msg) => ({
      parts: [
        {
          text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        }
      ],
      role: msg.role === "system" ? "model" : "user"
    }));
    const config = {};
    if (tools && tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
          }))
        }
      ];
    }
    const completion = await this.google.models.generateContent({
      contents,
      model: this.model,
      config
    });
    if (completion.functionCalls && completion.functionCalls.length > 0) {
      return {
        content: completion.text || "",
        role: "assistant",
        toolCalls: completion.functionCalls.map((call) => ({
          name: call.name,
          arguments: JSON.stringify(call.args)
        }))
      };
    }
    const text = (_a2 = completion.text) == null ? void 0 : _a2.replace(/^```json\n/, "").replace(/\n```$/, "");
    return text || "";
  }
  async generateChat(messages) {
    const completion = await this.google.models.generateContent({
      contents: messages,
      model: this.model
    });
    const response = completion.candidates[0].content;
    return {
      content: response.parts[0].text || "",
      role: response.role
    };
  }
};

// src/oss/src/llms/azure.ts
import { AzureOpenAI } from "openai";
var AzureOpenAILLM = class {
  constructor(config) {
    var _a2;
    if (!config.apiKey || !((_a2 = config.modelProperties) == null ? void 0 : _a2.endpoint)) {
      throw new Error("Azure OpenAI requires both API key and endpoint");
    }
    const { endpoint, ...rest } = config.modelProperties;
    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint,
      ...rest
    });
    this.model = config.model || "gpt-5-mini";
  }
  async generateResponse(messages, responseFormat, tools) {
    const completion = await this.client.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model,
      response_format: responseFormat,
      ...tools && { tools, tool_choice: "auto" }
    });
    const response = completion.choices[0].message;
    if (response.tool_calls) {
      return {
        content: response.content || "",
        role: response.role,
        toolCalls: response.tool_calls.map((call) => ({
          name: call.function.name,
          arguments: call.function.arguments
        }))
      };
    }
    return response.content || "";
  }
  async generateChat(messages) {
    const completion = await this.client.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role;
        return {
          role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        };
      }),
      model: this.model
    });
    const response = completion.choices[0].message;
    return {
      content: response.content || "",
      role: response.role
    };
  }
};

// src/oss/src/llms/langchain.ts
import {
  AIMessage,
  HumanMessage,
  SystemMessage
} from "@langchain/core/messages";
import { z as z2 } from "zod";
var factItem = z2.union([
  z2.string(),
  z2.object({ fact: z2.string() }).transform((o) => o.fact),
  z2.object({ text: z2.string() }).transform((o) => o.text)
]);
var FactRetrievalSchema = z2.object({
  facts: z2.array(factItem).transform((arr) => arr.filter((s) => s.length > 0)).describe("An array of distinct facts extracted from the conversation.")
});
var MemoryUpdateSchema = z2.object({
  memory: z2.array(
    z2.object({
      id: z2.string().describe("The unique identifier of the memory item."),
      text: z2.string().describe("The content of the memory item."),
      event: z2.enum(["ADD", "UPDATE", "DELETE", "NONE"]).describe(
        "The action taken for this memory item (ADD, UPDATE, DELETE, or NONE)."
      ),
      old_memory: z2.string().optional().nullable().describe(
        "The previous content of the memory item if the event was UPDATE."
      )
    })
  ).describe(
    "An array representing the state of memory items after processing new facts."
  )
});
var convertToLangchainMessages = (messages) => {
  return messages.map((msg) => {
    var _a2;
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    switch ((_a2 = msg.role) == null ? void 0 : _a2.toLowerCase()) {
      case "system":
        return new SystemMessage(content);
      case "user":
      case "human":
        return new HumanMessage(content);
      case "assistant":
      case "ai":
        return new AIMessage(content);
      default:
        console.warn(
          `Unsupported message role '${msg.role}' for Langchain. Treating as 'human'.`
        );
        return new HumanMessage(content);
    }
  });
};
var LangchainLLM = class {
  constructor(config) {
    if (!config.model || typeof config.model !== "object") {
      throw new Error(
        "Langchain provider requires an initialized Langchain instance passed via the 'model' field in the LLM config."
      );
    }
    if (typeof config.model.invoke !== "function") {
      throw new Error(
        "Provided Langchain 'instance' in the 'model' field does not appear to be a valid Langchain language model (missing invoke method)."
      );
    }
    this.llmInstance = config.model;
    this.modelName = this.llmInstance.modelId || this.llmInstance.model || "langchain-model";
  }
  async generateResponse(messages, response_format, tools) {
    var _a2, _b, _c, _d, _e;
    const langchainMessages = convertToLangchainMessages(messages);
    let runnable = this.llmInstance;
    const invokeOptions = {};
    let isStructuredOutput = false;
    let selectedSchema = null;
    const systemPromptContent = ((_a2 = messages.find((m) => m.role === "system")) == null ? void 0 : _a2.content) || "";
    const userPromptContent = ((_b = messages.find((m) => m.role === "user")) == null ? void 0 : _b.content) || "";
    if (systemPromptContent.includes("Personal Information Organizer") && systemPromptContent.includes("extract relevant pieces of information")) {
      selectedSchema = FactRetrievalSchema;
    } else if (userPromptContent.includes("smart memory manager") && userPromptContent.includes("Compare newly retrieved facts")) {
      selectedSchema = MemoryUpdateSchema;
    }
    if (selectedSchema && typeof this.llmInstance.withStructuredOutput === "function") {
      try {
        runnable = this.llmInstance.withStructuredOutput(
          selectedSchema,
          { name: (_c = tools == null ? void 0 : tools[0]) == null ? void 0 : _c.function.name }
        );
        isStructuredOutput = true;
      } catch (e) {
        isStructuredOutput = false;
        if ((response_format == null ? void 0 : response_format.type) === "json_object") {
          invokeOptions.response_format = { type: "json_object" };
        }
      }
    } else if (selectedSchema && (response_format == null ? void 0 : response_format.type) === "json_object") {
      if (((_d = this.llmInstance._identifyingParams) == null ? void 0 : _d.response_format) || this.llmInstance.response_format) {
        invokeOptions.response_format = { type: "json_object" };
      }
    } else if (!selectedSchema && (response_format == null ? void 0 : response_format.type) === "json_object") {
      if (((_e = this.llmInstance._identifyingParams) == null ? void 0 : _e.response_format) || this.llmInstance.response_format) {
        invokeOptions.response_format = { type: "json_object" };
      }
    }
    if (tools && tools.length > 0) {
      if (typeof runnable.bindTools === "function") {
        try {
          runnable = runnable.bindTools(tools);
        } catch (e) {
        }
      } else {
      }
    }
    try {
      const response = await runnable.invoke(langchainMessages, invokeOptions);
      if (isStructuredOutput) {
        return JSON.stringify(response);
      } else if (response && response.tool_calls && Array.isArray(response.tool_calls)) {
        const mappedToolCalls = response.tool_calls.map((call) => ({
          name: call.name || "unknown_tool",
          arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args)
        }));
        return {
          content: response.content || "",
          role: "assistant",
          toolCalls: mappedToolCalls
        };
      } else if (response && typeof response.content === "string") {
        return response.content;
      } else {
        return JSON.stringify(response);
      }
    } catch (error) {
      throw error;
    }
  }
  async generateChat(messages) {
    const langchainMessages = convertToLangchainMessages(messages);
    try {
      const response = await this.llmInstance.invoke(langchainMessages);
      if (response && typeof response.content === "string") {
        return {
          content: response.content,
          role: response.lc_id ? "assistant" : "assistant"
        };
      } else {
        console.warn(
          `Unexpected response format from Langchain instance (${this.modelName}) for generateChat:`,
          response
        );
        return {
          content: JSON.stringify(response),
          role: "assistant"
        };
      }
    } catch (error) {
      console.error(
        `Error invoking Langchain instance (${this.modelName}) for generateChat:`,
        error
      );
      throw error;
    }
  }
};

export { OpenAILLM, OpenAIStructuredLLM, AnthropicLLM, GroqLLM, MistralLLM, OllamaLLM, LMStudioLLM, DeepSeekLLM, GoogleLLM, AzureOpenAILLM, LangchainLLM };
