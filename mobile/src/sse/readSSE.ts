import { fetch as streamFetch } from "expo/fetch";

export class SSEHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Opens a streaming request and yields each `data:` payload parsed as JSON.
 * Uses expo/fetch because React Native's built-in fetch cannot stream bodies.
 * Ends when the server closes the stream; throws SSEHttpError on non-2xx.
 */
export async function* readSSE(
  url: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
): AsyncGenerator<any> {
  const res = await streamFetch(url, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });

  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new SSEHttpError(res.status, message);
  }
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        try {
          yield JSON.parse(line.slice(5).trim());
        } catch {
          // ignore malformed frame
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}
