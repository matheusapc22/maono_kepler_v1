import { MAX_MUTATION_BUDGET_MS } from "./execution-budget.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const CF_API_ORIGIN = "https://api.cloudflare.com";
export const CF_ACCOUNT_ID = "09d455fa1cf988b0d9db89987b73eaff";
export const CF_PROJECT_NAME = "maono-kepler-v1";
export const PRODUCT_BRANCH = "mano_kepler_v1";
export const PRODUCTION_D1_ID = "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db";
export const PRODUCTION_APP_ORIGIN = "https://maono-kepler-v1.pages.dev";
export const RUNTIME_READINESS_LIMITS = Object.freeze({ attempts: 12, timeoutMs: 180_000, requestMs: 10_000, intervalMs: 5_000, responseBytes: 16 * 1024 });

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DURABLE_SAVE_FLAGS = new Set(["PROJECT_DURABLE_SAVE_V1", "PROJECT_DURABLE_SAVE_INLINE_ENABLED"]);
const PREVIEW_FLAGS = new Set(["PROJECT_PREVIEW_OPERATIONS_V1", "PROJECT_PREVIEW_PROCESSOR_ENABLED", "VITE_PROJECT_PREVIEW_OPERATIONS_V1"]);
const TERMINAL = new Set(["success", "failure", "canceled"]);
const BACKEND_CODE = /^[A-Z0-9_]{1,120}$/;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
const CF_RAY = /^[0-9a-f]{16}(?:-[A-Z]{3})?$/;
const CLOUDFLARE_ERROR_CODES = new Set(["1027", "1101", "1102"]);
const RESPONSE_FORMATS = new Set(["json", "non-json", "invalid-json"]);

function matchesWholeString(value, pattern) {
  // JavaScript's $ also matches before a final newline; identifiers must match
  // the entire original value, without trimming or accepting control characters.
  return typeof value === "string" && pattern.exec(value)?.[0] === value;
}

// Acceptance reports retain only bounded identifiers, never backend messages,
// response bodies, arbitrary headers, provider details or request credentials.
function safeHttpEvidence(value = {}) {
  const evidence = {};
  if (Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) evidence.httpStatus = value.httpStatus;
  if (matchesWholeString(value?.backendCode, BACKEND_CODE)) evidence.backendCode = value.backendCode;
  for (const field of ["correlationId", "headerCorrelationId"]) {
    if (matchesWholeString(value?.[field], CORRELATION_ID)) evidence[field] = value[field];
  }
  if (evidence.headerCorrelationId === evidence.correlationId) delete evidence.headerCorrelationId;
  if (RESPONSE_FORMATS.has(value?.responseFormat)) evidence.responseFormat = value.responseFormat;
  if (matchesWholeString(value?.cfRay, CF_RAY)) evidence.cfRay = value.cfRay;
  if (evidence.responseFormat === "non-json" && evidence.httpStatus >= 400 && evidence.cfRay && CLOUDFLARE_ERROR_CODES.has(value?.cloudflareErrorCode)) evidence.cloudflareErrorCode = value.cloudflareErrorCode;
  return evidence;
}

