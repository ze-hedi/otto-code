import path from "path";
import type { RuntimeConfig, RuntimeKind } from "./config.js";
import {
  ID_ANNOTATION, PLAYGROUND_ANNOTATION, KIND_LABEL, buildPodManifest, labelSelectorForManaged, podNameFor,
} from "./pod-spec.js";
import type { PodManifest, RuntimeSpec } from "./pod-spec.js";

export interface PodView {
  name: string;
  phase: string;
  ready: boolean;
  ip?: string;
  deleting: boolean;
  /** Container waiting reason (ImagePullBackOff, CrashLoopBackOff, ...) when there is one. */
  waitingReason?: string;
  waitingMessage?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

/** The only thing the manager needs from Kubernetes; implemented by cluster-kube.ts. */
export interface ClusterApi {
  createPod(manifest: PodManifest): Promise<void>;
  getPod(name: string): Promise<PodView | null>;
  listPods(labelSelector: string): Promise<PodView[]>;
  deletePod(name: string): Promise<void>;
  /** A URL the backend can use to reach the runner in this pod. */
  resolveBaseUrl(pod: PodView, port: number): Promise<string>;
  /** Free anything held for the pod (port-forwards). */
  release(name: string): void;
}

export interface RuntimeHandle {
  key: string;
  spec: RuntimeSpec;
  podName: string;
  baseUrl: string;
  lastActivity: number;
  inflight: number;
  buildInit?: () => Promise<unknown>;
}

export interface RuntimeInfo {
  kind: RuntimeKind;
  id: string;
  podName: string;
  playground: string;
  idleSeconds: number;
  inflight: number;
}

export interface ManagerDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  pollIntervalMs?: number;
}

const FATAL_WAITING = new Set([
  "ErrImagePull", "ImagePullBackOff", "InvalidImageName", "CreateContainerConfigError", "CrashLoopBackOff",
]);

export class RuntimeError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function runtimeKey(kind: RuntimeKind, id: string): string {
  return `${kind}:${id}`;
}

export class RuntimeManager {
  private readonly handles = new Map<string, RuntimeHandle>();
  private readonly pending = new Map<string, Promise<RuntimeHandle>>();
  private reaper?: ReturnType<typeof setInterval>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;
  private readonly pollIntervalMs: number;
  private readonly cluster: ClusterApi;
  private readonly cfg: RuntimeConfig;

