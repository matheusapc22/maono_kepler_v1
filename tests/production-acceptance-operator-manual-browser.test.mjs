import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import { createManualAdministration, evidenceDigest, manualFunctionalCases, verifyManualCleanup } from "../scripts/acceptance/manual-evidence.mjs";

const source = await readFile(new URL("../scripts/acceptance/manual-admin-evidence.js", import.meta.url), "utf8");
const ORIGIN = "https://maono-kepler-v1.pages.dev";
const runId = "12345678-1234-4234-8234-123456789abc";
const commit = "a".repeat(40);
const workflowRunId = "9876543210";
const org = { id: 9, slug: "maono-preview-qa", active: true };
const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => value !== null && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  : JSON.stringify(value);
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const options = { suite: "durable-project-save", expectedCommit: commit, workflowRunId };
function resource(kind = "small") {
  return { kind, name: `QA Durable ${runId} ${kind}`, projectId: kind === "small" ? 101 : 103,
    slug: `qa-durable-${runId}-${kind}`, organizationFileId: null, reservationStarted: true, reservationUncertain: false };
}
function beforeFixture(suite = options.suite) {
  return { schemaVersion: 1, kind: "qa-before-inventory", suite, expectedCommit: commit, runId, workflowRunId, workflowRunAttempt: 1,
    administratorUserId: 12, organization: clone(org), capturedAt: "2026-10-07T00:50:00.000Z", origin: ORIGIN,
    inventory: { projects: [], files: [] } };
}
function report(resources = [resource()], suite = options.suite, before = beforeFixture(suite)) {
  const manualAdministration = createManualAdministration(before, 11);
  manualAdministration.resources = resources;
  const safe = { PROJECT_DURABLE_SAVE_V1: false, PROJECT_DURABLE_SAVE_INLINE_ENABLED: true,
    ...(suite === "durable-project-preview" ? { PROJECT_PREVIEW_OPERATIONS_V1: false, PROJECT_PREVIEW_PROCESSOR_ENABLED: false, VITE_PROJECT_PREVIEW_OPERATIONS_V1: false } : {}) };
  const flags = Object.fromEntries(Object.entries(safe).map(([key, value]) => [key, { state: "observed", value }]));
  return {
    reportVersion: 1, mode: "run", runId, suite, expectedCommit: commit, organizationId: 9, workflowRunId, workflowRunAttempt: 1,
    configurationRestored: true, cleanupComplete: false, complete: false, ok: false,
    acceptanceExecuted: true, writesPerformed: true, operationalTestsPassed: true, acceptanceStatus: "PENDING_MANUAL_CLEANUP",
    finishedAt: "2026-10-07T01:00:00.000Z", cases: manualFunctionalCases(suite).map((id) => ({ id, status: "PASS" })),
    cleanupErrors: [{ code: "MANUAL_CLEANUP_REQUIRED" }], error: { code: "MANUAL_CLEANUP_REQUIRED" },
    final: { databaseId: "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db", baseUrl: ORIGIN, configuredFlags: flags,
      canonical: { commit, status: "success", commitDirty: false, flags } },
    manualAdministration,
  };
}
function seed(kind = "small") {
  const item = resource(kind);
  return {
    project: { id: item.projectId, name: item.name, slug: item.slug, organizationId: 9, organization: org,
      createdBy: { id: 11, name: "Private creator", email: "private@example.test" }, organizationFileId: item.projectId + 1,
      dropboxRootPath: "/private-dropbox-path", description: "private description", defaultConfigFile: "private.json" },
    file: { id: item.projectId + 1, name: item.name, organizationId: 9, active: false, isProject: true,
      fileName: "private.json", documentData: "private-document", dropboxPath: "/private-dropbox-path" },
  };
}
function harness({ origin = ORIGIN, seeded = false, patch = null, timeout = false } = {}) {
  const projects = new Map();
  const files = new Map();
  const events = [];
  const session = { authenticated: true, user: { id: 12, role: "super_admin", email: "admin@example.test" },
    activeOrganization: clone(org), organizations: [{ id: 99, name: "private account list" }] };
  function add(kind = "small") {
    const value = seed(kind);
    projects.set(value.project.id, value.project);
    files.set(value.file.id, value.file);
    return value;
  }
  if (seeded) add();
  function clean() {
    projects.clear();
    for (const file of files.values()) Object.assign(file, { active: false, isProject: false });
  }
  const sandbox = {
    location: { origin }, TextEncoder, TextDecoder, AbortController, Uint8Array,
    crypto: { subtle: webcrypto.subtle, randomUUID: () => runId },
    setTimeout: timeout ? (callback) => setTimeout(callback, 5) : setTimeout, clearTimeout,
    async fetch(url, init) {
      const path = url.slice(ORIGIN.length);
      events.push({ url, path, init });
      assert.equal(new URL(url).origin, ORIGIN);
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.redirect, "error");
      assert.equal(init.mode, "same-origin");
      assert.equal(init.cache, "no-store");
      assert.deepEqual(clone(init.headers), { Accept: "application/json" });
      assert.equal(Object.hasOwn(init, "body"), false);
      assert.ok(init.signal instanceof AbortSignal);
      let body;
      let status = 200;
      if (path === "/api/session") body = session;
      else if (path === "/api/admin/organizations/9") body = { ok: true, organization: { ...org, dropboxRootPath: "/secret", users: ["private-user"] } };
      else if (path === "/api/admin/projects?organizationId=9") body = { ok: true, scope: "organization", organizationId: 9, projects: [...projects.values()].map(({ organizationFileId: _unused, ...project }) => project) };
      else if (path === "/api/admin/organizations/9/files") body = { ok: true, organization: org,
        files: [...files.values()].map((file) => ({ ...file, linkedProject: [...projects.values()].find((project) => project.organizationFileId === file.id) || null })),
        dropboxEntries: [{ name: "private account document", id: "secret-dropbox-id", size: 10 }] };
      else if (/^\/api\/admin\/projects\/[0-9]+$/.test(path)) {
        const project = projects.get(Number(path.split("/").at(-1)));
        body = project ? { ok: true, project } : { ok: false, error: { code: "PROJECT_NOT_FOUND" } };
        if (!project) status = 404;
      } else if (/^\/api\/admin\/organization-files\/[0-9]+$/.test(path)) {
        const file = files.get(Number(path.split("/").at(-1)));
        body = file ? { ok: true, file } : { ok: false, error: { code: "ORGANIZATION_FILE_NOT_FOUND" } };
        if (!file) status = 404;
      } else assert.fail(`Unexpected request ${path}`);
      const change = await patch?.({ path, body: clone(body), status, init });
      if (change?.response) return change.response;
      const response = new Response(change?.raw ?? JSON.stringify(change?.body ?? body), { status: change?.status ?? status,
        headers: { "content-type": "application/json", ...change?.headers } });
      Object.defineProperty(response, "url", { value: change?.url ?? url });
      if (change?.redirected) Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
  };
  for (const key of ["document", "localStorage", "sessionStorage"]) Object.defineProperty(sandbox, key, {
    get() { assert.fail(`Forbidden access to ${key}`); },
  });
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "manual-admin-evidence.js" });
  return { api: sandbox.MaonoAcceptanceEvidence, sandbox, projects, files, session, events, add, clean };
}
function rejects(promise, code) { return assert.rejects(promise, (error) => error.code === code); }

