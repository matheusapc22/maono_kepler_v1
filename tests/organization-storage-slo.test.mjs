import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildReliabilitySloReport,
  reportExitCode,
  SLO_CONTRACT,
} from "../scripts/organization-storage/reliability-slo-report.mjs";
import {
  organizationStorageObservation,
  recordOrganizationStorageObservation,
} from "../functions/_lib/organization-storage-telemetry.js";

const START = Date.parse("2026-08-01T00:00:00.000Z");
const END = START + 30 * 86400000;
const THROUGH = END + 3600000;
const iso = (ms) => new Date(ms).toISOString();

// Synthetic evidence is confined to unit tests. It is never exported as a
// production acceptance artifact or used by the live release workflow.
function fixture({ count = 1000, incidentCount = 100 } = {}) {
  const manifest = {
    schemaVersion: 1,
    evidenceKind: "production-observation",
    target: { ...SLO_CONTRACT.target },
    releaseSha: "a".repeat(40),
    window: { start: iso(START), end: iso(END), observedThrough: iso(THROUGH) },
    coverage: {
      organizationInventoryComplete: true,
      auditExportComplete: true,
      telemetryComplete: true,
      from: iso(START), through: iso(THROUGH), evidenceRef: "unit-test-only",
    },
    safetyChecks: SLO_CONTRACT.zeroTolerance.map((name) => ({
      name, count: 0, from: iso(START), through: iso(THROUGH), evidenceRef: "unit-test-only",
    })),
  };
  const organizations = [];
  const audit = [];
  const add = (event) => audit.push({
    id: audit.length + 1,
    action: "organization.storage.observation",
    details: { metadata: {
      schemaVersion: 1, source: "lifecycle", correlationId: "corr-test", ...event,
    } },
  });
  for (let i = 1; i <= count; i += 1) {
    const createdAt = iso(START + i * 1000);
    organizations.push({ id: i, created_at: createdAt });
    add({ type: "created", organizationId: i, observedAt: createdAt, createdAt, activeAtCreation: true });
    if (i <= incidentCount) {
      add({ type: "failure", organizationId: i, incidentId: `incident-${i}`, observedAt: iso(START + i * 1000 + 1000), completedAt: iso(START + i * 1000 + 1000), firstFailedAt: iso(START + i * 1000 + 1000), retryable: true });
    }
    add({ type: "operational", organizationId: i, incidentId: `incident-${i}`, observedAt: iso(START + i * 1000 + 60000), physicallyVerified: true, manualIntervention: false });
  }
  return { manifest, organizations, audit };
}

const metadata = (row) => row.details.metadata;

test("contrato fixa alvo, janela, amostras, deadlines e metas sem inferir sucesso de ausência", () => {
  const report = buildReliabilitySloReport(fixture());
  assert.equal(report.status, "PASS");
  assert.equal(report.provisioning.total, 1000);
  assert.equal(report.transientRecovery.total, 100);
  assert.equal(report.provisioning.completionLatency.p99, 60000);
  assert.equal(report.transientRecovery.completionLatency.p95, 59000);
  const empty = buildReliabilitySloReport(fixture({ count: 0, incidentCount: 0 }));
  assert.equal(empty.status, "INCONCLUSIVE");
  assert.equal(empty.provisioning.ratio, null);
  assert.equal(empty.provisioning.completionLatency.p50, null);
  assert.equal(reportExitCode(empty, true), 3);
});

test("resultado não passa com amostra insuficiente mesmo com 100% observado", () => {
  const report = buildReliabilitySloReport(fixture({ count: 999, incidentCount: 99 }));
  assert.equal(report.status, "INCONCLUSIVE");
  assert.equal(report.provisioning.ratio, 1);
  assert.ok(report.reasons.includes("TRANSIENT_RECOVERY_SAMPLE_INSUFFICIENT"));
});

test("coleta de follow-up incompleta não aprova coortes ainda imaturas", () => {
  const input = fixture();
  input.manifest.window.observedThrough = iso(END);
  assert.equal(buildReliabilitySloReport(input).status, "INCONCLUSIVE");
});

test("alvo errado, preview, SHA abreviado ou janela errada são inválidos", () => {
  for (const mutate of [
    (input) => { input.manifest.target.databaseId = "preview"; },
    (input) => { input.manifest.target.environment = "preview"; },
    (input) => { input.manifest.releaseSha = "abcd123"; },
    (input) => { input.manifest.evidenceKind = "simulation"; },
    (input) => { input.manifest.window.end = iso(END - 1); },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(buildReliabilitySloReport(input).status, "INVALID");
  }
});

test("inventário independente detecta criação sem observação e cobertura ausente", () => {
  const input = fixture();
  input.audit = input.audit.filter((row) => metadata(row).type !== "created" || metadata(row).organizationId !== 1);
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "INCONCLUSIVE");
  assert.ok(report.reasons.includes("CREATION_OBSERVATION_MISSING:1"));
  const missingCoverage = fixture();
  missingCoverage.manifest.coverage.telemetryComplete = false;
  assert.equal(buildReliabilitySloReport(missingCoverage).status, "INCONCLUSIVE");
});

