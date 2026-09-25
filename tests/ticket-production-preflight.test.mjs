import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectProduction, main, parseProductionPreflightArgs, readPagesResource,
  readWranglerCredentials, sanitizedFlags,
} from "../scripts/central-chamados/operator/production-preflight.mjs";

const options = { accountId: "09d455fa1cf988b0d9db89987b73eaff", projectName: "maono-kepler-v1",
  expectedDatabaseId: "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db", expectedCommit: "a".repeat(40), reportPath: "production.json" };
const canonicalId = "d16a3b83-5b22-4f48-9467-7bb035758765";
const previewId = "29bbd4ae-31e7-40b5-b3e3-1f3b74158093";
const credentials = { type: "oauth", token: "PRIVATE-AUTH-TOKEN" };
const clone = (value) => JSON.parse(JSON.stringify(value));
const flags = () => ({ MAONO_RUNTIME_ENV: { type: "plain_text", value: "production" },
  MAONO_TICKET_TRIAGE_ENABLED: { type: "plain_text", value: "false" },
  MAONO_TICKET_COMMANDS_ENABLED: { type: "plain_text", value: "false" },
  MAONO_PREVIEW_MUTATIONS_ENABLED: { type: "plain_text", value: "false" },
  DROPBOX_APP_SECRET: { type: "secret_text", value: "PRIVATE-DROPBOX-SECRET" },
  UNRELATED_PLAINTEXT: { type: "plain_text", value: "PRIVATE-UNRELATED-CONFIG" },
});
function deployment() {
  return { id: canonicalId, project_name: options.projectName, environment: "production",
    url: "https://d16a3b83.maono-kepler-v1.pages.dev", deployment_trigger: { metadata: { branch: "mano_kepler_v1", commit_hash: options.expectedCommit, commit_dirty: false, commit_message: "PRIVATE-COMMIT-MESSAGE" } },
    env_vars: flags(), latest_stage: { name: "deploy", status: "success", ended_on: "2026-09-25T18:00:00.000Z" },
    build_config: { web_analytics_token: "PRIVATE-ANALYTICS" } };
}
function project() {
  return { name: options.projectName, production_branch: "mano_kepler_v1", subdomain: "maono-kepler-v1.pages.dev", domains: ["maono-kepler-v1.pages.dev"],
    canonical_deployment: deployment(), latest_deployment: { ...deployment(), id: previewId, environment: "preview", url: "https://29bbd4ae.maono-kepler-v1.pages.dev", deployment_trigger: { metadata: { branch: "feat/latest-preview", commit_hash: "b".repeat(40), commit_dirty: false } } },
    deployment_configs: { production: { d1_databases: { DB: { id: options.expectedDatabaseId } }, env_vars: flags() }, preview: { env_vars: { SECRET: { value: "PRIVATE-PREVIEW-SECRET" } } } } };
}
function api(result, status = 200) { return new Response(JSON.stringify({ success: true, result }), { status, headers: { "content-type": "application/json" } }); }
function fixtureFetch({ initial = project(), deployed = deployment(), final = null } = {}) {
  const calls = []; let projectReads = 0;
  return { calls, async fetchImpl(url, request) {
    calls.push({ url, request });
    if (url.endsWith(`/deployments/${canonicalId}`)) return api(clone(deployed));
    if (url.endsWith(`/pages/projects/${options.projectName}`)) return api(clone(projectReads++ === 0 ? initial : final || initial));
    throw new Error("unexpected endpoint");
  } };
}
const args = (reportPath) => ["--account-id", options.accountId, "--project-name", options.projectName, "--expected-database-id", options.expectedDatabaseId, "--expected-commit", options.expectedCommit, "--report", reportPath];
async function folder(t) { const path = await mkdtemp(join(tmpdir(), "cc03-production-preflight-")); t.after(() => rm(path, { recursive: true, force: true })); return path; }

