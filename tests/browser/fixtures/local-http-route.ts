import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Page, Request, Route } from "@playwright/test";

const MAX_BODY_BYTES = 100 * 1024 * 1024;
const CORRELATION_HEADER = "x-maono-local-test-request";
type FulfillOptions = Pick<NonNullable<Parameters<Route["fulfill"]>[0]>, "body" | "json" | "status" | "headers" | "contentType">;

export type LocalHttpRoute = {
  request(): {
    url(): string;
    method(): string;
    headers(): Record<string, string>;
    postDataBuffer(): Buffer | null;
    postData(): string | null;
    postDataJSON(): unknown;
  };
  fulfill(options?: FulfillOptions): Promise<void>;
};

type PendingRequest = {
  original: Request;
  url: string;
  method: string;
  headers: Record<string, string>;
  origin: string;
  received: boolean;
  finish(error?: unknown): void;
};

function localHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("Local HTTP fixtures accept only credential-free loopback HTTP URLs.");
  }
  return url;
}

function corsHeaders(origin: string): Record<string, string> {
  // Never combine a wildcard origin with credentialed browser requests.
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" };
}

async function readBody(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of request) {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) throw new Error(`Local HTTP fixture request exceeds ${MAX_BODY_BYTES} bytes.`);
      chunks.push(chunk);
    }
  } catch (error) {
    // A partial, deliberately cancelled upload must never become a committed save.
    if (request.aborted && length <= MAX_BODY_BYTES) return null;
    throw error;
  }
  return Buffer.concat(chunks, length);
}

/**
 * Read the real browser HTTP body instead of Playwright's inspector postData:
 * WebKit can report null for a Blob even while transmitting all of its bytes.
 * No browser payload, method, or content headers are reconstructed here.
 * Use only with synthetic local fixtures; this is not a proxy for live accounts.
 */
export async function installLocalHttpRoute(
  page: Page,
  pattern: Parameters<Page["route"]>[0],
  handler: (route: LocalHttpRoute) => Promise<void> | void,
): Promise<{ dispose(): Promise<void> }> {
  const pending = new Map<string, PendingRequest>();
  let disposed = false;

  const receive = async (incoming: IncomingMessage, response: ServerResponse) => {
    const id = incoming.headers[CORRELATION_HEADER];
    const entry = typeof id === "string" ? pending.get(id) : undefined;
    if (!entry) {
      // A browser may preflight the rewritten destination. Only an already
      // intercepted local request authorizes its origin, path, and method.
      const preflight = incoming.method === "OPTIONS" && [...pending.values()].find(candidate => {
        const url = new URL(candidate.url);
        return `${url.pathname}${url.search}` === incoming.url && candidate.origin === incoming.headers.origin
          && candidate.method === incoming.headers["access-control-request-method"];
      });
      if (preflight) {
        response.writeHead(204, {
          ...corsHeaders(preflight.origin),
          "access-control-allow-methods": preflight.method,
          "access-control-allow-headers": [...Object.keys(preflight.headers), CORRELATION_HEADER].join(", "),
        });
      } else response.writeHead(404);
      response.end();
      return;
    }
    entry.received = true;
    try {
      if (Number(incoming.headers["content-length"]) > MAX_BODY_BYTES) {
        throw new Error(`Local HTTP fixture request exceeds ${MAX_BODY_BYTES} bytes.`);
      }
      const body = await readBody(incoming);
      if (body === null) { entry.finish(); return; }
      const originalUrl = new URL(entry.url);
      if (incoming.method !== entry.method || incoming.url !== `${originalUrl.pathname}${originalUrl.search}`) {
        throw new Error("Local HTTP fixture changed the request method or path.");
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined && name !== CORRELATION_HEADER) headers[name] = Array.isArray(value) ? value.join(", ") : value;
      }
      headers.host = entry.headers.host ?? originalUrl.host;
      const hasBody = body.length > 0 || "content-length" in headers || "transfer-encoding" in headers;
      let fulfilled = false;
      await handler({
        request: () => ({
          url: () => entry.url,
          method: () => incoming.method!,
          headers: () => ({ ...headers }),
          postDataBuffer: () => hasBody ? Buffer.from(body) : null,
          postData: () => hasBody ? body.toString("utf8") : null,
          postDataJSON: () => JSON.parse(body.toString("utf8")),
        }),
        fulfill: async (options = {}) => {
          if (fulfilled) throw new Error("Local HTTP fixture fulfilled one request twice.");
          fulfilled = true;
          const outputHeaders = Object.fromEntries(Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
          let outputBody = options.body ?? "";
          if (options.json !== undefined) {
            if (options.body !== undefined) throw new Error("Local HTTP fixture cannot fulfill with both body and json.");
            outputBody = JSON.stringify(options.json);
            outputHeaders["content-type"] ??= "application/json";
          }
          if (options.contentType) outputHeaders["content-type"] = options.contentType;
          // Server work may finish after a client's intentional AbortController
          // cancellation. Preserve that work for the next receipt/status query;
          // never manufacture a successful response for the cancelled fetch.
          if (response.destroyed || response.writableEnded) return;
          response.writeHead(options.status ?? 200, { ...outputHeaders, ...corsHeaders(entry.origin),
            vary: [outputHeaders.vary, "Origin"].filter(Boolean).join(", "),
          });
          response.end(outputBody);
        },
      });
      if (!fulfilled) throw new Error("Local HTTP fixture handler returned without fulfill().");
      entry.finish();
    } catch (error) {
      // Reject the page.route callback so Playwright fails the test with the
      // actual assertion/handler error, instead of silently returning HTTP 500.
      entry.finish(error);
      response.destroy();
    }
  };

  const server = createServer((request, response) => { void receive(request, response); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local HTTP fixture failed to acquire a loopback port.");
  const origin = `http://127.0.0.1:${address.port}`;

  const onFailed = (request: Request) => {
    for (const entry of pending.values()) {
      // Once the socket received a request, its server operation owns completion.
      if (entry.original === request && !entry.received) entry.finish();
    }
  };
  const routeHandler = async (route: Route) => {
    const original = route.request();
    const url = localHttpUrl(original.url());
    const headers = await original.allHeaders();
    const requestOrigin = headers.origin ?? url.origin;
    localHttpUrl(requestOrigin);
    const id = randomUUID();
    let finish!: PendingRequest["finish"];
    const completed = new Promise<void>((resolve, reject) => {
      finish = error => { pending.delete(id); if (error === undefined) resolve(); else reject(error); };
    });
    // Request.url() itself changes after route.continue({ url }); snapshot it.
    pending.set(id, { original, url: url.href, method: original.method(), headers, origin: requestOrigin, received: false, finish });
    try {
      await Promise.all([
        completed,
        // Supplying postData here would hide exactly the Blob regression these
        // tests need to detect. The browser must send its existing body itself.
        route.continue({ url: `${origin}${url.pathname}${url.search}`, headers: { ...headers, [CORRELATION_HEADER]: id } }),
      ]);
    } finally { pending.delete(id); }
  };
  const closeServer = () => {
    for (const entry of pending.values()) entry.finish();
    server.closeAllConnections();
    return new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
  };
  const onClose = () => {
    if (disposed) return;
    disposed = true;
    page.off("requestfailed", onFailed);
    void closeServer();
  };
  page.on("requestfailed", onFailed);
  page.once("close", onClose);
  try { await page.route(pattern, routeHandler); }
  catch (error) { onClose(); throw error; }

  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      page.off("close", onClose);
      page.off("requestfailed", onFailed);
      await page.unroute(pattern, routeHandler);
      await closeServer();
    },
  };
}
