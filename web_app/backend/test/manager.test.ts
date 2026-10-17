import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../src/runtime/config.js";
import { RuntimeManager, RuntimeError } from "../src/runtime/manager.js";
import type { ClusterApi, PodView } from "../src/runtime/manager.js";
import type { PodManifest } from "../src/runtime/pod-spec.js";

/** In-memory cluster: pods turn Running/Ready after `readyAfterPolls` getPod calls. */
class FakeCluster implements ClusterApi {
  pods = new Map<string, PodView & { polls: number }>();
  created: string[] = [];
  deleted: string[] = [];
  released: string[] = [];
  readyAfterPolls = 2;
  waitingReason: string | undefined;
  deletePodInstantly = true;
  onCreate?: (name: string) => void;

  async createPod(m: PodManifest) {
    this.created.push(m.metadata.name);
    this.onCreate?.(m.metadata.name);
    this.pods.set(m.metadata.name, {
      name: m.metadata.name, phase: "Pending", ready: false, deleting: false, polls: 0,
      labels: m.metadata.labels, annotations: m.metadata.annotations,
    });
  }
  async getPod(name: string) {
    const p = this.pods.get(name);
    if (!p) return null;
    if (p.phase === "Pending") {
      p.polls++;
      if (this.waitingReason) p.waitingReason = this.waitingReason;
      else if (p.polls >= this.readyAfterPolls) { p.phase = "Running"; p.ready = true; p.ip = "10.0.0.1"; }
    }
    return { ...p };
  }
  async listPods() { return [...this.pods.values()].map((p) => ({ ...p })); }
  async deletePod(name: string) {
    this.deleted.push(name);
    if (this.deletePodInstantly) this.pods.delete(name);
    else this.pods.get(name)!.deleting = true;
  }
  async resolveBaseUrl(pod: PodView) { return `http://fake/${pod.name}`; }
  release(name: string) { this.released.push(name); }
}

/** Fake runner HTTP server keyed by pod name. */
class FakeRunners {
  initialized = new Set<string>();
  initBodies: any[] = [];
  busy = new Set<string>();
  down = new Set<string>();
  calls: string[] = [];
  notInitOnce = new Set<string>();

  fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const pod = u.pathname.split("/")[1];
    const path = u.pathname.slice(pod.length + 1);
    this.calls.push(`${init?.method ?? "GET"} ${pod}${path}`);
    if (this.down.has(pod)) throw new TypeError("fetch failed");
    if (path === "/healthz") {
      return Response.json({ ok: true, initialized: this.initialized.has(pod), busy: this.busy.has(pod) });
    }
    if (path === "/init") {
      this.initBodies.push(JSON.parse(String(init!.body)));
      this.initialized.add(pod);
      return Response.json({ ok: true });
    }
    if (this.notInitOnce.delete(pod)) {
      this.initialized.delete(pod);
      return new Response("{}", { status: 409, headers: { "x-otto-not-initialized": "1" } });
    }
    return Response.json({ path, auth: new Headers(init?.headers).get("authorization") });
  };
}

function setup(env: Record<string, string> = {}) {
  const cluster = new FakeCluster();
  const runners = new FakeRunners();
  let clock = 1_000_000;
  const cfg = loadRuntimeConfig({ OTTO_K8S_STARTUP_TIMEOUT_SECONDS: "5", OTTO_K8S_IDLE_TTL_MINUTES: "10", ...env });
  const mgr = new RuntimeManager(cluster, cfg, {
    fetch: runners.fetch as typeof fetch,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    log: () => {},
  });
  return { cluster, runners, mgr, advance: (ms: number) => { clock += ms; } };
}

const spec = { kind: "agent" as const, id: "agent-1", playground: "/work/p" };
const init = async () => ({ agentId: "agent-1", config: { model: "x/y" } });

