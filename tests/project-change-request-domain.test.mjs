import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildChangeRequestSubmissionHash,
  CHANGE_REQUEST_TRANSITIONS,
  normalizeChangeRequestSubmission,
  PROJECT_CHANGE_OPERATION_REGISTRY,
} from "../functions/_lib/project-change-requests.js";

const migration = await readFile(
  new URL("../migrations/0020_project_change_requests.sql", import.meta.url),
  "utf8",
);
const service = await readFile(
  new URL("../functions/_lib/project-change-requests.js", import.meta.url),
  "utf8",
);
const collectionEndpoint = await readFile(
  new URL("../functions/api/projects/[slug]/change-requests.js", import.meta.url),
  "utf8",
);
const detailEndpoint = await readFile(
  new URL("../functions/api/projects/[slug]/change-requests/[id].js", import.meta.url),
  "utf8",
);

function submission(payload = { latitude: -15.78, longitude: -47.92 }) {
  return {
    baseRevision: 184,
    reason: "Novo ponto para validação.",
    operations: [
      {
        id: "op-1",
        type: "point.create",
        version: 1,
        payload,
        createdAt: "2026-09-04T12:00:00.000Z",
      },
    ],
  };
}

test("migration 0020 cria apenas request + operations com vínculo opcional ao ticket", () => {
  const tables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi)].map(
    (match) => match[1],
  );
  assert.deepEqual(tables, ["project_change_requests", "project_change_operations"]);
  assert.match(migration, /ticket_id INTEGER UNIQUE/);
  assert.match(migration, /REFERENCES organization_tickets\(id\) ON DELETE SET NULL/);
  assert.match(migration, /UNIQUE \(organization_id, requested_by_user_id, idempotency_key\)/);
});

test("migration protege conteúdo submitted sem bloquear cascatas de lifecycle", () => {
  assert.match(migration, /trg_project_change_requests_immutable_content/);
  assert.match(migration, /RAISE\(ABORT, 'PROJECT_CHANGE_REQUEST_IMMUTABLE'\)/);
  assert.match(migration, /trg_project_change_operations_no_update/);
  assert.match(migration, /PROJECT_CHANGE_OPERATION_IMMUTABLE/);
  assert.match(migration, /REFERENCES project_change_requests\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /trg_project_change_operations_no_delete/);
});

test("máquina de estados nasce preparada sem expor comandos de review nesta PR", () => {
  assert.deepEqual(CHANGE_REQUEST_TRANSITIONS.submitted, [
    "under_review",
    "rejected",
    "superseded",
  ]);
  assert.deepEqual(CHANGE_REQUEST_TRANSITIONS.applied, []);
  assert.doesNotMatch(collectionEndpoint, /PATCH|PUT|DELETE/);
  assert.doesNotMatch(detailEndpoint, /PATCH|PUT|DELETE/);
});

test("registry backend aceita point.create v1 e rejeita operação desconhecida", () => {
  assert.equal(PROJECT_CHANGE_OPERATION_REGISTRY["point.create"].version, 1);
  const normalized = normalizeChangeRequestSubmission(submission());
  assert.equal(normalized.operations[0].type, "point.create");
  assert.throws(
    () =>
      normalizeChangeRequestSubmission({
        ...submission(),
        operations: [{ ...submission().operations[0], type: "buffer.create" }],
      }),
    /Tipo de operação não suportado/,
  );
});

test("createdAt é obrigatório para manter hash idempotente entre retries", () => {
  const withoutCreatedAt = submission();
  delete withoutCreatedAt.operations[0].createdAt;
  assert.throws(
    () => normalizeChangeRequestSubmission(withoutCreatedAt),
    /Campo obrigatório ausente/,
  );
  assert.doesNotMatch(service, /operation\.createdAt \|\| new Date/);
});

test("hash é canônico para payload semanticamente idêntico", async () => {
  const a = normalizeChangeRequestSubmission(
    submission({ latitude: -15.78, longitude: -47.92, properties: { b: 2, a: 1 } }),
  );
  const b = normalizeChangeRequestSubmission(
    submission({ properties: { a: 1, b: 2 }, longitude: -47.92, latitude: -15.78 }),
  );
  assert.equal(
    await buildChangeRequestSubmissionHash(42, a),
    await buildChangeRequestSubmissionHash(42, b),
  );
});

test("submit exige Viewer route, Idempotency-Key e usa batch atômico", () => {
  assert.match(service, /viewerOnly:\s*true/);
  assert.match(service, /CHANGE_REQUEST_VIEWER_ROUTE_REQUIRED/);
  assert.match(service, /request\.headers\.get\("Idempotency-Key"\)/);
  assert.match(service, /await db\.batch\(statements\)/);
  assert.match(service, /project\.change_request\.submitted/);
});

test("submit cria Ticket e evento no mesmo batch e vincula ticket_id à Change Request", () => {
  const ticketInsert = service.indexOf("INSERT INTO organization_tickets");
  const requestInsert = service.indexOf("INSERT INTO project_change_requests", ticketInsert);
  const eventInsert = service.indexOf("INSERT INTO ticket_events", requestInsert);
  const batch = service.indexOf("await db.batch(statements)", eventInsert);

  assert.ok(ticketInsert >= 0);
  assert.ok(requestInsert > ticketInsert);
  assert.ok(eventInsert > requestInsert);
  assert.ok(batch > eventInsert);
  assert.match(service, /TKT-CR-/);
  assert.match(service, /category, created_by, active/);
  assert.match(service, /'new', 'normal', 'map'/);
  assert.match(service, /ticket_id/);
  assert.match(service, /source: "project_change_request"/);
});

test("schema guard exige também tabelas canônicas do Ticket Center", () => {
  assert.match(service, /"organization_tickets"/);
  assert.match(service, /"ticket_events"/);
  assert.match(service, /PROJECT_CHANGE_REQUEST_SCHEMA_OUTDATED/);
});

test("replay idempotente é resolvido antes de rejeitar revisão-base stale", () => {
  const existingStart = service.indexOf("const existing = await db");
  const existingBranch = service.indexOf("if (existing)", existingStart);
  const revisionCheck = service.indexOf("const currentRevision", existingBranch);
  assert.ok(existingStart >= 0 && existingBranch > existingStart && revisionCheck > existingBranch);
  assert.match(service, /CHANGE_REQUEST_IDEMPOTENCY_KEY_REUSED/);
  assert.match(service, /CHANGE_REQUEST_BASE_REVISION_STALE/);
});

test("schema drift é erro estruturado e list/get permanecem restritos ao solicitante", () => {
  assert.match(service, /PROJECT_CHANGE_REQUEST_SCHEMA_OUTDATED/);
  assert.match(service, /requested_by_user_id = \?/);
  assert.match(service, /requestedByUserId/);
});
