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
import {
  MAONO_LARGE_SAVE_THRESHOLD_BYTES,
  beginClientSaveAttempt,
  buildSaveRequestHeaders,
  serializeSaveRequest,
} from "../src/pages/Kepler/save-observability.ts";

const servicePath = new URL(
  "../functions/_lib/project-large-config-save.js",
  import.meta.url,
);
const transportPath = new URL(
  "../functions/_lib/dropbox-large-upload.js",
  import.meta.url,
);
const middlewarePath = new URL(
  "../functions/api/projects/[slug]/_middleware.js",
  import.meta.url,
);

test("save pequeno mantém envelope JSON tradicional", () => {
  const attempt = beginClientSaveAttempt("update");
  const config = {
    version: "v1",
    config: { visState: { layers: [] } },
    datasets: [],
  };
  const serialized = serializeSaveRequest(attempt, {
    config,
    expectedConfigRevision: 7,
  });
  const headers = buildSaveRequestHeaders(attempt);

  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-Maono-Large-Config"], undefined);
  assert.deepEqual(JSON.parse(serialized.body), {
    config,
    expectedConfigRevision: 7,
  });
});

test("save acima de 8 MiB envia MapConfig bruto e metadata em headers", () => {
  const attempt = beginClientSaveAttempt("update");
  const config = {
    version: "v1",
    config: { visState: { layers: [] } },
    datasets: [],
    largeFixture: "x".repeat(MAONO_LARGE_SAVE_THRESHOLD_BYTES + 1024),
  };
  const serialized = serializeSaveRequest(attempt, {
    config,
    expectedConfigRevision: 12,
  });
  const headers = buildSaveRequestHeaders(attempt);

  assert.ok(serialized.payloadBytes > MAONO_LARGE_SAVE_THRESHOLD_BYTES);
  assert.equal(headers["X-Maono-Large-Config"], "1");
  assert.equal(headers["X-Maono-Expected-Revision"], "12");
  assert.equal(headers["X-Maono-Config-Size"], String(serialized.payloadBytes));
  assert.equal(headers["X-Maono-Config-Schema"], "legacy-kepler");
  assert.equal(headers["X-Maono-Config-Schema-Version"], "1");
  assert.match(headers["Content-Type"], /application\/vnd\.maono\.map-config\+json/);

  const parsed = JSON.parse(serialized.body);
  assert.equal(parsed.version, "v1");
  assert.equal(parsed.largeFixture.length, MAONO_LARGE_SAVE_THRESHOLD_BYTES + 1024);
  assert.equal(parsed.expectedConfigRevision, undefined);
});

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

test("streaming backend nunca materializa o request grande como text/json", async () => {
  const service = await readFile(servicePath, "utf8");

  assert.match(service, /request\.body\.getReader\(\)/);
  assert.doesNotMatch(service, /request\.text\s*\(/);
  assert.doesNotMatch(service, /request\.json\s*\(/);
  assert.match(service, /StreamingJsonBoundaryGuard/);
  assert.doesNotMatch(service, /this\.stack\s*=|this\.inString\s*=/);
  assert.match(service, /DROPBOX_STREAM_BLOCK_BYTES/);
  assert.match(service, /appendLargeDropboxUploadSession/);
  assert.match(service, /finishLargeDropboxUploadSession/);
});

test("streaming preserva reserve -> storage -> ready -> publish", async () => {
  const service = await readFile(servicePath, "utf8");
  const reserve = service.indexOf("reserveProjectConfigRevision(env");
  const finish = service.indexOf("finishSessionWithReconciliation(env");
  const ready = service.indexOf("markProjectConfigRevisionReady(env");
  const publish = service.indexOf("publishProjectConfigRevision(env");

  assert.ok(reserve > 0);
  assert.ok(finish > reserve);
  assert.ok(ready > finish);
  assert.ok(publish > ready);
  assert.match(service, /writeMode:\s*"create"/);
  assert.match(service, /providerHash[\s\S]*contentHash/);
});

test("Dropbox streaming usa bloco canônico de content_hash e cursor sem retry cego", async () => {
  const transport = await readFile(transportPath, "utf8");

  assert.match(
    transport,
    /DROPBOX_STREAM_BLOCK_BYTES = DROPBOX_CONTENT_HASH_BLOCK_BYTES/,
  );
  assert.equal(DROPBOX_CONTENT_HASH_BLOCK_BYTES, 4 * 1024 * 1024);
  assert.match(transport, /maxRetries:\s*0/);
  assert.match(transport, /strict_conflict:\s*createOnly/);
  assert.match(transport, /DROPBOX_UPLOAD_SESSION_OFFSET_CONFLICT/);
});

test("middleware intercepta somente PUT /config grande e protege clientes antigos", async () => {
  const middleware = await readFile(middlewarePath, "utf8");

  assert.match(middleware, /targetsConfigPut\(request\)/);
  assert.match(middleware, /isLargeProjectConfigRequest\(request\)/);
  assert.match(middleware, /assertInlineProjectConfigRequestSize\(request\)/);
  assert.match(middleware, /return context\.next\(\)/);
  assert.match(middleware, /assertSaveDeployCompatibility/);
  assert.match(middleware, /can\(env, user, "project\.save"/);
  assert.match(middleware, /saveLargeProjectConfigStream/);
});