test("preflight requires explicit account/project/database/full commit/report and has no mutation arguments", () => {
  assert.deepEqual(parseProductionPreflightArgs(args("new.json")), { ...options, reportPath: "new.json" });
  assert.equal(parseProductionPreflightArgs(["--help"]).help, true);
  for (const extra of [["--apply"], ["--deploy"], ["--report", "again.json"]]) assert.throws(() => parseProductionPreflightArgs([...args("new.json"), ...extra]));
  for (const [argument, value] of [["--expected-commit", "abc1234"], ["--project-name", "../other"], ["--account-id", "bad"], ["--expected-database-id", "invalid"]]) {
    const values = args("new.json"); values[values.indexOf(argument) + 1] = value; assert.throws(() => parseProductionPreflightArgs(values));
  }
});

for (const auth of [{ type: "oauth", token: "PRIVATE-OAUTH" }, { type: "api_token", token: "PRIVATE-TOKEN" }, { type: "api_key", key: "PRIVATE-KEY", email: "private@example.test" }]) {
  test(`Wrangler ${auth.type} credentials are captured with stable JSON logging and no shell`, async () => {
    let calls = 0; let authDirectory;
    const actual = await readWranglerCredentials({ readPackage: async () => ({ version: "4.140.0" }), execCommand: async (binary, argv, settings) => {
      calls += 1; assert.equal(binary, process.execPath); assert.deepEqual(argv.slice(1), ["auth", "token", "--json"]);
      assert.equal(settings.shell, false); assert.equal(settings.env.WRANGLER_LOG, "log"); assert.equal(settings.env.WRANGLER_WRITE_LOGS, "false");
      assert.equal(settings.env.WRANGLER_SEND_METRICS, "false"); assert(!argv.join(" ").includes("PRIVATE"));
      authDirectory = settings.cwd;
      assert.notEqual(authDirectory, process.cwd()); assert.deepEqual(await readdir(authDirectory), []);
      return { stdout: `${JSON.stringify(auth)}\n`, stderr: "PRIVATE-AUTH-DIAGNOSTIC" };
    } });
    assert.equal(calls, 1); assert.deepEqual(actual, auth);
    await assert.rejects(stat(authDirectory), { code: "ENOENT" });
  });
}

test("Wrangler errors and malformed credentials never expose subprocess output or token values", async () => {
  for (const execCommand of [
    async () => { throw Object.assign(new Error("PRIVATE-CMD-SECRET"), { stdout: "PRIVATE-STDOUT", stderr: "PRIVATE-STDERR" }); },
    async () => ({ stdout: '{"token":"PRIVATE-TOKEN"', stderr: "PRIVATE-STDERR" }),
    async () => ({ stdout: JSON.stringify({ type: "unsupported", token: "PRIVATE-TOKEN" }) }),
    async () => ({ stdout: JSON.stringify({ type: "oauth", token: "PRIVATE-TOKEN\r\nInjected: true" }) }),
  ]) await assert.rejects(readWranglerCredentials({ readPackage: async () => ({ version: "4.140.0" }), execCommand }), (error) => { assert(![String(error), error.stack, JSON.stringify(error)].join(" ").includes("PRIVATE")); return true; });
  let executed = false;
  await assert.rejects(readWranglerCredentials({ readPackage: async () => ({ version: "4.139.0" }), execCommand: async () => { executed = true; } }), { preflightCode: "PREFLIGHT_WRANGLER_INSTALLATION" });
  assert.equal(executed, false);
});