test("console helper exposes only a frozen, read-only API without implicit requests", () => {
  const h = harness();
  assert.deepEqual(Object.keys(h.api).sort(), ["after", "before", "inspect"]);
  assert.equal(Object.isFrozen(h.api), true);
  assert.equal(Object.getOwnPropertyDescriptor(h.sandbox, "MaonoAcceptanceEvidence").writable, false);
  assert.equal(h.events.length, 0);
  assert.throws(() => vm.runInContext(source, h.sandbox), /QA_HELPER_ALREADY_INSTALLED/);
});

test("before exports bounded synthetic metadata, allowing only inactive unlinked historical tombstones", async () => {
  const h = harness();
  h.files.set(55, { id: 55, name: "QA Durable prior small", organizationId: 9, active: false, isProject: false, documentData: "private" });
  h.files.set(56, { id: 56, name: "Real document", organizationId: 9, active: true, isProject: false, documentData: "private" });
  const before = await h.api.before(options);
  assert.deepEqual(clone(before), {
    schemaVersion: 1, kind: "qa-before-inventory", suite: options.suite, expectedCommit: commit,
    runId, workflowRunId, workflowRunAttempt: 1, administratorUserId: 12, organization: org, capturedAt: before.capturedAt, origin: ORIGIN,
    inventory: { projects: [], files: [{ id: 55, name: "QA Durable prior small", organizationId: 9, active: false, isProject: false, linkedProjectId: null }] },
  });
  assert.equal(Object.isFrozen(before.inventory.files[0]), true);
  assert.ok(Buffer.byteLength(JSON.stringify(before)) <= 24 * 1024);
  assert.doesNotMatch(JSON.stringify(before), /private|dropbox|email|documentData|Real document/i);
  assert.equal(h.events.length, 4);
});

