import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DropboxClient } from "../functions/_lib/dropbox-client.js";
import {
  sha256Hex,
  verifyProjectConfigBytes,
} from "../functions/_lib/project-config-integrity.js";

const largeCreationSource = await readFile(
  new URL("../functions/_lib/project-large-creation.js", import.meta.url),
  "utf8",
);
const dropboxLargeSource = await readFile(
  new URL("../functions/_lib/dropbox-large-upload.js", import.meta.url),
  "utf8",
);

function primedDropboxClient(fetchFn) {
  const client = new DropboxClient(
    {},
    {
      fetchFn,
      sleepFn: async () => {},
      randomFn: () => 0,
      metricFn: () => {},
    },
  );
  client.accessToken = "acceptance-test-token";
  client.accessTokenExpiresAt = Date.now() + 10 * 60 * 1000;
  return client;
}

test("Dropbox timeout é classificado como retryable e não vira sucesso ambíguo", async () => {
  const client = primedDropboxClient(async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  );

  await assert.rejects(
    client.request({
      operation: "large-create-timeout-test",
      url: "https://content.dropboxapi.com/test",
      timeoutMs: 50,
      budgetMs: 1_000,
      maxRetries: 0,
      buildInit: ({ accessToken }) => ({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: new Uint8Array(0),
      }),
    }),
    (error) => {
      assert.equal(error.code, "DROPBOX_TIMEOUT");
      assert.equal(error.status, 504);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("Dropbox 503 permanece indisponibilidade retryable", async () => {
  const client = primedDropboxClient(async () =>
    new Response("temporarily unavailable", { status: 503 }),
  );

  await assert.rejects(
    client.request({
      operation: "large-create-503-test",
      url: "https://content.dropboxapi.com/test",
      maxRetries: 0,
      buildInit: () => ({ method: "POST", body: new Uint8Array(0) }),
    }),
    (error) => {
      assert.equal(error.code, "DROPBOX_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("tamanho incorreto impede aceitar revisão persistida", async () => {
  const bytes = new TextEncoder().encode('{"version":"v1","config":{},"datasets":[]}');
  const checksum = await sha256Hex(bytes);

  await assert.rejects(
    verifyProjectConfigBytes(bytes, {
      expectedChecksum: checksum,
      expectedSizeBytes: bytes.byteLength + 1,
    }),
    (error) => {
      assert.equal(error.code, "PROJECT_CONFIG_SIZE_MISMATCH");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("hash incorreto impede aceitar revisão persistida", async () => {
  const bytes = new TextEncoder().encode('{"version":"v1","config":{},"datasets":[]}');

  await assert.rejects(
    verifyProjectConfigBytes(bytes, {
      expectedChecksum: "0".repeat(64),
      expectedSizeBytes: bytes.byteLength,
    }),
    (error) => {
      assert.equal(error.code, "PROJECT_CONFIG_INTEGRITY_MISMATCH");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("append e finish do upload session nunca fazem retry cego", () => {
  assert.match(
    dropboxLargeSource,
    /appendLargeDropboxUploadSession[\s\S]*?maxRetries:\s*0/,
  );
  assert.match(
    dropboxLargeSource,
    /finishLargeDropboxUploadSession[\s\S]*?maxRetries:\s*0/,
  );
  assert.match(dropboxLargeSource, /DROPBOX_UPLOAD_SESSION_OFFSET_CONFLICT/);
  assert.match(dropboxLargeSource, /strict_conflict:\s*createOnly/);
});

test("falha Large CREATE mantém arquivo inativo e só libera quota em erro não-retryable", () => {
  const failureStart = largeCreationSource.indexOf("export async function markLargeProjectCreationFailed");
  assert.ok(failureStart >= 0);
  const failure = largeCreationSource.slice(failureStart);

  assert.match(failure, /markProjectLifecycleFailed/);
  assert.match(failure, /status = 'ERROR', active = 0/);
  assert.match(failure, /if \(retryable\)[\s\S]*touchQuotaReservation/);
  assert.match(failure, /else \{[\s\S]*releaseProjectQuota/);
  assert.match(failure, /action:\s*"project_create_failed"/);
  assert.match(failure, /transport:\s*"stream"/);
});