test("inspection reads only project/canonical detail/recheck, preserving full SHA and separating newer Preview", async () => {
  const fixture = fixtureFetch();
  const report = await inspectProduction(options, credentials, fixture);
  assert.equal(report.ok, true); assert.equal(report.readComplete, true); assert.equal(report.stateReadyForWindowPlanning, true);
  assert.equal(report.canonicalProduction.id, canonicalId); assert.equal(report.canonicalProduction.environment, "production");
  assert.equal(report.canonicalProduction.commit, options.expectedCommit); assert.equal(report.latestDeployment.id, previewId);
  assert.equal(report.latestDeployment.environment, "preview"); assert.equal(report.runtimeBindingVerified, false);
  assert.equal(report.acceptanceReady, false); assert.equal(report.acceptanceExecuted, false); assert.equal(report.releaseAuthorized, false); assert.equal(report.writesPerformed, false);
  assert.equal(report.deployedSnapshot.databaseBinding.id, null);
  assert.equal(report.configurationComparison.databaseBinding, "unknown_no_deployed_binding_snapshot");
  assert.equal(fixture.calls.length, 3);
  for (const call of fixture.calls) {
    assert.equal(call.request.method, "GET"); assert.equal(call.request.redirect, "error"); assert.equal(new URL(call.url).origin, "https://api.cloudflare.com");
    assert(call.url.includes(`/accounts/${options.accountId}/pages/projects/${options.projectName}`));
    assert.equal(call.request.headers.Authorization, "Bearer PRIVATE-AUTH-TOKEN");
  }
  const json = JSON.stringify(report);
  for (const secret of ["PRIVATE-AUTH-TOKEN", "PRIVATE-DROPBOX-SECRET", "PRIVATE-UNRELATED-CONFIG", "PRIVATE-PREVIEW-SECRET", "PRIVATE-COMMIT-MESSAGE", "PRIVATE-ANALYTICS"]) assert(!json.includes(secret));
});

test("HTTP allowlist rejects unknown resource kinds, traversal and foreign URLs before fetch", async () => {
  let calls = 0; const fetchImpl = async () => { calls += 1; return api({}); };
  for (const kind of ["https://other.test", "worker-settings", "update"]) await assert.rejects(readPagesResource(options, kind, credentials, { fetchImpl }), { preflightCode: "PREFLIGHT_REQUEST_NOT_ALLOWED" });
  for (const deploymentId of ["../../other", "https://other.test", "not-a-uuid"]) await assert.rejects(readPagesResource(options, "deployment", credentials, { deploymentId, fetchImpl }), { preflightCode: "PREFLIGHT_REQUEST_NOT_ALLOWED" });
  await assert.rejects(readPagesResource({ ...options, projectName: "other/../../account" }, "project", credentials, { fetchImpl }));
  assert.equal(calls, 0);
});

test("API-key auth uses only official headers and credentials never enter the URL", async () => {
  await readPagesResource(options, "project", { type: "api_key", key: "PRIVATE-KEY", email: "private@example.test" }, { fetchImpl: async (url, request) => {
    assert.equal(request.headers["X-Auth-Key"], "PRIVATE-KEY"); assert.equal(request.headers["X-Auth-Email"], "private@example.test");
    assert.equal(request.headers.Authorization, undefined); assert(!url.includes("PRIVATE")); return api({ name: options.projectName });
  } });
});

test("secret allowlisted flags stay unknown and unlisted environment values are omitted", () => {
  const values = flags(); values.MAONO_TICKET_COMMANDS_ENABLED = { type: "secret_text", value: "PRIVATE-COMMAND-FLAG" };
  values.MAONO_RUNTIME_ENV = { type: "plain_text", value: "PRIVATE-INVALID-RUNTIME" };
  const sanitized = sanitizedFlags(values);
  assert.equal(sanitized.MAONO_TICKET_COMMANDS_ENABLED.state, "secret_redacted"); assert.equal(sanitized.MAONO_TICKET_COMMANDS_ENABLED.value, null);
  assert.equal(sanitized.MAONO_RUNTIME_ENV.state, "invalid_value_redacted");
  assert.equal(Object.keys(sanitized).length, 4); assert(!JSON.stringify(sanitized).includes("PRIVATE"));
});

test("configured and deployed flags are compared without treating absent or unavailable snapshots as OFF", async () => {
  const initial = project(); const deployed = deployment();
  initial.deployment_configs.production.env_vars.MAONO_TICKET_COMMANDS_ENABLED.value = "true";
  const mismatch = await inspectProduction(options, credentials, fixtureFetch({ initial, deployed }));
  assert.equal(mismatch.configurationComparison.flags.MAONO_TICKET_COMMANDS_ENABLED, "mismatch");
  assert(mismatch.observations.includes("CONFIGURED_VERSUS_DEPLOYED_FLAGS_DIFFER"));
  assert.equal(mismatch.stateReadyForWindowPlanning, false);
  delete deployed.env_vars;
  const missing = await inspectProduction(options, credentials, fixtureFetch({ deployed }));
  assert.equal(missing.deployedSnapshot.flags.MAONO_TICKET_COMMANDS_ENABLED.state, "snapshot_unavailable");
  assert.equal(missing.deployedSnapshot.flags.MAONO_TICKET_COMMANDS_ENABLED.value, null);
  assert.equal(missing.configurationComparison.flags.MAONO_TICKET_COMMANDS_ENABLED, "unknown");
  assert.equal(missing.readComplete, true); assert.equal(missing.stateReadyForWindowPlanning, false);
  deployed.env_vars = {};
  const absent = await inspectProduction(options, credentials, fixtureFetch({ deployed }));
  assert.equal(absent.deployedSnapshot.flags.MAONO_TICKET_COMMANDS_ENABLED.state, "absent");
});

