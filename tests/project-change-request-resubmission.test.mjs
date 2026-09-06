import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../migrations/0023_change_request_resubmissions.sql", import.meta.url),
  "utf8",
);
const service = await readFile(
  new URL("../functions/_lib/project-change-request-resubmission.js", import.meta.url),
  "utf8",
);
const resubmitEndpoint = await readFile(
  new URL("../functions/api/projects/[slug]/change-requests/[id]/resubmit.js", import.meta.url),
  "utf8",
);
const tracker = await readFile(
  new URL("../src/pages/Kepler/change-requests/ViewerRequestTrackingRuntime.tsx", import.meta.url),
  "utf8",
);

test("0023 cria lineage imutável, único por origem e restrito ao mesmo solicitante/projeto", () => {
  assert.match(migration, /resubmitted_from_request_id TEXT/);
  assert.match(migration, /REFERENCES project_change_requests\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_project_change_request_resubmission_source/);
  assert.match(migration, /trg_project_change_request_resubmission_immutable/);
  assert.match(migration, /parent\.organization_id = NEW\.organization_id/);
  assert.match(migration, /parent\.project_id = NEW\.project_id/);
  assert.match(migration, /parent\.requested_by_user_id = NEW\.requested_by_user_id/);
  assert.match(migration, /parent\.status IN \('rejected', 'conflict'\)/);
});

test("ressubmissão cria request e Ticket novos sem reescrever decisão/feedback do pai", () => {
  assert.match(service, /RESUBMITTABLE_STATUSES = new Set\(\["rejected", "conflict"\]\)/);
  assert.match(service, /INSERT INTO organization_tickets/);
  assert.match(service, /INSERT INTO project_change_requests/);
  assert.match(service, /resubmitted_from_request_id/);
  assert.match(service, /await db\.batch\(statements\)/);
  assert.doesNotMatch(service, /UPDATE project_change_requests SET[\s\S]{0,300}source\.id/);
  assert.match(service, /project\.change_request\.resubmitted/);
});

test("retry idempotente valida também a origem e stale revision preserva correção local", () => {
  const existing = service.indexOf("if (existing)");
  const stateGate = service.indexOf("RESUBMITTABLE_STATUSES.has", existing);
  const revisionGate = service.indexOf("const currentRevision", stateGate);
  assert.ok(existing >= 0 && stateGate > existing && revisionGate > stateGate);
  assert.match(service, /existing\.resubmitted_from_request_id !== source\.id/);
  assert.match(service, /CHANGE_REQUEST_IDEMPOTENCY_KEY_REUSED/);
  assert.match(service, /CHANGE_REQUEST_BASE_REVISION_STALE/);
  assert.match(resubmitEndpoint, /Idempotency-Key|resubmitProjectChangeRequest/);
});

test("Viewer mostra lifecycle/feedback e exige seleção explícita quando há Working Copy existente", () => {
  assert.match(tracker, /Minhas solicitações/);
  assert.match(tracker, /Feedback da revisão/);
  assert.match(tracker, /Corrigir e reenviar/);
  assert.match(tracker, /Suas alterações locais existentes foram preservadas/);
  assert.match(tracker, /setSelectedIds\(\[\]\)/);
  assert.match(tracker, /O projeto avançou de revisão/);
  assert.match(tracker, /refaça as correções antes de reenviar/);
});
