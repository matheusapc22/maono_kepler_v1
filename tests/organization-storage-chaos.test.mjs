import assert from "node:assert/strict";
import test from "node:test";
import { ensureOrganizationStorage, repairActiveOrganizationStorages } from "../functions/_lib/organization-storage.js";
import { readOrganizationStorageReadiness } from "../functions/_lib/organization-storage-readiness.js";
import { readOrganizationStorageIncident, ORGANIZATION_STORAGE_MAX_ATTEMPTS, ORGANIZATION_STORAGE_RETRY_DELAY_MS } from "../functions/_lib/organization-storage-retry.js";
import { createStorageSqliteEnv } from "./helpers/storage-sqlite.mjs";

const NOW = Date.parse("2026-09-19T10:00:00.000Z");
function org(overrides = {}) {
  return { id: 1, name: "Acme", slug: "acme", active: 1, dropbox_root_path: "/projects/acme", storage_status: "ERROR", storage_error: "DROPBOX_UNAVAILABLE", storage_checked_at: "2026-09-18T10:00:00.000Z", ...overrides };
}
function transient() { return Object.assign(new Error("SECRET provider payload"), { code: "DROPBOX_UNAVAILABLE", status: 503, retryable: true }); }

for (const root of ["/Apps/MaonoKepler/preview/qa", "/projects", "/projects/../other"]) {
  test(`protected root ${root} never claims, rewrites or reports READY`, async () => {
    const row = org({ dropbox_root_path: root, storage_status: "READY", storage_error: null });
    const env = createStorageSqliteEnv([row]);
    const before = env.__rows.get(1);
    let calls = 0;
    await assert.rejects(ensureOrganizationStorage(env, row, { nowFn: () => NOW, ensureFolder: async () => { calls++; } }), { code: "ORGANIZATION_STORAGE_PATH_DECISION_REQUIRED" });
    assert.deepEqual(env.__rows.get(1), before);
    assert.equal(readOrganizationStorageReadiness(before).ready, false);
    assert.equal(calls, 0);
  });
}

test("legacy canonical subtree is usable but unattended recovery requires path decision", async () => {
  const row = org({ dropbox_root_path: "/projects/old-name" });
  const env = createStorageSqliteEnv([row]);
  const result = await repairActiveOrganizationStorages(env, { fairOrder: true, nowFn: () => NOW, ensureFolder: async () => { throw new Error("must not call"); } });
  assert.equal(result.ready, 0);
  assert.equal(result.organizations[0].reason, "PATH_LEGACY");
  assert.equal(env.__rows.get(1).dropbox_root_path, row.dropbox_root_path);
});

test("durable retry budget survives fresh invocations and records one correlated incident", async () => {
  const env = createStorageSqliteEnv([org()]);
  let now = NOW;
  let calls = 0;
  let incidentId;
  for (let attempt = 1; attempt <= ORGANIZATION_STORAGE_MAX_ATTEMPTS; attempt++) {
    await assert.rejects(ensureOrganizationStorage(env, org(), {
      nowFn: () => now, ensureFolder: async () => { calls++; throw transient(); },
    }), { code: "ORGANIZATION_STORAGE_PROVISION_FAILED" });
    const incident = readOrganizationStorageIncident(env.__rows.get(1).storage_error);
    incidentId ||= incident.incidentId;
    assert.equal(incident.incidentId, incidentId);
    assert.equal(incident.attemptCount, attempt);
    assert.doesNotMatch(env.__rows.get(1).storage_error, /SECRET|payload/);
    if (attempt < ORGANIZATION_STORAGE_MAX_ATTEMPTS) {
      await assert.rejects(ensureOrganizationStorage(env, org(), { nowFn: () => now + 1, ensureFolder: async () => { calls++; } }), { code: "ORGANIZATION_STORAGE_RETRY_BACKOFF" });
    }
    now += ORGANIZATION_STORAGE_RETRY_DELAY_MS;
  }
  await assert.rejects(ensureOrganizationStorage(env, org(), { nowFn: () => now, ensureFolder: async () => { calls++; } }), { code: "ORGANIZATION_STORAGE_RETRY_EXHAUSTED" });
  assert.equal(calls, ORGANIZATION_STORAGE_MAX_ATTEMPTS);
  const readiness = readOrganizationStorageReadiness(env.__rows.get(1), { nowFn: () => now });
  assert.equal(readiness.retryable, false);
  assert.equal(readiness.recoveryRecommended, false);
  assert.equal(readiness.reason, "STORAGE_RETRY_EXHAUSTED");
  const events = env.__sqlite.prepare("SELECT details FROM audit_logs").all().map((row) => JSON.parse(row.details).metadata);
  assert.equal(events.filter((event) => event.type === "failure").length, 5);
  assert.ok(events.every((event) => event.incidentId === incidentId));
});

