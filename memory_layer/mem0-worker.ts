// mem0-worker.ts
// Runs in a separate Worker Thread. Owns the Mem0 instance so the main thread
// never pays for the 211MB module load or the 3.75MB constructor cost.

import { parentPort, workerData } from "worker_threads";
import type { Mem0Config } from "./mem0.js";

interface ExtractMessage {
  type: "extract";
  messages: { role: string; content: string }[];
}

interface InitMessage {
  type: "init";
  config: Mem0Config;
}

type WorkerMessage = ExtractMessage | InitMessage;

let mem0: import("./mem0.js").Mem0 | null = null;
let mem0Config: Mem0Config | null = (workerData as { config: Mem0Config } | null)?.config ?? null;

async function getMem0(): Promise<import("./mem0.js").Mem0> {
  if (mem0) return mem0;
  if (!mem0Config) throw new Error("mem0 worker: no config provided");
  const { Mem0 } = await import("./mem0.js");
  mem0 = new Mem0(mem0Config);
  return mem0;
}

parentPort!.on("message", async (msg: WorkerMessage) => {
  if (msg.type === "init") {
    mem0Config = msg.config;
    return;
  }

  if (msg.type === "extract") {
    try {
      const instance = await getMem0();
      await instance.add(msg.messages);
      parentPort!.postMessage({ type: "done" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({ type: "error", error: errMsg });
    }
  }
});

parentPort!.postMessage({ type: "ready" });