test("active triage remains valid outside the window and Preview flags do not gate production planning", async () => {
  for (const preview of ["absent", "true", "mismatch", "secret"]) {
    const initial = project(); const deployed = deployment();
    for (const container of [initial.deployment_configs.production.env_vars, deployed.env_vars]) {
      container.MAONO_TICKET_TRIAGE_ENABLED.value = "true";
      if (preview === "absent") delete container.MAONO_PREVIEW_MUTATIONS_ENABLED;
      else if (preview === "secret") container.MAONO_PREVIEW_MUTATIONS_ENABLED = { type: "secret_text", value: "PRIVATE-PREVIEW-FLAG" };
      else container.MAONO_PREVIEW_MUTATIONS_ENABLED.value = "true";
    }
    if (preview === "mismatch") deployed.env_vars.MAONO_PREVIEW_MUTATIONS_ENABLED.value = "false";
    const report = await inspectProduction(options, credentials, fixtureFetch({ initial, deployed }));
    assert.equal(report.readComplete, true); assert.equal(report.stateReadyForWindowPlanning, true);
    assert.equal(report.configuredProduction.flags.MAONO_TICKET_TRIAGE_ENABLED.value, true);
    assert.equal(report.deployedSnapshot.flags.MAONO_TICKET_TRIAGE_ENABLED.value, true);
    assert.equal(report.acceptanceReady, false); assert(!JSON.stringify(report).includes("PRIVATE"));
    assert.deepEqual(report.observations, []);
    if (preview === "mismatch") assert.equal(report.configurationComparison.flags.MAONO_PREVIEW_MUTATIONS_ENABLED, "mismatch");
  }
});

test("production planning requires observed runtime and commands OFF while preserving the observed triage setting", async () => {
  for (const modify of [
    (values) => { values.MAONO_TICKET_COMMANDS_ENABLED.value = "true"; },
    (values) => { delete values.MAONO_TICKET_COMMANDS_ENABLED; },
    (values) => { values.MAONO_RUNTIME_ENV.value = "preview"; },
    (values) => { delete values.MAONO_TICKET_TRIAGE_ENABLED; },
  ]) {
    const initial = project(); const deployed = deployment(); modify(initial.deployment_configs.production.env_vars); modify(deployed.env_vars);
    const report = await inspectProduction(options, credentials, fixtureFetch({ initial, deployed }));
    assert.equal(report.readComplete, true); assert.equal(report.stateReadyForWindowPlanning, false);
    assert.equal(report.writesPerformed, false);
  }
});

