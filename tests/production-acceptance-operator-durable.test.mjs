import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { manifest, prepare, run, verifyPreflight, makeManifest, createSyntheticProjectForPreview } from "../scripts/acceptance/suites/durable-project-save.mjs";
import { buildProfiles, validateManifest, activeFlags, safeFlags, transitionFlags, suiteContext, PRODUCTION_D1_ID, safeError } from "../scripts/acceptance/production-acceptance-lib.mjs";
import { createManualAdministration } from "../scripts/acceptance/manual-evidence.mjs";
import { main } from "../scripts/acceptance/operator.mjs";
import { publicManifest } from "../scripts/acceptance/registry.mjs";

const runId = "12345678-1234-4234-8234-123456789abc";
const organization = { id: 9, slug: "maono-preview-qa", active: true };
const expectedCommit = "a".repeat(40);
const workflowRunId = "123456789";
function beforeInventory(suite = manifest.id, inventory = { projects: [], files: [] }) {
  return { schemaVersion: 1, kind: "qa-before-inventory", suite, expectedCommit, runId, workflowRunId, workflowRunAttempt: 1,
    organization, administratorUserId: 12, capturedAt: new Date().toISOString(), origin: "https://maono-kepler-v1.pages.dev", inventory };
}
function profiles() {
  return { creator: { organization, user: { id: 11, role: "editor", permissions: ["project.create"] } } };
}
function harness({ payloadFailure = null, lostReservation = false, foreignProject = false, failJournal = false, fastWorker = false, delayedReservation = false, verifyCleanupRegistration = true, inventory = { projects: [], files: [] } } = {}) {
  const events = [], projects = new Map(), files = new Map(), operations = new Map(), cleanups = [], journals = [];
  let sequence = 100;
  let lateCommit = null;
  const reply = (body, status = 200) => ({ status, body: { ok: true, ...body } });
  const manualInventory = beforeInventory(manifest.id, inventory);
  const ctx = { ...suiteContext({ baseUrl: "https://maono-kepler-v1.pages.dev", runId, organizationId: 9, profiles: profiles(),
    manifest, suite: manifest.id, expectedCommit, manualInventory, manualAdministration: createManualAdministration(manualInventory, 11),
    deps: { async onManualJournal(journal) { if (failJournal) throw new Error("simulated manual journal failure"); journals.push(structuredClone(journal)); } },
  }), cases: [],
    record(id, status, details = {}) { this.cases.push({ id, status, ...details }); },
    registerCleanup(fn) { events.push({ cleanupRegistered: true }); cleanups.push(fn); },
    async api(profile, path, options = {}) {
      const method = options.method || "GET";
      events.push({ profile, path, method, options });
      if (method !== "GET" && verifyCleanupRegistration) assert.ok(events.some((e) => e.cleanupRegistered), "cleanup must be armed before application mutation");
      assert.equal(profile, "creator", "only the editor QA session may enter CI");
      assert.ok(!path.startsWith("/api/admin/"), "human inventory is supplied as evidence, never queried by CI");
      assert.ok(!["DELETE", "PATCH"].includes(method), "resource cleanup is exclusively manual");
      if (path === "/api/projects" && method === "GET") return reply({ projects: [...projects.values()] });
      if (!options.headers?.["X-Maono-Client-Contract"] || options.headers["X-Maono-Client-Contract"] === "1") {
        assert.ok(["POST", "PUT"].includes(method));
        assert.match(options.body, /synthetic-old-client-invalid-json/);
        return { status: 412, body: { ok: false, error: { code: "SAVE_CLIENT_CONTRACT_UNSUPPORTED" } } };
      }
      if (path === "/api/projects") {
        assert.equal(method, "POST");
        assert.equal(options.json.durableSave, true);
        assert.equal(options.json.organizationId, 9);
        assert.ok(Buffer.byteLength(JSON.stringify(options.json)) < 16 * 1024);
        assert.match(options.json.name, new RegExp(runId));
        const existing = [...projects.values()].find((p) => p.name === options.json.name);
        if (existing) return reply({ project: existing, idempotent: true, status: "active", configRevision: existing.revision });
        const project = { id: ++sequence, name: options.json.name, slug: options.json.name.toLowerCase().replaceAll(" ", "-"), organizationId: 9, createdBy: { id: 11 }, organizationFileId: ++sequence, revision: 0 };
        if (delayedReservation) {
          lateCommit = () => { projects.set(project.id, project); files.set(project.organizationFileId, { id: project.organizationFileId, organizationId: 9, name: project.name, active: false, isProject: true }); };
          throw new Error("reservation request timed out before its later server commit");
        }
        files.set(project.organizationFileId, { id: project.organizationFileId, organizationId: 9, name: project.name, active: false, isProject: true });
        projects.set(project.id, project);
        if (lostReservation) throw new Error("simulated lost reservation acknowledgement");
        return reply({ project: foreignProject ? { ...project, createdBy: { id: 999 } } : project, status: "pending", creation: { transport: "durable-operation", expectedRevision: 0 } }, 202);
      }
      const routed = path.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
      assert.ok(routed, `unbounded/unexpected route: ${method} ${path}`);
      const project = [...projects.values()].find((p) => p.slug === routed[1]);
      assert.ok(project);
      assert.equal(options.headers["X-Maono-Project-Id"], String(project.id));
      if (routed[2] === "config-stream?delivery=direct") return reply({ transport: "direct", revision: project.revision, sizeBytes: 94 * 1024 * 1024 });
      const result = (op) => ({ operation: { ...op.public, currentRevision: project.revision }, currentRevision: project.revision });
      if (routed[2] === "save-operations") {
        assert.equal(method, "POST");
        const input = options.json;
        assert.match(input.operationId, new RegExp(`^qa-durable:${runId}:`));
        assert.equal(input.checksumAlgorithm, "dropbox-content-hash");
        const existing = operations.get(input.operationId);
        if (existing && JSON.stringify(existing.input) !== JSON.stringify(input)) return { status: 409, body: { ok: false, error: { code: "OPERATION_PAYLOAD_MISMATCH" } } };
        const op = existing || { input, public: { operationId: input.operationId, projectId: project.id, organizationId: 9, state: "AWAITING_UPLOAD", receipt: null, terminal: false, payloadStored: false } };
        operations.set(input.operationId, op);
        return reply(result(op), 201);
      }
      const operationRoute = routed[2].match(/^save-operations\/([^/]+)(\/payload)?$/);
      assert.ok(operationRoute, "only bounded operation endpoints are allowed");
      const op = operations.get(decodeURIComponent(operationRoute[1]));
      assert.ok(op);
      if (operationRoute[2]) {
        assert.equal(method, "PUT");
        assert.equal(typeof options.body, "string");
        assert.equal(Buffer.byteLength(options.body), op.input.payloadBytes);
        if (payloadFailure && op.input.operationId.endsWith(`:${payloadFailure.kind}:create`)) return payloadFailure.response;
        if (op.public.state === "PUBLISHED") return reply(result(op));
        op.public.state = "PAYLOAD_STORED";
        op.public.payloadStored = true;
        if (!fastWorker) return reply(result(op), 202);
      } else assert.equal(method, "GET");
      // Model an independent Worker committing before the first status read.
      // This is a contract mock, not evidence of real cloud scheduling.
      if (op.public.state === "PAYLOAD_STORED") {
        op.public.terminal = true;
        if (project.revision !== op.input.expectedConfigRevision) {
          op.public.state = "CONFLICT";
          op.public.errorCode = "PROJECT_CONFIG_REVISION_CONFLICT";
        } else {
          project.revision++;
          op.public.state = "PUBLISHED";
          op.public.receipt = { operationId: op.input.operationId, projectId: project.id, organizationId: 9, baseRevision: op.input.expectedConfigRevision, publishedRevision: project.revision,
            checksum: op.input.contentHash, checksumAlgorithm: op.input.checksumAlgorithm, sizeBytes: op.input.payloadBytes, committedAt: "2026-10-05T00:00:00.000Z" };
        }
      }
      return reply(result(op));
    },
    async cleanup() { for (const cleanup of cleanups.reverse()) await cleanup(); },
  };
  return { ctx, events, projects, files, operations, journals, failJournalWrites() { failJournal = true; }, commitDelayedReservation: () => lateCommit?.() };
}

