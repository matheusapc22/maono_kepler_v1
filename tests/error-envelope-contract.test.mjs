import assert from "node:assert/strict";
import test from "node:test";

import { errorResponse, errorResponseFromError } from "../functions/_lib/http.js";

test("errorResponse produz envelope S06 completo", async () => {
  const response = errorResponse(
    "Storage indisponível.",
    503,
    "DROPBOX_UPLOAD_FAILED",
  );
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "DROPBOX_UPLOAD_FAILED");
  assert.equal(payload.error.category, "STORAGE");
  assert.equal(payload.error.retryable, true);
  assert.equal(typeof payload.error.correlationId, "string");
  assert.ok(payload.error.correlationId.length >= 8);
  assert.equal(response.headers.get("X-Correlation-Id"), payload.error.correlationId);
  assert.equal("stack" in payload.error, false);
  assert.equal("cause" in payload.error, false);
});

test("correlationId fornecido é preservado em body e header", async () => {
  const correlationId = "test-correlation-123456";
  const response = errorResponse(
    "Conflito.",
    409,
    "PROJECT_CONFIG_REVISION_CONFLICT",
    null,
    { correlationId },
  );
  const payload = await response.json();
  assert.equal(payload.error.correlationId, correlationId);
  assert.equal(response.headers.get("X-Correlation-Id"), correlationId);
  assert.equal(payload.error.category, "MAP_CONFIG");
  assert.equal(payload.error.retryable, false);
});

test("errorResponseFromError preserva origem técnica sob mensagem pública", async () => {
  const cause = new Error("Falha ao enviar arquivo Dropbox /x: 503 upstream");
  cause.status = 503;
  const response = errorResponseFromError(cause, {
    defaultCode: "PROJECT_SAVE_ERROR",
    publicMessage: "Não foi possível salvar o projeto.",
  });
  const payload = await response.json();
  assert.equal(payload.error.code, "DROPBOX_UPLOAD_FAILED");
  assert.equal(payload.error.category, "STORAGE");
  assert.equal(payload.error.retryable, true);
  assert.equal(payload.error.message, "Não foi possível salvar o projeto.");
});
