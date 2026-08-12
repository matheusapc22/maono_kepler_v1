import { createReadStream } from "node:fs";
import { appendFile, mkdir, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { build as viteBuild } from "vite";

import { normalizeBenchmarkResult } from "../lib/result-schema.mjs";
import benchmarkViteConfig from "../vite.config.mjs";

const DATA_ROOT = path.resolve(process.cwd(), ".benchmark-data/s08");
const BUILD_ROOT = path.resolve(process.cwd(), ".benchmark-data/s08-build");
const FIXTURE_PREFIX = "/__s08_fixture__/";
const RESULT_ENDPOINT = "/__s08_results__";
const HARNESS_PATH = "/benchmarks/s08/index.html";
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
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".wasm") return "application/wasm";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".woff2") return "font/woff2";
  if (extension === ".ttf") return "font/ttf";
  return "application/octet-stream";
}

function safeFixturePath(pathname) {
  const relative = pathname.slice(FIXTURE_PREFIX.length);
  if (!relative || relative.includes("..") || relative.includes("\\")) return null;
  if (!/^(?:manifest\.json|fixtures\/[a-zA-Z0-9._-]+\.json)$/.test(relative)) return null;
  return path.join(DATA_ROOT, relative);
}

function safeBuildPath(pathname) {
  const relative = pathname === "/" ? HARNESS_PATH.slice(1) : pathname.replace(/^\/+/, "");
  if (!relative || relative.includes("..") || relative.includes("\\")) return null;
  const resolved = path.resolve(BUILD_ROOT, relative);
  const rootPrefix = `${BUILD_ROOT}${path.sep}`;
  return resolved.startsWith(rootPrefix) ? resolved : null;
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

async function streamFile(res, filePath, { cacheControl = "no-store" } = {}) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not-file");
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType(filePath));
  res.setHeader("Content-Length", String(info.size));
  res.setHeader("Cache-Control", cacheControl);
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.once("error", reject);
    res.once("error", reject);
    res.once("finish", resolve);
    stream.pipe(res);
  });
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url || "/", "http://s08.local");
  const pathname = requestUrl.pathname;

  try {
    if (req.method === "GET" && pathname.startsWith(FIXTURE_PREFIX)) {
      const filePath = safeFixturePath(pathname);
      if (!filePath) {
        res.statusCode = 400;
        res.end("Invalid S08 fixture path");
        return;
      }
      try {
        await streamFile(res, filePath, {
          cacheControl: pathname.endsWith("manifest.json")
            ? "no-store"
            : "public, max-age=3600, immutable",
        });
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
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: true, runId: result.runId }));
      return;
    }

    if (req.method === "GET") {
      const filePath = safeBuildPath(pathname);
      if (filePath) {
        try {
          await streamFile(res, filePath, {
            cacheControl: pathname.startsWith("/assets/")
              ? "public, max-age=3600, immutable"
              : "no-store",
          });
          return;
        } catch {
          // Continua para 404 abaixo.
        }
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("S08 resource not found");
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  }
}

async function main() {
  const { host, port } = parseArgs(process.argv.slice(2));
  console.log("[S08] Gerando bundle de produção do harness...");
  await viteBuild(benchmarkViteConfig);

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`[S08] Harness: http://localhost:${port}${HARNESS_PATH}`);
  console.log(`[S08] Corpus local: ${DATA_ROOT}`);
}

main().catch((error) => {
  console.error("[S08] Falha ao iniciar harness:", error);
  process.exitCode = 1;
});
