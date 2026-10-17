import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { loadRuntimeConfig } from "../src/runtime/config.js";
import { RuntimeManager } from "../src/runtime/manager.js";
import type { ClusterApi, RuntimeHandle } from "../src/runtime/manager.js";
import { proxyToRuntime } from "../src/runtime/proxy.js";

const noCluster: ClusterApi = {
  async createPod() { throw new Error("cluster unavailable"); },
  async getPod() { throw new Error("cluster unavailable"); },
  async listPods() { return []; },
  async deletePod() {},
  async resolveBaseUrl() { return ""; },
  release() {},
};

const listen = (server: http.Server) =>
  new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));

/** Express-ish shim over node:http so the proxy can run without express installed. */
function expressLike(handler: (req: any, res: any) => Promise<void>): http.Server {
  return http.createServer(async (req: any, res: any) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.send = (b: Buffer) => res.end(b);
    res.json = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    await handler(req, res);
  });
}

async function fixture(upstream: http.RequestListener) {
  const runner = http.createServer(upstream);
  const runnerPort = await listen(runner);
  const mgr = new RuntimeManager(noCluster, loadRuntimeConfig({ OTTO_RUNNER_TOKEN: "tok" }), { log: () => {} });
  const handle: RuntimeHandle = {
    key: "agent:a", spec: { kind: "agent", id: "a", playground: "/p" }, podName: "pod",
    baseUrl: `http://127.0.0.1:${runnerPort}`, lastActivity: 0, inflight: 0,
  };
  const front = expressLike((req, res) => proxyToRuntime(mgr, handle, req, res, "/agent/chat"));
  const frontPort = await listen(front);
  const close = () => { runner.closeAllConnections(); front.closeAllConnections(); runner.close(); front.close(); };
  return { handle, frontPort, close };
}

test("JSON responses keep status, body and get the runner token + payload", async () => {
  let seen: any;
  const { frontPort, close } = await fixture((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "busy" }));
    });
  });
  try {
    const r = await fetch(`http://127.0.0.1:${frontPort}/x`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: "busy" });
    assert.deepEqual(seen, { method: "POST", url: "/agent/chat", auth: "Bearer tok", body: { message: "hi" } });
  } finally { close(); }
});

test("SSE is streamed incrementally and holds the runtime until it ends", async () => {
  let finish!: () => void;
  const { handle, frontPort, close } = await fixture((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"type":"delta","text":"one"}\n\n');
    finish = () => { res.write('data: {"type":"done"}\n\n'); res.end(); };
  });
  try {
    const r = await fetch(`http://127.0.0.1:${frontPort}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.headers.get("content-type"), "text/event-stream");
    const reader = r.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /"one"/);          // arrived before the upstream finished
    assert.equal(handle.inflight, 1);       // reaper must not touch it mid-stream

    finish();
    let rest = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
    assert.match(rest, /"done"/);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(handle.inflight, 0);
  } finally { close(); }
});

test("a client that disconnects releases the hold and cancels the upstream request", async () => {
  let upstreamClosed!: () => void;
  const closed = new Promise<void>((r) => (upstreamClosed = r));
  const { handle, frontPort, close } = await fixture((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: {}\n\n");
    req.on("close", upstreamClosed);
  });
  try {
    const ac = new AbortController();
    const r = await fetch(`http://127.0.0.1:${frontPort}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: ac.signal });
    await r.body!.getReader().read();
    assert.equal(handle.inflight, 1);
    ac.abort();
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error("upstream never saw the disconnect")), 2000))]);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(handle.inflight, 0);
  } finally { close(); }
});

test("an unreachable runner becomes a JSON 502, not a hang", async () => {
  const { handle, frontPort, close } = await fixture(() => {});
  handle.baseUrl = "http://127.0.0.1:1"; // nothing listens here
  try {
    const r = await fetch(`http://127.0.0.1:${frontPort}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 502);
    assert.match((await r.json() as any).error, /cluster unavailable/);
  } finally { close(); }
});
