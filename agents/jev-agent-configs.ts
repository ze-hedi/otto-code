// jev-agent-configs.ts
// Config for JevAgent. A Jev is only configured with what the form asks for;
// everything else is fixed in JEV_DEFAULTS.

/** "choice" picks one of the choices, "noul" answers yes/no (its choice ids are "true" and "false") */
export type JevType = "choice" | "noul";

export interface JevChoice {
  /** What Jev answers with, and what the user calls this choice */
  id: string;
  /** When this choice applies. Jev reads it, so it matters (defaults to the id) */
  description: string;
  /** Agent of the workflow that runs when this choice wins */
  agent: string;
}

export interface JevConfig {
  /** OpenRouter API key (falls back to the OPENROUTER_API_KEY env var) */
  apiKey?: string;
  /** The question Jev answers about the context (defaults to JEV_DEFAULTS.instructions; required for "noul") */
  instructions?: string;
  /** Defaults to "choice" */
  type?: JevType;
  /** Left empty for "choice", the agents connected after the Jev are the choices */
  choices?: JevChoice[];
}

export const JEV_DEFAULTS = {
  /** TypeSafe's Jev decision model on OpenRouter (pinned; "~typesafe/jev-latest" tracks the newest) */
  model: "typesafe/jev-1.14",
  /** Sent to OpenRouter as the X-Title attribution header */
  appTitle: "Otto",
  instructions: "Which option should the workflow take next?",
} as const;
