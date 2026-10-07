import assert from "node:assert/strict";
import test from "node:test";
import { persistenceFixture, interruption, deferred } from "./helpers/project-persistence-fixture.mjs";
import { dropboxContentHashHex, dropboxContentHashBlockDigest, dropboxContentHashFromBlockDigestsHex } from "../functions/_lib/dropbox-content-hash.js";
import { DropboxMapConfigRepository } from "../functions/_lib/dropbox-map-config-repository.js";
import { createMapConfigStorageRef, createMapConfigOperationStorageRef, parseMapConfigStorageRef, resolveMapConfigStorageFileName } from "../functions/_lib/map-config-storage-ref.js";
import { StreamingMapConfigValidator } from "../functions/_lib/project-config-stream-validator.js";
import { uploadProjectSaveOperationPayload, recoverStoredProjectSaveOperation, verifyStoredProjectSaveOperation, createProjectSaveOperationStorageRef } from "../functions/_lib/project-save-operation-payload.js";
const encoder = new TextEncoder();
const project = { id: 7, organization_id: 1, dropbox_root_path: "/offline/a/project-7", default_config_file: "config.kepler.json", config_revision: 1 };
const map = { version: "v1", config: { visState: { layers: [] } }, datasets: [], unicode: "Maõno 🗺️" };
function stream(bytes, chunkSize = 65536, failAt = Infinity) {
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset >= failAt) { controller.error(interruption("INTERRUPTED_BODY")); return; }
    if (offset === bytes.length) { controller.close(); return; }
    const end = Math.min(bytes.length, offset + chunkSize);
    controller.enqueue(bytes.subarray(offset, end)); offset = end;
  } });
}
async function operation(bytes, overrides = {}) {
  return {
    id: "server-operation-001", operation_id: "client-operation-001", actor_user_id: 1,
    project_id: 7, organization_id: 1, upload_epoch: 1,
    size_bytes: bytes.length, checksum: await dropboxContentHashHex(bytes), checksum_algorithm: "dropbox-content-hash",
    serialization_version: 1, schema_name: "legacy-kepler", schema_version: 1, config_version: "v1", dataset_count: 0,
    ...overrides,
  };
}
function validate(text, options = {}, chunkSize = 1) {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  const validator = new StreamingMapConfigValidator(options);
  for (let i = 0; i < bytes.length; i += chunkSize) validator.push(bytes.subarray(i, i + chunkSize));
  return validator.finish();
}

test("operation references retain old revision names and isolate organization/project/server identity/epoch", () => {
  assert.deepEqual(parseMapConfigStorageRef(createMapConfigStorageRef(7, 18)), { projectId: 7, revision: 18 });
  assert.equal(resolveMapConfigStorageFileName({ project, revision: 18, storageRef: createMapConfigStorageRef(7, 18) }), "config.kepler.r000018.json");
  const ref = createMapConfigOperationStorageRef({ organizationId: 1, projectId: 7, operationId: "server-id", uploadEpoch: 3 });
  assert.equal(resolveMapConfigStorageFileName({ project, revision: 18, storageRef: ref }), "config.o1.p7.op-server-id.u3.json");
  assert.throws(() => resolveMapConfigStorageFileName({ project: { ...project, organization_id: 2 }, revision: 18, storageRef: ref }), { code: "MAP_CONFIG_STORAGE_REF_MISMATCH" });
  assert.throws(() => createMapConfigOperationStorageRef({ organizationId: 1, projectId: 7, operationId: "../outside", uploadEpoch: 1 }), { code: "MAP_CONFIG_OPERATION_ID_INVALID" });
});

