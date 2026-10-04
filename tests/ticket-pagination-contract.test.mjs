import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { onRequestGet as listRoute } from "../functions/api/organizations/[id]/tickets.js";
import { createTicketCommandDb } from "./helpers/ticket-command-db.mjs";

// Local integration coverage: real HTTP handlers and production SQL executed by
// the in-memory SQLite/D1 adapter. This is not production acceptance evidence.
async function fixture(t, { flowEnabled = true } = {}) {
  const f = await createTicketCommandDb(t);
  for (const migration of ["0027_ticket_selective_access.sql", "0032_ticket_flow_navigation.sql"]) {
    f.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  f.env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = "true";
  f.env.MAONO_TICKET_FLOW_ENABLED = String(flowEnabled);
  f.env.MAONO_TICKET_FLOW_ORGANIZATION_IDS = "1,2";
  // The base fixture has no viewer role grants. Explicitly authorize the list
  // route so these requests exercise ticket ACLs after organization permission.
  f.sqlite.exec("INSERT INTO role_permissions (role, permission, scope_type, active) VALUES ('viewer', 'ticket.view', 'organization', 1)");
  return f;
}

function seed(f, count, { organizationId = 1, priority = "normal", assignedTo = null, dueAt = null } = {}) {
  const insert = f.sqlite.prepare(`INSERT INTO organization_tickets (
    organization_id, code, subject, description, status, priority, category,
    assigned_to, due_at, created_by, created_at, updated_at
  ) VALUES (?, ?, 'Needle match', 'Local pagination fixture', 'open', ?, 'support',
    ?, ?, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`);
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(Number(insert.run(organizationId, `PAGE-${organizationId}-${index}`, priority, assignedTo, dueAt).lastInsertRowid));
  }
  return ids.reverse(); // Equal timestamps intentionally exercise the ID tie-breaker.
}

async function request(f, query = {}, { userId = 1, organizationId = 1 } = {}) {
  const headers = { "X-Request-Id": "pagination-contract-request" };
  if (userId !== null) headers.cookie = f.sessionCookie(userId, organizationId);
  const response = await listRoute({
    env: f.env,
    params: { id: String(organizationId) },
    request: new Request(`https://local.test/api/organizations/${organizationId}/tickets?${new URLSearchParams(query)}`, { headers }),
  });
  return { response, body: await response.json() };
}

async function list(f, query = {}, actor = {}) {
  const { response, body } = await request(f, query, actor);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(body.ok, true);
  assert.equal(body.pagination.loaded, body.tickets.length);
  return body;
}

function assertError({ response, body }, status, code) {
  assert.equal(response.status, status);
  assert.equal(body.ok, false);
  assert.equal(body.code, code);
  assert.equal(body.requestId, "pagination-contract-request");
  assert.equal(response.headers.get("X-Request-Id"), body.requestId);
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0);
  assert.equal(Object.hasOwn(body, "tickets"), false);
  assert.equal(Object.hasOwn(body, "pagination"), false);
}