test("durable suite is registered with only the exact two additional managed flags", () => {
  assert.equal(publicManifest(manifest.id).requiredOrganization.id, 9);
  assert.deepEqual(manifest.requiredProfiles, ["creator"]);
  assert.deepEqual(manifest.requiredRoles, { creator: "editor" });
  assert.deepEqual(manifest.requiredPermissions, { creator: ["project.create"] });
  assert.deepEqual(activeFlags(manifest), { PROJECT_DURABLE_SAVE_V1: true, PROJECT_DURABLE_SAVE_INLINE_ENABLED: false });
  assert.deepEqual(safeFlags(manifest), { PROJECT_DURABLE_SAVE_V1: false, PROJECT_DURABLE_SAVE_INLINE_ENABLED: true });
  assert.doesNotThrow(() => validateManifest(manifest));
  for (const name of ["PROJECT_ARBITRARY", "PROJECT_QUOTA_RESERVATION_V1", "PROJECT_DURABLE_SAVE_V1_EXTRA", "anything"]) {
    assert.throws(() => validateManifest({ ...manifest, managedFlags: { [name]: { requiredBefore: false, activeValue: true, safeValue: false } } }), { code: "MANIFEST_INVALID" });
  }
  assert.match(manifest.cleanup.retention, /objects.*receipts.*tombstones/);
});

test("quota prerequisite rejects enabled, secret, malformed or missing snapshot before a window", () => {
  const project = (configured, deployed) => ({ raw: { deployment_configs: { production: { env_vars: configured } }, canonical_deployment: { env_vars: deployed } } });
  const options = { organizationId: 9 };
  assert.doesNotThrow(() => verifyPreflight(project({}, {}), options));
  assert.doesNotThrow(() => verifyPreflight(project({ PROJECT_QUOTA_RESERVATION_V1: { type: "plain_text", value: "false" } }, {}), options));
  for (const entry of [{ type: "plain_text", value: "true" }, { type: "secret_text", value: "false" }, { type: "plain_text", value: "" }]) {
    assert.throws(() => verifyPreflight(project({ PROJECT_QUOTA_RESERVATION_V1: entry }, {}), options), { code: "QUOTA_CLEANUP_UNSUPPORTED" });
    assert.throws(() => verifyPreflight(project({}, { PROJECT_QUOTA_RESERVATION_V1: entry }), options), { code: "QUOTA_CLEANUP_UNSUPPORTED" });
  }
  assert.throws(() => verifyPreflight(project(undefined, {}), options), { code: "QUOTA_CLEANUP_UNSUPPORTED" });
  assert.throws(() => verifyPreflight(project({}, {}), { organizationId: 10 }), { code: "QA_ORGANIZATION_MISMATCH" });
});