test("full streaming grammar validates UTF-8, escapes, numbers, root fields and chunk boundaries", () => {
  const valid = JSON.stringify({ ...map, escaped: '\\"\n\t', numbers: [0, -1, 1.25, 1e30, null, true, false], nested: [{ a: [{ b: {} }] }] });
  for (const size of [1, 2, 3, 5, 11, 65536]) assert.deepEqual(validate(valid, { configVersion: "v1", datasetCount: 0 }, size), { configVersion: "v1", datasetCount: 0 });
  for (const bad of [
    '{"version":"v1","config":{},"datasets":[],}',
    '{"version":"v1","config":{},"datasets":[,]}',
    '{"version":"v1","config":{},"datasets":[01]}',
    '{"version":"v1","config":{},"datasets":[1e]}',
    '{"version":"v1","config":{"nested":{garbage}},"datasets":[]}',
    '{"version":"v1","config":{},"datasets":[],"x":"\\q"}',
    '{"version":"v1","config":{},"datasets":[],"x":"\\uGGGG"}',
    '{"version":"v1","config":{},"datasets":[],"x":"raw\nline"}',
    '{"version":"v1","config":{},"datasets":[]}{}',
    '{"version":"v1","config":{},"datasets":[],"config":{}}',
    '{"version":"","config":{},"datasets":[]}',
    '{"version":"v1","config":[],"datasets":[]}',
    '{"version":"v1","config":{},"datasets":null}',
    '{"version":"v1","config":{}}', '[]',
  ]) assert.throws(() => validate(bad), { code: "INVALID_KEPLER_CONFIG" }, bad);
  const bytes = encoder.encode(JSON.stringify(map)); bytes[bytes.length - 4] = 0xff;
  assert.throws(() => validate(bytes), { code: "INVALID_KEPLER_CONFIG" });
  assert.throws(() => validate(JSON.stringify(map), { datasetCount: 1 }), { code: "INVALID_KEPLER_CONFIG" });
  assert.throws(() => validate(JSON.stringify(map), { configVersion: "v2" }), { code: "INVALID_KEPLER_CONFIG" });
});

test("stream validation preserves analysis dataset checks without retaining rows", () => {
  const config = { version: "v1", datasets: [{ info: { id: "maono_analysis_buffer_1" }, data: { rows: [[1, 2, 3]] } }], config: { visState: { layers: [{ config: { dataId: ["maono_analysis_buffer_1"] } }] } } };
  assert.equal(validate(JSON.stringify(config)).datasetCount, 1);
  config.datasets = [];
  assert.throws(() => validate(JSON.stringify(config)), { code: "PROJECT_CONFIG_ANALYSIS_DATASET_MISSING" });
  config["datasets.*.info"] = { id: "maono_analysis_buffer_1" };
  assert.throws(() => validate(JSON.stringify(config)), { code: "PROJECT_CONFIG_ANALYSIS_DATASET_MISSING" });
});

test("small raw upload and read use operation object; repeated upload reconciles without another storage write", async t => {
  const f = persistenceFixture(t), bytes = encoder.encode(JSON.stringify(map)), op = await operation(bytes);
  const stored = await uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: stream(bytes, 3) });
  assert.equal(stored.checksum, op.checksum); assert.equal(stored.contentVerified, true);
  assert.equal(f.calls.filter(x => x.op === "upload_session/finish").length, 1);
  const again = await uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: stream(bytes) });
  assert.equal(again.idempotent, true);
  assert.equal(f.calls.filter(x => x.op === "upload_session/finish").length, 1);
  const repository = new DropboxMapConfigRepository(f.env);
  const loaded = await repository.getRevision({ project, revision: 4, storageRef: stored.storageRef });
  assert.deepEqual(loaded.bytes, bytes);
  assert.equal((await repository.getMetadata({ project, revision: 4, storageRef: stored.storageRef })).providerHash, op.checksum);
});

test("lost finish response is reconciled by exact metadata before any repeated finish", async t => {
  let dropped = false;
  const f = persistenceFixture(t, { afterProvider({ op }) {
    if (op === "upload_session/finish" && !dropped) { dropped = true; throw interruption("DROPBOX_TIMEOUT"); }
  } });
  const bytes = encoder.encode(JSON.stringify(map)), op = await operation(bytes);
  const result = await uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: stream(bytes) });
  assert.equal(result.contentVerified, true);
  assert.equal(f.calls.filter(x => x.op === "upload_session/finish").length, 1);
  // A process restarting before D1 recorded storageRef uses only the current epoch.
  const resumed = await recoverStoredProjectSaveOperation(f.env, { project, operation: op });
  assert.equal(resumed.storageRef, result.storageRef);
  assert.equal(await recoverStoredProjectSaveOperation(f.env, { project, operation: { ...op, upload_epoch: 2 } }), null);
});

