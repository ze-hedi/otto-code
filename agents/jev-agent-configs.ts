// jev-agent-configs.ts
// Config for JevAgent. A Jev is only configured with what the form asks for;
// everything else is fixed in JEV_DEFAULTS.

export interface JevConfig {
  /** OpenRouter API key (falls back to the OPENROUTER_API_KEY env var) */
  apiKey?: string;
  /** The question Jev answers about the context (defaults to JEV_DEFAULTS.instructions) */
  instructions?: string;
}

export const JEV_DEFAULTS = {
  /** TypeSafe's Jev decision model on OpenRouter (pinned; "~typesafe/jev-latest" tracks the newest) */
  model: "typesafe/jev-1.14",
  /** Sent to OpenRouter as the X-Title attribution header */
  appTitle: "Otto",
  instructions: "Which option should the workflow take next?",
} as const;
