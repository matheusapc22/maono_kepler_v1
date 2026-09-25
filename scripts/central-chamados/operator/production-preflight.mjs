#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = "https://api.cloudflare.com";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/i;
export const PRODUCTION_FLAG_NAMES = Object.freeze([
  "MAONO_RUNTIME_ENV", "MAONO_TICKET_TRIAGE_ENABLED", "MAONO_TICKET_COMMANDS_ENABLED", "MAONO_PREVIEW_MUTATIONS_ENABLED",
]);
const MESSAGES = {
  PREFLIGHT_ARGUMENT_INVALID: "Informe conta, projeto, UUID D1 esperado, commit completo esperado e arquivo de relatório novo.",
  PREFLIGHT_REPORT_UNAVAILABLE: "O relatório deve ser um arquivo novo em uma pasta existente e gravável; a consulta não foi iniciada.",
  PREFLIGHT_REPORT_WRITE_FAILED: "Não foi possível gravar o relatório sanitizado.",
  PREFLIGHT_REPORT_CLOSE_FAILED: "Não foi possível confirmar o fechamento do arquivo de relatório.",
  PREFLIGHT_WRANGLER_INSTALLATION: "Instale o pacote isolado do operador com Wrangler 4.140.0.",
  PREFLIGHT_AUTH_FAILED: "Não foi possível obter a autenticação vigente pelo Wrangler. A saída interna foi omitida.",
  PREFLIGHT_AUTH_FORMAT: "A autenticação devolvida pelo Wrangler não corresponde aos formatos oficiais esperados.",
  PREFLIGHT_REQUEST_NOT_ALLOWED: "A consulta solicitada está fora dos recursos de leitura permitidos.",
  PREFLIGHT_HTTP_FAILED: "A consulta Cloudflare foi recusada; detalhes internos foram omitidos.",
  PREFLIGHT_NETWORK_FAILED: "A consulta Cloudflare não pôde ser concluída; detalhes internos foram omitidos.",
  PREFLIGHT_TIMEOUT: "A consulta Cloudflare excedeu o tempo limite.",
  PREFLIGHT_RESPONSE_TOO_LARGE: "A resposta Cloudflare excedeu o limite de leitura.",
  PREFLIGHT_RESPONSE_INVALID: "A resposta Cloudflare não corresponde ao contrato JSON esperado.",
  PREFLIGHT_FAILED: "A inspeção não pôde ser concluída; detalhes internos foram omitidos.",
};
function failure(code, extras = {}) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.PREFLIGHT_FAILED), { preflightCode: code, ...extras }); }
function publicError(error) {
  const code = Object.hasOwn(MESSAGES, error?.preflightCode) ? error.preflightCode : "PREFLIGHT_FAILED";
  return { code, message: MESSAGES[code], ...(Number.isInteger(error?.httpStatus) ? { httpStatus: error.httpStatus } : {}) };
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
function validOptions(options) {
  if (!/^[a-f0-9]{32}$/i.test(options.accountId || "") || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.projectName || "") ||
      !UUID.test(options.expectedDatabaseId || "") || !SHA.test(options.expectedCommit || "") ||
      typeof options.reportPath !== "string" || !options.reportPath.trim()) throw failure("PREFLIGHT_ARGUMENT_INVALID");
  return options;
}
export function parseProductionPreflightArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const mapping = { "account-id": "accountId", "project-name": "projectName", "expected-database-id": "expectedDatabaseId", "expected-commit": "expectedCommit", report: "reportPath" };
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]?.slice(2);
    if (!args[index]?.startsWith("--") || !Object.hasOwn(mapping, name) || own(options, mapping[name])) throw failure("PREFLIGHT_ARGUMENT_INVALID");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw failure("PREFLIGHT_ARGUMENT_INVALID");
    options[mapping[name]] = value;
  }
  return validOptions(options);
}