test("hash, declared size, corrupt JSON and provider metadata cannot produce verified payload", async t => {
  for (const mode of ["hash", "size", "json", "metadata"]) {
    await t.test(mode, async t => {
      const f = persistenceFixture(t, mode === "metadata" ? { afterProvider({ op, objects }) {
        if (op === "upload_session/finish") {
          for (const object of objects.values()) object.metadata.content_hash = "f".repeat(64);
          return new Response(JSON.stringify([...objects.values()][0].metadata));
        }
      } } : {});
      const bytes = encoder.encode(mode === "json" ? '{"version":"v1","config":{},"datasets":[],garbage}' : JSON.stringify(map));
      const op = await operation(bytes, mode === "hash" ? { checksum: "0".repeat(64) } : mode === "size" ? { size_bytes: bytes.length + 1 } : {});
      await assert.rejects(uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: stream(bytes, 3) }));
      if (mode !== "metadata") assert.equal(f.objects.size, 0);
    });
  }
});

test("storage reconciliation rejects syntactically invalid object even if exact hash/size metadata exists", async t => {
  const f = persistenceFixture(t), bytes = encoder.encode('{"version":"v1","config":{},"datasets":[nope]}'), op = await operation(bytes);
  const storageRef = createProjectSaveOperationStorageRef({ project, operation: op });
  const fileName = resolveMapConfigStorageFileName({ project, storageRef });
  await f.store(`${project.dropbox_root_path}/${fileName}`, bytes);
  await assert.rejects(recoverStoredProjectSaveOperation(f.env, { project, operation: op }), { code: "INVALID_KEPLER_CONFIG" });
});

test("interrupted upload leaves no immutable object and retry uses identical snapshot", async t => {
  const f = persistenceFixture(t), bytes = encoder.encode(JSON.stringify({ ...map, padding: "x".repeat(5 * 1024 * 1024) })), op = await operation(bytes);
  await assert.rejects(uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: stream(bytes, 65536, 4 * 1024 * 1024) }), { code: "INTERRUPTED_BODY" });
  assert.equal(f.objects.size, 0);
  const result = await uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: stream(bytes) });
  assert.equal(result.contentVerified, true);
});

test("late older upload cannot overwrite another epoch or operation", async t => {
  const entered = deferred(), release = deferred();
  let paused = false;
  const f = persistenceFixture(t, { async beforeProvider({ op, args }) {
    if (op === "upload_session/finish" && args.commit.path.endsWith(".u1.json") && !paused) {
      paused = true; entered.resolve(); await release.promise;
    }
  } });
  const bytes1 = encoder.encode(JSON.stringify(map)), bytes2 = encoder.encode(JSON.stringify({ ...map, edition: 2 }));
  const op1 = await operation(bytes1), op2 = await operation(bytes2, { upload_epoch: 2 });
  const older = uploadProjectSaveOperationPayload(f.env, { project, operation: op1, body: stream(bytes1) });
  await entered.promise;
  const newer = await uploadProjectSaveOperationPayload(f.env, { project, operation: op2, body: stream(bytes2) });
  release.resolve(); const old = await older;
  assert.notEqual(old.storageRef, newer.storageRef); assert.equal(f.objects.size, 2);
  assert.equal((await verifyStoredProjectSaveOperation(f.env, { project, operation: op2 })).checksum, op2.checksum);
  const another = await operation(bytes1, { id: "another-server-row", actor_user_id: 2 });
  assert.notEqual(createProjectSaveOperationStorageRef({ project, operation: another }), old.storageRef);
});

