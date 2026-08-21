import { Workflow, NodeType } from "../agents/workflow_types.js";

const input = {
  components: [
    { id: "1774344684698", type: "agent", x: 224, y: 330 },
    { id: "1774344686003", type: "interface", x: 623, y: 171 },
    { id: "1774344700629", type: "agent", x: 653, y: 423 },
    { id: "1774344700630", type: "agent", x: 653, y: 493 },
  ],
  connections: [
    { from: "1774344684698", fromSide: "right", to: "1774344686003", toSide: "left" },
    { from: "1774344686003", fromSide: "right", to: "1774344700629", toSide: "left" },
    { from: "1774344686003", fromSide: "right", to: "1774344700630", toSide: "left" },
  ],
};

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

const workflow = new Workflow(input);
workflow.buildExecutionQueue();
const { levels, predecessors, successors } = workflow.executionQueue;

console.log("levels (agent nodes only):");
levels.forEach((level, i) =>
  console.log(`  [${i}] ${level.map((n) => n.id).join(", ")}`),
);

// interface node is structural (NodeType.node) and must be filtered out
assert(levels.length === 2, "interface node filtered out of run levels");
assert(levels[0].map((n) => n.id).join() === "1774344684698", "level 0 = first agent");
assert(
  levels[1].map((n) => n.id).sort().join() === "1774344700629,1774344700630",
  "level 1 = both downstream agents",
);

assert(predecessors.get("1774344686003")!.length === 1, "interface has 1 predecessor");
assert(successors.get("1774344686003")!.length === 2, "interface has 2 successors");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall assertions passed");

console.log("\nlevels:");
levels.forEach((level, i) =>
  console.log(`  [${i}] ${level.map((n) => `${n.id}(${n.type === NodeType.agent ? "agent" : "node"})`).join(", ")}`),
);

console.log("\npredecessors:");
for (const [id, preds] of predecessors)
  console.log(`  ${id} <- ${preds.map((n) => n.id).join(", ") || "(none)"}`);

console.log("\nsuccessors:");
for (const [id, succs] of successors)
  console.log(`  ${id} -> ${succs.map((n) => n.id).join(", ") || "(none)"}`);
