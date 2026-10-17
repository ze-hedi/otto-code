import { Readable } from "stream";
import type { Request, Response as ExpressResponse } from "express";
import type { RuntimeHandle, RuntimeManager } from "./manager.js";
import { RuntimeError } from "./manager.js";

const PASSTHROUGH_HEADERS = ["content-type", "cache-control", "x-accel-buffering"];

export interface ProxyOptions {
  method?: string;
  /** Overrides req.body as the JSON payload. */
  body?: unknown;
  /** false for status polling: don't count the request as activity. */
  touch?: boolean;
}

/**
 * Forwards an Express request to a runner and relays the answer. JSON responses are buffered;
 * SSE responses are streamed and hold the runtime open until the stream ends.
 */
export async function proxyToRuntime(
  mgr: RuntimeManager,
  handle: RuntimeHandle,
  req: Request,
  res: ExpressResponse,
  targetPath: string,
  opts: ProxyOptions = {},
): Promise<void> {
  const method = opts.method ?? req.method;
  const payload = opts.body !== undefined ? opts.body : req.body;
  const hasBody = method !== "GET" && method !== "HEAD" && payload !== undefined;

  // Client went away: stop waiting on the runner (the runner decides what that means for the agent).
  const upstreamAbort = new AbortController();
  res.on("close", () => upstreamAbort.abort());

  let up: Response;
  try {
    up = await mgr.request(
      handle,
      targetPath,
      {
        method,
        headers: hasBody ? { "content-type": "application/json" } : undefined,
        body: hasBody ? JSON.stringify(payload) : undefined,
        signal: upstreamAbort.signal,
      },
      { touch: opts.touch },
    );
  } catch (err) {
    if (upstreamAbort.signal.aborted) return;
    sendRuntimeError(res, err);
    return;
  }

  res.status(up.status);
  for (const name of PASSTHROUGH_HEADERS) {
    const value = up.headers.get(name);
    if (value) res.setHeader(name, value);
  }

  const isStream = (up.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!isStream || !up.body) {
    res.send(Buffer.from(await up.arrayBuffer()));
    return;
  }

  res.flushHeaders();
  const release = mgr.hold(handle);
  const body = Readable.fromWeb(up.body as any);
  body.on("data", (chunk) => {
    res.write(chunk);
    (res as any).flush?.();
  });
  await new Promise<void>((resolve) => {
    body.once("end", resolve);
    body.once("error", resolve);
    body.once("close", resolve);
  });
  release();
  if (!res.writableEnded) res.end();
}

export function sendRuntimeError(res: ExpressResponse, err: unknown): void {
  const status = err instanceof RuntimeError ? err.status : 502;
  const message = err instanceof Error ? err.message : String(err);
  console.error("[runtime] error:", message);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({ error: message });
}