test("desativação atual não remove organização ativa na criação do denominador", () => {
  const input = fixture();
  input.organizations[0].active = 0;
  input.audit = input.audit.filter((row) => metadata(row).type !== "operational" || metadata(row).organizationId > 2);
  const report = buildReliabilitySloReport(input);
  assert.equal(report.provisioning.total, 1000);
  assert.equal(report.provisioning.successful, 998);
  assert.equal(report.status, "FAIL");
});

test("organizações criadas inativas são exclusões explícitas, sem usar active atual", () => {
  const input = fixture({ count: 1001 });
  metadata(input.audit.find((row) => metadata(row).type === "created" && metadata(row).organizationId === 1001)).activeAtCreation = false;
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "PASS");
  assert.equal(report.cohorts.inactiveAtCreation, 1);
  assert.equal(report.provisioning.total, 1000);
});

test("limite superior da janela é exclusivo e timestamp sem timezone é rejeitado", () => {
  const input = fixture();
  input.organizations.push({ id: 2000, created_at: iso(END) });
  assert.equal(buildReliabilitySloReport(input).status, "PASS");
  input.manifest.window.start = "2026-08-01 00:00:00";
  assert.equal(buildReliabilitySloReport(input).status, "INVALID");
});

test("READY sem verificação física não comprova operação e não some do denominador", () => {
  const input = fixture();
  for (const row of input.audit) {
    if (metadata(row).type === "operational") metadata(row).physicallyVerified = false;
  }
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "FAIL");
  assert.equal(report.provisioning.successful, 0);
  assert.equal(report.transientRecovery.successful, 0);
});

test("reparo manual, conclusão tardia e conclusão superseded não contam como recuperação automática", () => {
  for (const mutate of [
    (event) => { event.manualIntervention = true; },
    (event) => { event.source = "operator"; },
    (event) => { event.observedAt = iso(END); },
    (event) => { event.superseded = true; },
  ]) {
    const input = fixture();
    for (const row of input.audit.filter((row) => metadata(row).type === "operational" && metadata(row).organizationId <= 2)) mutate(metadata(row));
    const report = buildReliabilitySloReport(input);
    assert.equal(report.status, "FAIL");
    assert.equal(report.transientRecovery.successful, 98);
  }
});

test("deadline inclusivo e objetivo exato permitem 999/1000 e 99/100", () => {
  const input = fixture();
  const first = metadata(input.audit.find((row) => metadata(row).type === "operational"));
  first.observedAt = iso(START + 1000 + SLO_CONTRACT.provisioning.deadlineMs);
  input.audit = input.audit.filter((row) => metadata(row).type !== "operational" || metadata(row).organizationId !== 2);
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "PASS");
  assert.equal(report.provisioning.ratio, 0.999);
  assert.equal(report.transientRecovery.ratio, 0.99);
});

test("duplicação idêntica do export não infla denominadores; duplicação divergente é inválida", () => {
  const input = fixture();
  input.audit.push(structuredClone(input.audit[0]));
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "PASS");
  assert.equal(report.cohorts.duplicateAuditRows, 1);
  metadata(input.audit.at(-1)).activeAtCreation = false;
  assert.equal(buildReliabilitySloReport(input).status, "INVALID");
});

test("múltiplas tentativas não inflacionam incidentes e uma falha permanente posterior não apaga a transitória", () => {
  const input = fixture();
  const repeat = structuredClone(input.audit.find((row) => metadata(row).type === "failure"));
  repeat.id = 99999;
  metadata(repeat).observedAt = iso(START + 5000);
  metadata(repeat).completedAt = iso(START + 5000);
  metadata(repeat).retryable = false;
  input.audit.push(repeat);
  const report = buildReliabilitySloReport(input);
  assert.equal(report.transientRecovery.total, 100);
  assert.equal(report.cohorts.permanentIncidents, 0);
});

test("incidentes com identidade divergente são rejeitados e classificação desconhecida não passa", () => {
  const input = fixture();
  const repeat = structuredClone(input.audit.find((row) => metadata(row).type === "failure"));
  repeat.id = 99999;
  metadata(repeat).organizationId = 2;
  input.audit.push(repeat);
  assert.equal(buildReliabilitySloReport(input).status, "INVALID");
  const unknown = fixture();
  delete metadata(unknown.audit.find((row) => metadata(row).type === "failure")).retryable;
  assert.equal(buildReliabilitySloReport(unknown).status, "INCONCLUSIVE");
});