for (const flowEnabled of [false, true]) {
  for (const limit of [10, 25, 50]) {
    test(`HTTP pagination: ${limit} per page, flow ${flowEnabled ? "on" : "off"}, complete traversal and final partial page`, async (t) => {
      const f = await fixture(t, { flowEnabled });
      const expected = seed(f, 113);
      const totalPages = Math.ceil(expected.length / limit);
      const seen = [];
      let snapshot = null;
      for (let page = 1; page <= totalPages + 1; page += 1) {
        const body = await list(f, { page, limit, ...(snapshot ? { snapshot } : {}) });
        assert.equal(body.flowEnabled, flowEnabled);
        assert.equal(body.pagination.page, page);
        assert.equal(body.pagination.limit, limit);
        assert.equal(body.pagination.total, 113);
        assert.equal(body.pagination.totalPages, totalPages);
        assert.equal(body.pagination.hasMore, page < totalPages);
        assert.deepEqual(body.tickets.map(({ id }) => id), expected.slice((page - 1) * limit, page * limit));
        seen.push(...body.tickets.map(({ id }) => id));
        if (flowEnabled) {
          assert.ok(body.pagination.snapshot);
          if (snapshot) assert.equal(body.pagination.snapshot, snapshot);
          snapshot = body.pagination.snapshot;
          assert.ok(Date.parse(body.pagination.expiresAt) > Date.parse(body.pagination.snapshotAt));
        } else {
          assert.equal(body.pagination.snapshot, null);
          assert.equal(body.pagination.snapshotAt, null);
          assert.equal(body.pagination.expiresAt, null);
        }
      }
      assert.deepEqual(seen, expected);
      assert.equal(new Set(seen).size, expected.length);
    });
  }

  test(`HTTP total is the complete filtered, active, organization- and ACL-authorized count, flow ${flowEnabled ? "on" : "off"}`, async (t) => {
    const f = await fixture(t, { flowEnabled });
    const expected = seed(f, 37, { priority: "high", assignedTo: 2, dueAt: "2026-09-30T12:00:00.000Z" });
    seed(f, 3, { organizationId: 2, priority: "high", assignedTo: 2, dueAt: "2026-09-30T12:00:00.000Z" });
    f.sqlite.exec(`
      UPDATE organization_tickets SET visibility = 'private' WHERE id BETWEEN 1 AND 5;
      INSERT INTO ticket_acl_entries (organization_id, ticket_id, principal_type, principal_id, action, effect, created_by, created_at)
        VALUES (1, 1, 'user', '3', 'ticket.view', 'allow', 1, '2026-09-01T00:00:00.000Z');
      UPDATE organization_tickets SET active = 0 WHERE id BETWEEN 6 AND 8;
      UPDATE organization_tickets SET priority = 'low' WHERE id = 9;
      UPDATE organization_tickets SET status = 'closed' WHERE id = 10;
      UPDATE organization_tickets SET subject = 'Different subject' WHERE id = 11;
      UPDATE organization_tickets SET assigned_to = NULL WHERE id = 12;
      UPDATE organization_tickets SET due_at = '2026-09-29T12:00:00.000Z' WHERE id = 13;
    `);
    const query = { limit: 10, q: "Needle", status: "open", priority: "high", assigneeId: 2, from: "2026-09-30", to: "2026-09-30" };
    const visibleIds = expected.filter((id) => id === 1 || id > 13);
    const first = await list(f, query, { userId: 3 });
    assert.equal(first.tickets.length, 10);
    assert.equal(first.pagination.total, visibleIds.length);
    assert.equal(first.pagination.total, 25);
    assert.equal(first.pagination.totalPages, 3);
    const seen = [...first.tickets.map(({ id }) => id)];
    for (const page of [2, 3]) {
      const body = await list(f, { ...query, page, ...(first.pagination.snapshot ? { snapshot: first.pagination.snapshot } : {}) }, { userId: 3 });
      assert.equal(body.pagination.total, 25);
      seen.push(...body.tickets.map(({ id }) => id));
    }
    assert.deepEqual(seen, visibleIds);
    assert.equal((await list(f, query, { userId: 1 })).pagination.total, 24, "an owner without the private grant cannot count that ticket");
    const empty = await list(f, { ...query, q: "No matching ticket" }, { userId: 3 });
    assert.deepEqual(empty.tickets, []);
    assert.equal(empty.pagination.total, 0);
    assert.equal(empty.pagination.totalPages, 1);
    assert.equal(empty.pagination.hasMore, false);
  });
}

test("HTTP sparse snapshot: empty middle pages retain hasMore and original page count after ACL revocation", async (t) => {
  const f = await fixture(t);
  seed(f, 31);
  const first = await list(f, { limit: 10 }, { userId: 3 });
  assert.equal(first.pagination.total, 31);
  assert.equal(first.pagination.totalPages, 4);
  const { snapshot } = first.pagination;
  f.sqlite.exec("UPDATE organization_tickets SET visibility = 'private' WHERE id >= 12 OR id = 5");
  f.sqlite.exec(`INSERT INTO organization_tickets (organization_id, code, subject, description, status, priority, category, created_by, created_at, updated_at)
    VALUES (1, 'LATE-PAGE', 'Late arrival', 'Outside snapshot', 'open', 'normal', 'support', 1, '2099', '2099')`);

  const seen = [];
  for (let page = 1; page <= 4; page += 1) {
    const body = await list(f, { limit: 10, page, snapshot }, { userId: 3 });
    assert.equal(body.pagination.snapshot, snapshot);
    assert.equal(body.pagination.total, 10);
    assert.equal(body.pagination.totalPages, 4, "do not derive snapshot pages from the live ACL count");
    assert.equal(body.pagination.hasMore, page < 4);
    assert.equal(body.facets.byStatus.open, 10);
    assert.equal(body.pagination.loaded, [0, 0, 9, 1][page - 1]);
    seen.push(...body.tickets.map(({ id }) => id));
  }
  assert.deepEqual(seen, [11, 10, 9, 8, 7, 6, 4, 3, 2, 1]);
  const fresh = await list(f, { limit: 10 }, { userId: 3 });
  assert.notEqual(fresh.pagination.snapshot, snapshot);
  assert.equal(fresh.pagination.total, 11);
  assert.equal(fresh.pagination.totalPages, 2);
  assert.equal(fresh.tickets[0].code, "LATE-PAGE");
});

test("HTTP snapshot accepts a new page size while preserving membership and ordering", async (t) => {
  const f = await fixture(t);
  const expected = seed(f, 53);
  const first = await list(f, { limit: 10 });
  for (const limit of [25, 50]) {
    const body = await list(f, { limit, page: 2, snapshot: first.pagination.snapshot });
    assert.equal(body.pagination.limit, limit);
    assert.equal(body.pagination.total, 53);
    assert.equal(body.pagination.totalPages, Math.ceil(53 / limit));
    assert.deepEqual(body.tickets.map(({ id }) => id), expected.slice(limit, 2 * limit));
  }
});