function cloudflareErrorCode(response, cfRay) {
  if (response?.responseFormat !== "non-json" || typeof response?.body !== "string" || !matchesWholeString(cfRay, CF_RAY) || response?.status < 400) return undefined;
  // Match only a known error marker within a bounded prefix already read by
  // appRequest. A resource-limit code is evidence, not a CPU/memory diagnosis.
  const prefix = response.body.slice(0, 16 * 1024);
  const html = prefix.match(/<span\s+class=["']cf-error-code["']\s*>\s*(1027|1101|1102)\s*<\/span>/i);
  const heading = prefix.match(/<(?:title|h1)\b[^>]{0,200}>\s*Error\s+(1027|1101|1102)(?=[\s:<])/i);
  const text = prefix.match(/(?:^|\n)[ \t]*error(?:[ \t]+code)?[ \t]*:[ \t]*(1027|1101|1102)(?=\s|$)/i);
  return html?.[1] || heading?.[1] || text?.[1];
}

export function assertHttpResponse(response, condition, message, code = "ACCEPTANCE_ASSERTION_FAILED") {
  if (condition) return;
  const cfRay = response?.headers?.get?.("CF-Ray");
  fail(code, message, {
    httpStatus: response?.status,
    backendCode: response?.body?.error?.code,
    correlationId: response?.body?.error?.correlationId,
    headerCorrelationId: response?.headers?.get?.("X-Correlation-Id"),
    responseFormat: response?.responseFormat,
    cfRay,
    cloudflareErrorCode: cloudflareErrorCode(response, cfRay),
  });
}

export class AcceptanceError extends Error {
  constructor(code, message, httpEvidence = {}) {
    super(message);
    this.name = "AcceptanceError";
    this.code = code;
    this.httpEvidence = safeHttpEvidence(httpEvidence);
  }
}

export function fail(code, message, httpEvidence) {
  throw new AcceptanceError(code, message, httpEvidence);
}

export function safeError(error) {
  return error instanceof AcceptanceError || error?.name === "AcceptanceBudgetError"
    ? { code: error.code, message: error.message, ...safeHttpEvidence(error instanceof AcceptanceError ? error.httpEvidence : null) }
    : { code: "ACCEPTANCE_UNEXPECTED", message: "Falha inesperada no operador; revise o relatório antes de repetir." };
}

export function positiveInt(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail("ARGUMENT_INVALID", `${label} deve ser inteiro positivo.`);
  return number;
}

export function expectedCommit(value) {
  const sha = String(value || "").toLowerCase();
  if (!SHA40.test(sha)) fail("EXPECTED_COMMIT_INVALID", "O commit esperado deve ter 40 caracteres hexadecimais.");
  return sha;
}

export function parseArgs(argv) {
  const allowed = new Set(["mode", "suite", "organization-id", "project-slug", "expected-commit", "report"]);
  const raw = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) fail("ARGUMENT_INVALID", "Use apenas opções nomeadas com --.");
    const key = token.slice(2);
    if (!allowed.has(key) || Object.hasOwn(raw, key)) fail("ARGUMENT_INVALID", `Opção inválida ou repetida: --${key}.`);
    const value = argv[++i];
    if (!value || value.startsWith("--")) fail("ARGUMENT_INVALID", `Valor ausente para --${key}.`);
    raw[key] = value;
  }
  const mode = raw.mode || "describe";
  if (!["describe", "preflight", "run", "closure"].includes(mode)) fail("MODE_INVALID", "mode inválido.");
  const suite = String(raw.suite || "").trim();
  if (!SAFE_ID.test(suite)) fail("SUITE_INVALID", "Suite inválida.");
  if (mode === "describe") return { mode, suite };
  return {
    mode,
    suite,
    organizationId: positiveInt(raw["organization-id"], "organization-id"),
    projectSlug: raw["project-slug"] ? String(raw["project-slug"]).trim() : null,
    expectedCommit: expectedCommit(raw["expected-commit"]),
    reportPath: resolve(String(raw.report || "")),
  };
}

export function validateManifest(manifest) {
  if (manifest?.mutationBudgetMs !== undefined && (!Number.isSafeInteger(manifest.mutationBudgetMs) || manifest.mutationBudgetMs <= 0 || manifest.mutationBudgetMs > MAX_MUTATION_BUDGET_MS)) fail("MANIFEST_INVALID", "mutationBudgetMs fora do limite revisado.");
  if (!manifest || !SAFE_ID.test(manifest.id || "")) fail("MANIFEST_INVALID", "Suite sem id válido.");
  if (!["read_only", "controlled_mutation"].includes(manifest.mutationMode)) fail("MANIFEST_INVALID", "mutationMode inválido.");
  if (!Array.isArray(manifest.requiredProfiles)) fail("MANIFEST_INVALID", "requiredProfiles deve ser array.");
  if (manifest.requiredRoles && (typeof manifest.requiredRoles !== "object" || Array.isArray(manifest.requiredRoles) ||
      Object.entries(manifest.requiredRoles).some(([name, role]) => !manifest.requiredProfiles.includes(name) || !["viewer", "editor", "admin", "super_admin"].includes(role)))) {
    fail("MANIFEST_INVALID", "requiredRoles deve identificar perfis registrados e papéis conhecidos.");
  }
  if (manifest.requiredOrganization && (!Number.isSafeInteger(manifest.requiredOrganization.id) || manifest.requiredOrganization.id < 1 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.requiredOrganization.slug || ""))) {
    fail("MANIFEST_INVALID", "requiredOrganization deve fixar id e slug válidos.");
  }
  if (!Array.isArray(manifest.cases) || !manifest.cases.length) fail("MANIFEST_INVALID", "A suite deve declarar casos.");
  if (!manifest.managedFlags || typeof manifest.managedFlags !== "object" || Array.isArray(manifest.managedFlags)) fail("MANIFEST_INVALID", "managedFlags inválido.");
  if (manifest.mutationMode === "read_only" && Object.keys(manifest.managedFlags).length) fail("MANIFEST_INVALID", "Suite read_only não pode alterar flags.");
  for (const [name, cfg] of Object.entries(manifest.managedFlags)) {
    if (!/^MAONO_[A-Z0-9_]+$/.test(name) && !DURABLE_SAVE_FLAGS.has(name) && !(manifest.id === "durable-project-preview" && PREVIEW_FLAGS.has(name))) fail("MANIFEST_INVALID", `Flag inválida: ${name}.`);
    for (const key of ["requiredBefore", "activeValue", "safeValue"]) {
      if (typeof cfg?.[key] !== "boolean") fail("MANIFEST_INVALID", `${name}.${key} deve ser boolean.`);
    }
  }
  return manifest;
}

