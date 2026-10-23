---
title: Meeting
sources:
  - agents/meeting.ts
---

# Meeting

## Purpose

`Meeting` runs a round-robin discussion among a group of agents until they reach consensus. Each participant is given a `declare_consensus` tool; the meeting ends when every participant has declared consensus (or a maximum number of rounds is reached).

## How it works

1. `_setup` augments each agent's original system prompt with a "Meeting" block (goal + participants) and registers a `declare_consensus` tool that sets the agent's `votedConsensus` flag and captures a closing message. It then creates a session for each agent under the key `"meeting"` and restores the original prompt.
2. `run(maxRounds)` iterates rounds and speakers. Each speaker chats with a prompt: the first speaker opens the discussion; later speakers receive the previous turn as `[AgentName]: message`.
3. After each turn, the last assistant message (or the consensus message) is appended to the transcript. If all participants have voted consensus, the meeting returns early; otherwise it continues until `maxRounds`.

## Key code

- `agents/meeting.ts`
  - `Meeting` — the orchestrator class.
  - `_setup` — prompt augmentation, consensus tool registration, session creation.
  - `run` — the round-robin loop and early exit.
  - `_extractLastAssistantText` — reads the last assistant message's text.
  - `MeetingTurn` / `MeetingTranscript` — transcript shapes.

## Data & config

- The meeting works entirely in memory plus each agent's session (keyed `"meeting"`). No extra files or env vars.

## Gotchas

- `declare_consensus` is registered with `terminate: true`, so declaring consensus ends that agent's turn.
- Consensus requires **all** participants to declare; a single holdout makes the meeting run until `maxRounds`.
- The meeting reuses one `sessionKey` (`"meeting"`) for all participants' sessions.

## Related

- [Swarm](swarm.md) — embeds a `Meeting` after synthesizing a goal.
- [RawPiAgent](raw-pi-agent.md) — the agent type participants are expected to be.
