import assert from "node:assert/strict";
import test from "node:test";

import { err, ok, unwrapResult } from "../functions/_lib/result.js";

test("ok encapsula valor sem alterar contrato de sucesso HTTP", () => {
  const result = ok({ id: 1 });
  assert.deepEqual(result, { ok: true, value: { id: 1 } });
  assert.deepEqual(unwrapResult(result), { id: 1 });
});

test("err normaliza falha como MaonoError", () => {
  const cause = new Error("falha");
  cause.status = 409;
  cause.code = "PROJECT_CONFIG_REVISION_CONFLICT";
  const result = err(cause, { correlationId: "corr-result-12345" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROJECT_CONFIG_REVISION_CONFLICT");
  assert.equal(result.error.category, "MAP_CONFIG");
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.correlationId, "corr-result-12345");
  assert.throws(() => unwrapResult(result), /falha/);
});