test("inspect resolves omitted creator file ID; after proves 404 plus file flags and fresh inventory links", async () => {
  const h = harness({ seeded: true });
  const original = report();
  const unchanged = JSON.stringify(original);
  const inspection = await h.api.inspect(original);
  assert.equal(inspection.reportDigest, digest(original));
  assert.equal(inspection.administratorUserId, 12);
  assert.deepEqual(clone(inspection.resources), [{ kind: "small", name: resource().name, projectId: 101,
    slug: resource().slug, organizationFileId: 102, createdById: 11, organizationId: 9 }]);
  assert.doesNotMatch(JSON.stringify(inspection), /private|dropbox|email|documentData/i);
  h.clean();
  const after = await h.api.after(original, clone(inspection));
  assert.equal(after.reportDigest, digest(original));
  assert.equal(after.administratorUserId, 12);
  assert.deepEqual(clone(after.inspection), clone(inspection));
  assert.deepEqual(clone(after.observations), [{ projectId: 101, projectStatus: 404,
    file: { id: 102, name: resource().name, organizationId: 9, active: false, isProject: false, linkedProjectId: null } }]);
  assert.equal(after.inventory.projects.length, 0);
  assert.equal(after.inventory.files.length, 1);
  assert.equal(Object.isFrozen(after.observations[0].file), true);
  assert.equal(JSON.stringify(original), unchanged);
  assert.doesNotMatch(JSON.stringify(after), /private|dropbox|email|documentData/i);
  assert.ok(h.events.some((event) => event.path === "/api/admin/organization-files/102"));
});

test("inspection and closure cover both resource kinds while preserving historical tombstones", async () => {
  const h = harness({ seeded: true });
  h.add("large");
  h.files.set(55, { id: 55, name: "QA Durable prior small", organizationId: 9, active: false, isProject: false });
  const original = report([resource(), resource("large")]);
  const inspection = await h.api.inspect(original);
  assert.equal(inspection.resources.length, 2);
  h.clean();
  const after = await h.api.after(original, inspection);
  assert.equal(after.observations.length, 2);
  assert.equal(after.inventory.files.length, 3);
});

test("unstarted resources remain in original report, but never appear in inspection or requests", async () => {
  const h = harness({ seeded: true });
  const unstarted = { ...resource("large"), projectId: null, slug: null, organizationFileId: null, reservationStarted: false };
  const original = report([resource(), unstarted]);
  const inspection = await h.api.inspect(original);
  assert.equal(inspection.resources.length, 1);
  h.clean();
  assert.equal((await h.api.after(original, inspection)).observations.length, 1);
  assert.equal(original.manualAdministration.resources.length, 2);
});

for (const kind of ["before", "inspect"]) test(`${kind} refuses a different origin before any request`, async () => {
  const h = harness({ origin: "https://evil.example" });
  await rejects(h.api[kind](kind === "before" ? options : report()), "QA_ORIGIN_MISMATCH");
  assert.equal(h.events.length, 0);
});

for (const [label, change, code] of [
  ["logged out", (s) => { s.authenticated = false; }, "QA_SUPER_ADMIN_REQUIRED"],
  ["creator role", (s) => { s.user.role = "editor"; }, "QA_SUPER_ADMIN_REQUIRED"],
  ["invalid admin ID", (s) => { s.user.id = "12"; }, "QA_SUPER_ADMIN_REQUIRED"],
  ["wrong organization", (s) => { s.activeOrganization.id = 10; }, "QA_ORGANIZATION_MISMATCH"],
  ["wrong organization slug", (s) => { s.activeOrganization.slug = "other"; }, "QA_ORGANIZATION_MISMATCH"],
  ["inactive organization", (s) => { s.activeOrganization.active = false; }, "QA_ORGANIZATION_MISMATCH"],
]) test(`before rejects ${label}`, async () => {
  const h = harness(); change(h.session);
  await rejects(h.api.before(options), code);
  assert.equal(h.events.length, 1);
});

