import assert from "node:assert/strict";
import test from "node:test";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { DropboxMapConfigRepository } from "../functions/_lib/dropbox-map-config-repository.js";
import { uploadProjectSaveOperationPayload } from "../functions/_lib/project-save-operation-payload.js";

for (const paddingBytes of [0, 9 * 1024 * 1024]) {
  test(`legacy ${paddingBytes ? "large" : "small"} reader promotes through the same immutable operation transport`, async t => {
    const f = persistenceFixture(t);
    const project = { id: 9, organization_id: 1, dropbox_root_path: "/offline/a/legacy", default_config_file: "config.kepler.json", lifecycle_state: null };
    const bytes = new TextEncoder().encode(JSON.stringify({ version: "v1", config: {}, datasets: [], padding: "x".repeat(paddingBytes) }));
    const legacyPath = `${project.dropbox_root_path}/${project.default_config_file}`;
    await f.store(legacyPath, bytes);
    const repository = new DropboxMapConfigRepository(f.env);
    const source = await repository.loadLegacyStream({ project });
    assert.equal(source.sizeBytes, bytes.byteLength);
    assert.equal(source.serializationVersion, 1);
    const operation = { id: "server-legacy-promotion", operation_id: "legacy-promotion", project_id: 9, organization_id: 1, upload_epoch: 1,
      size_bytes: source.sizeBytes, checksum: source.checksum, checksum_algorithm: source.checksumAlgorithm, serialization_version: source.serializationVersion };
    const artifact = await uploadProjectSaveOperationPayload(f.env, { project, operation, body: source.body });
    assert.equal(artifact.contentVerified, true);
    assert.equal(artifact.checksum, source.checksum);
    assert.deepEqual(f.objects.get(legacyPath).bytes, bytes, "legacy source is never overwritten");
    assert.equal(f.objects.size, 2);
    const reads = f.calls.filter(call => call.op === "download");
    assert.equal(reads.length, 1, "source is streamed once, without an application read-buffer pass");
    assert.ok(f.calls.filter(call => call.op.startsWith("upload_session/")).every(call => call.size <= 4 * 1024 * 1024));
  });
}

test("legacy source changing after metadata cannot publish mismatched bytes", async t => {
  const f = persistenceFixture(t);
  const project = { id: 9, organization_id: 1, dropbox_root_path: "/offline/a/legacy", default_config_file: "config.kepler.json" };
  const path = `${project.dropbox_root_path}/${project.default_config_file}`;
  const bytes = new TextEncoder().encode('{"version":"v1","config":{},"datasets":[],"value":1}');
  await f.store(path, bytes);
  const repository = new DropboxMapConfigRepository(f.env);
  const source = await repository.loadLegacyStream({ project });
  const different = new TextEncoder().encode('{"version":"v1","config":{},"datasets":[],"value":2}');
  const operation = { id: "server-legacy-promotion", project_id: 9, organization_id: 1, upload_epoch: 1,
    size_bytes: source.sizeBytes, checksum: source.checksum, checksum_algorithm: source.checksumAlgorithm, serialization_version: 1 };
  await source.body.cancel();
  await assert.rejects(uploadProjectSaveOperationPayload(f.env, { project, operation, body: new Response(different).body }), { code: "PROJECT_CONFIG_INTEGRITY_MISMATCH" });
  assert.equal(f.objects.size, 1);
});
