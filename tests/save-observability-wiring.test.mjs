import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const configRoute = read("functions/api/projects/[slug]/config.js");
const createRoute = read("functions/api/projects/index.js");
const service = read("functions/_lib/project-config-service.js");
const backendObservability = read("functions/_lib/save-observability.js");
const clientObservability = read("src/pages/Kepler/save-observability.ts");
const saveButton = read("src/pages/Kepler/components/maono-save-button.tsx");
const telemetry = read("src/pages/Kepler/map-panel/map-panel-telemetry.ts");
const packageJson = JSON.parse(read("package.json"));

test("PUT e POST leem body uma vez, correlacionam saveId e ecoam headers", () => {
  for (const source of [configRoute, createRoute]) {
    assert.match(source, /createSaveTrace/);
    assert.match(source, /readSaveJsonBody\(request, saveTrace\)/);
    assert.match(source, /bindSaveTraceToConfig/);
    assert.match(source, /saveTrace\?\.responseHeaders\(\)/);
  }
  assert.match(backendObservability, /"X-Maono-Save-Id"/);
  assert.match(backendObservability, /"X-Correlation-Id"/);
  assert.match(backendObservability, /"Server-Timing"/);
});

test("serviço mede somente fronteiras reais do pipeline de publicação", () => {
  const expectedStages = [
    "SERIALIZE",
    "VALIDATE",
    "RESERVE",
    "WRITE",
    "VERIFY",
    "READY",
    "PUBLISH",
  ];
  for (const stage of expectedStages) {
    assert.match(service, new RegExp(`runObservedStage\\(trace, \\\"${stage}\\\"`));
  }
  assert.match(service, /getSaveTraceForConfig\(config\)/);
  assert.doesNotMatch(service, /saveId\s*[:=].*project_config_revisions/);
});

test("frontend cria saveId antes da serialização e envia body já serializado", () => {
  assert.match(clientObservability, /beginClientSaveAttempt/);
  assert.match(clientObservability, /new TextEncoder\(\)\.encode\(value\)\.byteLength/);
  assert.match(clientObservability, /"X-Maono-Save-Id"/);
  assert.match(clientObservability, /"X-Correlation-Id"/);
  assert.match(saveButton, /beginClientSaveAttempt\("update"\)/);
  assert.match(saveButton, /beginClientSaveAttempt\("create"\)/);
  assert.match(saveButton, /serializeSaveRequest\(attempt/);
  assert.match(saveButton, /headers: buildSaveRequestHeaders\(attempt\)/);
  assert.match(saveButton, /body: serialized\.body/);
});

test("telemetria cobre serialização, sucesso, falha HTTP e falha de rede", () => {
  assert.match(saveButton, /map_save_serialized/);
  assert.match(saveButton, /map_save_succeeded/);
  assert.match(saveButton, /map_save_failed/);
  assert.match(saveButton, /INFRASTRUCTURE_NETWORK_FAILURE/);
  assert.match(saveButton, /serverTiming/);
  for (const field of [
    "saveId",
    "correlationId",
    "payloadBytes",
    "serializeDurationMs",
    "durationMs",
    "stage",
    "category",
    "retryable",
    "httpStatus",
    "expectedRevision",
    "candidateRevision",
  ]) {
    assert.match(telemetry, new RegExp(`${field}\\?`));
  }
});

test("criação não registra o objeto de erro bruto e foundation gate inclui SAVE-01", () => {
  assert.doesNotMatch(
    createRoute,
    /Falha na criação completa do projeto:\\", error\)/,
  );
  assert.match(
    packageJson.scripts["test:save-observability"],
    /save-observability\.test\.mjs/,
  );
  assert.match(
    packageJson.scripts["test:foundation-gate"],
    /test:save-observability/,
  );
});
