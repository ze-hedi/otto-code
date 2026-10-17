// Meeting speaker routing with stubbed agents and a stubbed Jev (no network).
import assert from "node:assert/strict";
import { Meeting } from "../agents/meeting";

function fakeAgent(name: string, voteOnTurn?: number) {
  let consensus: any;
  let spoke = 0;
  return {
    _baseSystemPrompt: "",
    registerTool(t: any) { if (t.name === "declare_consensus") consensus = t; },
    async createNewSession() {},
    async chat() {
      spoke++;
      if (voteOnTurn !== undefined && spoke >= voteOnTurn) await consensus.execute("id", { message: `${name} agrees` });
    },
    async getMessages() { return [{ role: "assistant", content: `${name} says hi` }]; },
  } as any;
}

const mk = (votes: Record<string, number | undefined> = {}) =>
  ["A", "B", "C"].map((n) => ({ name: n, description: `agent ${n}`, agent: fakeAgent(n, votes[n]) }));
const names = (t: { turns: { agentName: string }[] }) => t.turns.map((x) => x.agentName).join("");

// round-robin is unchanged
let t = await new Meeting(mk(), "goal").run(2);
assert.equal(names(t), "ABCABC");
assert.equal(t.reachedConsensus, false);

// jev picks the speakers; the last speaker is excluded; voted agents leave the choices
const seen: string[][] = [];
const picks = ["C", "A", "B", "A", "C"];
t = await new Meeting(mk({ A: 1, B: 1, C: 1 }), "goal", {
  router: "jev",
  jevDecide: async ({ options, context }) => {
    seen.push(options.map((o) => o.id));
    assert.match(context, /Meeting goal: goal/);
    assert.match(context, /\[A\]: A says hi/);
    return { choice: seen.length === 1 ? "C" : options[0].id, confidence: 0.9 };
  },
}).run(5);
// A speaks first (no context yet), then Jev: C, then (A voted) only B left -> no Jev call
assert.equal(names(t), "ACB");
assert.equal(t.reachedConsensus, true);
assert.equal(seen.length, 1);
assert.deepEqual(seen[0], ["B", "C"]);
assert.equal(t.turns[1].routedBy, "jev");
assert.equal(t.turns[1].confidence, 0.9);

// failure falls back to the next agent in order
t = await new Meeting(mk(), "goal", { router: "jev", jevDecide: async () => { throw new Error("boom"); } }).run(1);
assert.equal(names(t), "ABC");
assert.equal(t.turns[1].routedBy, "round-robin");

console.log("meeting jev router: ok");