test("manifest hashes exact UTF-8 bytes using Dropbox block hashing", () => {
  const body = "Maõno 🗺️";
  const value = makeManifest(body, "synthetic-operation", 0, "create");
  const expected = createHash("sha256").update(createHash("sha256").update(body).digest()).digest("hex");
  assert.equal(value.contentHash, expected);
  assert.equal(value.payloadBytes, Buffer.byteLength(body));
});

test("registered suite uses bounded real protocol routes and preserves two projects for manual cleanup", async () => {
  const h = harness();
  await prepare(h.ctx);
  assert.ok(h.events.every((e) => e.method === "GET"), "preparation must be read-only");
  const result = await run(h.ctx);
  assert.equal(result.projects.length, 2);
  assert.equal(h.projects.size, 2);
  assert.equal(h.operations.size, 4);
  assert.ok(h.ctx.cases.some((c) => c.id === "DS-LOST-ACK" && c.modeled === true));
  assert.equal(h.ctx.cases.find((c) => c.id === "DS-LARGE").sizeBytes, 94 * 1024 * 1024);
  await assert.rejects(() => h.ctx.cleanup(), { code: "MANUAL_CLEANUP_REQUIRED" });
  assert.equal(h.projects.size, 2);
  assert.equal(h.files.size, 2, "manual cleanup must receive every generated file identity");
  assert.ok([...h.files.values()].every((f) => !f.active && f.isProject));
  assert.deepEqual(new Set(h.ctx.cases.filter((c) => c.status === "PASS").map((c) => c.id)), new Set(manifest.cases.filter(id => id !== "DS-CLEANUP")));
  assert.ok(h.ctx.cases.some(c => c.id === "DS-CLEANUP" && c.status === "PENDING_MANUAL"));
  assert.equal(h.journals.at(-1).resources.length, 2);
  for (const resource of h.journals.at(-1).resources) {
    const project = h.projects.get(resource.projectId);
    assert.equal(resource.slug, project.slug);
    assert.equal(resource.organizationFileId, project.organizationFileId);
    assert.equal(resource.reservationStarted, true);
    assert.equal(resource.reservationUncertain, false);
  }
  assert.ok(!h.events.some((e) => e.path?.includes("dropbox=true") || e.path?.includes("/config") && e.method === "PUT" && e.options?.headers?.["X-Maono-Client-Contract"] === "2"));
});

test("lost reservation preserves uncertain resources without inventing IDs or certifying closure", async () => {
  const h = harness({ lostReservation: true });
  await assert.rejects(() => run(h.ctx), /lost reservation acknowledgement/);
  assert.equal(h.projects.size, 1);
  await assert.rejects(() => h.ctx.cleanup(), { code: "QA_RESERVATION_OUTCOME_UNCERTAIN" });
  assert.equal(h.projects.size, 1);
  assert.ok([...h.files.values()].every((f) => !f.active && f.isProject));
  const resource = h.journals.at(-1).resources.find(value => value.kind === "small");
  assert.equal(resource.projectId, null);
  assert.equal(resource.organizationFileId, null);
  assert.equal(resource.reservationStarted, true);
  assert.equal(resource.reservationUncertain, true);
  assert.ok(!h.ctx.cases.some(c => c.id === "DS-CLEANUP" && c.status === "PASS"));
});

test("reservation identity rejects a changed creator before publishing any JSON", async () => {
  const h = harness({ foreignProject: true });
  await assert.rejects(() => run(h.ctx), { code: "QA_CLEANUP_SCOPE_MISMATCH" });
  await assert.rejects(() => h.ctx.cleanup(), { code: "QA_RESERVATION_OUTCOME_UNCERTAIN" });
  assert.equal(h.events.filter((e) => e.method === "DELETE").length, 0);
  assert.equal(h.operations.size, 0);
  assert.equal(h.projects.size, 1);
});

test("failed manual journal persistence prevents reservation and never records cleanup PASS", async () => {
  const h = harness({ failJournal: true });
  await assert.rejects(() => run(h.ctx), /manual journal failure/);
  assert.equal(h.events.some(event => event.method === "POST"), false);
  assert.equal(h.projects.size, 0);
  assert.ok(!h.ctx.cases.some((c) => c.id === "DS-CLEANUP" && c.status === "PASS"));
});

test("arbitrary run IDs and existing project input cannot reach HTTP", async () => {
  const h = harness();
  h.ctx.runId = "../../real-project";
  await assert.rejects(() => run(h.ctx), { code: "QA_RUN_ID_INVALID" });
  assert.equal(h.events.length, 0);
  h.ctx.runId = runId;
  h.ctx.projectSlug = "real-project";
  await assert.rejects(() => run(h.ctx), { code: "QA_EXISTING_PROJECT_FORBIDDEN" });
  assert.equal(h.events.length, 0);
});

