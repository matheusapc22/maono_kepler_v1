import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionBudget, totalBudgetMs, PHASE_BUDGET_MS, MINUTE_MS, WORKFLOW_TIMEOUT_MINUTES } from "../scripts/acceptance/execution-budget.mjs";
import { appRequest, cfRequest, validateManifest, PRODUCTION_D1_ID } from "../scripts/acceptance/production-acceptance-lib.mjs";
import { manifest } from "../scripts/acceptance/suites/durable-project-save.mjs";
import { main } from "../scripts/acceptance/operator.mjs";

const minute = MINUTE_MS;
test("reviewed phase budgets leave twenty minutes below the protected Actions hard timeout", async () => {
  assert.equal(totalBudgetMs(manifest), 190 * minute);
  assert.equal(Object.values(PHASE_BUDGET_MS).reduce((sum, value) => sum + value), 190 * minute);
  assert.equal(WORKFLOW_TIMEOUT_MINUTES * minute - totalBudgetMs(manifest), 20 * minute);
  assert.ok(WORKFLOW_TIMEOUT_MINUTES < 360);
  const workflow = await readFile(new URL("../.github/workflows/production-acceptance-operator.yml", import.meta.url), "utf8");
  assert.match(workflow, new RegExp(`timeout-minutes: ${WORKFLOW_TIMEOUT_MINUTES}\\s+environment: production-acceptance`));
  assert.match(workflow, /report\*\.json/);
  const protectedJob = workflow.slice(workflow.indexOf("  protected:"));
  const steps = [...protectedJob.matchAll(/timeout-minutes: (\d+)/g)].slice(1).map((match) => Number(match[1]));
  assert.deepEqual(steps, [3, 1, 2, 5, 192, 1, 2]);
  assert.equal(steps.reduce((sum, value) => sum + value, 0), 206);
  assert.ok(steps.reduce((sum, value) => sum + value, 0) < WORKFLOW_TIMEOUT_MINUTES);
  assert.ok(totalBudgetMs(manifest) < 192 * minute);
  for (const mutationBudgetMs of [0, -1, 46 * minute, Infinity]) {
    assert.throws(() => validateManifest({ ...manifest, mutationBudgetMs }), { code: "MANIFEST_INVALID" });
  }
});

test("slow activation consumes its own budget and suite admission preserves fresh closure allocations", () => {
  let now = 0;
  const budget = createExecutionBudget(manifest, { now: () => now });
  budget.enter("preflight"); now += 9 * minute;
  budget.enter("activation"); now += 59 * minute;
  budget.enter("suite");
  assert.equal(budget.remainingMs(), 45 * minute);
  assert.ok(budget.endAt - budget.phaseDeadline >= budget.closureReserveMs);
  now = budget.phaseDeadline;
  assert.throws(() => budget.assertActive(), { code: "ACCEPTANCE_PHASE_TIMEOUT" });
  budget.enter("cleanup"); assert.equal(budget.remainingMs(), 10 * minute);
  now = budget.phaseDeadline;
  budget.enter("restoration"); assert.equal(budget.remainingMs(), 60 * minute);
  now = budget.phaseDeadline;
  budget.enter("report"); assert.equal(budget.remainingMs(), 5 * minute);
});

test("unexpected elapsed time blocks flag and application admissions without spending closure reserve", () => {
  let now = 0;
  const budget = createExecutionBudget(manifest, { now: () => now });
  budget.enter("preflight"); now = 56 * minute;
  assert.throws(() => budget.enter("activation"), { code: "ACCEPTANCE_CLOSURE_BUDGET_REQUIRED" });
  budget.enter("cleanup");
  assert.equal(budget.remainingMs(), 10 * minute);
  budget.enter("restoration");
  assert.equal(budget.remainingMs(), 60 * minute);
  const other = createExecutionBudget(manifest, { now: () => now });
  other.enter("preflight"); other.enter("activation"); now += 71 * minute;
  assert.throws(() => other.enter("suite"), { code: "ACCEPTANCE_CLOSURE_BUDGET_REQUIRED" });
});

test("phase limits cover response-body parsing and preserve uncertainty instead of returning HTTP success", async () => {
  for (const kind of ["app", "cloudflare"]) {
    let now = 0;
    const budget = createExecutionBudget(manifest, { now: () => now });
    budget.enter("preflight");
    const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      async json() { now = budget.phaseDeadline + 1; return kind === "app" ? { ok: true } : { success: true, result: {} }; },
    });
    await assert.rejects(() => kind === "app" ? appRequest("https://maono.test", "/api/test", { method: "POST", json: {}, budget, fetchImpl }) :
      cfRequest("synthetic", "/client/v4/test", { budget, fetchImpl }), { code: "ACCEPTANCE_PHASE_TIMEOUT" });
  }
});