/** Credentials remain in memory. Never pass them in command arguments or reports. */
export async function readWranglerCredentials({
  execCommand = exec,
  readPackage = async () => JSON.parse(await readFile(join(PACKAGE_DIR, "node_modules/wrangler/package.json"), "utf8")),
} = {}) {
  try { if ((await readPackage())?.version !== "4.140.0") throw new Error("unavailable"); }
  catch { throw failure("PREFLIGHT_WRANGLER_INSTALLATION"); }
  let result; let authDirectory;
  try {
    authDirectory = await mkdtemp(join(tmpdir(), "maono-pages-auth-"));
    result = await execCommand(process.execPath, [join(PACKAGE_DIR, "node_modules/wrangler/bin/wrangler.js"), "auth", "token", "--json"], {
      cwd: authDirectory, shell: false, windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024,
      env: { ...process.env, WRANGLER_LOG: "log", WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false", CI: "true" },
    });
  } catch { throw failure("PREFLIGHT_AUTH_FAILED"); }
  finally {
    // No credentials or config are written here. Cleanup cannot discard captured evidence.
    if (authDirectory) { try { await rm(authDirectory, { recursive: true, force: true }); } catch { /* Empty isolated cwd: cleanup is best effort. */ } }
  }
  try {
    const value = JSON.parse(result.stdout.trim());
    const clean = (text, max = 16384) => typeof text === "string" && text.length > 0 && text.length <= max && !/[\r\n\x00]/.test(text);
    if (object(value) && ["oauth", "api_token"].includes(value.type) && clean(value.token)) return { type: value.type, token: value.token };
    if (object(value) && value.type === "api_key" && clean(value.key) && clean(value.email, 320)) return { type: "api_key", key: value.key, email: value.email };
  } catch { /* The captured output can contain credentials; do not echo it. */ }
  throw failure("PREFLIGHT_AUTH_FORMAT");
}
function authHeaders(credentials) {
  if (["oauth", "api_token"].includes(credentials?.type) && typeof credentials.token === "string" && !/[\r\n\x00]/.test(credentials.token)) return { Authorization: `Bearer ${credentials.token}` };
  if (credentials?.type === "api_key" && typeof credentials.key === "string" && typeof credentials.email === "string" && !/[\r\n\x00]/.test(credentials.key + credentials.email)) return { "X-Auth-Key": credentials.key, "X-Auth-Email": credentials.email };
  throw failure("PREFLIGHT_AUTH_FORMAT");
}

/** Only these two official resources are reachable; there is no arbitrary URL or method input. */
export async function readPagesResource(options, kind, credentials, { fetchImpl = fetch, timeoutMs = 15000, maxBytes = 1024 * 1024, deploymentId = null } = {}) {
  validOptions(options);
  const projectPath = `/client/v4/accounts/${options.accountId}/pages/projects/${options.projectName}`;
  if (!(["project", "deployment"].includes(kind)) || (kind === "deployment" && !UUID.test(deploymentId || ""))) throw failure("PREFLIGHT_REQUEST_NOT_ALLOWED");
  const path = kind === "project" ? projectPath : `${projectPath}/deployments/${deploymentId}`;
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN || url.pathname !== path || url.search || url.hash) throw failure("PREFLIGHT_REQUEST_NOT_ALLOWED");
  const signal = AbortSignal.timeout(timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(url.href, { method: "GET", redirect: "error", signal, headers: { Accept: "application/json", ...authHeaders(credentials) } });
    if (!response.ok) { await response.body?.cancel(); throw failure("PREFLIGHT_HTTP_FAILED", { httpStatus: response.status }); }
    if (Number(response.headers.get("content-length") || 0) > maxBytes) { await response.body?.cancel(); throw failure("PREFLIGHT_RESPONSE_TOO_LARGE"); }
    if (!response.body?.getReader) throw failure("PREFLIGHT_RESPONSE_INVALID");
    reader = response.body.getReader();
    const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw failure("PREFLIGHT_RESPONSE_TOO_LARGE"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let envelope;
    try { envelope = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failure("PREFLIGHT_RESPONSE_INVALID"); }
    if (!object(envelope) || envelope.success !== true || !object(envelope.result)) throw failure("PREFLIGHT_RESPONSE_INVALID");
    return envelope.result;
  } catch (error) {
    if (error.preflightCode) throw error;
    throw failure(signal.aborted ? "PREFLIGHT_TIMEOUT" : "PREFLIGHT_NETWORK_FAILED");
  } finally { reader?.releaseLock(); }
}

function safeText(value, max = 200) { return typeof value === "string" && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : null; }
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url.href : null; } catch { return null; }
}
export function sanitizedFlags(container) {
  const available = object(container);
  return Object.fromEntries(PRODUCTION_FLAG_NAMES.map((name) => {
    if (!available) return [name, { state: "snapshot_unavailable", value: null }];
    if (!own(container, name)) return [name, { state: "absent", value: null }];
    const entry = container[name];
    if (entry?.type === "secret_text") return [name, { state: "secret_redacted", value: null }];
    if (entry?.type !== "plain_text" || typeof entry.value !== "string") return [name, { state: "unknown", value: null }];
    const value = entry.value.trim().toLowerCase();
    if (name === "MAONO_RUNTIME_ENV") return [name, ["production", "preview", "local", "unknown"].includes(value) ? { state: "observed", value } : { state: "invalid_value_redacted", value: null }];
    return [name, ["true", "false"].includes(value) ? { state: "observed", value: value === "true" } : { state: "invalid_value_redacted", value: null }];
  }));
}
function configuredBinding(project) {
  const bindings = project?.deployment_configs?.production?.d1_databases;
  if (!object(bindings)) return { state: "configuration_unavailable", name: "DB", id: null };
  if (!own(bindings, "DB")) return { state: "absent", name: "DB", id: null };
  return UUID.test(bindings.DB?.id || "") ? { state: "observed_project_configuration", name: "DB", id: bindings.DB.id } : { state: "invalid", name: "DB", id: null };
}
function summarizeDeployment(deployment) {
  const meta = deployment?.deployment_trigger?.metadata;
  return { id: UUID.test(deployment?.id || "") ? deployment.id : null,
    environment: ["production", "preview"].includes(deployment?.environment) ? deployment.environment : null,
    url: safeUrl(deployment?.url), branch: safeText(meta?.branch), commit: SHA.test(meta?.commit_hash || "") ? meta.commit_hash.toLowerCase() : null,
    commitDirty: typeof meta?.commit_dirty === "boolean" ? meta.commit_dirty : null,
    stage: ["queued", "initialize", "clone_repo", "build", "deploy"].includes(deployment?.latest_stage?.name) ? deployment.latest_stage.name : null,
    status: ["idle", "active", "success", "failure", "canceled"].includes(deployment?.latest_stage?.status) ? deployment.latest_stage.status : null,
    completedAt: Number.isFinite(Date.parse(deployment?.latest_stage?.ended_on)) ? deployment.latest_stage.ended_on : null };
}
function configuredProduction(project) {
  return { databaseBinding: configuredBinding(project), flags: sanitizedFlags(project?.deployment_configs?.production?.env_vars) };
}
function flagsCompared(configured, deployed) {
  return Object.fromEntries(PRODUCTION_FLAG_NAMES.map((name) => [name, configured[name].state === "observed" && deployed[name].state === "observed"
    ? configured[name].value === deployed[name].value ? "match" : "mismatch" : "unknown"]));
}
function initialReport(options) {
  return { reportVersion: 1, generatedAt: new Date().toISOString(), nodeVersion: process.version, mode: "production-discovery-read-only",
    accountId: options.accountId, projectName: options.projectName, expectedDatabaseId: options.expectedDatabaseId, expectedCommit: options.expectedCommit?.toLowerCase(),
    ok: false, readComplete: false, stateReadyForWindowPlanning: false, acceptanceReady: false, acceptanceExecuted: false,
    releaseAuthorized: false, writesPerformed: false, decisionGate: "pending", runtimeBindingVerified: false,
    source: { provider: "Cloudflare official control-plane API", resources: ["GET /accounts/{account_id}/pages/projects/{project_name}", "GET /accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}"],
      documentation: ["https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/", "https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/get/", "https://developers.cloudflare.com/workers/wrangler/commands/general/#auth-token"] } };
}
export async function inspectProduction(options, credentials, dependencies = {}) {
  validOptions(options);
  const report = initialReport(options);
  try {
    const project = await readPagesResource(options, "project", credentials, dependencies);
    const canonicalId = UUID.test(project.canonical_deployment?.id || "") ? project.canonical_deployment.id : null;
    const canonical = canonicalId ? await readPagesResource(options, "deployment", credentials, { ...dependencies, deploymentId: canonicalId }) : null;
    const recheck = await readPagesResource(options, "project", credentials, dependencies);
    report.project = { name: safeText(project.name), productionBranch: safeText(project.production_branch),
      productionUrl: typeof project.subdomain === "string" && /^[a-z0-9.-]+\.pages\.dev$/i.test(project.subdomain) ? `https://${project.subdomain}` : null,
      domains: Array.isArray(project.domains) ? project.domains.filter((name) => typeof name === "string" && /^[a-z0-9.-]+$/i.test(name)).slice(0, 50) : [] };
    report.canonicalProduction = summarizeDeployment(canonical);
    report.latestDeployment = summarizeDeployment(project.latest_deployment);
    report.configuredProduction = configuredProduction(project);
    report.deployedSnapshot = { flags: sanitizedFlags(canonical?.env_vars), databaseBinding: { state: "not_available_in_documented_deployment_schema", name: "DB", id: null } };
    report.configurationComparison = { flags: flagsCompared(report.configuredProduction.flags, report.deployedSnapshot.flags),
      databaseBinding: "unknown_no_deployed_binding_snapshot", explanation: "A configuração atual do projeto e as variáveis capturadas no deployment são evidências distintas. Esta consulta não prova o binding D1 em execução nem altera flags." };
    const finalConfigured = configuredProduction(recheck);
    report.consistency = {
      canonicalStable: canonicalId !== null && recheck.canonical_deployment?.id === canonicalId,
      projectStable: project.name === recheck.name && project.production_branch === recheck.production_branch && JSON.stringify(report.configuredProduction) === JSON.stringify(finalConfigured),
      recheckedCanonicalId: UUID.test(recheck.canonical_deployment?.id || "") ? recheck.canonical_deployment.id : null,
    };
    report.comparisons = { configuredDatabaseMatchesExpected: report.configuredProduction.databaseBinding.id === options.expectedDatabaseId,
      deployedCommitMatchesExpected: report.canonicalProduction.commit === options.expectedCommit.toLowerCase(),
      deploymentBranchMatchesProduction: Boolean(report.project.productionBranch) && report.canonicalProduction.branch === report.project.productionBranch };
    const issues = [];
    if (project.name !== options.projectName || recheck.name !== options.projectName) issues.push("PROJECT_NAME_MISMATCH");
    if (!canonicalId || report.canonicalProduction.id !== canonicalId) issues.push("CANONICAL_DEPLOYMENT_UNCONFIRMED");
    if (report.canonicalProduction.environment !== "production") issues.push("CANONICAL_ENVIRONMENT_NOT_PRODUCTION");
    if (report.canonicalProduction.status !== "success" || report.canonicalProduction.stage !== "deploy") issues.push("CANONICAL_DEPLOYMENT_NOT_SUCCESSFUL");
    if (!report.project.productionUrl || !report.canonicalProduction.url) issues.push("PRODUCTION_URL_UNCONFIRMED");
    if (!report.comparisons.deploymentBranchMatchesProduction) issues.push("PRODUCTION_BRANCH_MISMATCH_OR_UNKNOWN");
    if (!report.comparisons.deployedCommitMatchesExpected || report.canonicalProduction.commitDirty !== false) issues.push("PRODUCTION_COMMIT_MISMATCH_OR_UNCONFIRMED");
    if (!report.comparisons.configuredDatabaseMatchesExpected) issues.push("CONFIGURED_DATABASE_MISMATCH_OR_UNKNOWN");
    if (!report.consistency.canonicalStable || !report.consistency.projectStable) issues.push("PRODUCTION_CHANGED_DURING_READ");
    const relevantFlags = ["MAONO_RUNTIME_ENV", "MAONO_TICKET_TRIAGE_ENABLED", "MAONO_TICKET_COMMANDS_ENABLED"];
    if (relevantFlags.some((name) => report.configurationComparison.flags[name] === "mismatch")) issues.push("CONFIGURED_VERSUS_DEPLOYED_FLAGS_DIFFER");
    if (relevantFlags.some((name) => report.configurationComparison.flags[name] === "unknown")) issues.push("PRODUCTION_FLAGS_NOT_FULLY_OBSERVABLE");
    const snapshots = [report.configuredProduction.flags, report.deployedSnapshot.flags];
    if (snapshots.some((flags) => flags.MAONO_RUNTIME_ENV.value !== "production")) issues.push("PRODUCTION_RUNTIME_FLAG_UNCONFIRMED");
    if (snapshots.some((flags) => flags.MAONO_TICKET_COMMANDS_ENABLED.value !== false)) issues.push("COMMANDS_OFF_OUTSIDE_WINDOW_NOT_CONFIRMED");
    report.planningScope = "Metadados para planejar a janela; não comprova binding executado, isolamento ou aceite. Triagem existente é preservada; a flag de Preview é apenas informativa em produção.";
    report.observations = [...new Set(issues)];
    report.stateReadyForWindowPlanning = issues.length === 0;
    report.acceptanceBlockers = ["AUTHENTICATED_ACCEPTANCE_NOT_EXECUTED", "RUNTIME_D1_BINDING_NOT_PROVEN_BY_THIS_INSPECTION", "EXPLICIT_WINDOW_DECISION_PENDING"];
    report.ok = true; report.readComplete = true;
  } catch (error) { report.error = publicError(error); }
  report.finishedAt = new Date().toISOString();
  return report;
}

