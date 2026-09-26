import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { can } from "../functions/_lib/permissions.js";
import {
  getTicketAccessConfiguration,
  getTicketSelectiveAccessCapability,
  replaceTicketAccessConfiguration,
  requireTicketAccess,
} from "../functions/_lib/ticket-access.js";
import { listTickets, parseTicketListOptions } from "../functions/_lib/ticket-center.js";
import { COMMAND_ACTORS, createTicketCommandDb } from "./helpers/ticket-command-db.mjs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

async function fixture(t) {
  const f = await createTicketCommandDb(t, { commandsSchema: true, triageSchema: true, commandsEnabled: false, triageEnabled: false, marker: true });
  f.sqlite.exec(source("../migrations/0027_ticket_selective_access.sql"));
  f.env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = "true";
  const insert = f.sqlite.prepare(`INSERT INTO organization_tickets
    (id, organization_id, code, subject, description, status, priority, category, created_by, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', 'normal', 'support', ?, 1, '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')`);
  insert.run(101, 1, "TKT-000101", "Organizacional", "Visível na organização", 1);
  insert.run(102, 1, "TKT-000102", "Privado", "Não deve vazar", 1);
  insert.run(201, 2, "TKT-000201", "Outra organização", "Isolado", 4);
  f.sqlite.prepare("UPDATE organization_tickets SET visibility = 'private' WHERE id = 102").run();
  return f;
}

async function listedIds(f, user = COMMAND_ACTORS.viewer) {
  const data = await listTickets(f.env, 1, parseTicketListOptions("https://maono.test/api/organizations/1/tickets?limit=100&q="), user);
  return data.tickets
    .filter((ticket) => ticket.id >= 100)
    .map((ticket) => Number(ticket.id))
    .sort((a, b) => a - b);
}

function acl(f, { principalType = "user", principalId = "3", action = "ticket.view", effect = "allow" } = {}) {
  f.sqlite.prepare(`INSERT INTO ticket_acl_entries
    (organization_id, ticket_id, principal_type, principal_id, action, effect, created_by, created_at)
    VALUES (1, 102, ?, ?, ?, ?, 1, '2026-09-26T00:00:00.000Z')`)
    .run(principalType, String(principalId), action, effect);
}

test("CC-04 capability requires feature flag plus schema", async (t) => {
  const f = await fixture(t);
  assert.equal(await getTicketSelectiveAccessCapability(f.env), true);
  assert.equal(await getTicketSelectiveAccessCapability({ ...f.env, MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: "false" }), false);
});

test("flag OFF keeps CC-03 routes compatible before migration 0027", async (t) => {
  const f = await createTicketCommandDb(t, { commandsSchema: true, triageSchema: true, commandsEnabled: false, triageEnabled: false, marker: true });
  f.env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = "false";
  f.sqlite.prepare(`INSERT INTO organization_tickets
    (id, organization_id, code, subject, description, status, priority, category, created_by, active, created_at, updated_at)
    VALUES (90, 1, 'TKT-000090', 'Legado', 'Sem migration 0027', 'open', 'normal', 'support', 1, 1, 'x', 'x')`).run();
  const allowed = await requireTicketAccess(f.env, 1, 90, COMMAND_ACTORS.viewer, "ticket.view");
  assert.equal(allowed.selective, false);
  assert.equal(allowed.ticket.visibility, "organization");
  const listed = await listTickets(f.env, 1, parseTicketListOptions("https://maono.test/api/organizations/1/tickets?limit=100"), COMMAND_ACTORS.viewer);
  assert.equal(listed.tickets.some((ticket) => ticket.id === 90), true);
});

test("CT-11: list, count/facets universe and detail hide a private ticket without grant", async (t) => {
  const f = await fixture(t);
  const data = await listTickets(f.env, 1, parseTicketListOptions("https://maono.test/api/organizations/1/tickets?limit=100&q=Privado"), COMMAND_ACTORS.viewer);
  assert.equal(data.tickets.some((ticket) => ticket.id === 102), false);
  assert.equal(data.pagination.total, 0);
  assert.equal(Object.values(data.facets.byStatus).reduce((a, b) => a + b, 0), 0);
  await assert.rejects(() => requireTicketAccess(f.env, 1, 102, COMMAND_ACTORS.viewer, "ticket.view"), (error) => error?.status === 404 && error?.code === "TICKET_NOT_FOUND");
  acl(f);
  assert.deepEqual(await listedIds(f), [101, 102]);
  assert.equal((await requireTicketAccess(f.env, 1, 102, COMMAND_ACTORS.viewer, "ticket.view")).ticket.visibility, "private");
});

test("comment-only grant cannot bypass the private-ticket read gate", async (t) => {
  const f = await fixture(t);
  acl(f, { action: "ticket.comment" });
  await assert.rejects(() => requireTicketAccess(f.env, 1, 102, COMMAND_ACTORS.viewer, "ticket.comment"), (error) => error?.code === "TICKET_NOT_FOUND");
  acl(f, { action: "ticket.view" });
  assert.equal((await requireTicketAccess(f.env, 1, 102, COMMAND_ACTORS.viewer, "ticket.comment")).ticket.visibility, "private");
});

