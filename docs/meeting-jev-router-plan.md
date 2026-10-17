# Plan: Jev as an optional speaker router in `Meeting`

## Goal
Let a meeting choose who speaks next either by **round-robin** (today, default) or by **Jev**, the decision model in `agents/jev-agent.ts`. At every turn the Jev router gets the new meeting context injected.

## Current behaviour
- `Meeting.run()` (`agents/meeting.ts:84`) loops `round 1..maxRounds` and, inside it, `for speaker of this.agents`. The order is fixed.
- Each speaker is prompted with only the previous turn (`[Name]: message`).
- The meeting stops early when every agent has called `declare_consensus`.
- `Swarm.run()` (`agents/swarm.ts:258`) is the only production caller. `examples/meeting-test.ts` is the example.

## Design

### 1. Public API (`meeting.ts`)
```ts
export type MeetingRouter = "round-robin" | "jev";

export interface MeetingOptions {
  router?: MeetingRouter;       // default "round-robin"
  jev?: JevConfig;              // apiKey / instructions, used only when router === "jev"
  maxConsecutive?: number;      // default 1: same agent cannot speak twice in a row
}
new Meeting(agents, goal, options?)
```
`Swarm` passes the option through (new optional `router` argument on `run()` or the constructor). Existing callers are unchanged.

### 2. Turn loop refactor
Replace the nested round/agent loop with a single turn loop behind a `_pickNextSpeaker()` method:
- `round-robin`: `agents[turn % n]`. The `round` field of `MeetingTurn` stays `floor(turn / n) + 1`, and the total budget stays `maxRounds * n` turns, so results match today.
- `jev`: see below.
- The consensus check after each turn is unchanged.
- The "first to speak" prompt is unchanged. In Jev mode the first speaker is `agents[0]` (no context yet to route on).
- Update the system-prompt line "You are participating in a round-robin discussion" so it reflects the router.

### 3. Jev router
- Build one `JevAgent({ type: "choice", instructions, apiKey })` in the constructor when `router === "jev"`.
- Instructions: "Given the meeting so far, which participant should speak next? Prefer whoever was addressed or whose expertise the last message needs."
- Options = the eligible agents: `{ id: name, description: "<agent description> | spoke N turns ago | voted consensus: yes/no" }`.
- **Context injection at each turn**: build the `context` string fresh before every `decide()` call:
  1. the meeting goal,
  2. the participant list,
  3. the transcript so far (`[Name]: message`, truncated to the last K turns to bound size),
  4. the consensus status of each agent,
  5. who spoke last.
  Because the transcript grows by one turn, each call carries the newly added message.
- **Stopping rule**: an agent that has called `declare_consensus` is removed from the Jev options for the rest of the meeting. When no agents remain, the meeting ends with `reachedConsensus: true` (same all-voted check as today). If exactly one agent remains, skip the Jev call and give it the turn.
- Eligibility: drop the last speaker if `maxConsecutive` is hit, unless only one agent remains.
- Pass `confidence` / `probabilities` back so they can be logged.

### 4. Failure handling
If `decide()` throws (no API key, network, bad answer), log a warning and fall back to the next agent in round-robin order. The meeting never fails because of the router.

### 5. Observability
- Add optional `routedBy: "round-robin" | "jev"` and `confidence?: number` to `MeetingTurn` so the transcript shows how each speaker was chosen.
- Emit the same events through `onEvent`; no new event types needed.

### 6. Workflow / UI
- Check whether `agents/workflow*.ts` or `web_app` build meetings. Today only `swarm.ts` does, so the choice is exposed as a `Swarm` option first. If the workflow builder gets a meeting node later, add a router dropdown there.

### 7. Tests / verification
- Unit test with a stubbed `JevAgent.decide` (no network): order follows Jev's picks, voted agents are excluded, the last agent standing skips the Jev call, `maxConsecutive` is enforced, the fallback triggers when `decide()` throws, and round-robin output is identical to today.
- Add a Jev variant to `examples/meeting-test.ts` for a manual run (needs `OPENROUTER_API_KEY`).
- Run the TypeScript build (`tsc --noEmit`).

## Order of work
1. Extract `_pickNextSpeaker()` and the single turn loop; confirm round-robin is unchanged.
2. Add `MeetingOptions` and the Jev router with context injection.
3. Add the guard and the fallback.
4. Add `routedBy` / `confidence` to the transcript.
5. Wire the option through `Swarm`.
6. Tests and the example.

## Open questions
- Resolved: the meeting stays consensus-only. Voted agents leave the Jev options; the meeting ends when none remain.
- How many past turns should the context include (default proposal: last 12)?