function readFlag(entry) {
  if (!entry) return { state: "absent", value: null };
  if (entry.type !== "plain_text" || typeof entry.value !== "string") return { state: "not_plain_text", value: null };
  const value = entry.value.trim().toLowerCase();
  if (!["true", "false"].includes(value)) return { state: "invalid", value: null };
  return { state: "observed", value: value === "true" };
}

export function flagSnapshot(container, names) {
  return Object.fromEntries(names.map((name) => [name, readFlag(container?.[name])]));
}

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function deploymentSummary(deployment, flagNames) {
  const meta = deployment?.deployment_trigger?.metadata;
  return {
    id: typeof deployment?.id === "string" ? deployment.id : null,
    environment: deployment?.environment || null,
    url: httpsOrigin(deployment?.url),
    commit: SHA40.test(meta?.commit_hash || "") ? meta.commit_hash.toLowerCase() : null,
    commitDirty: typeof meta?.commit_dirty === "boolean" ? meta.commit_dirty : null,
    stage: deployment?.latest_stage?.name || null,
    status: deployment?.latest_stage?.status || null,
    isSkipped: deployment?.is_skipped === true,
    flags: flagSnapshot(deployment?.env_vars || {}, flagNames),
  };
}

async function apiJson(response, code) {
  let envelope;
  try { envelope = await response.json(); } catch { fail(code, "Resposta Cloudflare inválida."); }
  if (!response.ok || envelope?.success !== true || envelope?.result == null) fail(code, `Cloudflare recusou a operação (HTTP ${response.status}).`);
  return envelope.result;
}