test("CT-12: group removal revokes access on the next request", async (t) => {
  const f = await fixture(t);
  f.sqlite.exec(`
    INSERT INTO ticket_access_groups(id, organization_id, name, description, active, created_by, created_at, updated_at)
      VALUES ('g1', 1, 'Operadores', '', 1, 1, 'x', 'x');
    INSERT INTO ticket_access_group_members(group_id, organization_id, user_id, created_by, created_at)
      VALUES ('g1', 1, 3, 1, 'x');
  `);
  acl(f, { principalType: "group", principalId: "g1" });
  assert.deepEqual(await listedIds(f), [101, 102]);
  f.sqlite.prepare("DELETE FROM ticket_access_group_members WHERE group_id = 'g1' AND user_id = 3").run();
  assert.deepEqual(await listedIds(f), [101]);
});

test("CT-13: classification labels do not grant access and access administration is separately protected", async (t) => {
  const f = await fixture(t);
  f.sqlite.exec(`
    INSERT INTO ticket_labels(id, organization_id, name, active, created_by, created_at, updated_at)
      VALUES ('l1', 1, 'Financeiro', 1, 1, 'x', 'x');
    INSERT INTO ticket_label_links(organization_id, ticket_id, label_id, created_by, created_at)
      VALUES (1, 102, 'l1', 1, 'x');
  `);
  assert.deepEqual(await listedIds(f), [101]);
  const owner = await can(f.env, COMMAND_ACTORS.owner, "ticket.access.manage", { organizationId: 1, scopeType: "organization" });
  const viewer = await can(f.env, COMMAND_ACTORS.viewer, "ticket.access.manage", { organizationId: 1, scopeType: "organization" });
  assert.equal(owner.allowed, true);
  assert.equal(viewer.allowed, false);
});

test("CT-50: explicit user deny wins over group allow; suspension/removal revokes", async (t) => {
  const f = await fixture(t);
  f.sqlite.exec(`
    INSERT INTO ticket_access_groups(id, organization_id, name, description, active, created_by, created_at, updated_at)
      VALUES ('g1', 1, 'Operadores', '', 1, 1, 'x', 'x');
    INSERT INTO ticket_access_group_members(group_id, organization_id, user_id, created_by, created_at)
      VALUES ('g1', 1, 3, 1, 'x');
  `);
  acl(f, { principalType: "group", principalId: "g1" });
  acl(f, { principalType: "user", principalId: "3", effect: "deny" });
  assert.deepEqual(await listedIds(f), [101]);
  f.sqlite.prepare("DELETE FROM ticket_acl_entries WHERE ticket_id=102 AND principal_type='user' AND principal_id='3'").run();
  assert.deepEqual(await listedIds(f), [101, 102]);
  f.sqlite.prepare("UPDATE users SET active = 0 WHERE id = 3").run();
  assert.deepEqual(await listedIds(f), [101]);
  f.sqlite.prepare("UPDATE users SET active = 1 WHERE id = 3").run();
  f.sqlite.prepare("DELETE FROM organization_users WHERE organization_id = 1 AND user_id = 3").run();
  assert.deepEqual(await listedIds(f), [101]);
});

test("policies participate in the same resolver and deny precedence", async (t) => {
  const f = await fixture(t);
  f.sqlite.exec(`
    INSERT INTO ticket_access_policies(id, organization_id, name, description, active, created_by, created_at, updated_at)
      VALUES ('p1', 1, 'Policy', '', 1, 1, 'x', 'x');
    INSERT INTO ticket_access_policy_entries(policy_id, organization_id, principal_type, principal_id, action, effect, created_by, created_at)
      VALUES ('p1', 1, 'user', '3', 'ticket.view', 'allow', 1, 'x');
    INSERT INTO ticket_ticket_access_policies(organization_id, ticket_id, policy_id, created_by, created_at)
      VALUES (1, 102, 'p1', 1, 'x');
  `);
  assert.deepEqual(await listedIds(f), [101, 102]);
  acl(f, { effect: "deny" });
  assert.deepEqual(await listedIds(f), [101]);
});

test("cross-org grants are rejected and a private config cannot be orphaned", async (t) => {
  const f = await fixture(t);
  assert.throws(() => acl(f, { principalId: "4" }), /TICKET_ACL_PRINCIPAL_SCOPE_INVALID/);
  await assert.rejects(() => replaceTicketAccessConfiguration(f.env, 1, 102, { visibility: "private", acl: [], policyIds: [] }, 1), (error) => error?.code === "TICKET_PRIVATE_WITHOUT_ALLOW");
  const configured = await replaceTicketAccessConfiguration(f.env, 1, 102, {
    visibility: "private",
    acl: [{ principalType: "user", principalId: 3, action: "ticket.view", effect: "allow" }],
    policyIds: [],
  }, 1);
  assert.equal(configured.visibility, "private");
  assert.equal(configured.acl.length, 1);
  assert.equal((await getTicketAccessConfiguration(f.env, 1, 102)).acl[0].principalId, "3");
});


test("CT-12 client clears stale drawer data when object access is revoked", () => {
  const sourceText = source("../src/pages/Projects/components/TicketsSection.tsx");
  assert.match(sourceText, /detailFailure\.status === 404 \|\| detailFailure\.status === 403/);
  assert.match(sourceText, /setDetail\(null\);[\s\S]*setSelectedTicketId\(null\);[\s\S]*setToast\("O chamado não está mais disponível para seu acesso\."\)/);
  assert.match(sourceText, /current\.filter\(\(ticket\) => String\(ticket\.id\) !== String\(ticketId\)\)/);
  assert.match(sourceText, /mutationFailure\.status === 404 \|\| mutationFailure\.status === 403/);
});
