import { OpenAILLM } from "./llms.js";

// src/oss/src/utils.ts
function toSnakeCase(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value
    ])
  );
}
function toCamelCase(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value
    ])
  );
}

// src/oss/src/vector_stores/pgvector.ts
var SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
function validateIdentifier(name, label = "identifier") {
  if (!SAFE_IDENTIFIER_RE.test(name)) {
    throw new Error(
      `Invalid ${label} '${name}': only letters, digits, and underscores are allowed, must start with a letter or underscore, and be at most 128 characters.`
    );
  }
  return name;
}
function escapeFilterKey(key) {
  if (!SAFE_IDENTIFIER_RE.test(key)) {
    throw new Error(
      `Invalid filter key '${key}': only letters, digits, and underscores are allowed.`
    );
  }
  return key;
}

// src/oss/src/utils/memory.ts
var get_image_description = async (image_url) => {
  const llm = new OpenAILLM({
    apiKey: process.env.OPENAI_API_KEY
  });
  const response = await llm.generateResponse([
    {
      role: "user",
      content: "Provide a description of the image and do not include any additional text."
    },
    {
      role: "user",
      content: { type: "image_url", image_url: { url: image_url } }
    }
  ]);
  return response;
};
var parse_vision_messages = async (messages) => {
  const parsed_messages = [];
  for (const message of messages) {
    let new_message = {
      role: message.role,
      content: ""
    };
    if (message.role !== "system") {
      if (typeof message.content === "object" && message.content.type === "image_url") {
        const description = await get_image_description(
          message.content.image_url.url
        );
        new_message.content = typeof description === "string" ? description : JSON.stringify(description);
        parsed_messages.push(new_message);
      } else parsed_messages.push(message);
    }
  }
  return parsed_messages;
};

export { toSnakeCase, toCamelCase, validateIdentifier, escapeFilterKey, get_image_description, parse_vision_messages };
