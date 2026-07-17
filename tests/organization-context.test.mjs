import assert from "node:assert/strict";
import test from "node:test";

import { onRequest as switchActiveOrganization } from "../functions/api/session/active-organization.js";
import { onRequest as loadSession } from "../functions/api/session.js";
import { listProjectsForActiveOrganization } from "../functions/_lib/project-list.js";

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  first() {
    return this.db.first(this.sql, this.params);
  }

  all() {
    return this.db.all(this.sql, this.params);
  }

  run() {
    return this.db.run(this.sql, this.params);
  }
}

class OrganizationDb {
  constructor({ memberships = [1, 2], inactiveOrganizations = [] } = {}) {
    this.activeOrganizationId = 1;
    this.memberships = new Set(memberships);
    this.inactiveOrganizations = new Set(inactiveOrganizations);
    this.auditEvents = [];
    this.queries = [];
  }

  prepare(sql) {
    this.queries.push(sql);
    return new MockStatement(this, sql);
  }

  async first(sql, params) {
    if (sql.includes("FROM sessions") && sql.includes("INNER JOIN users")) {
      return {
        id: 10,
        email: "owner@maono.test",
        name: "Owner",
        role: "owner",
        active: 1,
        session_active_organization_id: this.activeOrganizationId,
        expires_at: "2999-01-01T00:00:00.000Z",
      };
    }

    if (sql.includes("FROM organizations") && sql.includes("WHERE id = ?")) {
      const id = Number(params[0]);
      return {
        id,
        name: `Organização ${id}`,
        slug: `organizacao-${id}`,
        active: this.inactiveOrganizations.has(id) ? 0 : 1,
      };
    }

    if (sql.includes("FROM organization_users") && sql.includes("access_level")) {
      return this.memberships.has(Number(params[1]))
        ? { access_level: "owner" }
        : null;
    }

    return null;
  }

  async all(sql, params) {
    if (sql.includes("FROM organization_users ou")) {
      return {
        results: [...this.memberships].map((id) => ({
          id,
          name: `Organização ${id}`,
          slug: `organizacao-${id}`,
          active: 1,
          role: "owner",
          access_level: "owner",
        })),
      };
    }

    if (sql.includes("INNER JOIN projects") && sql.includes("user_projects")) {
      const organizationId = Number(params.at(-1));
      return {
        results: [
          {
            id: organizationId * 100,
            name: `Projeto ${organizationId}`,
            slug: `projeto-${organizationId}`,
            description: "Projeto do contexto ativo",
            organization_id: organizationId,
            active: 1,
            access_level: "owner",
          },
        ],
      };
    }

    return { results: [] };
  }

  async run(sql, params) {
    if (sql.includes("UPDATE sessions")) {
      this.activeOrganizationId = params[0];
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes("INSERT INTO audit_logs")) {
      this.auditEvents.push({
        action: params[2],
        details: JSON.parse(params[3]),
      });
    }

    return { success: true, meta: { changes: 1 } };
  }
}

function switchRequest(organizationId) {
  return new Request("https://maono.test/api/session/active-organization", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: "maono_session=test-token",
    },
    body: JSON.stringify({ organizationId }),
  });
}

function sessionRequest() {
  return new Request("https://maono.test/api/session", {
    method: "GET",
    headers: {
      Cookie: "maono_session=test-token",
    },
  });
}

test("troca a organização somente com membership e retorna sessão já reescopada", async () => {
  const DB = new OrganizationDb();
  const response = await switchActiveOrganization({
    request: switchRequest(2),
    env: { DB },
  });
  const session = await response.json();

  assert.equal(response.status, 200);
  assert.equal(DB.activeOrganizationId, 2);
  assert.equal(session.activeOrganization.id, 2);
  assert.equal(session.user.activeOrganizationId, 2);
  assert.deepEqual(
    session.projects.map((project) => project.organizationId),
    [2],
  );
  assert.equal(DB.auditEvents.at(-1)?.action, "organization.context.switch");
  assert.equal(DB.auditEvents.at(-1)?.details.result, "success");
});

test("nega organização sem membership e mantém o contexto anterior", async () => {
  const DB = new OrganizationDb({ memberships: [1] });
  const response = await switchActiveOrganization({
    request: switchRequest(2),
    env: { DB },
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, "ORGANIZATION_ACCESS_DENIED");
  assert.equal(DB.activeOrganizationId, 1);
  assert.equal(DB.auditEvents.at(-1)?.details.result, "denied");
});

test("nega organização inativa sem alterar a sessão", async () => {
  const DB = new OrganizationDb({ inactiveOrganizations: [2] });
  const response = await switchActiveOrganization({
    request: switchRequest(2),
    env: { DB },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "ORGANIZATION_INACTIVE");
  assert.equal(DB.activeOrganizationId, 1);
});

test("a sessão corrige um contexto que perdeu membership", async () => {
  const DB = new OrganizationDb({ memberships: [1] });
  DB.activeOrganizationId = 2;

  const response = await loadSession({
    request: sessionRequest(),
    env: { DB },
  });
  const session = await response.json();

  assert.equal(response.status, 200);
  assert.equal(session.activeOrganization.id, 1);
  assert.equal(DB.activeOrganizationId, 1);
});

test("a sessão limpa o contexto quando não há organização autorizada", async () => {
  const DB = new OrganizationDb({ memberships: [] });

  const response = await loadSession({
    request: sessionRequest(),
    env: { DB },
  });
  const session = await response.json();

  assert.equal(response.status, 200);
  assert.equal(session.activeOrganization, null);
  assert.equal(DB.activeOrganizationId, null);
  assert.deepEqual(session.projects, []);
});

test("a listagem de super admin continua limitada à organização ativa", async () => {
  const DB = new OrganizationDb();
  DB.activeOrganizationId = 7;

  const projects = await listProjectsForActiveOrganization(
    { DB },
    {
      id: 99,
      role: "super_admin",
      activeOrganizationId: 7,
    },
  );

  const projectQuery = DB.queries.find(
    (sql) => sql.includes("FROM projects") && sql.includes("ORDER BY"),
  );

  assert.match(projectQuery, /projects\.organization_id\s*=\s*\?/);
  assert.deepEqual(projects, []);
});
