import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DROPBOX_CONTENT_HASH_BLOCK_BYTES,
  dropboxContentHashBlockDigest,
  dropboxContentHashFromBlockDigestsHex,
  dropboxContentHashHex,
} from "../functions/_lib/dropbox-content-hash.js";
import {
  PROJECT_CONFIG_CHECKSUM_ALGORITHM_DROPBOX,
  verifyProjectConfigBytes,
} from "../functions/_lib/project-config-integrity.js";
test("hash incremental streamed coincide com o content_hash canônico do Dropbox", async () => {
  const bytes = new Uint8Array(DROPBOX_CONTENT_HASH_BLOCK_BYTES + 12345);
  for (let index = 0; index < bytes.byteLength; index += 4096) {
    bytes[index] = (index / 4096) % 251;
  }

  const blockDigests = [];
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += DROPBOX_CONTENT_HASH_BLOCK_BYTES
  ) {
    blockDigests.push(
      await dropboxContentHashBlockDigest(
        bytes.subarray(
          offset,
          Math.min(offset + DROPBOX_CONTENT_HASH_BLOCK_BYTES, bytes.byteLength),
        ),
      ),
    );
  }

  const incremental = await dropboxContentHashFromBlockDigestsHex(blockDigests);
  const canonical = await dropboxContentHashHex(bytes);
  assert.equal(incremental, canonical);
});

test("integridade aceita content_hash Dropbox nas revisões streamed", async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: "v1", config: {}, datasets: [], value: "stream" }),
  );
  const expected = await dropboxContentHashHex(bytes);
  const verified = await verifyProjectConfigBytes(bytes, {
    expectedChecksum: expected,
    expectedAlgorithm: PROJECT_CONFIG_CHECKSUM_ALGORITHM_DROPBOX,
    expectedSizeBytes: bytes.byteLength,
  });

  assert.equal(verified.checksum, expected);
  assert.equal(verified.checksumAlgorithm, "dropbox-content-hash");
  assert.equal(verified.sizeBytes, bytes.byteLength);
});

test("new stream transport owns no D1 publication and validates the complete JSON", async () => {
  const service = await readFile(new URL("../functions/_lib/project-save-operation-payload.js", import.meta.url), "utf8");
  assert.doesNotMatch(service, /reserveProjectConfigRevision|publishProjectConfigRevision|markProjectConfigRevision/);
  assert.doesNotMatch(service, /request\.(?:text|json)\s*\(/);
  assert.match(service, /StreamingMapConfigValidator/);
  assert.match(service, /writeMode: "create"/);
});

import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { uploadProjectSaveOperationPayload, LARGE_CONFIG_THRESHOLD_BYTES } from "../functions/_lib/project-save-operation-payload.js";
for (const size of [LARGE_CONFIG_THRESHOLD_BYTES - 1, LARGE_CONFIG_THRESHOLD_BYTES, LARGE_CONFIG_THRESHOLD_BYTES + 1]) {
  test(`raw JSON uses the same exact-byte protocol at ${size} bytes`, async t => {
    const f = persistenceFixture(t);
    const base = '{"version":"v1","config":{},"datasets":[],"padding":"';
    const bytes = new TextEncoder().encode(base + "x".repeat(size - base.length - 2) + '"}');
    const project = { id: 8, organization_id: 1, dropbox_root_path: "/offline/a/8" };
    const operation = { id: "server-boundary", operation_id: "client-boundary", project_id: 8, organization_id: 1,
      upload_epoch: 1, checksum_algorithm: "dropbox-content-hash", checksum: await dropboxContentHashHex(bytes),
      size_bytes: bytes.length, serialization_version: 1 };
    const artifact = await uploadProjectSaveOperationPayload(f.env, { project, operation, body: new Response(bytes).body });
    assert.equal(artifact.sizeBytes, size);
    assert.equal(artifact.checksum, operation.checksum);
    assert.ok(f.calls.filter(call => call.op.startsWith("upload_session/")).every(call => call.size <= 4 * 1024 * 1024));
  });
}