test("editor role and QA slug are verified with project.create only before activation", async () => {
  let role = "editor", authenticatedOrganization = organization;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/auth/login")) {
      return Response.json({ ok: true }, { headers: { "set-cookie": "maono_session=synthetic; Secure; HttpOnly" } });
    }
    return Response.json({ authenticated: true, activeOrganization: authenticatedOrganization, user: { id: 11, role }, permissions: ["project.create"] });
  };
  const credentials = { creator: { email: "qa-creator@example.test", password: "synthetic" } };
  assert.deepEqual(Object.keys(await buildProfiles("https://maono.test", credentials, manifest, 9, { fetchImpl })), ["creator"]);
  for (role of ["admin", "super_admin", "viewer"]) {
    await assert.rejects(() => buildProfiles("https://maono.test", credentials, manifest, 9, { fetchImpl }), { code: "QA_ROLE_MISMATCH" });
  }
  role = "editor";
  authenticatedOrganization = { ...organization, slug: "some-other-organization" };
  await assert.rejects(() => buildProfiles("https://maono.test", credentials, manifest, 9, { fetchImpl }), { code: "QA_ORGANIZATION_MISMATCH" });
  await assert.rejects(() => buildProfiles("https://maono.test", credentials, manifest, 10, { fetchImpl }), { code: "QA_ORGANIZATION_MISMATCH" });
  const operator = await readFile(new URL("../scripts/acceptance/operator.mjs", import.meta.url), "utf8");
  assert.ok(operator.indexOf("await suite.prepare(context)") < operator.indexOf("const activated = await transitionFlags"));
});

test("human inventory administrator and automated editor must be distinct identities", async () => {
  const h = harness();
  h.ctx.profiles.creator.user.id = 12;
  await assert.rejects(() => prepare(h.ctx), { code: "QA_IDENTITIES_NOT_DISTINCT" });
  assert.equal(h.events.length, 0);
});

test("missing or explicitly denied project.create never becomes implicit editor authorization", async () => {
  const credentials = { creator: { email: "qa-creator@example.test", password: "synthetic" } };
  for (const [permissions, deniedPermissions] of [[[], []], [["project.create"], ["project.create"]]]) {
    const fetchImpl = async url => String(url).endsWith("/api/auth/login")
      ? Response.json({ ok: true }, { headers: { "set-cookie": "maono_session=synthetic; Secure; HttpOnly" } })
      : Response.json({ authenticated: true, activeOrganization: organization, user: { id: 11, role: "editor" }, permissions, deniedPermissions });
    await assert.rejects(() => buildProfiles("https://maono.test", credentials, manifest, 9, { fetchImpl }), { code: "QA_PERMISSION_MISSING" });
  }
});

