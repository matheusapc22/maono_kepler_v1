import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/admin/users/[id].js";
import { createTicketCommandDb } from "./helpers/ticket-command-db.mjs";

const targetId = 3;
const retainedCode = "USER_TICKET_HISTORY_RETAINED";

async function fixture(t) {
  const db = await createTicketCommandDb(t);
  db.sqlite.exec(`
    INSERT INTO users (id, email, name, role, password_hash)
      VALUES (5, 'super-admin@cc03.test', 'Super Admin', 'super_admin', 'fixture');
    INSERT INTO projects (id, organization_id, name, slug, dropbox_root_path, created_by)
      VALUES (1, 1, 'Projeto preservado', 'retention-project', '/projects/org-a/retention', 1);
    INSERT INTO user_projects (user_id, project_id, access_level) VALUES (3, 1, 'viewer');
  `);
  db.sessionCookie(targetId, 1);
  const cookie = db.sessionCookie(5, 1);
  return {
    ...db,
    call(method, body) {
      return onRequest({
        env: db.env, params: { id: String(targetId) },
        request: new Request(`https://cc03.test/api/admin/users/${targetId}`, {
          method, headers: { Cookie: cookie, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      });
    },
  };
}

function seedEventAuthor(db) {
  db.sqlite.exec(`INSERT INTO organization_tickets
    (id, organization_id, subject, description, created_by)
    VALUES (1, 1, 'Atendimento preservado', 'Histórico conhecido', 1);
    INSERT INTO ticket_events (organization_id, ticket_id, event_type, actor_user_id, metadata)
    VALUES (1, 1, 'ticket.legacy.imported', 3, '{"source":"fixture"}');`);
}

function seedAuditAuthor(db) {
  db.sqlite.exec(`INSERT INTO audit_logs (user_id, action, details)
    VALUES (3, 'ticket.legacy.imported', '{"organizationId":1,"resourceType":"ticket"}');`);
}

function seedRetainedCommand(db) {
  db.sqlite.exec(`INSERT INTO ticket_commands
    (id, organization_id, actor_user_id, operation, request_hash, result_json, response_status, created_at)
    VALUES ('retained-command', 1, 3, 'legacy.import', 'fixture-hash', '{"legacyId":1}', 201, '2026-09-25T12:00:00.000Z');`);
}

for (const [description, seed] of [
  ["event author protected against SET NULL", seedEventAuthor],
  ["ticket auditor protected against SET NULL", seedAuditAuthor],
  ["command actor protected by its restrictive foreign key", seedRetainedCommand],
]) {
  test(`admin DELETE returns a retention conflict for ${description}, preserving the whole batch; deactivation still works`, async (t) => {
    const db = await fixture(t);
    seed(db);
    assert.equal(db.sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    const before = db.snapshot();
    const batchesBefore = db.batches.length;
    const response = await db.call("DELETE");
    assert.equal(response.status, 409, await response.clone().text());
    const body = await response.json();
    assert.equal(body.error.code, retainedCode);
    assert.match(body.error.message, /Desative o usuário/);
    assert.deepEqual(db.snapshot(), before, "sessions, memberships, project links and all history must roll back");
    assert.equal(db.batches.length, batchesBefore + 1, "the error was classified after the real deletion batch rolled back");
    assert.equal(db.rows("audit_logs").some((row) => row.action === "admin.users.delete"), false);

    const disabled = await db.call("PATCH", { active: false });
    assert.equal(disabled.status, 200, await disabled.clone().text());
    assert.equal((await disabled.json()).user.active, false);
    assert.equal(db.sqlite.prepare("SELECT active FROM users WHERE id = ?").get(targetId).active, 0);
    assert.deepEqual(db.rows("ticket_events"), before.ticket_events);
    assert.deepEqual(db.rows("ticket_commands"), before.ticket_commands);
    for (const row of before.audit_logs) assert.deepEqual(db.rows("audit_logs").find((current) => current.id === row.id), row);
    assert.deepEqual(db.rows("organization_users"), before.organization_users);
    assert.deepEqual(db.rows("user_projects"), before.user_projects);
    assert.deepEqual(db.rows("organizations"), before.organizations);
    assert.deepEqual(db.rows("projects"), before.projects);
  });
}

test("admin DELETE recognizes a wrapped D1 append-only cause after rollback", async (t) => {
  const db = await fixture(t);
  seedEventAuthor(db);
  const originalBatch = db.env.DB.batch.bind(db.env.DB);
  db.env.DB.batch = async (statements) => {
    try { return await originalBatch(statements); }
    catch (cause) { throw new Error("D1 batch failed", { cause }); }
  };
  const before = db.snapshot();
  const response = await db.call("DELETE");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, retainedCode);
  assert.deepEqual(db.snapshot(), before);
});

test("admin DELETE keeps ordinary deletion available when the target has no retained Ticket history", async (t) => {
  const db = await fixture(t);
  const organizations = db.rows("organizations");
  const projects = db.rows("projects");
  const response = await db.call("DELETE");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(db.rows("users").some((row) => row.id === targetId), false);
  for (const table of ["sessions", "user_projects", "organization_users"]) {
    assert.equal(db.rows(table).some((row) => row.user_id === targetId), false);
  }
  assert.deepEqual(db.rows("organizations"), organizations);
  assert.deepEqual(db.rows("projects"), projects);
  assert.equal(db.rows("audit_logs").filter((row) => row.action === "admin.users.delete").length, 1);
});

test("an unrelated foreign-key failure is not mislabeled as Ticket history retention", async (t) => {
  const db = await fixture(t);
  db.sqlite.exec(`CREATE TABLE fixture_unrelated_dependency (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  ); INSERT INTO fixture_unrelated_dependency VALUES (3);`);
  const before = db.snapshot();
  const response = await db.call("DELETE");
  assert.equal(response.status, 500);
  assert.notEqual((await response.json()).error.code, retainedCode);
  assert.deepEqual(db.snapshot(), before);
});
