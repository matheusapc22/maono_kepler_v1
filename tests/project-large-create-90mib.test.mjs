import assert from "node:assert/strict";
import test from "node:test";

import {
  LARGE_CREATE_MAX_ACCEPTANCE_BYTES,
  LARGE_CREATE_MIN_ACCEPTANCE_BYTES,
  buildLargeCreateFixture,
  fixtureSha256,
} from "../scripts/large-create/build-large-create-fixture.mjs";
import {
  beginClientSaveAttempt,
  buildSaveRequestHeaders,
} from "../src/pages/Kepler/save-observability.ts";
import { prepareProjectCreateTransport } from "../src/pages/Kepler/project-create-transport.ts";

const TARGET_MIB = Number(process.env.LARGE_CREATE_STRESS_MIB || 94);

test("fixture de acceptance fica entre 90 e 100 MiB e usa CREATE streaming metadata-first", () => {
  const fixture = buildLargeCreateFixture({ targetMiB: TARGET_MIB });
  assert.ok(fixture.sizeBytes >= LARGE_CREATE_MIN_ACCEPTANCE_BYTES);
  assert.ok(fixture.sizeBytes <= LARGE_CREATE_MAX_ACCEPTANCE_BYTES);
  assert.match(fixtureSha256(fixture.body), /^[a-f0-9]{64}$/);

  const attempt = beginClientSaveAttempt("create");
  const idempotencyKey = "large-create-stress-0001";
  const prepared = prepareProjectCreateTransport(attempt, {
    name: "QA Smoke Large Create Stress",
    description: "Fixture determinística de acceptance",
    organizationId: 9,
    idempotencyKey,
    config: fixture.config,
    legacy: null,
  });

  assert.equal(prepared.large, true);
  assert.equal(prepared.configPayloadBytes, fixture.sizeBytes);
  assert.equal(prepared.configBody, fixture.body);
  assert.ok(Buffer.byteLength(prepared.requestBody, "utf8") < 64 * 1024);

  const metadata = JSON.parse(prepared.requestBody);
  assert.equal(metadata.largeConfig, true);
  assert.equal(metadata.organizationId, 9);
  assert.equal(metadata.idempotencyKey, idempotencyKey);
  assert.equal(metadata.configMetadata.sizeBytes, fixture.sizeBytes);
  assert.equal(metadata.configMetadata.datasetCount, fixture.datasetCount);
  assert.equal(metadata.configMetadata.schemaName, "legacy-kepler");
  assert.equal(metadata.configMetadata.schemaVersion, 1);
  assert.equal("config" in metadata, false);

  const streamHeaders = buildSaveRequestHeaders(attempt);
  assert.equal(streamHeaders["X-Maono-Large-Config"], "1");
  assert.equal(streamHeaders["X-Maono-Expected-Revision"], "0");
  assert.equal(streamHeaders["X-Maono-Config-Size"], String(fixture.sizeBytes));
  assert.match(
    streamHeaders["Content-Type"],
    /application\/vnd\.maono\.map-config\+json/,
  );
});