test("the obsolete Preview workflow cannot expose credentials or execute a selected old ref", async () => {
  const workflow = await readFile(new URL("../.github/workflows/large-create-preview-acceptance.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /Retired.*durable-project-save/);
  assert.doesNotMatch(workflow, /secrets\.|checkout@|release_ref:|preview_base_url:|SESSION_COOKIE/);
});

test("failed closure journal does not erase either synthetic resource or claim cleanup PASS", async () => {
  const h = harness();
  await run(h.ctx);
  h.failJournalWrites();
  await assert.rejects(() => h.ctx.cleanup(), /manual journal failure/);
  assert.equal(h.events.filter((e) => e.method === "DELETE").length, 0);
  assert.equal(h.projects.size, 2);
  assert.equal(h.journals.at(-1).resources.filter(resource => resource.projectId !== null).length, 2);
  assert.ok(!h.ctx.cases.some((c) => c.id === "DS-CLEANUP" && c.status === "PASS"));
});

test("acceptance manifest and synthetic bytes satisfy the actual server stream validator", async () => {
  const { normalizeProjectSaveManifest } = await import("../functions/_lib/project-save-operations.js");
  const { validateProjectSavePayloadStream } = await import("../functions/_lib/project-save-operation-payload.js");
  const body = JSON.stringify({ version: "v1", config: { visState: { layers: [], filters: [] }, mapState: {}, mapStyle: {} }, datasets: [], acceptanceFixture: { runId, marker: "Maõno 🗺️" } });
  const input = makeManifest(body, `qa-durable:${runId}:small:create`, 0, "create");
  const validated = await validateProjectSavePayloadStream(new Blob([body]).stream(), normalizeProjectSaveManifest(input));
  assert.equal(validated.checksum, input.contentHash);
  assert.equal(validated.sizeBytes, input.payloadBytes);
});

test("a fresh quota drift check aborts before any flag mutation or deployment retry", async () => {
  const sha = "a".repeat(40), calls = [];
  const env_vars = {
    PROJECT_DURABLE_SAVE_V1: { type: "plain_text", value: "false" },
    PROJECT_DURABLE_SAVE_INLINE_ENABLED: { type: "plain_text", value: "true" },
    PROJECT_QUOTA_RESERVATION_V1: { type: "plain_text", value: "true" },
  };
  const canonical = { id: "deployment-test", environment: "production", deployment_trigger: { metadata: { commit_hash: sha, commit_dirty: false } }, latest_stage: { name: "deploy", status: "success" }, env_vars };
  const fetchImpl = async (url, options) => {
    calls.push(options.method);
    assert.equal(options.method, "GET");
    return Response.json({ success: true, result: String(url).includes("/deployments?") ? [canonical] : {
      name: "maono-kepler-v1", production_branch: "mano_kepler_v1", subdomain: "maono-kepler-v1.pages.dev", canonical_deployment: canonical,
      deployment_configs: { production: { d1_databases: { DB: { id: PRODUCTION_D1_ID } }, env_vars } },
    } });
  };
  let armed = false;
  await assert.rejects(() => transitionFlags({ token: "synthetic", sourceDeploymentId: canonical.id, commit: sha, manifest, values: activeFlags(manifest),
    deps: { fetchImpl }, validateCurrent: (current) => verifyPreflight(current, { organizationId: 9 }), onMutationStart() { armed = true; },
  }), { code: "QUOTA_CLEANUP_UNSUPPORTED" });
  assert.equal(armed, false);
  assert.deepEqual(calls, ["GET", "GET"]);
});

test("later resource renaming cannot turn the recorded manual scope into cleanup-complete", async () => {
  const h = harness();
  await createSyntheticProjectForPreview(h.ctx, JSON.stringify({ version: "v1", config: {}, datasets: [{}] }));
  const resource = h.journals.at(-1).resources[0];
  h.projects.get(resource.projectId).name = "renamed after reservation";
  await assert.rejects(() => h.ctx.cleanup(), { code: "MANUAL_CLEANUP_REQUIRED" });
  assert.equal(h.projects.size, 1);
  assert.equal(h.journals.at(-1).resources[0].name, resource.name);
  assert.equal(h.journals.at(-1).resources[0].projectId, resource.projectId);
  assert.ok(!h.ctx.cases.some((c) => c.id === "DS-CLEANUP" && c.status === "PASS"));
});

test("independent Worker publication before upload response is accepted without inline assumptions", async () => {
  const h = harness({ fastWorker: true });
  await run(h.ctx);
  assert.equal(h.ctx.cases.find((value) => value.id === "DS-LOST-ACK").httpStatus, 200);
  assert.equal(h.ctx.cases.find((value) => value.id === "DS-LOST-ACK").state, "PUBLISHED");
  await assert.rejects(() => h.ctx.cleanup(), { code: "MANUAL_CLEANUP_REQUIRED" });
  assert.ok(manifest.cases.filter(id => id !== "DS-CLEANUP").every((id) => h.ctx.cases.some((value) => value.id === id && value.status === "PASS")));
});

test("reservation commit after empty cleanup inventory never becomes false cleanup-complete", async () => {
  const h = harness({ delayedReservation: true });
  await assert.rejects(() => run(h.ctx), /timed out/);
  assert.equal(h.projects.size, 0);
  await assert.rejects(() => h.ctx.cleanup(), { code: "QA_RESERVATION_OUTCOME_UNCERTAIN" });
  assert.ok(!h.ctx.cases.some((value) => value.id === "DS-CLEANUP" && value.status === "PASS"));
  h.commitDelayedReservation();
  assert.equal(h.projects.size, 1, "the original request can still commit after inventory");
});

test("prior synthetic resources in human evidence block a new window while inactive tombstones remain allowed", async () => {
  const priorRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const inventory = { projects: [{ id: 77, name: `QA Durable ${priorRunId} small`, slug: `qa-durable-${priorRunId}-small`, organizationId: 9, createdById: 11, organizationFileId: 78 }], files: [] };
  const h = harness({ inventory });
  await assert.rejects(() => prepare(h.ctx), { code: "QA_PRIOR_CLEANUP_UNVERIFIED" });
  assert.ok(h.events.every(event => event.method === "GET" && event.path === "/api/projects"), "the operator never queries administrative inventory");
  const clean = harness({ inventory: { projects: [], files: [{ id: 78, name: `QA Durable ${priorRunId} small`, organizationId: 9, active: false, isProject: false, linkedProjectId: null }] } });
  await prepare(clean.ctx);
  const linked = harness({ inventory: { projects: [], files: [{ id: 78, name: `QA Durable ${priorRunId} small`, organizationId: 9, active: false, isProject: true, linkedProjectId: null }] } });
  await assert.rejects(() => prepare(linked.ctx), { code: "QA_PRIOR_CLEANUP_UNVERIFIED" });
});

test("creator-visible foreign organization or unclean synthetic state blocks the window", async () => {
  for (const project of [
    { id: 77, name: "Some project", slug: "some-project", organizationId: 10 },
    { id: 77, name: `QA Durable ${runId} small`, slug: `qa-durable-${runId}-small`, organizationId: 9 },
    { id: 77, name: "QA Durable aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa small", slug: "qa-durable-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-small", organizationId: 9 },
  ]) {
    const h = harness();
    h.projects.set(project.id, project);
    await assert.rejects(() => prepare(h.ctx));
    assert.ok(h.events.every(event => event.method === "GET" && event.path === "/api/projects"));
    assert.equal(h.journals.length, 0);
  }
});

test("PNG suite preserves the exact one-project manual scope with accurate dataset count", async () => {
  const { ctx, events, projects, files } = harness();
  const body = JSON.stringify({ version: "v1", config: {}, datasets: [{ data: { id: "synthetic" } }] });
  const saved = await createSyntheticProjectForPreview(ctx, body);
  assert.equal(saved.input.datasetCount, 1);
  assert.equal(saved.request.configMetadata.datasetCount, 1);
  assert.equal(projects.size, 1);
  await assert.rejects(() => ctx.cleanup(), { code: "MANUAL_CLEANUP_REQUIRED" });
  assert.equal(projects.size, 1);
  assert.ok([...files.values()].every(file => file.active === false && file.isProject === true));
  assert.ok(events.find(e => e.cleanupRegistered));
});

test("unknown browser closure blocks manual-cleanup handoff and leaves closure unverified", async () => {
  const { ctx, projects, events } = harness();
  await createSyntheticProjectForPreview(ctx, JSON.stringify({ version: "v1", config: {}, datasets: [{}] }), { beforeCleanup: async () => { throw new Error("browser closure unknown"); } });
  await assert.rejects(() => ctx.cleanup(), /browser closure unknown/);
  assert.equal(projects.size, 1);
  assert.equal(events.some(event => event.method === "DELETE"), false);
});


function operatorHarness({ payloadFailure = null, beforeControlRead = () => {} } = {}) {
  // Main owns cleanup registration here; standalone harness tests above verify
  // registration before each mutation. This adapter only models HTTP protocol.
  const h = harness({ verifyCleanupRegistration: false, payloadFailure }), patches = [], appRequests = [];
  let controlWrites = 0;
  const entries = values => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { type: "plain_text", value: String(value) }]));
  let configured = entries(safeFlags(manifest)), canonicalFlags = structuredClone(configured), canonicalId = "original";
  const deployment = () => ({ id: canonicalId, environment: "production", url: "https://maono-kepler-v1.pages.dev",
    deployment_trigger: { metadata: { commit_hash: expectedCommit, commit_dirty: false } },
    latest_stage: { name: "deploy", status: "success" }, env_vars: canonicalFlags });
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname, method = options.method;
    if (parsed.hostname === "api.cloudflare.com") {
      beforeControlRead({ method, appRequests });
      if (["PATCH", "POST"].includes(method)) controlWrites++;
      if (method === "PATCH") {
        const changed = JSON.parse(options.body).deployment_configs.production.env_vars;
        configured = { ...configured, ...changed };
        patches.push(Object.fromEntries(Object.entries(changed).map(([name, value]) => [name, value.value === "true"])));
        return Response.json({ success: true, result: {} });
      }
      if (method === "POST") {
        canonicalId = `retry-${patches.length}`; canonicalFlags = structuredClone(configured);
        return Response.json({ success: true, result: { id: canonicalId } });
      }
      if (path.endsWith("/deployments")) return Response.json({ success: true, result: [deployment()] });
      if (path.includes("/deployments/")) return Response.json({ success: true, result: deployment() });
      return Response.json({ success: true, result: { name: "maono-kepler-v1", production_branch: "mano_kepler_v1", subdomain: "maono-kepler-v1.pages.dev",
        canonical_deployment: deployment(), deployment_configs: { production: { d1_databases: { DB: { id: PRODUCTION_D1_ID } }, env_vars: configured } } } });
    }
    appRequests.push({ path, method });
    if (path === "/api/auth/login") {
      assert.equal(JSON.parse(options.body).email, "creator@example.test");
      return Response.json({ ok: true }, { headers: { "set-cookie": "maono_session=synthetic; Secure; HttpOnly" } });
    }
    if (path === "/api/session") return Response.json({ ok: true, authenticated: true, activeOrganization: organization,
      user: { id: 11, role: "editor" }, permissions: ["project.create"] });
    const request = { ...options };
    if (method === "POST" && options.headers["X-Maono-Client-Contract"] === "2") request.json = JSON.parse(options.body);
    const response = await h.ctx.api("creator", path + parsed.search, request);
    return typeof response.body === "string"
      ? new Response(response.body, { status: response.status, headers: response.headers })
      : Response.json(response.body, { status: response.status, headers: response.headers });
  };
  return { h, patches, appRequests, fetchImpl, get controlWrites() { return controlWrites; } };
}