export async function cfRequest(token, path, { method = "GET", body = null, fetchImpl = fetch, budget = null } = {}) {
  if (!token) fail("CLOUDFLARE_TOKEN_MISSING", "Secret Cloudflare do acceptance ausente.");
  const url = new URL(path, CF_API_ORIGIN);
  if (url.origin !== CF_API_ORIGIN) fail("CLOUDFLARE_URL_INVALID", "Origem Cloudflare inválida.");
  const response = await fetchImpl(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(budget ? budget.requestTimeoutMs(30_000) : 30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await apiJson(response, "CLOUDFLARE_API_FAILED");
  budget?.assertActive();
  return result;
}

function projectPath() {
  return `/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PROJECT_NAME}`;
}

export async function readProduction(token, manifest, deps = {}) {
  const names = Object.keys(manifest.managedFlags);
  const [project, deployments] = await Promise.all([
    cfRequest(token, projectPath(), deps),
    cfRequest(token, `${projectPath()}/deployments?env=production&per_page=25`, deps),
  ]);
  if (!Array.isArray(deployments)) fail("PRODUCTION_DEPLOYMENTS_INVALID", "Cloudflare não retornou a fila de Produção.");
  const production = project?.deployment_configs?.production;
  const productionDeployments = deployments.map((value) => deploymentSummary(value, names));
  const pendingProductionDeployments = productionDeployments.filter(
    (value) => value.isSkipped !== true && !TERMINAL.has(value.status),
  );
  return {
    raw: project,
    name: project?.name || null,
    productionBranch: project?.production_branch || null,
    baseUrl: project?.subdomain ? httpsOrigin(`https://${project.subdomain}`) : null,
    databaseId: production?.d1_databases?.DB?.id || null,
    configuredFlags: flagSnapshot(production?.env_vars || {}, names),
    canonical: deploymentSummary(project?.canonical_deployment, names),
    productionDeployments,
    pendingProductionDeployments,
  };
}

export function assertProduction(project, commit, manifest, { requireBaseline = true } = {}) {
  const sha = expectedCommit(commit);
  if (project.name !== CF_PROJECT_NAME) fail("PRODUCTION_PROJECT_MISMATCH", "Projeto Pages inesperado.");
  if (project.productionBranch !== PRODUCT_BRANCH) fail("PRODUCTION_BRANCH_MISMATCH", "Branch de Produção inesperada.");
  if (project.databaseId !== PRODUCTION_D1_ID) fail("PRODUCTION_D1_MISMATCH", "Binding D1 de Produção inesperado.");
  if (!project.baseUrl) fail("PRODUCTION_URL_UNCONFIRMED", "URL de Produção não confirmada.");
  if ((project.pendingProductionDeployments || []).length > 0) {
    fail("PRODUCTION_DEPLOYMENT_IN_PROGRESS", "Há deployment de Produção não-terminal; nenhuma mudança de flag pode começar.");
  }
  const d = project.canonical;
  if (d.environment !== "production" || d.stage !== "deploy" || d.status !== "success" || d.commit !== sha || d.commitDirty !== false) {
    fail("PRODUCTION_DEPLOYMENT_MISMATCH", "Deployment canônico não corresponde ao SHA esperado.");
  }
  if (requireBaseline) {
    for (const [name, cfg] of Object.entries(manifest.managedFlags)) {
      const configured = project.configuredFlags[name];
      const deployed = d.flags[name];
      if (configured?.state !== "observed" || deployed?.state !== "observed" ||
          configured.value !== cfg.requiredBefore || deployed.value !== cfg.requiredBefore) {
        fail("PRODUCTION_FLAG_BASELINE_MISMATCH", `Flag ${name} fora do baseline obrigatório.`);
      }
    }
  }
  return true;
}

export async function waitProductionQuiescent(token, manifest, {
  timeoutMs = 50 * 60_000,
  intervalMs = 15_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  ...deps
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const project = await readProduction(token, manifest, deps);
    if (project.pendingProductionDeployments.length === 0) return project;
    if (deps.budget) await deps.budget.pause(intervalMs, sleep);
    else await sleep(intervalMs);
  }
  fail("PRODUCTION_DEPLOYMENT_QUEUE_TIMEOUT", "A fila de Produção não ficou quiescente dentro da janela.");
}

export async function patchFlags(token, values, deps = {}) {
  const env_vars = Object.fromEntries(Object.entries(values).map(([name, value]) => [
    name, { type: "plain_text", value: value ? "true" : "false" },
  ]));
  await cfRequest(token, projectPath(), {
    ...deps,
    method: "PATCH",
    body: { deployment_configs: { production: { env_vars } } },
  });
}

export async function retryDeployment(token, deploymentId, deps = {}) {
  if (!deploymentId || !SAFE_ID.test(deploymentId)) fail("DEPLOYMENT_ID_INVALID", "Deployment base inválido.");
  return cfRequest(token, `${projectPath()}/deployments/${encodeURIComponent(deploymentId)}/retry`, {
    ...deps,
    method: "POST",
  });
}

export async function readDeployment(token, deploymentId, manifest, deps = {}) {
  const value = await cfRequest(token, `${projectPath()}/deployments/${encodeURIComponent(deploymentId)}`, deps);
  return deploymentSummary(value, Object.keys(manifest.managedFlags));
}

export async function waitDeployment(token, deploymentId, manifest, {
  timeoutMs = 42 * 60_000,
  intervalMs = 15_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  ...deps
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const d = await readDeployment(token, deploymentId, manifest, deps);
    if (TERMINAL.has(d.status)) {
      if (d.status !== "success" || d.stage !== "deploy") fail("PRODUCTION_DEPLOYMENT_FAILED", "Deployment do acceptance falhou.");
      return d;
    }
    if (deps.budget) await deps.budget.pause(intervalMs, sleep);
    else await sleep(intervalMs);
  }
  fail("PRODUCTION_DEPLOYMENT_TIMEOUT", "Deployment do acceptance não terminou dentro da janela.");
}

export async function waitCanonical(token, deploymentId, commit, manifest, desired, {
  timeoutMs = 5 * 60_000,
  intervalMs = 5_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  ...deps
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const project = await readProduction(token, manifest, deps);
    if (project.canonical.id === deploymentId) {
      assertProduction(project, commit, manifest, { requireBaseline: false });
      for (const [name, value] of Object.entries(desired)) {
        if (project.configuredFlags[name]?.state !== "observed" || project.canonical.flags[name]?.state !== "observed" ||
            project.configuredFlags[name].value !== value || project.canonical.flags[name].value !== value) {
          fail("PRODUCTION_FLAG_DEPLOYMENT_MISMATCH", `Flag ${name} não foi publicada como esperado.`);
        }
      }
      return project;
    }
    if (deps.budget) await deps.budget.pause(intervalMs, sleep);
    else await sleep(intervalMs);
  }
  fail("PRODUCTION_CANONICAL_TIMEOUT", "Novo deployment não se tornou canônico.");
}

export async function transitionFlags({
  token,
  sourceDeploymentId,
  commit,
  manifest,
  values,
  deps = {},
  onMutationStart = () => {},
  validateCurrent = () => {},
  expectedOrigin = PRODUCTION_APP_ORIGIN,
  onRuntimeObservation = () => {},
}) {
  const current = await waitProductionQuiescent(token, manifest, deps);
  // A queued deployment may have changed the canonical product since preflight.
  // Never patch configuration or retry an old SHA across that drift.
  assertProduction(current, commit, manifest, { requireBaseline: false });
  assertRuntimeOrigin(current.baseUrl, expectedOrigin, manifest);
  validateCurrent(current);
  onMutationStart();
  await patchFlags(token, values, deps);
  // Re-check after the config change. If another Production deployment appeared
  // in the narrow race, wait for terminality before creating our retry.
  await waitProductionQuiescent(token, manifest, deps);
  const retried = await retryDeployment(token, sourceDeploymentId, deps);
  if (!retried?.id) fail("PRODUCTION_RETRY_UNCONFIRMED", "Cloudflare não retornou id do novo deployment.");
  const deployment = await waitDeployment(token, retried.id, manifest, deps);
  if (deployment.commit !== commit || deployment.commitDirty !== false || deployment.environment !== "production") {
    fail("PRODUCTION_RETRY_COMMIT_MISMATCH", "Deployment recriado não corresponde ao SHA esperado.");
  }
  const project = await waitCanonical(token, retried.id, commit, manifest, values, deps);
  assertRuntimeOrigin(project.baseUrl, expectedOrigin, manifest);
  const runtimeReadiness = await waitRuntimeReadiness(project.baseUrl, manifest, values, { ...deps, onRuntimeObservation });
  return { project, deployment, runtimeReadiness };
}

function durableRuntimeFlags(manifest) {
  return [...DURABLE_SAVE_FLAGS].filter(name => Object.hasOwn(manifest.managedFlags, name));
}

function assertRuntimeOrigin(baseUrl, expectedOrigin, manifest) {
  if (durableRuntimeFlags(manifest).length && (baseUrl !== PRODUCTION_APP_ORIGIN || baseUrl !== expectedOrigin)) {
    fail("PRODUCTION_RUNTIME_ORIGIN_MISMATCH", "A origem pública do runtime divergiu da origem canônica fixada.");
  }
}

async function readRuntimeHealth(baseUrl, { fetchImpl, budget, signal, requestMs }) {
  if (signal?.aborted) return { state: "aborted" };
  const timeoutMs = budget ? budget.requestTimeoutMs(requestMs) : requestMs;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  let reader;
  let onAbort;
  const stopped = new Promise((_, reject) => {
    onAbort = () => reject(new DOMException("Runtime health request stopped", "AbortError"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  const bounded = promise => Promise.race([promise, stopped]);
  try {
    controller.signal.throwIfAborted();
    const url = new URL("/api/health", baseUrl);
    // This public read deliberately has no Cloudflare token or QA session.
    const response = await bounded(fetchImpl(url, { method: "GET", redirect: "error", credentials: "omit",
      cache: "no-store", referrerPolicy: "no-referrer", headers: { Accept: "application/json" }, signal: controller.signal }));
    if (response.redirected || (response.url && response.url !== url.href)) return { state: "invalid_response" };
    if (response.status !== 200) return { state: "http_error" };
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "") ||
        !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get("cache-control") || "")) return { state: "invalid_response" };
    if (Number(response.headers.get("content-length")) > RUNTIME_READINESS_LIMITS.responseBytes) return { state: "response_too_large" };
    reader = response.body?.getReader();
    if (!reader) return { state: "invalid_response" };
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await bounded(reader.read());
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RUNTIME_READINESS_LIMITS.responseBytes) return { state: "response_too_large" };
      chunks.push(value);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return { state: "invalid_response" }; }
    const runtime = body?.runtime;
    if (body?.service !== CF_PROJECT_NAME || typeof runtime?.durableProjectSaveEnabled !== "boolean" ||
        typeof runtime?.durableProjectSaveInlineEnabled !== "boolean") return { state: "invalid_response" };
    const flags = { durableProjectSaveEnabled: runtime.durableProjectSaveEnabled, durableProjectSaveInlineEnabled: runtime.durableProjectSaveInlineEnabled };
    if (runtime.runtime !== "production") return { state: "runtime_mismatch", ...flags };
    if (body.ok !== true || body.checks?.dbBinding !== true || body.checks?.databaseReachable !== true) return { state: "unhealthy", ...flags };
    return { state: "observed", ...flags };
  } catch {
    return { state: signal?.aborted ? "aborted" : controller.signal.aborted ? "request_timeout" : "transport_error" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
    if (reader) void reader.cancel().catch(() => {});
    controller.abort();
  }
}

export async function waitRuntimeReadiness(baseUrl, manifest, desired, {
  fetchImpl = fetch, budget = null, signal, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRuntimeObservation = () => {},
} = {}) {
  const managed = durableRuntimeFlags(manifest);
  if (!managed.length) return { state: "not_applicable" };
  assertRuntimeOrigin(baseUrl, PRODUCTION_APP_ORIGIN, manifest);
  const fields = { PROJECT_DURABLE_SAVE_V1: "durableProjectSaveEnabled", PROJECT_DURABLE_SAVE_INLINE_ENABLED: "durableProjectSaveInlineEnabled" };
  if (managed.some(name => typeof desired[name] !== "boolean")) fail("PRODUCTION_RUNTIME_FLAGS_INVALID", "Estado esperado do runtime inválido.");
  const deadline = now() + RUNTIME_READINESS_LIMITS.timeoutMs;
  for (let attempt = 1; attempt <= RUNTIME_READINESS_LIMITS.attempts && now() < deadline; attempt++) {
    budget?.assertActive();
    const observed = await readRuntimeHealth(baseUrl, { fetchImpl, budget, signal,
      requestMs: Math.max(1, Math.min(RUNTIME_READINESS_LIMITS.requestMs, deadline - now())) });
    if (observed.state === "observed") observed.state = managed.every(name => observed[fields[name]] === desired[name]) ? "matched" : "flags_mismatch";
    const evidence = { ...observed, attempts: attempt, scope: "durable_save_flags_only", deploymentIdentityVerified: false, previewFlagsVerified: false };
    onRuntimeObservation(evidence);
    budget?.assertActive();
    if (signal?.aborted) fail("PRODUCTION_RUNTIME_READINESS_ABORTED", "Leitura de runtime interrompida; restauração continua independente.");
    if (now() >= deadline) break;
    if (observed.state === "matched") return evidence;
    if (attempt < RUNTIME_READINESS_LIMITS.attempts) {
      const pause = Math.min(RUNTIME_READINESS_LIMITS.intervalMs, deadline - now());
      if (budget) await budget.pause(pause, sleep);
      else await sleep(pause);
    }
  }
  fail("PRODUCTION_RUNTIME_READINESS_FAILED", "O runtime público não confirmou as flags duráveis dentro dos limites de leitura.");
}

export function activeFlags(manifest) {
  return Object.fromEntries(Object.entries(manifest.managedFlags).map(([name, cfg]) => [name, cfg.activeValue]));
}

export function safeFlags(manifest) {
  return Object.fromEntries(Object.entries(manifest.managedFlags).map(([name, cfg]) => [name, cfg.safeValue]));
}

function credential(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    typeof value.email === "string" && value.email.trim() &&
    typeof value.password === "string" && value.password;
}

export function parseCredentials(raw, requiredProfiles) {
  let parsed;
  try { parsed = JSON.parse(String(raw || "")); } catch { fail("QA_CREDENTIALS_INVALID", "Secret QA não é JSON válido."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("QA_CREDENTIALS_INVALID", "Secret QA deve ser objeto.");
  const output = {};
  for (const name of requiredProfiles) {
    if (!credential(parsed[name])) fail("QA_CREDENTIALS_MISSING", `Credencial QA ausente: ${name}.`);
    output[name] = { email: parsed[name].email.trim().toLowerCase(), password: parsed[name].password };
  }
  return output;
}

function cookieFromHeader(value) {
  const match = String(value || "").match(/(?:^|,\s*)maono_session=([^;,\s]+)/i);
  if (!match?.[1]) fail("QA_LOGIN_COOKIE_MISSING", "Login QA não retornou sessão.");
  return `maono_session=${match[1]}`;
}

export async function appRequest(baseUrl, path, {
  method = "GET",
  cookie = null,
  json = undefined,
  body = undefined,
  headers = {},
  fetchImpl = fetch,
  timeoutMs = 30_000,
  budget = null,
} = {}) {
  const base = new URL(baseUrl);
  const url = new URL(path, base);
  if (url.origin !== base.origin) fail("QA_REQUEST_ORIGIN_INVALID", "Suite tentou acessar origem diferente de Produção.");
  const response = await fetchImpl(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(budget ? budget.requestTimeoutMs(timeoutMs) : timeoutMs),
    headers: {
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    ...(body !== undefined ? { body } : {}),
  });
  const type = response.headers.get("content-type") || "";
  const readFailure = (error, fallback) => {
    if (["AbortError", "TimeoutError"].includes(error?.name)) throw error;
    return fallback;
  };
  let payload, responseFormat;
  if (type.includes("application/json")) {
    try { payload = await response.json(); responseFormat = "json"; }
    catch (error) { payload = readFailure(error, null); responseFormat = "invalid-json"; }
  } else {
    payload = await response.text().catch((error) => readFailure(error, ""));
    responseFormat = "non-json";
  }
  budget?.assertActive();
  return { status: response.status, ok: response.ok, headers: response.headers, body: payload, responseFormat };
}

export async function loginProfile(baseUrl, credentials, organizationId, deps = {}) {
  const login = await appRequest(baseUrl, "/api/auth/login", {
    ...deps, method: "POST", json: { email: credentials.email, password: credentials.password },
  });
  assertHttpResponse(login, login.status === 200, `Login QA recusado (HTTP ${login.status}).`, "QA_LOGIN_FAILED");
  const cookie = cookieFromHeader(login.headers.get("set-cookie"));
  let session = await appRequest(baseUrl, "/api/session", { ...deps, cookie });
  assertHttpResponse(session, session.status === 200 && session.body?.authenticated === true && Boolean(session.body?.user?.id), "Sessão QA não confirmada.", "QA_SESSION_FAILED");
  if (String(session.body.activeOrganization?.id || "") !== String(organizationId)) {
    session = await appRequest(baseUrl, "/api/session/active-organization", {
      ...deps, method: "PUT", cookie, json: { organizationId },
    });
  }
  assertHttpResponse(session, session.status === 200 && session.body?.authenticated === true &&
    String(session.body.activeOrganization?.id || "") === String(organizationId), "Sessão QA não está na organização solicitada.", "QA_ORGANIZATION_MISMATCH");
  return {
    cookie,
    organization: { id: session.body.activeOrganization.id, slug: session.body.activeOrganization.slug },
    user: {
      id: session.body.user.id,
      role: session.body.user.role,
      permissions: Array.isArray(session.body.permissions) ? session.body.permissions : [],
      deniedPermissions: Array.isArray(session.body.deniedPermissions) ? session.body.deniedPermissions : [],
    },
  };
}

export async function buildProfiles(baseUrl, credentials, manifest, organizationId, deps = {}) {
  if (manifest.requiredOrganization && Number(organizationId) !== manifest.requiredOrganization.id) {
    fail("QA_ORGANIZATION_MISMATCH", "A suite exige sua organização QA registrada.");
  }
  const profiles = {};
  for (const name of manifest.requiredProfiles) profiles[name] = await loginProfile(baseUrl, credentials[name], organizationId, deps);
  for (const name of manifest.requiredProfiles) {
    if (manifest.requiredRoles?.[name] && profiles[name].user.role !== manifest.requiredRoles[name]) {
      fail("QA_ROLE_MISMATCH", `Perfil ${name} não tem o papel QA registrado.`);
    }
    if (manifest.requiredOrganization && (Number(profiles[name].organization.id) !== manifest.requiredOrganization.id ||
        profiles[name].organization.slug !== manifest.requiredOrganization.slug)) {
      fail("QA_ORGANIZATION_MISMATCH", "A organização autenticada diverge da organização QA registrada.");
    }
  }
  const ids = manifest.requiredProfiles.map((name) => String(profiles[name].user.id));
  if (new Set(ids).size !== ids.length) fail("QA_IDENTITIES_NOT_DISTINCT", "Perfis QA devem usar contas distintas.");
  for (const [profile, permissions] of Object.entries(manifest.requiredPermissions || {})) {
    const actual = new Set(profiles[profile]?.user?.permissions || []);
    const denied = new Set(profiles[profile]?.user?.deniedPermissions || []);
    for (const permission of permissions) {
      if ((!actual.has(permission) || denied.has(permission)) && profiles[profile]?.user?.role !== "super_admin") {
        fail("QA_PERMISSION_MISSING", `Perfil ${profile} sem permissão ${permission}.`);
      }
    }
  }
  return profiles;
}

export function suiteContext({
  baseUrl,
  organizationId,
  projectSlug,
  profiles,
  mutationMode = "controlled_mutation",
  runId = randomUUID(),
  expectedCommit = null,
  manualInventory = null,
  manualAdministration = null,
  deps = {},
}) {
  const cases = [];
  const cleanup = [];
  const index = new Map();
  const record = (id, status, details = {}) => {
    const row = { ...details, id, status };
    if (index.has(id)) cases[index.get(id)] = row;
    else { index.set(id, cases.length); cases.push(row); }
    return row;
  };
  return {
    runId, baseUrl, organizationId, projectSlug, profiles, cases, record, expectedCommit, manualInventory, manualAdministration,
    async publishManualJournal(resources) {
      if (!manualAdministration || !Array.isArray(resources) || resources.length > 2) fail("MANUAL_CONTEXT_REQUIRED", "Contexto administrativo manual não confirmado.");
      manualAdministration.resources = resources.map(row => ({ kind: row.kind, name: row.name, projectId: row.id ?? null, slug: row.slug ?? null,
        organizationFileId: row.organizationFileId ?? null, reservationStarted: row.reservationStarted === true, reservationUncertain: row.reservationUncertain === true }));
      await deps.onManualJournal?.(structuredClone(manualAdministration));
    },
    registerCleanup(fn) { cleanup.push(fn); },
    // Browser suites must share the same phase admission/deadline as HTTP calls.
    assertAdmission() { deps.budget?.assertAdmission(); },
    requestTimeoutMs(ms = 30_000) { return deps.budget ? deps.budget.requestTimeoutMs(ms) : ms; },
    async pause(ms) {
      if (deps.budget) await deps.budget.pause(ms, deps.sleep);
      else await (deps.sleep || ((duration) => new Promise((resolve) => setTimeout(resolve, duration))))(ms);
    },
    async api(profileName, path, options = {}) {
      const profile = profiles[profileName];
      if (!profile) fail("QA_PROFILE_UNKNOWN", `Perfil QA desconhecido: ${profileName}.`);
      const method = String(options.method || "GET").toUpperCase();
      if (manualAdministration && (profileName !== "creator" || method === "DELETE" || new URL(path, baseUrl).pathname.startsWith("/api/admin/"))) {
        fail("MANUAL_ADMIN_AUTOMATION_FORBIDDEN", "O runner só pode usar o editor; operações administrativas ficam com o usuário.");
      }
      if (mutationMode === "read_only" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        fail("READ_ONLY_SUITE_MUTATION_BLOCKED", `Suite read_only não pode executar ${method}.`);
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && deps.budget?.phase === "suite") deps.budget.assertAdmission();
      return appRequest(baseUrl, path, { ...deps, ...options, method, cookie: profile.cookie, budget: deps.budget });
    },
    async cleanupApi(profileName, path, options = {}, expectedStatuses = [200, 204]) {
      const response = await this.api(profileName, path, options);
      assertHttpResponse(response, expectedStatuses.includes(response.status), `Cleanup recusado (HTTP ${response.status}).`, "CLEANUP_HTTP_FAILED");
      return response;
    },
    async cleanup() {
      const errors = [];
      for (const fn of cleanup.reverse()) {
        try { await fn(); } catch (error) { errors.push(safeError(error)); }
      }
      return errors;
    },
  };
}

export function initialReport(options) {
  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    ...options,
    writesPerformed: false,
    acceptanceExecuted: false,
    configurationRestored: null,
    cleanupComplete: null,
    operationalTestsPassed: null,
    acceptanceIncomplete: true,
    cases: [],
    ok: false,
    complete: false,
  };
}

export async function writeReport(path, report, { budget = null } = {}) {
  if (!path || path === resolve(".")) fail("REPORT_REQUIRED", "--report deve apontar para arquivo JSON.");
  budget?.assertActive();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx", ...(budget ? { signal: AbortSignal.timeout(budget.requestTimeoutMs(5 * 60_000)) } : {}) });
  budget?.assertActive();
}