test("inspect rejects a changed administrator and same creator/admin identity", async () => {
  const h = harness({ seeded: true });
  h.session.user.id = 13;
  await rejects(h.api.inspect(report()), "QA_ADMINISTRATOR_ID_MISMATCH");
  const original = report(); original.manualAdministration.administratorUserId = 11;
  await rejects(h.api.inspect(original), "QA_REPORT_INVALID");
});

for (const extra of [{ url: "https://evil.example" }, { method: "DELETE" }, { organizationId: 10 }]) test(`before rejects arbitrary request option ${Object.keys(extra)[0]}`, async () => {
  const h = harness();
  await rejects(h.api.before({ ...options, ...extra }), "QA_OPTIONS_INVALID");
  assert.equal(h.events.length, 0);
});

for (const change of [{ url: "https://evil.example/api/session" }, { redirected: true }, { status: 302 }]) test(`refuses redirected/foreign response ${JSON.stringify(change)}`, async () => {
  const h = harness({ patch: () => change });
  await assert.rejects(h.api.before(options));
  assert.equal(h.events.length, 1);
});

for (const target of ["projects", "files"]) test(`before validates non-synthetic ${target} organization before filtering`, async () => {
  const h = harness();
  if (target === "projects") h.projects.set(50, { id: 50, name: "Real project", slug: "real", organizationId: 10 });
  else h.files.set(50, { id: 50, name: "Real document", organizationId: 10, active: false, isProject: false });
  await rejects(h.api.before(options), "QA_INVENTORY_SCOPE_MISMATCH");
});

for (const target of ["/api/admin/projects?organizationId=9", "/api/admin/organizations/9/files"]) test(`refuses hidden truncation/pagination at ${target}`, async () => {
  for (const extra of [{ hasMore: true }, { nextCursor: "next" }, { total: 5 }, { truncated: true }]) {
    const h = harness({ patch: ({ path, body }) => path === target ? { body: { ...body, ...extra } } : undefined });
    await rejects(h.api.before(options), "QA_INVENTORY_INCOMPLETE");
  }
});

test("requires original complete arrays, scoped envelope and explicit file link state", async () => {
  for (const mutate of [
    (body) => { delete body.projects; }, (body) => { body.scope = "global"; }, (body) => { body.organizationId = 10; },
  ]) {
    const h = harness({ patch: ({ path, body }) => { if (path.includes("?")) { mutate(body); return { body }; } } });
    await rejects(h.api.before(options), "QA_INVENTORY_INCOMPLETE");
  }
  const h = harness({ patch: ({ path, body }) => {
    if (path.endsWith("/files")) return { body: { ...body, files: [{ id: 55, name: "QA Durable old", organizationId: 9, active: false, isProject: false }] } };
  } });
  await rejects(h.api.before(options), "QA_INVENTORY_INCOMPLETE");
});

test("before rejects active synthetic resources, draft projects and same-run tombstone collisions", async () => {
  const h = harness({ seeded: true });
  await rejects(h.api.before(options), "QA_PRIOR_CLEANUP_UNVERIFIED");
  h.clean();
  await rejects(h.api.before(options), "QA_RUN_ID_COLLISION");
  h.files.get(102).name = "QA Durable older small";
  h.files.get(102).active = true;
  await rejects(h.api.before(options), "QA_PRIOR_CLEANUP_UNVERIFIED");
  h.files.get(102).active = false; h.files.get(102).isProject = true;
  await rejects(h.api.before(options), "QA_PRIOR_CLEANUP_UNVERIFIED");
});

test("before rejects export overflow rather than truncating historical file inventory", async () => {
  const h = harness();
  for (let id = 1; id <= 60; id++) h.files.set(id, { id, name: `QA Durable historical ${id} ${"x".repeat(450)}`, organizationId: 9, active: false, isProject: false });
  await rejects(h.api.before(options), "QA_EXPORT_TOO_LARGE");
});

for (const declared of [true, false]) test(`response limit is enforced ${declared ? "from length header" : "while streaming"}`, async () => {
  const h = harness({ patch: () => declared
    ? { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }
    : { raw: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024 + 1) }) } });
  await rejects(h.api.before(options), "QA_RESPONSE_TOO_LARGE");
});

test("deadline bounds hung responses and aborts the GET", async () => {
  const h = harness({ timeout: true, patch: () => new Promise(() => {}) });
  await rejects(h.api.before(options), "QA_REQUEST_TIMEOUT");
  assert.equal(h.events[0].init.signal.aborted, true);
});

