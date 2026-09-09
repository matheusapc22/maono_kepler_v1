import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { publicRuntimeDiagnostics } from "../functions/_lib/runtime-environment.js";
import { isLargeProjectCreationEnabled } from "../functions/_lib/project-large-creation.js";

const saveButtonSource = await readFile(
  new URL("../src/pages/Kepler/components/maono-save-button.tsx", import.meta.url),
  "utf8",
);
const largeCreationSource = await readFile(
  new URL("../functions/_lib/project-large-creation.js", import.meta.url),
  "utf8",
);
const middlewareSource = await readFile(
  new URL("../functions/api/projects/[slug]/_middleware.js", import.meta.url),
  "utf8",
);
const healthSource = await readFile(
  new URL("../functions/api/health.js", import.meta.url),
  "utf8",
);

test("health expõe apenas o estado booleano da feature flag Large CREATE", () => {
  const disabled = publicRuntimeDiagnostics({
    MAONO_RUNTIME_ENV: "preview",
    PROJECT_CREATE_LARGE_STREAM_V1: "false",
  });
  const enabled = publicRuntimeDiagnostics({
    MAONO_RUNTIME_ENV: "preview",
    PROJECT_CREATE_LARGE_STREAM_V1: "true",
  });

  assert.equal(disabled.largeCreateStreamEnabled, false);
  assert.equal(enabled.largeCreateStreamEnabled, true);
  assert.equal(
    enabled.largeCreateStreamEnabled,
    isLargeProjectCreationEnabled({ PROJECT_CREATE_LARGE_STREAM_V1: "true" }),
  );
  assert.match(healthSource, /publicRuntimeDiagnostics\(env\)/);
});

test("telemetria cliente diferencia inline/stream e preserva IDs de correlação", () => {
  assert.match(saveButtonSource, /transport:\s*result\.transport/);
  assert.match(saveButtonSource, /payloadBytes/);
  assert.match(saveButtonSource, /serializeDurationMs/);
  assert.match(saveButtonSource, /candidateRevision:\s*result\.revision/);
  assert.match(saveButtonSource, /saveId:\s*result\.diagnostics\.saveId/);
  assert.match(saveButtonSource, /correlationId:\s*result\.diagnostics\.correlationId/);
  assert.match(saveButtonSource, /serverTiming:\s*result\.diagnostics\.serverTiming/);
});

test("auditoria Large CREATE registra metadados operacionais, nunca o MapConfig ou segredos", () => {
  assert.match(largeCreationSource, /action:\s*"project_create_reserved"/);
  assert.match(largeCreationSource, /payloadBytes:\s*configMetadata\.sizeBytes/);
  assert.match(largeCreationSource, /transport:\s*"stream"/);
  assert.match(largeCreationSource, /action:\s*"project_create_activated"/);
  assert.match(largeCreationSource, /configRevision:\s*1/);
  assert.match(largeCreationSource, /checksumAlgorithm:\s*artifact\.checksumAlgorithm/);

  for (const forbidden of [
    "DROPBOX_REFRESH_TOKEN",
    "DROPBOX_APP_SECRET",
    "maono_session",
    "Authorization: `Bearer",
  ]) {
    assert.equal(
      largeCreationSource.includes(forbidden),
      false,
      `auditoria Large CREATE não deve tocar em ${forbidden}`,
    );
  }
});

test("middleware registra falha com estágio/provider sem logar corpo do MapConfig", () => {
  assert.match(middlewareSource, /operation === "create"[\s\S]{0,160}"project_create_stream"/);
  assert.match(middlewareSource, /correlationId/);
  assert.match(middlewareSource, /saveId:\s*trace\.saveId/);
  assert.match(middlewareSource, /code:\s*normalized\.code/);
  assert.match(middlewareSource, /retryable:\s*normalized\.retryable/);
  assert.match(middlewareSource, /transport:\s*"stream"/);
  assert.doesNotMatch(middlewareSource, /metadata:\s*\{[\s\S]{0,500}configBody/);
  assert.doesNotMatch(middlewareSource, /console\.(?:log|info|error)\([^)]*request\.body/);
});