test("HTTP page/limit normalization preserves defaults, a 100-row ceiling, and out-of-range empty pages", async (t) => {
  const f = await fixture(t, { flowEnabled: false });
  const expected = seed(f, 113);
  const cases = [
    [{}, 1, 50],
    [{ page: 0, limit: 0 }, 1, 50],
    [{ page: -2, limit: -10 }, 1, 50],
    [{ page: "invalid", limit: "invalid" }, 1, 50],
    [{ page: 1.5, limit: 2.5 }, 1, 50],
    [{ page: 2, limit: 1 }, 2, 1],
    [{ page: 2, limit: 100 }, 2, 100],
    [{ page: 1, limit: 101 }, 1, 100],
    [{ page: 1, limit: 1000 }, 1, 100],
    [{ page: 999, limit: 50 }, 999, 50],
  ];
  for (const [query, page, limit] of cases) {
    const body = await list(f, query);
    assert.equal(body.pagination.page, page);
    assert.equal(body.pagination.limit, limit);
    assert.equal(body.pagination.total, 113);
    assert.equal(body.pagination.totalPages, Math.ceil(113 / limit));
    assert.equal(body.pagination.hasMore, page * limit < 113);
    assert.deepEqual(body.tickets.map(({ id }) => id), expected.slice((page - 1) * limit, page * limit));
  }
});

test("HTTP invalid filters return an error envelope, never an empty successful list", async (t) => {
  const f = await fixture(t);
  seed(f, 3);
  for (const [query, code] of [
    [{ status: "invalid" }, "INVALID_STATUS"],
    [{ priority: "invalid" }, "INVALID_PRIORITY"],
    [{ assigneeId: "invalid" }, "INVALID_ASSIGNEE"],
    [{ from: "invalid" }, "INVALID_DATE"],
  ]) {
    assertError(await request(f, query), 400, code);
  }
  assert.equal(f.rows("ticket_query_snapshots").length, 0);
});

test("HTTP expired, unknown, or differently scoped snapshots return 409 without silently restarting", async (t) => {
  const f = await fixture(t);
  seed(f, 31);
  const first = await list(f, { limit: 10 });
  const query = { limit: 10, page: 2, snapshot: first.pagination.snapshot };
  for (const [options, actor] of [
    [{ ...query, snapshot: "missing-snapshot" }, {}],
    [query, { userId: 2 }],
    [query, { organizationId: 2 }],
    [{ ...query, q: "changed" }, {}],
    [{ ...query, sort: "updated_asc" }, {}],
  ]) {
    assertError(await request(f, options, actor), 409, "TICKET_QUERY_EXPIRED");
  }
  f.sqlite.prepare("UPDATE ticket_query_snapshots SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(query.snapshot);
  assertError(await request(f, query), 409, "TICKET_QUERY_EXPIRED");
  assert.equal(f.rows("ticket_query_snapshots").length, 1);
  const fresh = await list(f, { limit: 10 });
  assert.notEqual(fresh.pagination.snapshot, query.snapshot);
  assert.equal(fresh.pagination.page, 1);
  assert.equal(fresh.pagination.total, 31);
  assert.equal(f.rows("ticket_query_snapshots").length, 1, "starting a fresh query cleans up the expired snapshot");
  f.env.MAONO_TICKET_FLOW_ENABLED = "false";
  assertError(await request(f, { limit: 10, snapshot: fresh.pagination.snapshot }), 409, "TICKET_QUERY_EXPIRED");
  assert.equal((await list(f, { limit: 10 })).flowEnabled, false);
});

test("HTTP query quota returns 429 but existing snapshot pagination still works", async (t) => {
  const f = await fixture(t);
  seed(f, 31);
  const first = await list(f, { limit: 10 });
  const insert = f.sqlite.prepare(`INSERT INTO ticket_query_snapshots (id, organization_id, user_id, query_key, created_at, expires_at)
    SELECT ?, organization_id, user_id, query_key, created_at, expires_at FROM ticket_query_snapshots WHERE id = ?`);
  for (let index = 1; index < 100; index += 1) insert.run(`quota-fixture-${index}`, first.pagination.snapshot);
  assertError(await request(f, { limit: 10 }), 429, "TICKET_QUERY_RATE_LIMIT");
  const second = await list(f, { limit: 10, page: 2, snapshot: first.pagination.snapshot });
  assert.deepEqual(second.tickets.map(({ id }) => id), [21, 20, 19, 18, 17, 16, 15, 14, 13, 12]);
  assert.equal(second.pagination.hasMore, true);
});

test("HTTP pagination requires authentication and organization permission", async (t) => {
  const f = await fixture(t);
  seed(f, 3);
  const anonymous = await request(f, { limit: 10 }, { userId: null });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.body.ok, false);
  assert.equal(Object.hasOwn(anonymous.body, "tickets"), false);
  const otherOrganization = await request(f, { limit: 10 }, { userId: 4 });
  assert.equal(otherOrganization.response.status, 403);
  assert.equal(otherOrganization.body.ok, false);
  assert.equal(Object.hasOwn(otherOrganization.body, "tickets"), false);
  assert.equal(f.rows("ticket_query_snapshots").length, 0);
});