for (const [name, change, issue] of [
  ["wrong full SHA", (initial, deployed) => { deployed.deployment_trigger.metadata.commit_hash = "c".repeat(40); }, "PRODUCTION_COMMIT_MISMATCH_OR_UNCONFIRMED"],
  ["short SHA", (initial, deployed) => { deployed.deployment_trigger.metadata.commit_hash = "abc1234"; }, "PRODUCTION_COMMIT_MISMATCH_OR_UNCONFIRMED"],
  ["Preview canonical", (initial, deployed) => { deployed.environment = "preview"; }, "CANONICAL_ENVIRONMENT_NOT_PRODUCTION"],
  ["wrong D1", (initial) => { initial.deployment_configs.production.d1_databases.DB.id = previewId; }, "CONFIGURED_DATABASE_MISMATCH_OR_UNKNOWN"],
  ["missing binding", (initial) => { delete initial.deployment_configs.production.d1_databases; }, "CONFIGURED_DATABASE_MISMATCH_OR_UNKNOWN"],
  ["missing branch", (initial) => { delete initial.production_branch; }, "PRODUCTION_BRANCH_MISMATCH_OR_UNKNOWN"],
  ["failed deployment", (initial, deployed) => { deployed.latest_stage.status = "failure"; }, "CANONICAL_DEPLOYMENT_NOT_SUCCESSFUL"],
]) test(`${name} is a reported mismatch, never an automatic deployment or acceptance`, async () => {
  const initial = project(); const deployed = deployment(); change(initial, deployed);
  const report = await inspectProduction(options, credentials, fixtureFetch({ initial, deployed }));
  assert.equal(report.readComplete, true); assert.equal(report.stateReadyForWindowPlanning, false); assert(report.observations.includes(issue));
  assert.equal(report.decisionGate, "pending"); assert.equal(report.acceptanceExecuted, false); assert.equal(report.writesPerformed, false);
});

test("missing canonical fields produce unknown observations instead of guessing the latest Preview is production", async () => {
  const initial = project(); delete initial.canonical_deployment;
  const fixture = fixtureFetch({ initial });
  const report = await inspectProduction(options, credentials, fixture);
  assert.equal(report.readComplete, true); assert.equal(report.canonicalProduction.id, null); assert.equal(fixture.calls.length, 2);
  assert(report.observations.includes("CANONICAL_DEPLOYMENT_UNCONFIRMED"));
  assert.equal(report.latestDeployment.environment, "preview");
});

test("project recheck detects canonical replacement and desired configuration changes", async () => {
  for (const modify of [(value) => { value.canonical_deployment.id = previewId; }, (value) => { value.deployment_configs.production.env_vars.MAONO_TICKET_COMMANDS_ENABLED.value = "true"; }]) {
    const final = project(); modify(final);
    const report = await inspectProduction(options, credentials, fixtureFetch({ final }));
    assert(report.observations.includes("PRODUCTION_CHANGED_DURING_READ")); assert.equal(report.stateReadyForWindowPlanning, false);
  }
});

test("HTTP failures and redirects expose status only and never API error text/headers", async () => {
  for (const status of [301, 403, 500]) {
    const report = await inspectProduction(options, credentials, { fetchImpl: async () => new Response("PRIVATE-API-ERROR", { status, headers: { Location: "https://evil.test/PRIVATE", "Set-Cookie": "PRIVATE-COOKIE" } }) });
    assert.equal(report.readComplete, false); assert.equal(report.error.httpStatus, status);
    assert(!JSON.stringify(report).includes("PRIVATE"));
  }
});

test("network errors, malformed JSON and oversized bodies fail safely", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("PRIVATE-NETWORK-CREDENTIALS"); },
    async () => new Response("PRIVATE-MALFORMED-JSON"),
    async () => new Response(JSON.stringify({ success: false, errors: [{ message: "PRIVATE-API-MESSAGE" }] })),
  ]) {
    const report = await inspectProduction(options, credentials, { fetchImpl });
    assert.equal(report.readComplete, false); assert(!JSON.stringify(report).includes("PRIVATE"));
  }
  await assert.rejects(readPagesResource(options, "project", credentials, { maxBytes: 10, fetchImpl: async () => new Response("01234567890123456789") }), { preflightCode: "PREFLIGHT_RESPONSE_TOO_LARGE" });
  await assert.rejects(readPagesResource(options, "project", credentials, { maxBytes: 10, fetchImpl: async () => new Response("short", { headers: { "content-length": "1000" } }) }), { preflightCode: "PREFLIGHT_RESPONSE_TOO_LARGE" });
});

test("API timeout aborts the pending GET and produces a sanitized timeout report", async () => {
  const report = await inspectProduction(options, credentials, { timeoutMs: 5, fetchImpl: (_url, request) => new Promise((_resolve, reject) => {
    const fallback = setTimeout(() => reject(new Error("test timeout fallback")), 1000);
    request.signal.addEventListener("abort", () => { clearTimeout(fallback); reject(new Error("PRIVATE-TIMEOUT-DIAGNOSTIC")); }, { once: true });
  }) });
  assert.equal(report.error.code, "PREFLIGHT_TIMEOUT"); assert.equal(report.readComplete, false); assert(!JSON.stringify(report).includes("PRIVATE"));
});