for (const change of [
  { reservationUncertain: true }, { projectId: null }, { projectId: null, reservationUncertain: true }, { slug: null },
]) test(`lost acknowledgement cannot be certified from inventory ${JSON.stringify(change)}`, async () => {
  const h = harness({ seeded: true });
  await rejects(h.api.inspect(report([{ ...resource(), ...change }])), "QA_RESERVATION_OUTCOME_UNCERTAIN");
  assert.equal(h.events.length, 0);
});

for (const [label, patch] of [
  ["creator", { createdBy: { id: 99 } }], ["organization", { organizationId: 10 }],
  ["project ID", { id: 999 }], ["name", { name: "QA Durable other small" }],
  ["slug", { slug: "qa-durable-other-small" }], ["file ID", { organizationFileId: 999 }],
]) test(`inspect refuses project-detail ${label} drift`, async () => {
  const h = harness({ seeded: true, patch: ({ path, body }) => path === "/api/admin/projects/101" ? { body: { ...body, project: { ...body.project, ...patch } } } : undefined });
  await rejects(h.api.inspect(report()), "QA_CLEANUP_SCOPE_MISMATCH");
});

test("inspect refuses ambiguous run-name collisions and missing project/file linkage", async () => {
  const h = harness({ seeded: true });
  h.files.set(500, { ...h.files.get(102), id: 500 });
  await rejects(h.api.inspect(report()), "QA_CLEANUP_SCOPE_MISMATCH");
  h.files.delete(500); h.projects.get(101).organizationFileId = 999;
  await rejects(h.api.inspect(report()), "QA_CLEANUP_SCOPE_MISMATCH");
});

test("after binds the whole unchanged report digest and administrator, not a cleanup checkbox", async () => {
  const h = harness({ seeded: true });
  const original = report();
  const inspection = await h.api.inspect(original);
  h.clean();
  const changed = clone(original); changed.cases[0].details = "different sanitized result";
  await rejects(h.api.after(changed, inspection), "QA_INSPECTION_BINDING_MISMATCH");
  await rejects(h.api.after(original, { ...clone(inspection), administratorUserId: 13 }), "QA_INSPECTION_BINDING_MISMATCH");
  await rejects(h.api.after(original, { cleanupComplete: true }), "QA_INSPECTION_INVALID");
  h.session.user.id = 13;
  await rejects(h.api.after(original, inspection), "QA_ADMINISTRATOR_ID_MISMATCH");
});

test("after refuses metadata-only success while actual projects or files remain", async () => {
  const h = harness({ seeded: true });
  const original = report(); original.cleanupComplete = true;
  const inspection = await h.api.inspect(original);
  await rejects(h.api.after(original, inspection), "QA_HTTP_STATUS_UNEXPECTED");
  h.projects.clear();
  await rejects(h.api.after(original, inspection), "QA_CLEANUP_UNVERIFIED");
  h.clean();
  h.files.get(102).active = true;
  await rejects(h.api.after(original, inspection), "QA_CLEANUP_UNVERIFIED");
});

test("after requires fresh inventory proving no hidden link even when file detail flags are false", async () => {
  let extraLink = false;
  const h = harness({ seeded: true, patch: ({ path, body }) => {
    if (extraLink && path.endsWith("/files")) body.files[0].linkedProject = { id: 900, name: "Other", slug: "other" };
    return { body };
  } });
  const original = report();
  const inspection = await h.api.inspect(original);
  h.clean(); extraLink = true;
  await rejects(h.api.after(original, inspection), "QA_INVENTORY_DRIFT");
});

test("after rejects different file identity and incomplete fresh inventory", async () => {
  let stage = "inspect";
  const h = harness({ seeded: true, patch: ({ path, body }) => {
    if (stage === "identity" && path === "/api/admin/organization-files/102") body.file.name = "Real user document";
    if (stage === "inventory" && path.endsWith("/files")) body.files = [];
    return { body };
  } });
  const original = report(); const inspection = await h.api.inspect(original); h.clean();
  stage = "identity"; await rejects(h.api.after(original, inspection), "QA_CLEANUP_UNVERIFIED");
  stage = "inventory"; await rejects(h.api.after(original, inspection), "QA_CLEANUP_UNVERIFIED");
});

