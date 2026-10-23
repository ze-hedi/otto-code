---
title: JevAgent
sources:
  - agents/jev-agent.ts
  - agents/jev-agent-configs.ts
---

# JevAgent

## Purpose

`JevAgent` wraps TypeSafe's "Jev" decision model through the OpenRouter SDK. Given some context and a list of options, Jev picks exactly one option (or answers yes/no) and returns typed probabilities rather than free-form text. It is a standalone decision primitive.

## How it works

1. `decide({ context, options }, signal)` validates the options: at least one option, unique ids, and — for a yes/no Jev — exactly the options `"true"` and `"false"` plus a question (`instructions`).
2. It builds a `choice` or `noul` question from the instructions and option descriptions.
3. It creates an OpenRouter client and calls `client.alpha.decisions.create` with the pinned model from `JEV_DEFAULTS`.
4. For `noul` it converts Jev's probability of "yes" into a `true`/`false` choice with a confidence of `max(yes, 1-yes)`; for `choice` it returns the chosen id, confidence, and per-option probabilities.

## Key code

- `agents/jev-agent.ts`
  - `JevAgent` — the wrapper class.
  - `decide` — validation, question construction, and the OpenRouter call.
  - `JevDecisionInput` / `JevDecision` / `JevOption` — input/output shapes.
- `agents/jev-agent-configs.ts`
  - `JevType` — `"choice"` or `"noul"`.
  - `JevConfig` / `JevChoice` — configuration shapes.
  - `JEV_DEFAULTS` — pinned model `typesafe/jev-1.14` and app title `Otto`.

## Data & config

- API key comes from `JevConfig.apiKey` or the `OPENROUTER_API_KEY` environment variable.
- The model is pinned to `typesafe/jev-1.14`; the `X-Title` header is `Otto`.
- Requests are routed through `http_proxy` / `https_proxy` via `undici`'s `EnvHttpProxyAgent` (set at module load).

## Gotchas

- A yes/no (`noul`) Jev requires `instructions` and exactly the two options `"true"` and `"false"`; anything else throws.
- `decide()` throws if there is no OpenRouter API key.
- The `choice` field for `noul` is the string `"true"` or `"false"`, not a boolean.

## Related

- [Workflow](workflow.md) — its `RouteInterface` provides a similar one-of-many routing concept, though implemented differently.