test("CLI reserves an exclusive report before auth and persists only sanitized evidence", async (t) => {
  const directory = await folder(t); const reportPath = join(directory, "production.json"); const fixture = fixtureFetch(); let output = "";
  const code = await main(args(reportPath), { getCredentials: async () => credentials, fetchImpl: fixture.fetchImpl, output: (text) => { output += text; } });
  assert.equal(code, 0);
  const artifact = await readFile(reportPath, "utf8"); assert.deepEqual(JSON.parse(artifact), JSON.parse(output));
  assert(!artifact.includes("PRIVATE")); assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(artifact).acceptanceExecuted, false);
  let authenticated = false;
  const blocked = await main(args(reportPath), { getCredentials: async () => { authenticated = true; return credentials; }, output: () => {} });
  assert.equal(blocked, 1); assert.equal(authenticated, false); assert.equal(await readFile(reportPath, "utf8"), artifact);
  const absent = await main(args(join(directory, "missing", "report.json")), { getCredentials: async () => { authenticated = true; return credentials; }, output: () => {} });
  assert.equal(absent, 1); assert.equal(authenticated, false);
});

test("CLI auth failure persists a safe incomplete report without credentials or raw stderr", async (t) => {
  const path = join(await folder(t), "auth-error.json"); let output = ""; let fetched = false;
  const code = await main(args(path), { getCredentials: async () => { throw Object.assign(new Error("PRIVATE-AUTH-ERROR"), { stderr: "PRIVATE-STDERR" }); }, fetchImpl: async () => { fetched = true; return api({}); }, output: (text) => { output += text; } });
  assert.equal(code, 1); assert.equal(fetched, false); assert(!output.includes("PRIVATE"));
  assert(!String(await readFile(path)).includes("PRIVATE")); assert.equal(JSON.parse(output).readComplete, false);
  assert(Number.isFinite(Date.parse(JSON.parse(output).finishedAt)));
});

test("CLI reports failed final write or close safely and never advertises a premature zero exit code", async () => {
  for (const stage of ["write", "close"]) {
    const fixture = fixtureFetch(); let output = ""; let closed = false;
    const fakeHandle = { async writeFile() {}, async sync() {}, async truncate() {},
      async write() { if (stage === "write") throw new Error("PRIVATE-WRITE-FAILURE"); },
      async close() { closed = true; if (stage === "close") throw new Error("PRIVATE-CLOSE-FAILURE"); },
    };
    const code = await main(args("new.json"), { openReport: async (_path, mode, permissions) => {
      assert.equal(mode, "wx"); assert.equal(permissions, 0o600); return fakeHandle;
    }, getCredentials: async () => credentials, fetchImpl: fixture.fetchImpl, output: (text) => { output += text; } });
    assert.equal(code, 1); assert.equal(closed, true); assert(!output.includes("PRIVATE"));
    const report = JSON.parse(output);
    assert.equal(report.readComplete, true); assert.equal(report.exitCode, undefined);
    assert.equal(stage === "write" ? report.reportWriteError.code : report.reportCloseError.code, `PREFLIGHT_REPORT_${stage.toUpperCase()}_FAILED`);
    assert(Number.isFinite(Date.parse(report.finishedAt)));
  }
});

test("CLI stdout failure returns nonzero after the sanitized inspection was safely persisted", async (t) => {
  const path = join(await folder(t), "stdout-failed.json"); const fixture = fixtureFetch();
  const code = await main(args(path), { getCredentials: async () => credentials, fetchImpl: fixture.fetchImpl,
    output: async () => { throw new Error("PRIVATE-OUTPUT-FAILURE"); } });
  assert.equal(code, 1);
  const report = JSON.parse(await readFile(path, "utf8"));
  assert.equal(report.readComplete, true); assert.equal(report.exitCode, undefined); assert(!JSON.stringify(report).includes("PRIVATE"));
  assert(Number.isFinite(Date.parse(report.finishedAt)));
});