test("successful JSON protocol returns incomplete pending manual cleanup after safe flag restoration", async t => {
  const directory = await mkdtemp(join(tmpdir(), "durable-manual-operator-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let expireOnActivationRead = false, fakeNow = Date.now();
  const state = operatorHarness({ beforeControlRead({ method, appRequests }) {
    if (expireOnActivationRead && method === "GET" && appRequests.some(call => call.path === "/api/projects")) {
      fakeNow += 16 * 60_000;
      expireOnActivationRead = false;
    }
  } });
  const { h, patches, appRequests, fetchImpl } = state;
  t.mock.method(process.stdout, "write", () => true);
  const credentials = { creator: { email: "creator@example.test", password: "synthetic" }, manualInventory: beforeInventory() };
  const reportPath = join(directory, "report.json");
  const baseEnv = { MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: "synthetic", MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON: JSON.stringify(credentials) };
  const rejectedRuns = [
    [{}, "QA_WORKFLOW_RUN_MISMATCH"],
    [{ GITHUB_RUN_ID: workflowRunId }, "QA_WORKFLOW_RUN_MISMATCH"],
    [{ GITHUB_RUN_ATTEMPT: "1" }, "QA_WORKFLOW_RUN_MISMATCH"],
    [{ GITHUB_RUN_ID: workflowRunId, GITHUB_RUN_ATTEMPT: "2" }, "QA_WORKFLOW_RUN_MISMATCH"],
    [{ GITHUB_RUN_ID: workflowRunId, GITHUB_RUN_ATTEMPT: "01" }, "QA_WORKFLOW_RUN_MISMATCH"],
    [{ GITHUB_RUN_ID: "987654321", GITHUB_RUN_ATTEMPT: "1" }, "MANUAL_EVIDENCE_SCOPE_MISMATCH"],
  ];
  for (const [index, [binding, expectedError]] of rejectedRuns.entries()) {
    const rejectedReportPath = join(directory, `rejected-${index}.json`);
    const rejectedCode = await main(["--mode", "run", "--suite", manifest.id, "--organization-id", "9", "--expected-commit", expectedCommit, "--report", rejectedReportPath],
      { ...baseEnv, ...binding }, { fetchImpl, sleep: async () => {} });
    const rejectedReport = JSON.parse(await readFile(rejectedReportPath, "utf8"));
    assert.equal(rejectedCode, 1);
    assert.equal(rejectedReport.error.code, expectedError);
    assert.equal(rejectedReport.writesPerformed, false);
    assert.equal(rejectedReport.acceptanceExecuted, false);
    assert.equal(state.controlWrites, 0, "missing/mismatched/rerun binding cannot mutate the control plane");
    assert.equal(appRequests.length, 0, "binding is verified before login or application requests");
    assert.equal(h.projects.size, 0);
  }
  // Fresh evidence at authentication must be rechecked after a slow control-plane read.
  expireOnActivationRead = true;
  const staleReportPath = join(directory, "expired-before-activation.json");
  const staleCode = await main(["--mode", "run", "--suite", manifest.id, "--organization-id", "9", "--expected-commit", expectedCommit, "--report", staleReportPath],
    { ...baseEnv, GITHUB_RUN_ID: workflowRunId, GITHUB_RUN_ATTEMPT: "1" }, { fetchImpl, now: () => fakeNow, sleep: async () => {} });
  const staleReport = JSON.parse(await readFile(staleReportPath, "utf8"));
  assert.equal(staleCode, 1);
  assert.equal(staleReport.error.code, "MANUAL_EVIDENCE_STALE");
  assert.equal(staleReport.writesPerformed, false);
  assert.equal(staleReport.acceptanceExecuted, false);
  assert.equal(state.controlWrites, 0, "evidence that ages during queue/control-plane checks cannot reach flag PATCH or retry");
  assert.equal(h.projects.size, 0);
  assert.ok(!appRequests.some(call => call.path === "/api/projects" && call.method === "POST"));

  const code = await main(["--mode", "run", "--suite", manifest.id, "--organization-id", "9", "--expected-commit", expectedCommit, "--report", reportPath],
    { GITHUB_RUN_ID: workflowRunId, GITHUB_RUN_ATTEMPT: "1", MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: "synthetic", MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON: JSON.stringify(credentials) }, { fetchImpl, sleep: async () => {} });
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const checkpoint = JSON.parse(await readFile(`${reportPath}.checkpoint.json`, "utf8"));
  assert.equal(code, 1);
  assert.equal(report.error.code, "MANUAL_CLEANUP_REQUIRED");
  assert.equal(report.operationalTestsPassed, true);
  assert.equal(report.cleanupComplete, false);
  assert.equal(report.configurationRestored, true);
  assert.equal(report.complete, false); assert.equal(report.ok, false);
  assert.equal(report.runId, runId); assert.equal(checkpoint.runId, runId);
  assert.equal(report.workflowRunId, workflowRunId); assert.equal(report.workflowRunAttempt, 1);
  assert.equal(report.manualAdministration.creatorUserId, 11);
  assert.equal(report.manualAdministration.administratorUserId, 12);
  assert.equal(report.manualAdministration.expectedCommit, expectedCommit);
  assert.deepEqual(patches, [activeFlags(manifest), safeFlags(manifest)]);
  assert.equal(h.projects.size, 2);
  assert.equal(report.manualAdministration.resources.filter(resource => resource.reservationStarted).length, 2);
  assert.ok(report.cases.some(value => value.id === "DS-CLEANUP" && value.status === "PENDING_MANUAL"));
  assert.ok(report.cleanupErrors.every(value => value.code === "MANUAL_CLEANUP_REQUIRED"));
  assert.deepEqual(Object.keys(report.qa), ["creator"]);
  assert.doesNotMatch(JSON.stringify(report), /password|maono_session=synthetic|creator@example.test/);
});


test("unrelated visible QA9 project is retained and cannot break scoped collision checks", async () => {
  const h = harness();
  const real = { id: 77, name: "Unrelated existing QA project", slug: "unrelated-existing", organizationId: 9, createdBy: { id: 11 } };
  h.projects.set(real.id, real);
  await prepare(h.ctx);
  await run(h.ctx);
  assert.deepEqual(h.projects.get(77), real);
  assert.equal(h.projects.size, 3);
  assert.ok(h.journals.every(journal => journal.resources.every(row => row.projectId !== 77)));
  await assert.rejects(() => h.ctx.cleanup(), { code: "MANUAL_CLEANUP_REQUIRED" });
  assert.deepEqual(h.projects.get(77), real);
});

function unavailablePayload() {
  return { status: 503, responseFormat: "json",
    headers: new Headers({ "X-Correlation-Id": "header-save-12345678", "Set-Cookie": "maono_session=private-response-cookie",
      "X-Private": "private-response-header" }),
    body: { ok: false, error: { code: "STORAGE_UNAVAILABLE", correlationId: "body-save-12345678",
      message: "private-backend-message", details: { provider: "private-provider-details",
        url: "https://private.example.test/object?token=private-signed-token" } },
      password: "private-response-password", body: "private-response-body" } };
}

test("failed large JSON payload preserves safe report/stdout diagnostics and restores flags without retry or automated cleanup", async t => {
  const directory = await mkdtemp(join(tmpdir(), "durable-http-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const variants = [
    { name: "json", response: unavailablePayload(), expected: { backendCode: "STORAGE_UNAVAILABLE", correlationId: "body-save-12345678",
      headerCorrelationId: "header-save-12345678", responseFormat: "json" } },
    { name: "cloudflare-html", response: { status: 503,
      headers: new Headers({ "Content-Type": "text/html", "CF-Ray": "1234567890abcdef-GRU", "Set-Cookie": "maono_session=private-response-cookie" }),
      body: '<html><span class="cf-error-code">1102</span><div>private-response-body https://private.example.test/object?token=private-signed-token</div></html>' },
      expected: { responseFormat: "non-json", cfRay: "1234567890abcdef-GRU", cloudflareErrorCode: "1102" } },
  ];
  const stdout = [], stderr = [];
  t.mock.method(process.stdout, "write", chunk => { stdout.push(String(chunk)); return true; });
  t.mock.method(process.stderr, "write", chunk => { stderr.push(String(chunk)); return true; });
  for (const variant of variants) {
    stdout.length = 0;
    stderr.length = 0;
    const { h, patches, appRequests, fetchImpl } = operatorHarness({ payloadFailure: { kind: "large", response: variant.response } });
    const reportPath = join(directory, `${variant.name}.json`);
    const result = await main(["--mode", "run", "--suite", manifest.id, "--organization-id", "9", "--expected-commit", expectedCommit, "--report", reportPath],
      { GITHUB_RUN_ID: workflowRunId, GITHUB_RUN_ATTEMPT: "1", MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: "private-control-token",
        MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON: JSON.stringify({ creator: { email: "creator@example.test", password: "private-login-password" }, manualInventory: beforeInventory() }) },
      { fetchImpl, sleep: async () => {} });
    const reportText = await readFile(reportPath, "utf8"), report = JSON.parse(reportText);
    const summary = JSON.parse(stdout.at(-1));
    const expected = { code: "ACCEPTANCE_ASSERTION_FAILED", message: "recebimento durável independente: HTTP 503, esperado 200/202.",
      httpStatus: 503, ...variant.expected };
    assert.equal(result, 1);
    assert.deepEqual(report.error, expected);
    assert.deepEqual(summary.error, expected);
    for (const output of [report, summary]) {
      assert.equal(output.acceptanceExecuted, true);
      assert.equal(output.configurationRestored, true);
      assert.equal(output.cleanupComplete, false);
      assert.equal(output.operationalTestsPassed, false);
      assert.equal(output.complete, false);
      assert.equal(output.ok, false);
      assert.equal(output.acceptanceIncomplete, true);
      assert.ok(output.cases.some(row => row.id === "DS-SMALL" && row.status === "PASS"));
      assert.ok(!output.cases.some(row => row.id === "DS-LARGE" && row.status === "PASS"));
      assert.ok(output.cases.some(row => row.id === "DS-CLEANUP" && row.status === "PENDING_MANUAL"));
    }
    assert.deepEqual(patches, [activeFlags(manifest), safeFlags(manifest)]);
    const uploads = appRequests.filter(call => call.method === "PUT" && decodeURIComponent(call.path).endsWith(":large:create/payload"));
    assert.equal(uploads.length, 1, "a 503 must not start another payload attempt or acceptance window");
    assert.equal(appRequests.some(call => call.method === "DELETE" || call.path.startsWith("/api/admin/")), false);
    assert.equal(h.projects.size, 2);
    assert.equal(h.files.size, 2);
    assert.equal(report.manualAdministration.resources.filter(row => row.projectId && row.organizationFileId).length, 2);
    assert.deepEqual(report.cleanupErrors.map(error => error.code), ["MANUAL_CLEANUP_REQUIRED"]);
    assert.doesNotMatch([reportText, ...stdout, ...stderr].join(""),
      /private-|maono_session=|creator@example\.test|password|https:\/\/private\.example\.test/);
    assert.equal(stderr.length, 0);
  }
});

test("PNG bootstrap reports the same safe payload failure and preserves its one-project manual cleanup scope", async () => {
  const h = harness({ payloadFailure: { kind: "small", response: unavailablePayload() } });
  await assert.rejects(() => createSyntheticProjectForPreview(h.ctx, JSON.stringify({ version: "v1", config: {}, datasets: [{}] })), error => {
    assert.deepEqual(safeError(error), { code: "ACCEPTANCE_ASSERTION_FAILED", message: "recebimento durável independente: HTTP 503, esperado 200/202.",
      httpStatus: 503, backendCode: "STORAGE_UNAVAILABLE", correlationId: "body-save-12345678", headerCorrelationId: "header-save-12345678", responseFormat: "json" });
    return true;
  });
  assert.equal(h.events.filter(event => event.method === "PUT" && event.path.endsWith("/payload")).length, 1);
  assert.equal(h.projects.size, 1);
  await assert.rejects(() => h.ctx.cleanup(), { code: "MANUAL_CLEANUP_REQUIRED" });
  assert.equal(h.journals.at(-1).resources.length, 1);
  assert.equal(h.journals.at(-1).resources[0].reservationUncertain, false);
  assert.ok(h.ctx.cases.some(row => row.id === "DS-CLEANUP" && row.status === "PENDING_MANUAL"));
  assert.equal(h.events.some(event => event.method === "DELETE"), false);
});
