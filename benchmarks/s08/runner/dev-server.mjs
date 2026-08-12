import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createServer as createViteServer } from "vite";

import { normalizeBenchmarkResult } from "../lib/result-schema.mjs";

const DATA_ROOT = path.resolve(process.cwd(), ".benchmark-data/s08");
const FIXTURE_PREFIX = "/__s08_fixture__/";
const RESULT_ENDPOINT = "/__s08_results__";
const MAX_RESULT_BYTES = 512 * 1024;

function parseArgs(argv) {
  const options = { host: "0.0.0.0", port: 4174 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--host") options.host = argv[++index] || options.host;
    else if (argv[index] === "--port") options.port = Number(argv[++index] || options.port);
  }
  return options;
}

function contentType(filePath) {
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeFixturePath(pathname) {
  const relative = pathname.slice(FIXTURE_PREFIX.length);
  if (!relative || relative.includes("..") || relative.includes("\\")) return null;
  if (!/^(?:manifest\.json|fixtures\/[a-zA-Z0-9._-]+\.json)$/.test(relative)) return null;
  return path.join(DATA_ROOT, relative);
}

async function readRequestBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_RESULT_BYTES) throw new Error("Resultado S08 excede o limite local.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function s08LocalPlugin() {
  return {
    name: "maono-s08-local-benchmark",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const requestUrl = new URL(req.url || "/", "http://s08.local");
          const pathname = requestUrl.pathname;

          if (req.method === "GET" && pathname.startsWith(FIXTURE_PREFIX)) {
            const filePath = safeFixturePath(pathname);
            if (!filePath) {
              res.statusCode = 400;
              res.end("Invalid S08 fixture path");
              return;
            }
            try {
              const info = await stat(filePath);
              if (!info.isFile()) throw new Error("not-file");
              const bytes = await readFile(filePath);
              res.statusCode = 200;
              res.setHeader("Content-Type", contentType(filePath));
              res.setHeader("Content-Length", String(bytes.byteLength));
              res.setHeader("Cache-Control", "no-store");
              res.end(bytes);
            } catch {
              res.statusCode = 404;
              res.end("Fixture S08 not found. Run npm run benchmark:s08:generate first.");
            }
            return;
          }

          if (req.method === "POST" && pathname === RESULT_ENDPOINT) {
            const body = await readRequestBody(req);
            const result = normalizeBenchmarkResult(JSON.parse(body));
            const resultsDir = path.join(DATA_ROOT, "results");
            await mkdir(resultsDir, { recursive: true });
            const resultFile = path.join(resultsDir, `${result.deviceClass}.jsonl`);
            await appendFile(resultFile, `${JSON.stringify(result)}\n`, "utf8");
            res.statusCode = 201;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, runId: result.runId }));
            return;
          }

          next();
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
        }
      });
    },
  };
}

async function main() {
  const { host, port } = parseArgs(process.argv.slice(2));
  const server = await createViteServer({
    root: process.cwd(),
    server: { host, port },
    plugins: [s08LocalPlugin()],
  });
  await server.listen();
  server.printUrls();
  console.log(`[S08] Harness: http://localhost:${port}/benchmarks/s08/index.html`);
  console.log(`[S08] Corpus local: ${DATA_ROOT}`);
}

main().catch((error) => {
  console.error("[S08] Falha ao iniciar harness:", error);
  process.exitCode = 1;
});
