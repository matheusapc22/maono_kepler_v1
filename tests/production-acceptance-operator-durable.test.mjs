import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { manifest, prepare, run, verifyPreflight, makeManifest, createSyntheticProjectForPreview } from "../scripts/acceptance/suites/durable-project-save.mjs";
import { buildProfiles, validateManifest, activeFlags, safeFlags, transitionFlags, PRODUCTION_D1_ID } from "../scripts/acceptance/production-acceptance-lib.mjs";
import { publicManifest } from "../scripts/acceptance/registry.mjs";

const runId = "12345678-1234-4234-8234-123456789abc";
const organization = { id: 9, slug: "maono-preview-qa", active: true };
function profiles() {
  return { creator: { organization, user: { id: 11, role: "editor" } }, administrator: { organization, user: { id: 12, role: "super_admin" } } };
}
function harness({ lostReservation = false, foreignProject = false, failCleanup = false, fastWorker = false, delayedReservation = false } = {}) {
  const events = [], projects = new Map(), files = new Map(), operations = new Map(), cleanups = [];
  let sequence = 100;
  let lateCommit = null;
  const reply = (body, status = 200) => ({ status, body: { ok: true, ...body } });
  const ctx = { runId, organizationId: 9, profiles: profiles(), cases: [],
    record(id, status, details = {}) { this.cases.push({ id, status, ...details }); },
    registerCleanup(fn) { events.push({ cleanupRegistered: true }); cleanups.push(fn); },
    async cleanupApi(profile, path, options) {
      const response = await this.api(profile, path, options);
      assert.ok([200, 204].includes(response.status));
      return response;
    },
    async api(profile, path, options = {}) {
      const method = options.method || "GET";
      events.push({ profile, path, method, options });
      if (method !== "GET") assert.ok(events.some((e) => e.cleanupRegistered), "cleanup must be armed before application mutation");
      if (path.startsWith("/api/admin/")) assert.equal(profile, "administrator");
      else assert.equal(profile, "creator");
      if (path === "/api/admin/organizations/9") return reply({ organization });
      if (path === "/api/admin/projects?organizationId=9") return reply({ projects: [...projects.values()] });
      if (path === "/api/admin/organizations/9/files") return reply({ files: [...files.values()].map((file) => ({ ...file, linkedProject: [...projects.values()].find((p) => p.organizationFileId === file.id) || null })) });
      const adminProject = path.match(/^\/api\/admin\/projects\/(\d+)$/);
      if (adminProject) {
        const project = projects.get(Number(adminProject[1]));
        if (!project) return reply({}, 404);
        if (method === "GET") return reply({ project: foreignProject ? { ...project, createdBy: { id: 999 } } : project });
        assert.equal(method, "DELETE");
        projects.delete(project.id);
        return reply({ deleted: true });
      }
      const adminFile = path.match(/^\/api\/admin\/organization-files\/(\d+)$/);
      if (adminFile) {
        const file = files.get(Number(adminFile[1]));
        assert.ok(file);
        if (method === "GET") return reply({ file });
        assert.equal(method, "PATCH");
        assert.deepEqual(options.json, { active: false, isProject: false });
        if (failCleanup) throw new Error("simulated cleanup failure");
        Object.assign(file, options.json);
        return reply({ file });
      }
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
        return reply({ project, status: "pending", creation: { transport: "durable-operation", expectedRevision: 0 } }, 202);
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
  return { ctx, events, projects, files, operations, commitDelayedReservation: () => lateCommit?.() };
}

test("durable suite is registered with only the exact two additional managed flags", () => {
  assert.equal(publicManifest(manifest.id).requiredOrganization.id, 9);
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

test("registered suite uses bounded real protocol routes, two synthetic projects and verified cleanup", async () => {
  const h = harness();
  await prepare(h.ctx);
  assert.ok(h.events.every((e) => e.method === "GET"), "preparation must be read-only");
  const result = await run(h.ctx);
  assert.equal(result.projects.length, 2);
  assert.equal(h.projects.size, 2);
  assert.equal(h.operations.size, 4);
  assert.ok(h.ctx.cases.some((c) => c.id === "DS-LOST-ACK" && c.modeled === true));
  assert.equal(h.ctx.cases.find((c) => c.id === "DS-LARGE").sizeBytes, 94 * 1024 * 1024);
  await h.ctx.cleanup();
  assert.equal(h.projects.size, 0);
  assert.equal(h.files.size, 2, "file tombstones retained");
  assert.ok([...h.files.values()].every((f) => !f.active && !f.isProject));
  assert.deepEqual(new Set(h.ctx.cases.filter((c) => c.status === "PASS").map((c) => c.id)), new Set(manifest.cases));
  assert.ok(!h.events.some((e) => e.path?.includes("dropbox=true") || e.path?.includes("/config") && e.method === "PUT" && e.options?.headers?.["X-Maono-Client-Contract"] === "2"));
});

test("lost reservation cleans observed rows but cannot claim the original request finished", async () => {
  const h = harness({ lostReservation: true });
  await assert.rejects(() => run(h.ctx), /lost reservation acknowledgement/);
  assert.equal(h.projects.size, 1);
  await assert.rejects(() => h.ctx.cleanup(), { code: "QA_RESERVATION_OUTCOME_UNCERTAIN" });
  assert.equal(h.projects.size, 0);
  assert.ok([...h.files.values()].every((f) => !f.active && !f.isProject));
});

test("cleanup refuses a project with a changed creator rather than deleting outside scope", async () => {
  const h = harness({ lostReservation: true, foreignProject: true });
  await assert.rejects(() => run(h.ctx));
  await assert.rejects(() => h.ctx.cleanup(), { code: "QA_CLEANUP_SCOPE_MISMATCH" });
  assert.equal(h.events.filter((e) => e.method === "DELETE").length, 0);
  assert.equal(h.projects.size, 1);
});

test("failed file cleanup never records a false closure PASS", async () => {
  const h = harness({ lostReservation: true, failCleanup: true });
  await assert.rejects(() => run(h.ctx));
  await assert.rejects(() => h.ctx.cleanup(), /cleanup failure/);
  assert.ok(!h.ctx.cases.some((c) => c.id === "DS-CLEANUP"));
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

test("profile roles and organization slug are verified by generic authentication before activation", async () => {
  let current = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/auth/login")) {
      current++;
      return Response.json({ ok: true }, { headers: { "set-cookie": "maono_session=synthetic; Secure; HttpOnly" } });
    }
    return Response.json({ authenticated: true, activeOrganization: organization, user: { id: current, role: current === 1 ? "editor" : "admin" }, permissions: ["project.create", "admin.panel.access"] });
  };
  const credentials = { creator: { email: "qa-creator@example.test", password: "synthetic" }, administrator: { email: "qa-admin@example.test", password: "synthetic" } };
  await assert.rejects(() => buildProfiles("https://maono.test", credentials, manifest, 9, { fetchImpl }), { code: "QA_ROLE_MISMATCH" });
  await assert.rejects(() => buildProfiles("https://maono.test", credentials, manifest, 10, { fetchImpl }), { code: "QA_ORGANIZATION_MISMATCH" });
  const operator = await readFile(new URL("../scripts/acceptance/operator.mjs", import.meta.url), "utf8");
  assert.ok(operator.indexOf("await suite.prepare(context)") < operator.indexOf("const activated = await transitionFlags"));
});

test("the obsolete Preview workflow cannot expose credentials or execute a selected old ref", async () => {
  const workflow = await readFile(new URL("../.github/workflows/large-create-preview-acceptance.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /Retired.*durable-project-save/);
  assert.doesNotMatch(workflow, /secrets\.|checkout@|release_ref:|preview_base_url:|SESSION_COOKIE/);
});

test("one failed file cleanup still attempts cleanup of the other synthetic project", async () => {
  const h = harness({ failCleanup: true });
  await run(h.ctx);
  await assert.rejects(() => h.ctx.cleanup(), /cleanup failure/);
  assert.equal(h.events.filter((e) => e.method === "DELETE").length, 2);
  assert.equal(h.projects.size, 0);
  assert.ok(!h.ctx.cases.some((c) => c.id === "DS-CLEANUP"));
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

test("renaming a known synthetic project cannot make cleanup falsely report no resources", async () => {
  const h = harness({ lostReservation: true });
  await assert.rejects(() => run(h.ctx));
  [...h.projects.values()][0].name = "renamed after reservation";
  await assert.rejects(() => h.ctx.cleanup(), { code: "QA_CLEANUP_SCOPE_MISMATCH" });
  assert.equal(h.projects.size, 1);
  assert.ok(!h.ctx.cases.some((c) => c.id === "DS-CLEANUP"));
});

test("independent Worker publication before upload response is accepted without inline assumptions", async () => {
  const h = harness({ fastWorker: true });
  await run(h.ctx);
  assert.equal(h.ctx.cases.find((value) => value.id === "DS-LOST-ACK").httpStatus, 200);
  assert.equal(h.ctx.cases.find((value) => value.id === "DS-LOST-ACK").state, "PUBLISHED");
  await h.ctx.cleanup();
  assert.ok(manifest.cases.every((id) => h.ctx.cases.some((value) => value.id === id && value.status === "PASS")));
});

test("reservation commit after empty cleanup inventory never becomes false cleanup-complete", async () => {
  const h = harness({ delayedReservation: true });
  await assert.rejects(() => run(h.ctx), /timed out/);
  assert.equal(h.projects.size, 0);
  await assert.rejects(() => h.ctx.cleanup(), { code: "QA_RESERVATION_OUTCOME_UNCERTAIN" });
  assert.ok(!h.ctx.cases.some((value) => value.id === "DS-CLEANUP"));
  h.commitDelayedReservation();
  assert.equal(h.projects.size, 1, "the original request can still commit after inventory");
});

test("prior synthetic resources block a new window while inactive file tombstones remain allowed", async () => {
  const h = harness();
  h.projects.set(77, { id: 77, slug: `qa-durable-${runId}-small` });
  await assert.rejects(() => prepare(h.ctx), { code: "QA_PRIOR_CLEANUP_UNVERIFIED" });
  assert.ok(h.events.every((value) => value.method === "GET"));
  h.projects.clear();
  h.files.set(78, { id: 78, name: `QA Durable ${runId} small`, active: false, isProject: false });
  await prepare(h.ctx);
  h.files.get(78).isProject = true;
  await assert.rejects(() => prepare(h.ctx), { code: "QA_PRIOR_CLEANUP_UNVERIFIED" });
});


test("PNG suite reuses the exact one-project reservation and cleanup scope with accurate dataset count", async () => {
  const { ctx, events, projects, files } = harness();
  const body = JSON.stringify({ version: "v1", config: {}, datasets: [{ data: { id: "synthetic" } }] });
  const saved = await createSyntheticProjectForPreview(ctx, body);
  assert.equal(saved.input.datasetCount, 1);
  assert.equal(saved.request.configMetadata.datasetCount, 1);
  assert.equal(projects.size, 1);
  await ctx.cleanup();
  assert.equal(projects.size, 0);
  assert.ok([...files.values()].every(file => file.active === false && file.isProject === false));
  assert.ok(events.find(e => e.cleanupRegistered));
});

test("unknown browser closure blocks PNG fixture deletion and leaves cleanup unverified", async () => {
  const { ctx, projects, events } = harness();
  await createSyntheticProjectForPreview(ctx, JSON.stringify({ version: "v1", config: {}, datasets: [{}] }), { beforeCleanup: async () => { throw new Error("browser closure unknown"); } });
  await assert.rejects(() => ctx.cleanup(), /browser closure unknown/);
  assert.equal(projects.size, 1);
  assert.equal(events.some(event => event.method === "DELETE"), false);
});