export const PRODUCTION_PREFLIGHT_HELP = `CC-03 — descoberta de produção somente leitura\n\nnode scripts/central-chamados/operator/production-preflight.mjs --account-id 09d455fa1cf988b0d9db89987b73eaff --project-name maono-kepler-v1 --expected-database-id 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db --expected-commit SHA_COMPLETO_40_HEX --report ./producao-novo.json\n\nUsa a autenticação atual do Wrangler 4.140.0 somente em memória. Não execute auth token separadamente nem copie credenciais para o chat.\nRelatório exclusivo; pasta existente. Consultas apenas GET ao projeto e ao deployment canônico da Cloudflare.\nNão acessa a aplicação ou D1, não habilita flags, não faz deploy nem aplica migrations.\nSaídas: 0 leitura concluída (não significa aceite); 1 erro operacional. Divergências são registradas no relatório.\n`;
export async function main(argv = process.argv.slice(2), { getCredentials = readWranglerCredentials, fetchImpl = fetch,
  output = (text) => new Promise((resolveOutput, rejectOutput) => process.stdout.write(text, (error) => error ? rejectOutput(error) : resolveOutput())),
  openReport = open,
} = {}) {
  let handle; let report; let code = 1;
  try {
    const options = parseProductionPreflightArgs(argv);
    if (options.help) { await output(PRODUCTION_PREFLIGHT_HELP); return 0; }
    try { handle = await openReport(resolve(options.reportPath), "wx", 0o600); } catch { throw failure("PREFLIGHT_REPORT_UNAVAILABLE"); }
    report = initialReport(options);
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); await handle.sync();
    const credentials = await getCredentials();
    report = await inspectProduction(options, credentials, { fetchImpl });
    code = report.readComplete ? 0 : 1;
  } catch (error) { report = { ...(report || { reportVersion: 1, generatedAt: new Date().toISOString(), writesPerformed: false, acceptanceExecuted: false, acceptanceReady: false, releaseAuthorized: false }), ok: false, readComplete: false, error: publicError(error) }; }
  finally {
    if (report) {
      report.finishedAt = new Date().toISOString();
      if (handle) {
        try { const text = `${JSON.stringify(report, null, 2)}\n`; await handle.write(text, 0, "utf8"); await handle.truncate(Buffer.byteLength(text)); await handle.sync(); }
        catch { code = 1; report.reportWriteError = publicError(failure("PREFLIGHT_REPORT_WRITE_FAILED")); }
      }
    }
    try { await handle?.close(); } catch { code = 1; if (report) report.reportCloseError = publicError(failure("PREFLIGHT_REPORT_CLOSE_FAILED")); }
    // The report describes the read, not the eventual CLI exit status. In particular,
    // it must not persist a false exitCode:0 before close/stdout can still fail.
    if (report) { try { await output(`${JSON.stringify(report, null, 2)}\n`); } catch { code = 1; } }
  }
  return code;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