test("primeira falha ausente não permite reclassificar incidente transitório como permanente", () => {
  const input = fixture();
  input.audit = input.audit.filter((row) => metadata(row).type !== "failure" || metadata(row).organizationId !== 1);
  input.audit.push({ id: 92000, action: "organization.storage.observation", details: { metadata: {
    schemaVersion: 1, type: "failure", source: "scheduled", organizationId: 1,
    observedAt: iso(START + 5001), completedAt: iso(START + 5000),
    firstFailedAt: iso(START + 2000), correlationId: "corr-missing-first", incidentId: "incident-1", retryable: false,
  } } });
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "INCONCLUSIVE");
  assert.equal(report.transientRecovery.total, 99);
  assert.equal(report.cohorts.permanentIncidents, 0);
  assert.ok(report.reasons.includes("INITIAL_FAILURE_OBSERVATION_MISSING:incident-1"));
});

test("falha permanente inicial é relatada separadamente da coorte transitória", () => {
  const input = fixture({ incidentCount: 101 });
  metadata(input.audit.find((row) => metadata(row).type === "failure" && metadata(row).organizationId === 101)).retryable = false;
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "PASS");
  assert.equal(report.transientRecovery.total, 100);
  assert.equal(report.cohorts.permanentIncidents, 1);
});

test("falha de execução superseded não abre novo incidente após conclusão mais recente", () => {
  const input = fixture();
  input.audit.push({ id: 90000, action: "organization.storage.observation", details: { metadata: {
    schemaVersion: 1, type: "failure", source: "scheduled", organizationId: 1,
    observedAt: iso(START + 120000), correlationId: "corr-old", incidentId: "superseded-old",
    firstFailedAt: iso(START + 120000), superseded: true, retryable: true,
  } } });
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "PASS");
  assert.equal(report.transientRecovery.total, 100);
  assert.equal(report.cohorts.supersededFailures, 1);
});

test("claim sem conclusão ou crash repetido sem classificação mantém SLO inconclusivo", () => {
  for (const crash of [false, true]) {
    const input = fixture();
    input.audit.push({ id: 90000, action: "organization.storage.observation", details: { metadata: {
      schemaVersion: 1, type: "attempt", source: "scheduled", organizationId: crash ? 500 : 900,
      observedAt: iso(START + 1000), correlationId: "corr-crash", incidentId: crash ? "incident-500" : "never-completed",
      attemptCount: crash ? 2 : 1,
    } } });
    const report = buildReliabilitySloReport(input);
    assert.equal(report.status, "INCONCLUSIVE");
    assert.ok(report.reasons.some((reason) => reason.startsWith(crash ? "RETRIED_INCIDENT_CLASSIFICATION_MISSING" : "ATTEMPT_WITHOUT_TERMINAL_OBSERVATION")));
  }
});

test("intervenção manual anterior à conclusão automática não fica oculta", () => {
  const input = fixture();
  for (const organizationId of [1, 2]) input.audit.push({ id: 90000 + organizationId, action: "organization.storage.observation", details: { metadata: {
    schemaVersion: 1, type: "attempt", source: "operator", organizationId,
    observedAt: iso(START + organizationId * 1000 + 2000), correlationId: "corr-operator", incidentId: `incident-${organizationId}`,
    manualIntervention: true,
  } } });
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "FAIL");
  assert.equal(report.provisioning.successful, 998);
  assert.equal(report.transientRecovery.successful, 98);
});

test("falha do operador seguida de sucesso scheduled não vira recuperação automática", () => {
  const input = fixture();
  for (const organizationId of [1, 2]) input.audit.push({ id: 91000 + organizationId, action: "organization.storage.observation", details: { metadata: {
    schemaVersion: 1, type: "failure", source: "operator", organizationId,
    observedAt: iso(START + organizationId * 1000 + 2000), correlationId: "corr-operator-failure", incidentId: `incident-${organizationId}`,
    firstFailedAt: iso(START + organizationId * 1000 + 1000), retryable: true, manualIntervention: false,
    completedAt: iso(START + organizationId * 1000 + 2000),
  } } });
  for (const row of input.audit.filter((row) => metadata(row).type === "operational")) metadata(row).source = "scheduled";
  const report = buildReliabilitySloReport(input);
  assert.equal(report.status, "FAIL");
  assert.equal(report.provisioning.successful, 998);
  assert.equal(report.transientRecovery.successful, 98);
});