test("reports must be finished, restored, bound JSON data without accessors or arbitrary resource paths", async () => {
  const h = harness();
  for (const change of [{ configurationRestored: false }, { finishedAt: null }, { mode: "closure" }]) {
    await rejects(h.api.inspect({ ...report(), ...change }), "QA_RUN_NOT_FINISHED");
  }
  await rejects(h.api.inspect({ ...report(), organizationId: 10 }), "QA_REPORT_BINDING_MISMATCH");
  const bad = report(); Object.defineProperty(bad, "danger", { enumerable: true, get() { assert.fail("Getter executed"); } });
  await rejects(h.api.inspect(bad), "QA_INPUT_INVALID");
  await rejects(h.api.inspect(report([{ ...resource(), projectId: "../../admin/users" }])), "QA_REPORT_INVALID");
  assert.equal(h.events.length, 0);
});

test("preview suite remains restricted to its small synthetic resource", async () => {
  const h = harness({ seeded: true });
  const original = report([resource()], "durable-project-preview");
  const inspection = await h.api.inspect(original);
  assert.equal(inspection.suite, "durable-project-preview");
  original.manualAdministration.resources = [resource("large")];
  await rejects(h.api.inspect(original), "QA_REPORT_INVALID");
});

for (const suite of ["durable-project-save", "durable-project-preview"]) test(`actual ${suite} report shape round-trips through browser evidence and Node cleanup verifier`, async () => {
  const h = harness();
  const before = await h.api.before({ ...options, suite });
  const resources = suite === "durable-project-save" ? [resource(), resource("large")] : [resource()];
  resources.forEach((row) => h.add(row.kind));
  const original = report(resources, suite, clone(before));
  original.finishedAt = new Date().toISOString();
  assert.equal(original.manualAdministration.beforeInventoryDigest, evidenceDigest(before));
  const inspection = await h.api.inspect(original);
  h.clean();
  const after = await h.api.after(original, clone(inspection));
  const verified = verifyManualCleanup(clone(original), clone(after));
  assert.equal(verified.ok, true);
  assert.equal(verified.complete, true);
  assert.equal(verified.cleanupComplete, true);
  assert.equal(verified.reportDigest, evidenceDigest(original));
  assert.equal(verified.evidenceDigest, evidenceDigest(after));
});

test("original before inventory digest and every run/organization/administrator binding are verified before requests", async () => {
  for (const [mutate, code] of [
    [(m) => { m.beforeInventoryDigest = "c".repeat(64); }, "QA_BEFORE_DIGEST_MISMATCH"],
    [(m) => { m.beforeInventory.capturedAt = "2026-10-07T00:49:00.000Z"; }, "QA_BEFORE_DIGEST_MISMATCH"],
    [(m) => { m.origin = "https://other.example"; }, "QA_REPORT_INVALID"],
    [(m) => { m.beforeInventory.origin = "https://other.example"; }, "QA_BEFORE_BINDING_MISMATCH"],
    [(m) => { m.beforeInventory.runId = "11111111-1111-4111-8111-111111111111"; }, "QA_BEFORE_BINDING_MISMATCH"],
    [(m) => { m.beforeInventory.expectedCommit = "c".repeat(40); }, "QA_BEFORE_BINDING_MISMATCH"],
    [(m) => { m.beforeInventory.suite = "durable-project-preview"; }, "QA_BEFORE_BINDING_MISMATCH"],
    [(m) => { m.beforeInventory.administratorUserId = 99; }, "QA_BEFORE_BINDING_MISMATCH"],
    [(m) => { m.beforeInventory.organization.id = 10; }, "QA_ORGANIZATION_MISMATCH"],
    [(m) => { m.beforeInventory.inventory.files.push({ id: 50, name: `QA Durable ${runId} small`, organizationId: 9, active: false, isProject: false, linkedProjectId: null }); }, "QA_BEFORE_BINDING_MISMATCH"],
    [(m) => { m.beforeInventory.inventory.projects.push({ id: 50 }); }, "QA_BEFORE_BINDING_MISMATCH"],
    [(m) => { m.beforeInventory.accountList = ["private"]; }, "QA_BEFORE_BINDING_MISMATCH"],
  ]) {
    const h = harness({ seeded: true });
    const original = report(); mutate(original.manualAdministration);
    await rejects(h.api.inspect(original), code);
    assert.equal(h.events.length, 0);
  }
});