test("response body transport aborts are not swallowed as successful empty JSON", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
    async json() { throw new DOMException("body timed out", "TimeoutError"); },
  });
  await assert.rejects(() => appRequest("https://maono.test", "/api/projects", { method: "POST", json: {}, fetchImpl }), { name: "TimeoutError" });
});

test("suite timeout after slow activation still runs cleanup then restores flags and persists checkpoint", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "acceptance-budget-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = Date.parse("2026-10-05T00:00:00Z"), profileId = 0, reads = 0, patchCount = 0;
  const start = now, events = [], sha = "a".repeat(40);
  let configured = false, canonicalFlag = false, canonicalId = "original", pending = null;
  const deployment = (id = canonicalId, flag = canonicalFlag, status = "success") => ({
    id, environment: "production", url: "https://maono-kepler-v1.pages.dev",
    deployment_trigger: { metadata: { commit_hash: sha, commit_dirty: false } },
    latest_stage: { name: "deploy", status },
    env_vars: { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: { type: "plain_text", value: String(flag) } },
  });
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, method = options.method;
    if (new URL(url).hostname === "api.cloudflare.com") {
      if (method === "PATCH") {
        patchCount++;
        events.push(patchCount === 1 ? "activate" : "restore");
        configured = JSON.parse(options.body).deployment_configs.production.env_vars.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED.value === "true";
        return Response.json({ success: true, result: {} });
      }
      if (method === "POST") {
        pending = { id: `retry-${patchCount}`, readyAt: now + (patchCount === 1 ? 39 * minute : 0), flag: configured };
        return Response.json({ success: true, result: { id: pending.id } });
      }
      if (path.includes("/deployments/") && !path.endsWith("/retry")) {
        const ready = now >= pending.readyAt;
        const result = deployment(pending.id, pending.flag, ready ? "success" : "active");
        if (ready) { canonicalId = pending.id; canonicalFlag = pending.flag; }
        return Response.json({ success: true, result });
      }
      if (path.endsWith("/deployments")) {
        reads++;
        // Initial preflight is quiescent. A later same-SHA deployment requires
        // 20 minutes of quiescence before flags can be touched.
        const waiting = reads > 1 && patchCount === 0 && now < start + 20 * minute;
        return Response.json({ success: true, result: [deployment(canonicalId, canonicalFlag, waiting ? "active" : "success")] });
      }
      return Response.json({ success: true, result: { name: "maono-kepler-v1", production_branch: "mano_kepler_v1", subdomain: "maono-kepler-v1.pages.dev",
        canonical_deployment: deployment(), deployment_configs: { production: { d1_databases: { DB: { id: PRODUCTION_D1_ID } },
          env_vars: { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: { type: "plain_text", value: String(configured) } } } },
      } });
    }
    if (path === "/api/auth/login") {
      profileId++;
      return Response.json({ ok: true }, { headers: { "set-cookie": "maono_session=synthetic; HttpOnly; Secure" } });
    }
    if (path === "/api/session") return Response.json({ authenticated: true, activeOrganization: { id: 1 }, user: { id: profileId, role: "editor" },
      permissions: ["ticket.view", "ticket.create", "ticket.manage", "ticket.access.manage"] });
    assert.equal(path, "/api/organizations/1/tickets");
    events.push("suite-request");
    now += 45 * minute + 1;
    return Response.json({ ok: true });
  };
  t.mock.method(process.stdout, "write", (value) => {
    if (String(value).includes('"event":"ACCEPTANCE_RUN_PREPARED"')) events.push("checkpoint");
    return true;
  });
  const credentials = Object.fromEntries(["manager", "allowed", "restricted"].map((name) => [name, { email: `${name}@example.test`, password: "synthetic" }]));
  const reportPath = join(dir, "report.json");
  const code = await main(["--mode", "run", "--suite", "cc04-selective-access", "--organization-id", "1", "--expected-commit", sha, "--report", reportPath],
    { MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: "synthetic", MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON: JSON.stringify(credentials) },
    { now: () => now, sleep: async (ms) => { now += ms; }, fetchImpl });
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const checkpoint = JSON.parse(await readFile(`${reportPath}.checkpoint.json`, "utf8"));
  assert.equal(code, 1);
  assert.equal(report.error.code, "ACCEPTANCE_PHASE_TIMEOUT");
  assert.equal(report.configurationRestored, true);
  assert.equal(report.cleanupComplete, true, "no application mutation had started before this timeout");
  assert.equal(report.ok, false);
  assert.equal(report.complete, false);
  assert.equal(checkpoint.runId, report.runId);
  assert.deepEqual(events, ["checkpoint", "activate", "suite-request", "restore"]);
  assert.equal(configured, false);
  assert.ok(now - start > 100 * minute);
  assert.ok(now - start < totalBudgetMs(manifest));
});
