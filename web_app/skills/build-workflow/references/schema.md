# Schema format

```json
{
  "components": [
    { "id": "<agent_id>", "type": "agent",     "x": 100, "y": 200 },
    { "id": "delegate",   "type": "interface", "x": 400, "y": 200 },
    { "id": "<agent_id>", "type": "agent",     "x": 700, "y": 100 }
  ],
  "connections": [
    { "from": "<agent_id>", "fromSide": "right", "to": "delegate",   "toSide": "left" },
    { "from": "delegate",   "fromSide": "right", "to": "<agent_id>", "toSide": "left" }
  ]
}
```

- `type` is `"agent"` or `"interface"`.
- Agent node `id` = the `agent_id` of an existing agent. Interface node `id` = `delegate` | `forward` | `accumulate` | `route`.
- `x`, `y` are canvas positions, only used by the UI. Lay out left to right: about 300 px between levels, 150 px between nodes of the same level.
- Always connect `fromSide: "right"` to `toSide: "left"`.
- Connections that reference a missing node are silently dropped, so check ids carefully.
