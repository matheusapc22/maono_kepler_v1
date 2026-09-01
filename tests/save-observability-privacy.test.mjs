import assert from "node:assert/strict";
import test from "node:test";

import {
  createSaveTrace,
  sanitizeSaveDiagnostic,
} from "../functions/_lib/save-observability.js";

const SECRET_MARKERS = [
  "FeatureCollection",
  "coordinates",
  "ACCESS_TOKEN_SHOULD_NOT_LEAK",
  "COOKIE_SHOULD_NOT_LEAK",
  "AUTHORIZATION_SHOULD_NOT_LEAK",
  "RAW_BODY_SHOULD_NOT_LEAK",
];

function assertNoSecretMarker(value) {
  const serialized = JSON.stringify(value);
  for (const marker of SECRET_MARKERS) {
    assert.equal(
      serialized.includes(marker),
      false,
      `diagnóstico expôs marcador sensível: ${marker}`,
    );
  }
}

test("sanitizer usa allowlist e descarta payload geográfico e credenciais", () => {
  const safe = sanitizeSaveDiagnostic({
    event: "project_save_failed",
    saveId: "save_privacy_12345678",
    correlationId: "corr_privacy_12345678",
    operation: "update",
    projectId: 84,
    expectedRevision: 16,
    candidateRevision: 17,
    payloadBytes: 4321,
    stage: "WRITE",
    provider: "dropbox",
    providerStatus: 503,
    httpStatus: 503,
    code: "MAP_CONFIG_STORAGE_UNAVAILABLE",
    category: "STORAGE",
    retryable: true,
    result: "error",
    config: {
      type: "FeatureCollection",
      features: [{ geometry: { coordinates: [-43.1, -22.9] } }],
    },
    requestBody: "RAW_BODY_SHOULD_NOT_LEAK",
    token: "ACCESS_TOKEN_SHOULD_NOT_LEAK",
    cookie: "COOKIE_SHOULD_NOT_LEAK",
    authorization: "AUTHORIZATION_SHOULD_NOT_LEAK",
  });

  assert.equal(safe.saveId, "save_privacy_12345678");
  assert.equal(safe.stage, "WRITE");
  assert.equal(safe.providerStatus, 503);
  assertNoSecretMarker(safe);
  assert.equal("config" in safe, false);
  assert.equal("requestBody" in safe, false);
  assert.equal("token" in safe, false);
});

test("structured log não serializa message, cause, config ou headers do erro", () => {
  const originalError = console.error;
  const captured = [];
  console.error = (...args) => captured.push(args);
  try {
    const trace = createSaveTrace({
      saveId: "save_logprivacy_12345678",
      correlationId: "corr_logprivacy_12345678",
      operation: "update",
      projectId: 84,
    });
    const error = Object.assign(
      new Error("FeatureCollection coordinates ACCESS_TOKEN_SHOULD_NOT_LEAK"),
      {
        status: 503,
        code: "MAP_CONFIG_STORAGE_UNAVAILABLE",
        category: "STORAGE",
        retryable: true,
        config: { coordinates: [1, 2] },
        headers: {
          Cookie: "COOKIE_SHOULD_NOT_LEAK",
          Authorization: "AUTHORIZATION_SHOULD_NOT_LEAK",
        },
        cause: {
          status: 503,
          responseBody: "RAW_BODY_SHOULD_NOT_LEAK",
        },
        details: {
          provider: "dropbox",
          retryable: true,
          token: "ACCESS_TOKEN_SHOULD_NOT_LEAK",
        },
      },
    );

    trace.fail(error, {
      stage: "WRITE",
      httpStatus: 503,
      category: "STORAGE",
      retryable: true,
    });

    assert.equal(captured.length, 1);
    assert.equal(captured[0][0], "[Maono save]");
    assertNoSecretMarker(captured[0][1]);
    assert.equal(captured[0][1].provider, "dropbox");
    assert.equal(captured[0][1].providerStatus, 503);
  } finally {
    console.error = originalError;
  }
});
