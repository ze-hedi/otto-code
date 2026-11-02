---
name: build-workflow
description: Turn a plan into an executable multi-agent workflow (a DAG of agents wired through interface nodes), save it, compile it and run it through the Otto backend API. Use when a task is better split across several specialised agents than done by yourself, or when asked to create, schedule or launch a workflow.
---

# Build a workflow from a plan

A workflow is a DAG: **agent nodes** do the work, **interface nodes** hand one agent's output to the next ones. You build it by calling the Otto backend (`$OTTO_API`, default `http://localhost:4000`) with `scripts/wf.sh`.

## Procedure

1. **Plan first.** Write the plan as steps. For each step decide: which agent does it, what it receives, what it hands over. Merge steps that don't need a separate agent: every extra agent costs a full LLM session.
2. **Pick agents.** Run `scripts/wf.sh agents` to list existing agents (id, description, model). Reuse one when its role fits. Only create a new one (`scripts/wf.sh create-agent <file.json>`) when none fits. Format in `references/agents.md`.
3. **Choose the interfaces** that link the agents. Rules and limits in `references/interfaces.md`. Read it before drawing the graph, because the backend rejects wrong wiring at compile time.
4. **Write the schema** as a JSON file (`components` + `connections`, format in `references/schema.md`).
5. **Check it:** `scripts/wf.sh validate <schema.json>`. Fix every error it prints.
6. **Save:** `scripts/wf.sh save "<name>" "<description>" <schema.json> [playground]` prints the `workflow_id`.
7. **Compile:** `scripts/wf.sh compile <workflow_id> <schema.json>`.
8. **Run:** `scripts/wf.sh run "<message for the first agent>"`. It streams events until the workflow ends. Summarise the outcome for the user from the last agent's output.

If compile or run fails, read the error, fix the schema, and go back to step 5. Do not retry unchanged.

## Rules you must not break

- Never invent an agent id. Every agent node id must come from `wf.sh agents` or from an agent you just created.
- Agents are linked **only through interface nodes**. A direct agent → agent connection means the second agent never runs.
- There is exactly one node of each interface type per workflow (`delegate`, `forward`, `accumulate`, `route`), because the interface node id *is* its type.
- The graph must be acyclic.
- The workflow has one entry message: the first-level agent(s) receive what you pass to `run`. Put everything they need in it.
- Ask the user before running a workflow that writes files or runs commands, unless they already asked you to launch it.
