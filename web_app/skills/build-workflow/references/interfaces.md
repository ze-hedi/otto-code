# Interface nodes

| id | shape | inputs | outputs | what the upstream agent does |
|---|---|---|---|---|
| `delegate` | one → many | exactly 1 | at least 1 | calls a tool with `tasks[]` (one task per chosen downstream agent). It may pick only a subset. |
| `forward` | one → one | exactly 1 | exactly 1 | calls a tool with a single `result` string. |
| `accumulate` | many → one | at least 1 | exactly 1 | each upstream agent calls a tool with its `result`. The downstream agent gets all results together. |
| `route` | one → one of many | exactly 1 | at least 1 | picks exactly one downstream agent with `route` + `result`. |

## Choosing

- Sequential pipeline A → B → C: `forward` between each pair. Each `forward` can be used only once, so a pipeline of more than two agents cannot repeat it. Use another type or fewer steps.
- Parallel fan-out then merge: `delegate` to the workers, then `accumulate` into the merger.
- Conditional branch: `route`.

## Behaviour to plan around

- A downstream agent only runs if the upstream agent **calls the interface tool**. If it answers in plain text, the downstream agent is skipped.
- Agents in the same level run in parallel.
- Each agent's system prompt gets a generated suffix describing its neighbours, taken from the first 120 characters of their system prompts. Start every agent's system prompt with a clear one-sentence role.
