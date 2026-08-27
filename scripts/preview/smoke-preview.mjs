import assert from "node:assert/strict";
import process from "node:process";

const baseUrl = String(process.env.MAONO_PREVIEW_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");
const cookie = String(process.env.MAONO_PREVIEW_SESSION_COOKIE || "").trim();
const goldenSlug = String(
  process.env.MAONO_PREVIEW_GOLDEN_PROJECT_SLUG || "qa-geojson-golden",
).trim();

if (!baseUrl) {
  console.error("Defina MAONO_PREVIEW_BASE_URL para executar o smoke Preview.");
  process.exit(1);
}

async function get(pathname, { authenticated = false } = {}) {
  const headers = { Accept: "application/json" };
  if (authenticated && cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers,
    redirect: "manual",
  });
}

const health = await get("/api/health");
assert.equal(health.status, 200, `health status=${health.status}`);
const healthBody = await health.json();
assert.equal(healthBody?.runtime?.preview, true, "runtime deve ser Preview");
assert.equal(
  health.headers.get("x-maono-runtime-env"),
  "preview",
  "middleware Preview deve estar ativo",
);
assert.equal(healthBody?.checks?.databaseReachable, true, "D1 deve responder");

console.log("[preview-smoke] health/runtime: OK");

if (!cookie) {
  console.log(
    "[preview-smoke] MAONO_PREVIEW_SESSION_COOKIE ausente; smoke autenticado foi ignorado.",
  );
  process.exit(0);
}

const projects = await get("/api/projects", { authenticated: true });
assert.equal(projects.status, 200, `projects status=${projects.status}`);
const projectsBody = await projects.json();
assert.ok(Array.isArray(projectsBody?.projects), "lista de projetos inválida");

const golden = projectsBody.projects.find(
  (project) => String(project?.slug || "") === goldenSlug,
);
assert.ok(golden, `projeto Golden ${goldenSlug} não encontrado`);

console.log("[preview-smoke] projeto Golden listado: OK");

const stream = await get(
  `/api/projects/${encodeURIComponent(goldenSlug)}/config-stream`,
  { authenticated: true },
);
assert.equal(stream.status, 200, `config-stream status=${stream.status}`);
assert.equal(
  stream.headers.get("x-maono-runtime-env"),
  "preview",
  "config-stream deve passar pelo middleware Preview",
);
assert.equal(
  stream.headers.get("x-maono-config-transport"),
  "stream",
  "config-stream deve usar transporte streaming",
);

if (stream.body) {
  const reader = stream.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false, "config-stream não retornou bytes");
  assert.ok(first.value?.byteLength > 0, "primeiro chunk do config está vazio");
  await reader.cancel();
}

console.log("[preview-smoke] config-stream Golden: OK");
