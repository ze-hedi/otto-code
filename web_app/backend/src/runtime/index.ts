import { isKubernetesMode, loadRuntimeConfig } from "./config.js";
import { KubeClusterApi } from "./cluster-kube.js";
import { RuntimeManager } from "./manager.js";

export { isKubernetesMode } from "./config.js";

let manager: RuntimeManager | undefined;

export function getRuntimeManager(): RuntimeManager {
  if (!isKubernetesMode()) throw new Error("Runtime manager is only available with OTTO_RUNTIME=kubernetes");
  if (!manager) {
    const cfg = loadRuntimeConfig();
    manager = new RuntimeManager(new KubeClusterApi(cfg), cfg);
  }
  return manager;
}

/** Adopts pods from a previous backend run, starts the idle reaper and hooks shutdown. */
export async function startRuntime(): Promise<void> {
  if (!isKubernetesMode()) {
    console.warn("[runtime] OTTO_RUNTIME=local: agents and workflows run INSIDE the backend process, with no sandbox");
    return;
  }
  const mgr = getRuntimeManager();
  await mgr.reconcile().catch((err) => console.warn("[runtime] reconcile failed:", err?.message ?? err));
  mgr.startReaper();
  const shutdown = () => void mgr.shutdown().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log("[runtime] kubernetes mode: agents and workflows run in pods");
}