test("permanent provider failure is persisted and never retried in later cycles", async () => {
  const env = createStorageSqliteEnv([org()]);
  let calls = 0;
  await assert.rejects(ensureOrganizationStorage(env, org(), {
    nowFn: () => NOW,
    ensureFolder: async () => { calls++; throw Object.assign(new Error("unauthorized"), { code: "DROPBOX_TOKEN_REFRESH_FAILED", status: 401, retryable: false }); },
  }), { retryable: false });
  const next = await repairActiveOrganizationStorages(env, { nowFn: () => NOW + 86400000, fairOrder: true, ensureFolder: async () => { calls++; } });
  assert.equal(next.organizations[0].reason, "RETRY_BLOCKED");
  assert.equal(calls, 1);
});

test("unknown legacy errors and malformed envelopes require operator diagnosis", async () => {
  for (const value of ["SOMETHING_UNKNOWN", '{"v":1,"attemptCount":-1}', "token=secret"]) {
    const env = createStorageSqliteEnv([org({ storage_error: value })]);
    await assert.rejects(ensureOrganizationStorage(env, org(), { nowFn: () => NOW, ensureFolder: async () => { throw new Error("must not call"); } }), { code: "ORGANIZATION_STORAGE_RETRY_BLOCKED" });
    assert.equal(env.__rows.get(1).storage_error, value);
  }
});

test("blocked oldest batch never starves a later recoverable organization", async () => {
  const rows = Array.from({ length: 15 }, (_, i) => org({ id: i + 1, slug: `blocked-${i}`, dropbox_root_path: `/projects/blocked-${i}`, storage_error: "DROPBOX_AUTH_INVALID" }));
  rows.push(org({ id: 99, storage_checked_at: new Date(NOW - 100000).toISOString() }));
  const env = createStorageSqliteEnv(rows);
  const result = await repairActiveOrganizationStorages(env, { limit: 2, fairOrder: true, nowFn: () => NOW, ensureFolder: async () => {} });
  assert.equal(result.ready, 1);
  assert.equal(result.organizations.find((item) => item.status === "READY").organizationId, 99);
});

test("root change or disable during provider call prevents old claim completion", async () => {
  for (const mutation of ["UPDATE organizations SET active=0, storage_status='DISABLED' WHERE id=1", "UPDATE organizations SET dropbox_root_path='/projects/new-root' WHERE id=1"]) {
    const env = createStorageSqliteEnv([org()]);
    const result = await ensureOrganizationStorage(env, org(), { nowFn: () => NOW, ensureFolder: async () => { env.__sqlite.exec(mutation); } });
    assert.equal(result.superseded, true);
    assert.equal(result.ready, false);
    assert.equal(result.physicallyVerified, false);
    assert.notEqual(env.__rows.get(1).storage_status, "READY");
    const observed = env.__sqlite.prepare("SELECT details FROM audit_logs").all().map((row) => JSON.parse(row.details).metadata.type);
    assert.deepEqual(observed, ["attempt"]);
  }
});

