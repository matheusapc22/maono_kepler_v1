import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("streaming backend nunca materializa o request grande como text/json", async () => {
  const service = await readFile(servicePath, "utf8");

  assert.match(service, /request\.body\.getReader\(\)/);
  assert.doesNotMatch(service, /request\.text\s*\(/);
  assert.doesNotMatch(service, /request\.json\s*\(/);
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

test("Dropbox streaming usa blocos de 4 MiB e cursor sem retry cego", async () => {
  const transport = await readFile(transportPath, "utf8");

  assert.match(transport, /DROPBOX_STREAM_BLOCK_BYTES = 4 \* 1024 \* 1024/);
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
