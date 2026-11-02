# Creating an agent

`scripts/wf.sh create-agent agent.json` POSTs the file to `/agents`. Minimal file:

```json
{
  "name": "researcher",
  "description": "Finds and summarises sources",
  "model": "deepseek/deepseek-v4-pro",
  "systemPrompt": "You are a researcher. Find ... Output ...",
  "builtInTools": ["read", "bash"],
  "playground": "/absolute/path/of/the/project"
}
```

- `model` is required. Copy the model of an existing agent from `wf.sh agents`.
- `builtInTools` is a subset of `read`, `bash`, `edit`, `write`. Give the least that the role needs (an analyst needs none).
- `playground` should match the project the other agents use.
- The response contains `agent_id`. Use it as the node id.