// A generated 90 MiB source: no large JSON stringify or concatenation in the
// uploader. The HTTP-only fake provider may retain bytes for object verification.
function largeSource(size) {
  const prefix = encoder.encode('{"version":"v1","config":{},"datasets":[],"padding":"');
  const suffix = encoder.encode('"}');
  const fill = new Uint8Array(65536).fill(120);
  const count = size - prefix.length - suffix.length;
  return () => {
    let remaining = count, phase = 0;
    return new ReadableStream({ pull(controller) {
      if (phase === 0) { phase = 1; controller.enqueue(prefix); return; }
      if (remaining) { const n = Math.min(remaining, fill.length); remaining -= n; controller.enqueue(fill.subarray(0, n)); return; }
      if (phase === 1) { phase = 2; controller.enqueue(suffix); return; }
      controller.close();
    } });
  };
}
async function streamHash(source) {
  const reader = source.getReader(), pending = new Uint8Array(4 * 1024 * 1024), digests = [];
  let used = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    for (let i = 0; i < value.length;) {
      const n = Math.min(value.length - i, pending.length - used);
      pending.set(value.subarray(i, i + n), used); used += n; i += n;
      if (used === pending.length) { digests.push(await dropboxContentHashBlockDigest(pending)); used = 0; }
    }
  }
  if (used) digests.push(await dropboxContentHashBlockDigest(pending.subarray(0, used)));
  return dropboxContentHashFromBlockDigestsHex(digests);
}

test("90 MiB payload uses bounded 4 MiB Dropbox blocks, validates and recovers exact bytes", async t => {
  const f = persistenceFixture(t), size = 90 * 1024 * 1024, source = largeSource(size);
  const op = await operation(new Uint8Array(), { size_bytes: size, checksum: await streamHash(source()) });
  const result = await uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: source() });
  assert.equal(result.sizeBytes, size);
  assert.equal(result.checksum, op.checksum);
  const writes = f.calls.filter(x => x.op.startsWith("upload_session/"));
  assert.ok(writes.length > 20);
  assert.ok(writes.every(x => x.size <= 4 * 1024 * 1024));
  assert.equal((await recoverStoredProjectSaveOperation(f.env, { project, operation: op })).contentVerified, true);
});

test("direct revision delivery resolves both reference formats and requires provider integrity metadata", async t => {
  const { createProjectConfigRevisionDirectDescriptor } = await import("../functions/_lib/project-config-revision-direct-delivery.js");
  let missingMetadata = false;
  const f = persistenceFixture(t, { beforeProvider({ op, args, objects }) {
    if (op !== "get_temporary_link") return;
    const object = objects.get(args.path);
    assert.ok(object, "descriptor targets the object resolved by storage_ref");
    return new Response(JSON.stringify({ link: "https://offline.invalid/download", metadata: missingMetadata ? {} : object.metadata }));
  } });
  const bytes = encoder.encode(JSON.stringify(map)), op = await operation(bytes);
  const saved = await uploadProjectSaveOperationPayload(f.env, { project, operation: op, body: stream(bytes) });
  const oldMetadata = await f.store(`${project.dropbox_root_path}/config.kepler.r000006.json`, bytes);
  for (const [revision, storageRef] of [[6, createMapConfigStorageRef(7, 6)], [7, saved.storageRef]]) {
    const ledger = { status: "READY", storage_provider: "dropbox", storage_ref: storageRef, size_bytes: bytes.length, storage_provider_hash: oldMetadata.content_hash };
    const descriptor = await createProjectConfigRevisionDirectDescriptor(f.env, { project, ledger, revision });
    assert.equal(descriptor.revision, revision); assert.equal(descriptor.sizeBytes, bytes.length);
    missingMetadata = true;
    await assert.rejects(createProjectConfigRevisionDirectDescriptor(f.env, { project, ledger, revision }), { code: "PROJECT_CONFIG_SIZE_MISMATCH" });
    missingMetadata = false;
  }
});

test("parser resource limits are independent of payload length", () => {
  const deep = '{"version":"v1","config":{},"datasets":[],"extra":' + '['.repeat(256) + '0' + ']'.repeat(256) + '}';
  assert.throws(() => validate(deep), { code: "INVALID_KEPLER_CONFIG" });
  const veryLongIgnoredValue = JSON.stringify({ ...map, padding: "x".repeat(2 * 1024 * 1024) });
  const validator = new StreamingMapConfigValidator();
  validator.push(encoder.encode(veryLongIgnoredValue)); validator.finish();
  assert.equal(validator.identifierMemoryBytes, 0);
  assert.equal(validator.stack.length, 0);
});