test("evidência de integridade ausente é inconclusiva e violação conhecida bloqueia mesmo com amostra baixa", () => {
  const input = fixture();
  input.manifest.safetyChecks = [];
  assert.equal(buildReliabilitySloReport(input).status, "INCONCLUSIVE");
  const incident = fixture({ count: 1, incidentCount: 0 });
  incident.manifest.safetyChecks[0].count = 1;
  assert.equal(buildReliabilitySloReport(incident).status, "FAIL");
  const correlation = fixture();
  delete metadata(correlation.audit[0]).correlationId;
  assert.equal(buildReliabilitySloReport(correlation).status, "FAIL");
});

test("referências de evidência devem ser strings não vazias, sem aceitar objetos ou espaços", () => {
  for (const evidenceRef of [{}, [], "   ", false, null]) {
    const coverage = fixture();
    coverage.manifest.coverage.evidenceRef = evidenceRef;
    assert.equal(buildReliabilitySloReport(coverage).status, "INCONCLUSIVE");
    const safety = fixture();
    safety.manifest.safetyChecks[0].evidenceRef = evidenceRef;
    assert.equal(buildReliabilitySloReport(safety).status, "INCONCLUSIVE");
  }
});

test("export Wrangler aceita metadata JSON textual e rejeita consulta com falha", () => {
  const input = fixture();
  input.organizations = [{ success: true, results: input.organizations }];
  input.audit = [{ success: true, results: input.audit.map((row) => ({ ...row, details: JSON.stringify(row.details) })) }];
  assert.equal(buildReliabilitySloReport(input).status, "PASS");
  input.audit[0].success = false;
  assert.equal(buildReliabilitySloReport(input).status, "INVALID");
});

test("gate fornece exit codes distintos e CLI não sobrescreve arquivos de evidência", () => {
  assert.equal(reportExitCode({ status: "PASS" }, true), 0);
  assert.equal(reportExitCode({ status: "FAIL" }, true), 1);
  assert.equal(reportExitCode({ status: "INVALID" }, false), 2);
  assert.equal(reportExitCode({ status: "INCONCLUSIVE" }, true), 3);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maono-slo-test-"));
  try {
    const input = fixture({ count: 0, incidentCount: 0 });
    const args = [];
    for (const key of ["manifest", "organizations", "audit"]) {
      const filename = path.join(directory, `${key}.json`);
      fs.writeFileSync(filename, JSON.stringify(input[key]));
      args.push(`--${key}`, filename);
    }
    const script = new URL("../scripts/organization-storage/reliability-slo-report.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [script.pathname, ...args, "--gate"], { encoding: "utf8" });
    assert.equal(result.status, 3, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "INCONCLUSIVE");
    const overwrite = spawnSync(process.execPath, [script.pathname, ...args, "--output", path.join(directory, "manifest.json")], { encoding: "utf8" });
    assert.equal(overwrite.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"))).schemaVersion, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("telemetria allowlist exclui nomes, paths, erros brutos e envelope interno", () => {
  const observation = organizationStorageObservation({
    type: "failure", source: "scheduled", organizationId: 9,
    observedAt: iso(START), correlationId: "corr-safe", incidentId: "incident-safe",
    firstFailedAt: iso(START), retryable: false, attemptCount: 3,
    previousIncidentId: "old-incident", retryBudgetReset: true,
    providerCode: "DROPBOX_AUTH_FAILED", dropboxRootPath: "/private/path",
    message: "access_token=secret", storage_error: "envelope", name: "private name",
  });
  assert.equal(observation.providerCode, "DROPBOX_AUTH_FAILED");
  assert.equal(observation.retryable, false);
  assert.equal(observation.previousIncidentId, "old-incident");
  assert.equal(observation.retryBudgetReset, true);
  for (const key of ["dropboxRootPath", "message", "storage_error", "name"]) assert.equal(key in observation, false);
  assert.equal(organizationStorageObservation({ ...observation, correlationId: "raw token /path" }), null);
});

test("falha de auditoria não transforma operação de negócio bem sucedida em erro nem finge persistência", async () => {
  const value = { type: "operational", source: "lifecycle", organizationId: 1, observedAt: iso(START), correlationId: "corr-safe", physicallyVerified: true, manualIntervention: false };
  const unavailable = await recordOrganizationStorageObservation({}, value, { audit: async () => null });
  assert.equal(unavailable.recorded, false);
  const failed = await recordOrganizationStorageObservation({}, value, { audit: async () => { throw new Error("private provider message"); } });
  assert.equal(failed.recorded, false);
  let event;
  const saved = await recordOrganizationStorageObservation({}, value, { audit: async (_env, item) => { event = item; return { success: true }; } });
  assert.equal(saved.recorded, true);
  assert.equal(event.action, "organization.storage.observation");
  assert.equal(event.metadata.physicallyVerified, true);
});