test("crashed PENDING attempt retains its consumed budget when lease expires", async () => {
  const env = createStorageSqliteEnv([org()]);
  let finish;
  const first = ensureOrganizationStorage(env, org(), { nowFn: () => NOW, ensureFolder: async () => new Promise((resolve) => { finish = resolve; }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readOrganizationStorageIncident(env.__rows.get(1).storage_error).attemptCount, 1);
  const recovered = await ensureOrganizationStorage(env, org(), { nowFn: () => NOW + 120001, ensureFolder: async () => {} });
  assert.equal(recovered.attemptCount, 2);
  assert.equal(recovered.ready, true);
  finish();
  const obsolete = await first;
  assert.equal(obsolete.superseded, true);
  assert.equal(obsolete.physicallyVerified, false);
});

test("even root-only caller must validate documents before publishing READY", async () => {
  const env = createStorageSqliteEnv([org()]);
  const calls = [];
  const result = await ensureOrganizationStorage(env, org(), { nowFn: () => NOW, provisionDocuments: false, ensureFolder: async (_env, path) => calls.push(path) });
  assert.deepEqual(calls, ["/projects/acme/documents"]);
  assert.equal(result.physicallyVerified, true);
  const operational = JSON.parse(env.__sqlite.prepare("SELECT details FROM audit_logs ORDER BY id DESC LIMIT 1").get().details).metadata;
  assert.equal(operational.type, "operational");
  assert.equal(operational.physicallyVerified, true);
});

test("permanent failure only rearms when approved operator explicitly resets budget", async () => {
  const { applyOrganizationStorageDriftRepairs } = await import("../functions/_lib/organization-storage-drift.js");
  const env = createStorageSqliteEnv([org()]);
  await assert.rejects(ensureOrganizationStorage(env, org(), { nowFn: () => NOW, ensureFolder: async () => { throw Object.assign(new Error("auth"), { code: "DROPBOX_AUTH_INVALID", retryable: false }); } }));
  const previous = readOrganizationStorageIncident(env.__rows.get(1).storage_error);
  const report = () => ({ complete: true, organizations: [{ id: 1, active: true, repairable: true, issues: [{ code: "PHYSICAL_PRESENT_STORAGE_NOT_READY", repairable: true }] }], _rowsById: new Map([[1, env.__rows.get(1)]]) });
  const options = {
    approvedOrganizationIds: [1], confirmation: "APPLY_APPROVED_STORAGE_DRIFT", nowFn: () => NOW + 1000,
    buildReport: async () => report(),
    ensureStorage: (env, row, opts) => ensureOrganizationStorage(env, row, { ...opts, ensureFolder: async () => {} }),
  };
  const blocked = await applyOrganizationStorageDriftRepairs(env, options);
  assert.equal(blocked.failed, 1);
  assert.equal(blocked.repaired, 0);
  const reset = await applyOrganizationStorageDriftRepairs(env, { ...options, resetRetryBudget: true });
  assert.equal(reset.repaired, 1);
  const events = env.__sqlite.prepare("SELECT details FROM audit_logs").all().map((row) => JSON.parse(row.details).metadata);
  const rearmed = events.find((event) => event.retryBudgetReset === true);
  assert.ok(rearmed);
  assert.equal(rearmed.previousIncidentId, previous.incidentId);
  assert.notEqual(rearmed.incidentId, previous.incidentId);
  assert.equal(rearmed.manualIntervention, true);
});

test("malformed or contradictory legacy envelopes cannot occupy the eligible queue", async () => {
  const errors = ['{"v":1,"attemptCount":1,"retryable":true}', 'SECRET=NETWORK', 'DROPBOX_AUTH_NETWORK'];
  const rows = errors.map((storage_error, i) => org({ id: i + 1, slug: `blocked-${i}`, dropbox_root_path: `/projects/blocked-${i}`, storage_error }));
  rows.push(org({ id: 99, storage_checked_at: new Date(NOW - 100000).toISOString() }));
  const env = createStorageSqliteEnv(rows);
  const result = await repairActiveOrganizationStorages(env, { limit: 1, fairOrder: true, nowFn: () => NOW, ensureFolder: async () => {} });
  assert.equal(result.ready, 1);
  assert.equal(result.organizations[0].organizationId, 99);
});