  constructor(cluster: ClusterApi, cfg: RuntimeConfig, deps: ManagerDeps = {}) {
    this.cluster = cluster;
    this.cfg = cfg;
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = deps.log ?? ((m) => console.log(`[runtime] ${m}`));
    this.pollIntervalMs = deps.pollIntervalMs ?? 500;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Idempotent: returns a ready, initialised runtime, starting its pod if needed. */
  ensure(spec: RuntimeSpec, buildInit?: () => Promise<unknown>): Promise<RuntimeHandle> {
    const key = runtimeKey(spec.kind, spec.id);
    const known = this.handles.get(key);
    if (known && samePlayground(known.spec.playground, spec.playground)) {
      known.buildInit = buildInit ?? known.buildInit;
      known.lastActivity = this.now();
      return Promise.resolve(known);
    }

    let inflight = this.pending.get(key);
    if (!inflight) {
      inflight = this.start(spec, buildInit).finally(() => this.pending.delete(key));
      this.pending.set(key, inflight);
    }
    return inflight;
  }

  get(kind: RuntimeKind, id: string): RuntimeHandle | undefined {
    return this.handles.get(runtimeKey(kind, id));
  }

  list(): RuntimeInfo[] {
    return [...this.handles.values()].map((h) => ({
      kind: h.spec.kind,
      id: h.spec.id,
      podName: h.podName,
      playground: h.spec.playground,
      idleSeconds: Math.round((this.now() - h.lastActivity) / 1000),
      inflight: h.inflight,
    }));
  }

  async stop(kind: RuntimeKind, id: string): Promise<boolean> {
    const key = runtimeKey(kind, id);
    const hadHandle = this.handles.delete(key);
    const name = podNameFor(kind, id);
    const pod = await this.cluster.getPod(name);
    if (pod && !pod.deleting) await this.cluster.deletePod(name);
    this.cluster.release(name);
    if (pod || hadHandle) this.log(`stopped ${key} (${name})`);
    return !!pod || hadHandle;
  }

  /** Adopts pods left by a previous backend process so they're reaped instead of leaked. */
  async reconcile(): Promise<void> {
    const pods = await this.cluster.listPods(labelSelectorForManaged());
    for (const pod of pods) {
      const kind = pod.labels[KIND_LABEL] as RuntimeKind | undefined;
      const id = pod.annotations[ID_ANNOTATION];
      const playground = pod.annotations[PLAYGROUND_ANNOTATION];
      if ((kind !== "agent" && kind !== "workflow") || !id || !playground || pod.deleting) continue;
      if (pod.phase !== "Running" || !pod.ready) {
        await this.cluster.deletePod(pod.name).catch(() => {});
        continue;
      }
      const key = runtimeKey(kind, id);
      if (this.handles.has(key)) continue;
      const baseUrl = await this.cluster.resolveBaseUrl(pod, this.cfg.port);
      this.handles.set(key, {
        key, spec: { kind, id, playground }, podName: pod.name, baseUrl, lastActivity: this.now(), inflight: 0,
      });
      this.log(`adopted ${key} (${pod.name})`);
    }
  }

  startReaper(intervalMs = 60_000): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => void this.reapIdle().catch((e) => this.log(`reap failed: ${e}`)), intervalMs);
    this.reaper.unref?.();
  }

  async reapIdle(): Promise<string[]> {
    const reaped: string[] = [];
    for (const handle of [...this.handles.values()]) {
      if (handle.inflight > 0 || this.now() - handle.lastActivity < this.cfg.idleTtlMs) continue;
      // A chat turn keeps running after its client disconnects, so ask the runner before killing it.
      if (await this.isBusy(handle)) {
        handle.lastActivity = this.now();
        continue;
      }
      await this.stop(handle.spec.kind, handle.spec.id);
      reaped.push(handle.key);
    }
    return reaped;
  }

  async shutdown(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = undefined;
    if (this.cfg.cleanupOnExit) {
      await Promise.all([...this.handles.values()].map((h) => this.stop(h.spec.kind, h.spec.id).catch(() => {})));
    }
    for (const h of this.handles.values()) this.cluster.release(h.podName);
  }

  // ── Talking to a runner ───────────────────────────────────────────────────

  /**
   * Sends a request to the runner. If the pod vanished (connection error) or the runner lost its
   * in-memory state (container restart), re-ensures and retries once.
   */
  async request(
    handle: RuntimeHandle,
    urlPath: string,
    init: RequestInit = {},
    opts: { touch?: boolean } = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined;
      try {
        res = await this.fetchImpl(handle.baseUrl + urlPath, { ...init, headers: this.headers(init.headers) });
      } catch (err) {
        if (attempt > 0 || init.signal?.aborted) throw err;
        this.log(`${handle.key} unreachable, restarting`);
        this.handles.delete(handle.key);
        handle = await this.ensure(handle.spec, handle.buildInit);
        continue;
      }
      if (res.status === 409 && res.headers.get("x-otto-not-initialized") && attempt === 0 && handle.buildInit) {
        await this.initialise(handle);
        continue;
      }
      // Status polling passes touch:false so a dashboard left open doesn't keep the pod alive.
      if (opts.touch !== false) handle.lastActivity = this.now();
      return res;
    }
  }

  /** Marks a long-lived request (SSE) so the reaper never kills its pod mid-stream. */
  hold(handle: RuntimeHandle): () => void {
    handle.inflight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      handle.inflight--;
      handle.lastActivity = this.now();
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private headers(extra?: ConstructorParameters<typeof Headers>[0]): Headers {
    const headers = new Headers(extra);
    if (this.cfg.runnerToken) headers.set("authorization", `Bearer ${this.cfg.runnerToken}`);
    return headers;
  }

  private async isBusy(handle: RuntimeHandle): Promise<boolean> {
    try {
      const res = await this.fetchImpl(handle.baseUrl + "/healthz", { headers: this.headers() });
      return !!(await res.json() as { busy?: boolean }).busy;
    } catch {
      return false;
    }
  }

  private async start(spec: RuntimeSpec, buildInit?: () => Promise<unknown>): Promise<RuntimeHandle> {
    const key = runtimeKey(spec.kind, spec.id);
    const manifest = buildPodManifest(spec, this.cfg); // validates the playground before touching the cluster
    const name = manifest.metadata.name;

    let pod = await this.cluster.getPod(name);
    if (pod && (pod.deleting || pod.phase === "Failed" || pod.phase === "Succeeded"
        || !samePlayground(pod.annotations[PLAYGROUND_ANNOTATION], spec.playground))) {
      this.log(`replacing ${name} (phase=${pod.phase}${pod.deleting ? ", deleting" : ""})`);
      if (!pod.deleting) await this.cluster.deletePod(name);
      await this.waitGone(name);
      this.cluster.release(name);
      pod = null;
    }
    if (!pod) {
      await this.cluster.createPod(manifest);
      this.log(`created ${name} for ${key}`);
    }

    const ready = await this.waitReady(name);
    const handle: RuntimeHandle = {
      key,
      spec,
      podName: name,
      baseUrl: await this.cluster.resolveBaseUrl(ready, this.cfg.port),
      lastActivity: this.now(),
      inflight: 0,
      buildInit,
    };
    await this.initialise(handle);
    this.handles.set(key, handle);
    return handle;
  }

  private async waitReady(name: string): Promise<PodView> {
    const deadline = this.now() + this.cfg.startupTimeoutMs;
    let last: PodView | null = null;
    while (this.now() < deadline) {
      last = await this.cluster.getPod(name);
      if (!last) throw new RuntimeError(`Pod ${name} disappeared while starting`);
      if (last.phase === "Failed" || last.phase === "Succeeded") {
        throw new RuntimeError(`Pod ${name} exited during startup (phase ${last.phase})`);
      }
      if (last.waitingReason && FATAL_WAITING.has(last.waitingReason)) {
        throw new RuntimeError(`Pod ${name} cannot start: ${last.waitingReason}${last.waitingMessage ? ` — ${last.waitingMessage}` : ""}`);
      }
      if (last.phase === "Running" && last.ready) return last;
      await this.sleep(this.pollIntervalMs);
    }
    throw new RuntimeError(
      `Timed out after ${this.cfg.startupTimeoutMs / 1000}s waiting for pod ${name} ` +
      `(phase ${last?.phase ?? "unknown"}${last?.waitingReason ? `, ${last.waitingReason}` : ""}). ` +
      `If it is stuck in ContainerCreating, check that the playground path exists on the node.`,
      504,
    );
  }

  private async waitGone(name: string): Promise<void> {
    const deadline = this.now() + this.cfg.startupTimeoutMs;
    while (this.now() < deadline) {
      if (!(await this.cluster.getPod(name))) return;
      await this.sleep(this.pollIntervalMs);
    }
    throw new RuntimeError(`Timed out waiting for pod ${name} to terminate`, 504);
  }

  /** Posts the init payload if the runner reports it has none yet. */
  private async initialise(handle: RuntimeHandle): Promise<void> {
    const health = await this.fetchWithRetry(handle, "/healthz");
    const state = await health.json() as { initialized?: boolean };
    if (state.initialized || !handle.buildInit) return;

    const res = await this.fetchImpl(handle.baseUrl + "/init", {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(await handle.buildInit()),
    });
    if (!res.ok) throw new RuntimeError(`Runner ${handle.podName} rejected init: ${await res.text()}`);
  }

  /** Readiness only proves the probe port answered once; tolerate a short window of resets after it. */
  private async fetchWithRetry(handle: RuntimeHandle, urlPath: string): Promise<Response> {
    let lastErr: unknown;
    for (let i = 0; i < 10; i++) {
      try {
        const res = await this.fetchImpl(handle.baseUrl + urlPath, { headers: this.headers() });
        if (res.ok) return res;
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new RuntimeError(`Runner ${handle.podName} is not answering: ${lastErr}`);
  }
}

function samePlayground(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && path.resolve(a) === path.resolve(b);
}
