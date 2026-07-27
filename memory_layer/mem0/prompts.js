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

var AdditiveExtractionSchema = z2.object({
  memory: z2.array(
    z2.object({
      id: z2.string(),
      text: z2.string(),
      attributed_to: z2.enum(["user", "assistant"]).optional(),
      linked_memory_ids: z2.array(z2.string()).optional()
    })
  )
});
var PAST_MESSAGE_TRUNCATION_LIMIT = 300;
function truncateContent(text, limit = PAST_MESSAGE_TRUNCATION_LIMIT) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}
function formatConversationHistory(messages) {
  var _a2, _b;
  if (!messages || messages.length === 0) return "";
  let result = "";
  for (const msg of messages) {
    const role = (_a2 = msg.role) != null ? _a2 : "";
    const content = (_b = msg.content) != null ? _b : "";
    if (role && content) {
      result += `${role}: ${truncateContent(content)}
`;
    }
  }
  return result;
}
function serializeMemories(memories) {
  return JSON.stringify(memories != null ? memories : []);
}
function generateAdditiveExtractionPrompt(options) {
  var _a2, _b, _c;
  const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const currentDate = (_a2 = options.currentDate) != null ? _a2 : now;
  const observationDate = (_b = options.observationDate) != null ? _b : currentDate;
  const sections = [];
  sections.push("## Summary\n");
  sections.push(
    `## Last k Messages
${formatConversationHistory(options.lastKMessages)}`
  );
  sections.push("## Recently Extracted Memories\n[]");
  sections.push(
    `## Existing Memories
${serializeMemories(options.existingMemories)}`
  );
  sections.push(`## New Messages
${(_c = options.newMessages) != null ? _c : "[]"}`);
  sections.push(`## Observation Date
${observationDate}`);
  sections.push(`## Current Date
${currentDate}`);
  if (options.customInstructions) {
    sections.push(`## Custom Instructions
${options.customInstructions}`);
  }
  sections.push("# Output:");
  return sections.join("\n\n");
}
function removeCodeBlocks(text) {
  const stripped = text.replace(/```(?:\w+)?\n?([\s\S]*?)(?:```|$)/g, "$1").trim();
  return stripped.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
function extractJson(text) {
  let cleaned = text.replace(/<\|end_of_text\|>/g, "").replace(/<\|eot_id\|>/g, "").replace(/<\|im_end\|>/g, "").replace(/<\|im_start\|>/g, "").replace(/<\|endoftext\|>/g, "");
  cleaned = removeCodeBlocks(cleaned);
  const trimmed = cleaned.trim();
  if (!trimmed) return "";
  const braceIndices = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{") braceIndices.push(i);
  }
  for (const start of braceIndices) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.substring(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch (e) {
            break;
          }
        }
      }
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (e) {
    }
  }
  const bracketIndices = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "[") bracketIndices.push(i);
  }
  for (const start of bracketIndices) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "[") depth++;
      else if (char === "]") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.substring(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch (e) {
            break;
          }
        }
      }
    }
  }
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.substring(firstBracket, lastBracket + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (e) {
    }
  }
  return trimmed;
}


export { factItem, FactRetrievalSchema, MemoryUpdateSchema, AdditiveExtractionSchema,  PAST_MESSAGE_TRUNCATION_LIMIT, truncateContent, formatConversationHistory, serializeMemories, generateAdditiveExtractionPrompt, removeCodeBlocks, extractJson };