test("ensure creates the pod, waits for readiness and initialises it exactly once", async () => {
  const { cluster, runners, mgr } = setup();
  const h = await mgr.ensure(spec, init);
  assert.equal(cluster.created.length, 1);
  assert.equal(h.baseUrl, `http://fake/${h.podName}`);
  assert.equal(runners.initBodies.length, 1);
  assert.deepEqual(runners.initBodies[0], { agentId: "agent-1", config: { model: "x/y" } });

  const again = await mgr.ensure(spec, init);
  assert.equal(again, h);
  assert.equal(cluster.created.length, 1);
  assert.equal(runners.initBodies.length, 1);
});

test("concurrent ensure calls share one startup", async () => {
  const { cluster, mgr } = setup();
  const [a, b, c] = await Promise.all([mgr.ensure(spec, init), mgr.ensure(spec, init), mgr.ensure(spec, init)]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(cluster.created.length, 1);
});

test("an existing ready pod is reused without recreating it", async () => {
  const { cluster, runners, mgr } = setup();
  const first = await mgr.ensure(spec, init);
  // A fresh backend process finds the pod left behind by the previous one.
  const restarted = new RuntimeManager(cluster, loadRuntimeConfig({}), {
    fetch: runners.fetch as typeof fetch, sleep: async () => {}, log: () => {},
  });
  const second = await restarted.ensure(spec, init);
  assert.equal(second.podName, first.podName);
  assert.equal(cluster.created.length, 1);
});

test("a failed pod is replaced", async () => {
  const { cluster, runners, mgr } = setup();
  const first = await mgr.ensure(spec, init);
  cluster.pods.get(first.podName)!.phase = "Failed";
  runners.initialized.clear();

  // Backend restarted, so it has no handle and must inspect the pod it finds.
  const restarted = new RuntimeManager(cluster, loadRuntimeConfig({}), {
    fetch: runners.fetch as typeof fetch, sleep: async () => {}, log: () => {},
  });
  const second = await restarted.ensure(spec, init);
  assert.deepEqual(cluster.deleted, [first.podName]);
  assert.equal(cluster.created.length, 2);
  assert.equal(second.podName, first.podName);
});

test("changing the playground recreates the pod", async () => {
  const { cluster, mgr } = setup();
  await mgr.ensure({ kind: "workflow", id: "w", playground: "/work/a" }, init);
  await mgr.ensure({ kind: "workflow", id: "w", playground: "/work/b" }, init);
  assert.equal(cluster.created.length, 2);
  assert.equal(cluster.deleted.length, 1);
  assert.equal(mgr.get("workflow", "w")!.spec.playground, "/work/b");
});

test("image pull failures fail fast with the reason", async () => {
  const { cluster, mgr } = setup();
  cluster.waitingReason = "ImagePullBackOff";
  await assert.rejects(mgr.ensure(spec, init), (e: any) => e instanceof RuntimeError && /ImagePullBackOff/.test(e.message));
});

test("never-ready pods time out with a hint about the mount", async () => {
  const { cluster, mgr } = setup();
  cluster.readyAfterPolls = Infinity;
  await assert.rejects(mgr.ensure(spec, init), (e: any) => e.status === 504 && /playground path exists/.test(e.message));
});

test("invalid playgrounds never reach the cluster", async () => {
  const { cluster, mgr } = setup();
  await assert.rejects(mgr.ensure({ ...spec, playground: "relative/dir" }, init), /absolute/);
  assert.equal(cluster.created.length, 0);
});

test("stop deletes the pod, forgets the handle and frees forwards", async () => {
  const { cluster, mgr } = setup();
  const h = await mgr.ensure(spec, init);
  assert.equal(await mgr.stop("agent", "agent-1"), true);
  assert.deepEqual(cluster.deleted, [h.podName]);
  assert.deepEqual(cluster.released, [h.podName]);
  assert.equal(mgr.get("agent", "agent-1"), undefined);
  assert.equal(await mgr.stop("agent", "agent-1"), false);
});

test("reaper only stops idle, non-busy runtimes", async () => {
  const { cluster, runners, mgr, advance } = setup();
  const make = (id: string) => mgr.ensure({ kind: "agent", id, playground: "/p" }, init);
  const idle = await make("idle");
  const streaming = await make("streaming");
  const busy = await make("busy");
  const release = mgr.hold(streaming);
  runners.busy.add(busy.podName);

  advance(11 * 60_000);
  await make("fresh"); // started after the TTL elapsed for the others
  assert.deepEqual(await mgr.reapIdle(), [idle.key]);
  for (const id of ["streaming", "busy", "fresh"]) assert.ok(mgr.get("agent", id), id);

  release();
  runners.busy.clear();
  advance(11 * 60_000);
  assert.equal((await mgr.reapIdle()).length, 3);
  assert.equal(cluster.deleted.length, 4);
});

test("status polling with touch:false does not postpone reaping", async () => {
  const { mgr, advance } = setup();
  const h = await mgr.ensure(spec, init);
  advance(9 * 60_000);
  await mgr.request(h, "/agent/status", {}, { touch: false });
  advance(2 * 60_000);
  assert.deepEqual(await mgr.reapIdle(), [h.key]);
});

test("reconcile adopts running pods, deletes broken ones, ignores foreign ones", async () => {
  const { cluster, mgr } = setup();
  const labels = { "app.kubernetes.io/managed-by": "otto", "otto.dev/kind": "agent" };
  const mk = (name: string, over: Partial<PodView>): PodView & { polls: number } => ({
    name, phase: "Running", ready: true, deleting: false, polls: 0, labels,
    annotations: { "otto.dev/id": name, "otto.dev/playground": "/p" }, ...over,
  });
  cluster.pods.set("good", mk("good", {}));
  cluster.pods.set("crashed", mk("crashed", { ready: false }));
  cluster.pods.set("foreign", mk("foreign", { annotations: {} }));
  await mgr.reconcile();
  assert.deepEqual(mgr.list().map((r) => r.id), ["good"]);
  assert.deepEqual(cluster.deleted, ["crashed"]);
});

test("connection failures restart the runtime and retry once", async () => {
  const { cluster, runners, mgr } = setup();
  const h = await mgr.ensure(spec, init);
  // The pod died: it's Failed and its address stops answering until a replacement is created.
  cluster.pods.get(h.podName)!.phase = "Failed";
  runners.down.add(h.podName);
  runners.initialized.clear();
  cluster.onCreate = (name) => runners.down.delete(name);

  const res = await mgr.request(h, "/agent/messages");
  assert.equal((await res.json() as any).path, "/agent/messages");
  assert.equal(cluster.created.length, 2);
  assert.equal(runners.initBodies.length, 2);
});

test("a runner that lost its state is re-initialised transparently", async () => {
  const { runners, mgr } = setup();
  const h = await mgr.ensure(spec, init);
  runners.notInitOnce.add(h.podName);
  const res = await mgr.request(h, "/agent/chat", { method: "POST" });
  assert.equal(res.status, 200);
  assert.equal(runners.initBodies.length, 2);
});

test("the runner token is attached to every request", async () => {
  const { mgr } = setup({ OTTO_RUNNER_TOKEN: "s3cret" });
  const h = await mgr.ensure(spec, init);
  const body = await (await mgr.request(h, "/agent/status")).json() as any;
  assert.equal(body.auth, "Bearer s3cret");
});

test("shutdown with cleanup removes every pod; without it pods are left for adoption", async () => {
  const keep = setup();
  await keep.mgr.ensure(spec, init);
  await keep.mgr.shutdown();
  assert.equal(keep.cluster.deleted.length, 0);

  const clean = setup({ OTTO_K8S_CLEANUP_ON_EXIT: "true" });
  await clean.mgr.ensure(spec, init);
  await clean.mgr.shutdown();
  assert.equal(clean.cluster.deleted.length, 1);
});
