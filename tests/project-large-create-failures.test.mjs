import assert from "node:assert/strict";
import test from "node:test";

import { DropboxClient } from "../functions/_lib/dropbox-client.js";
import {
  sha256Hex,
  verifyProjectConfigBytes,
} from "../functions/_lib/project-config-integrity.js";

import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { config, create, status } from "./helpers/durable-project-http.mjs";

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

test("provider checksum disagreement never activates creation or commits quota", async t => {
  const f=persistenceFixture(t,{async afterProvider({op,response,objects,args}) {
    if(op === "upload_session/finish") { objects.get(args.commit.path).metadata.content_hash="0".repeat(64); return Response.json({...await response.json(),content_hash:"0".repeat(64)}); }
  }});
  const result=await create(f,config("provider-mismatch"));
  assert.ok(result.status>=400);
  assert.equal(f.project().active,0);
  assert.equal(f.project().config_revision,0);
  assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active,0);
  assert.notEqual(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status,"COMMITTED");
  const receipt=await status(f,result.registered.input.operationId,{key:result.key});
  assert.equal(receipt.data.operation.state,"FAILED_FINAL");
  assert.equal(receipt.data.operation.receipt,null);
});
