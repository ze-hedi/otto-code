// jev-agent.ts
// Jev (TypeSafe's decision model) through the OpenRouter SDK: given some context and a
// list of options, Jev picks exactly one. It returns typed answers with probabilities, not text.

// Route fetch through http_proxy / https_proxy, same as pi-agent.ts.
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
setGlobalDispatcher(new EnvHttpProxyAgent());

import { OpenRouter } from "@openrouter/sdk";
import { JEV_DEFAULTS, type JevConfig, type JevType } from "./jev-agent-configs.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface JevOption {
  /** Value returned in `choice` */
  id: string;
  /** When this option applies. Jev reads it, so a good description matters (defaults to the id). */
  description?: string;
}

export interface JevDecisionInput {
  /** What Jev bases its choice on */
  context: string;
  /** Options to choose from. Ids must be unique. */
  options: JevOption[];
}

export interface JevDecision {
  /** Id of the chosen option ("true" or "false" for a yes/no Jev) */
  choice: string;
  /** How concentrated Jev's probability is on the choice (0-1) */
  confidence?: number;
  /** Probability Jev gave to each option */
  probabilities?: Record<string, number>;
}

// ── JevAgent class ─────────────────────────────────────────────────────────────

export class JevAgent {
  private _apiKey: string;
  private _instructions: string;
  private _type: JevType;

  constructor(config: JevConfig = {}) {
    this._apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || "";
    this._type = config.type ?? "choice";
    this._instructions = config.instructions || (this._type === "choice" ? JEV_DEFAULTS.instructions : "");
  }

  /** Pick one option. A yes/no Jev takes exactly the options "true" and "false". */
  async decide({ context, options }: JevDecisionInput, signal?: AbortSignal): Promise<JevDecision> {
    const ids = options.map((o) => o.id);
    if (ids.length === 0) throw new Error("decide() needs at least one option");
    if (new Set(ids).size !== ids.length) throw new Error("Option ids must be unique");
    if (this._type === "noul") {
      if (!this._instructions) throw new Error("A yes/no Jev needs a question (instructions)");
      if (ids.length !== 2 || !ids.includes("true") || !ids.includes("false")) {
        throw new Error('A yes/no Jev takes exactly the options "true" and "false"');
      }
    }
    if (!this._apiKey) {
      throw new Error("No OpenRouter API key. Set apiKey in the config or OPENROUTER_API_KEY in the environment.");
    }

    const describe = (o: JevOption) => o.description || o.id;
    const question =
      this._type === "noul"
        ? {
            type: "noul" as const,
            instructions: this._instructions,
            criteria: {
              true: describe(options.find((o) => o.id === "true")!),
              false: describe(options.find((o) => o.id === "false")!),
            },
          }
        : {
            type: "choice" as const,
            instructions: this._instructions,
            criteria: Object.fromEntries(options.map((o) => [o.id, describe(o)])),
          };

    const client = new OpenRouter({ apiKey: this._apiKey, appTitle: JEV_DEFAULTS.appTitle });
    const response = await client.alpha.decisions.create(
      { decisionsRequest: { model: JEV_DEFAULTS.model, state: context, questions: { decision: question } } },
      { signal }
    );

    const answer = response.answers.decision;
    if (this._type === "noul") {
      if (answer?.type !== "noul") throw new Error("Jev returned no yes/no answer");
      // Jev gives the probability of yes
      const yes = answer.noul;
      return {
        choice: yes >= 0.5 ? "true" : "false",
        confidence: Math.max(yes, 1 - yes),
        probabilities: { true: yes, false: 1 - yes },
      };
    }
    if (answer?.type !== "choice") throw new Error("Jev returned no choice");
    return { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities };
  }
}