test("synthetic export count is bounded to the standalone validator limit without truncation", async () => {
  const h = harness();
  for (let id = 1; id <= 65; id++) h.files.set(id, { id, name: `QA Durable historical ${id}`, organizationId: 9, active: false, isProject: false });
  await rejects(h.api.before(options), "QA_INVENTORY_TOO_LARGE");
});

test("inspection never hands out cleanup identities before the safe manual barrier is proven", async () => {
  for (const cleanupErrors of [undefined, [], [{ code: "BROWSER_NOT_SETTLED" }],
    [{ code: "MANUAL_CLEANUP_REQUIRED" }, { code: "QA_RESERVATION_OUTCOME_UNCERTAIN" }]]) {
    const h = harness({ seeded: true });
    const original = report();
    if (cleanupErrors === undefined) delete original.cleanupErrors;
    else original.cleanupErrors = cleanupErrors;
    await rejects(h.api.inspect(original), "QA_CLEANUP_BARRIER_UNVERIFIED");
    assert.equal(h.events.length, 0);
  }
});

test("failed or uncertain remote work blocks inspect and after despite known IDs and restored flags", async () => {
  const changes = [
    (value) => { value.operationalTestsPassed = false; },
    (value) => { delete value.operationalTestsPassed; },
    (value) => { value.acceptanceStatus = "FAILED"; },
    (value) => { delete value.acceptanceStatus; },
    (value) => { value.error = { code: "DURABLE_RECOVERY_TIMEOUT" }; },
    (value) => { value.error = { code: "PREVIEW_CALLBACK_TIMEOUT" }; },
    (value) => { value.budgetError = { code: "ACCEPTANCE_BUDGET_EXHAUSTED" }; },
    (value) => { value.restoreError = { code: "RESTORE_FAILED" }; },
    (value) => { value.cases[0].status = "FAIL"; },
    (value) => { value.cases.pop(); },
    (value) => { value.cases.push({ ...value.cases[0] }); },
  ];
  for (const suite of ["durable-project-save", "durable-project-preview"]) {
    const baseline = harness({ seeded: true });
    const original = report([resource()], suite);
    const inspection = await baseline.api.inspect(original);
    for (const change of changes) {
      const h = harness({ seeded: true });
      const failed = clone(original); change(failed);
      await rejects(h.api.inspect(failed), "QA_REMOTE_OPERATIONS_UNRECONCILED");
      h.clean();
      await rejects(h.api.after(failed, inspection), "QA_REMOTE_OPERATIONS_UNRECONCILED");
      assert.equal(h.events.length, 0, "known IDs and restored flags must not enable cleanup after remote timeout/callback failure");
    }
  }
});

test("before binds a first-attempt GitHub window run and rejects missing or malformed run identifiers", async () => {
  for (const value of [undefined, null, 1234, "0", "01", "-1", "1.5", "1e3", "123456789012345678901", "https://evil.example"]) {
    const h = harness();
    const input = { ...options, workflowRunId: value };
    if (value === undefined) delete input.workflowRunId;
    await rejects(h.api.before(input), "QA_OPTIONS_INVALID");
    assert.equal(h.events.length, 0);
  }
  const h = harness();
  const before = await h.api.before({ ...options, workflowRunId: "12345678901234567890" });
  assert.equal(before.workflowRunId, "12345678901234567890");
  assert.equal(before.workflowRunAttempt, 1);
});

test("frozen before evidence cannot replay into another GitHub run or any rerun attempt", async () => {
  const changes = [
    (value) => { value.workflowRunId = "9876543211"; },
    (value) => { value.workflowRunId = 9876543210; },
    (value) => { delete value.workflowRunId; },
    (value) => { value.workflowRunAttempt = 2; },
    (value) => { value.workflowRunAttempt = "1"; },
    (value) => { delete value.workflowRunAttempt; },
    (value) => { value.manualAdministration.beforeInventory.workflowRunId = "9876543211"; },
    (value) => { value.manualAdministration.beforeInventory.workflowRunAttempt = 2; },
  ];
  const baseline = harness({ seeded: true });
  const original = report();
  const inspection = await baseline.api.inspect(original);
  for (const change of changes) {
    const h = harness({ seeded: true });
    const replay = clone(original); change(replay);
    await rejects(h.api.inspect(replay), "QA_WORKFLOW_BINDING_MISMATCH");
    h.clean();
    await rejects(h.api.after(replay, inspection), "QA_WORKFLOW_BINDING_MISMATCH");
    assert.equal(h.events.length, 0);
  }
});
