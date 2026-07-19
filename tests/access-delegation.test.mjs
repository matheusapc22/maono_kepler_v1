import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  DELEGABLE_PERMISSION_CATALOG,
  DELEGATION_POLICY_CATALOG,
  ORGANIZATION_ACCESS_DELEGATE_PERMISSION,
  authorizeOrganizationPermissionMutation,
  disableDelegationPolicy,
  saveDelegationPolicy,
} from "../functions/_lib/access-governance.js";

const catalogCodes = new Set(
  DELEGABLE_PERMISSION_CATALOG.map((item) => item.code),
);

class D1Statement {
  constructor(statement, params = []) {
    this.statement = statement;
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.statement, params);
  }

  async first() {
    return this.statement.get(...this.params) || null;
  }

  async all() {
    return { results: this.statement.all(...this.params) };
  }

  async run() {
    const result = this.statement.run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function governanceFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE organizations (id INTEGER PRIMARY KEY);
    CREATE TABLE organization_users (
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      access_level TEXT NOT NULL,
      PRIMARY KEY (organization_id, user_id)
    );
    CREATE TABLE user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      organization_id INTEGER,
      project_id INTEGER,
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE role_permissions (
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      project_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);
  database.exec(
    await readFile(
      new URL("../migrations/0012_access_delegation_policy.sql", import.meta.url),
      "utf8",
    ),
  );
  database.exec(
    await readFile(
      new URL(
        "../migrations/0013_access_delegation_hardening.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  database.exec(`
    INSERT INTO organizations (id) VALUES (10), (20);
    INSERT INTO users (id, role, active)
    VALUES (1, 'super_admin', 1), (2, 'owner', 1), (3, 'viewer', 1);
    INSERT INTO organization_users (organization_id, user_id, access_level)
    VALUES (10, 2, 'owner'), (10, 3, 'viewer');
  `);

  return {
    database,
    env: { DB: new D1Database(database) },
    actor: { id: 1, role: "super_admin" },
    request: new Request("https://example.test/policy", {
      headers: { "x-request-id": "test-request" },
    }),
  };
}

test("catálogo delegado respeita o teto do owner e exclui meta-permissões", () => {
  assert.equal(
    ORGANIZATION_ACCESS_DELEGATE_PERMISSION,
    "organization.users.permissions.delegate",
  );
  assert.equal(
    catalogCodes.has("organization.users.permissions.delegate"),
    false,
  );
  assert.equal(catalogCodes.has("organization.projects.geojson.view"), false);
  assert.equal(catalogCodes.has("admin.panel.access"), false);
  assert.equal(catalogCodes.has("audit.view"), false);
  assert.equal(catalogCodes.has("users.manage_access"), false);
  assert.equal(catalogCodes.has("role.assign"), false);

  assert.equal(catalogCodes.has("document.view"), true);
  assert.equal(catalogCodes.has("ticket.create"), true);
  assert.equal(catalogCodes.has("organization.metrics.view"), true);
  assert.equal(catalogCodes.has("limits.increase_request"), true);
});

test("catálogo administrativo explicita acessos bloqueados e seus motivos", () => {
  const byCode = new Map(
    DELEGATION_POLICY_CATALOG.map((item) => [item.code, item]),
  );

  for (const code of [
    "organization.users.permissions.delegate",
    "organization.projects.geojson.view",
    "admin.panel.access",
    "audit.view",
  ]) {
    const item = byCode.get(code);
    assert.ok(item, `O catálogo completo deve incluir ${code}`);
    assert.equal(item.ownerDelegable, false);
    assert.ok(item.disabledReason);
  }

  assert.equal(byCode.get("document.view")?.ownerDelegable, true);
  assert.equal(byCode.get("document.view")?.disabledReason, null);
});

test("migration mantém política, whitelist e perfis vinculados à organização", async () => {
  const sql = await readFile(
    new URL("../migrations/0012_access_delegation_policy.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS organization_access_delegations/);
  assert.match(sql, /UNIQUE\s*\(organization_id, delegate_user_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS delegation_permissions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS delegation_target_levels/);
  assert.match(sql, /CHECK \(access_level IN \('viewer', 'editor'\)\)/);
  assert.match(sql, /ON DELETE CASCADE/);
  assert.match(sql, /trg_access_delegation_membership_downgrade/);
  assert.match(sql, /trg_access_delegation_membership_removed/);
  assert.match(sql, /trg_access_delegation_user_ineligible/);
  assert.match(sql, /SET enabled = 0/);
});

test("migration de hardening registra justificativa e trava concorrência", async () => {
  const sql = await readFile(
    new URL(
      "../migrations/0013_access_delegation_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /ADD COLUMN justification TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /ADD COLUMN revision_token TEXT/);
});

test("persistência da política aplica confirmação e compare-and-swap", async () => {
  const { database, env, actor, request } = await governanceFixture();

  await assert.rejects(
    () =>
      saveDelegationPolicy(
        env,
        10,
        2,
        {
          targetLevels: ["viewer"],
          permissions: [
            {
              permission: "document.view",
              canGrant: true,
              canRevoke: true,
            },
          ],
          justification: "Operação temporária de atendimento.",
          confirmed: false,
        },
        actor,
        request,
      ),
    (error) => error?.code === "DELEGATION_CONFIRMATION_REQUIRED",
  );

  const created = await saveDelegationPolicy(
    env,
    10,
    2,
    {
      version: null,
      targetLevels: ["viewer"],
      permissions: [
        {
          permission: "document.view",
          canGrant: true,
          canRevoke: false,
        },
      ],
      justification: "Operação temporária de atendimento.",
      confirmed: true,
    },
    actor,
    request,
  );
  assert.equal(created.version, 1);
  assert.equal(created.justification, "Operação temporária de atendimento.");
  assert.deepEqual(created.targetLevels, ["viewer"]);

  const updated = await saveDelegationPolicy(
    env,
    10,
    2,
    {
      version: 1,
      targetLevels: ["viewer", "editor"],
      permissions: [
        {
          permission: "document.view",
          canGrant: true,
          canRevoke: true,
        },
      ],
      justification: "Escopo ampliado após revisão do Super Admin.",
      confirmed: true,
    },
    actor,
    request,
  );
  assert.equal(updated.version, 2);

  await assert.rejects(
    () =>
      saveDelegationPolicy(
        env,
        10,
        2,
        {
          version: 1,
          targetLevels: ["viewer"],
          permissions: [
            {
              permission: "document.view",
              canGrant: true,
              canRevoke: true,
            },
          ],
          justification: "Tentativa com uma versão antiga.",
          confirmed: true,
        },
        actor,
        request,
      ),
    (error) =>
      error?.status === 409 && error?.code === "POLICY_VERSION_CONFLICT",
  );

  const disabled = await disableDelegationPolicy(
    env,
    10,
    2,
    2,
    actor,
    request,
  );
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.version, 3);

  const audit = database
    .prepare(
      "SELECT action, details FROM audit_logs ORDER BY id DESC LIMIT 1",
    )
    .get();
  assert.equal(audit.action, "delegation.policy.disable");
  assert.match(audit.details, /"requestId":"test-request"/);
  assert.match(audit.details, /"policyVersion":3/);
});

test("decisão delegada respeita organização, alvo e teto do owner", async () => {
  const { env, actor, request } = await governanceFixture();
  await saveDelegationPolicy(
    env,
    10,
    2,
    {
      targetLevels: ["viewer"],
      permissions: [
        {
          permission: "document.view",
          canGrant: true,
          canRevoke: true,
        },
      ],
      justification: "Owner apoia a gestão documental da organização.",
      confirmed: true,
    },
    actor,
    request,
  );

  const owner = {
    id: 2,
    role: "owner",
    activeOrganizationId: 10,
  };
  const allowed = await authorizeOrganizationPermissionMutation({
    env,
    request,
    actor: owner,
    organizationId: 10,
    targetUserId: 3,
    permission: "document.view",
    operation: "grant",
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.delegated, true);
  assert.equal(allowed.policyVersion, 1);
  assert.equal(allowed.requestId, "test-request");

  await assert.rejects(
    () =>
      authorizeOrganizationPermissionMutation({
        env,
        request,
        actor: owner,
        organizationId: 10,
        targetUserId: 3,
        permission: "organization.projects.geojson.view",
        operation: "grant",
      }),
    (error) => error?.code === "OWNER_CEILING_EXCEEDED",
  );

  await assert.rejects(
    () =>
      authorizeOrganizationPermissionMutation({
        env,
        request,
        actor: owner,
        organizationId: 10,
        targetUserId: 2,
        permission: "document.view",
        operation: "grant",
      }),
    (error) => error?.code === "SELF_SERVICE_BLOCKED",
  );

  await assert.rejects(
    () =>
      authorizeOrganizationPermissionMutation({
        env,
        request,
        actor: { ...owner, activeOrganizationId: 20 },
        organizationId: 10,
        targetUserId: 3,
        permission: "document.view",
        operation: "grant",
      }),
    (error) => error?.code === "CROSS_ORGANIZATION_DENIED",
  );
});

test("rotas de grant e revoke usam o mesmo motor de decisão delegado", async () => {
  const [grantSource, revokeSource] = await Promise.all([
    readFile(
      new URL(
        "../functions/api/organizations/[id]/users/[userId]/permissions.js",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../functions/api/organizations/[id]/users/[userId]/permissions/[permission].js",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(grantSource, /authorizeOrganizationPermissionMutation/);
  assert.match(grantSource, /operation:\s*"grant"/);
  assert.match(revokeSource, /authorizeOrganizationPermissionMutation/);
  assert.match(revokeSource, /operation:\s*"revoke"/);
  assert.doesNotMatch(grantSource, /requireGrantAccess/);
  assert.doesNotMatch(revokeSource, /requireRevokeAccess/);
});

test("motor exige confirmação, justificativa e versão para escrita concorrente", async () => {
  const source = await readFile(
    new URL("../functions/_lib/access-governance.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /DELEGATION_JUSTIFICATION_REQUIRED/);
  assert.match(source, /DELEGATION_CONFIRMATION_REQUIRED/);
  assert.match(source, /INVALID_DELEGATION_OPERATION/);
  assert.match(source, /WHERE id = \? AND version = \?/);
  assert.match(source, /revision_token/);
  assert.match(source, /requestId/);
  assert.match(source, /policyVersion/);
});

test("revogação administrativa exige a versão observada da política", async () => {
  const source = await readFile(
    new URL(
      "../functions/api/admin/organizations/[id]/access-delegations/[userId].js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /searchParams\.get\("version"\)/);
  assert.match(source, /disableDelegationPolicy/);
});

test("gestão delegada permanece em Projects e depende das capabilities do backend", async () => {
  const source = await readFile(
    new URL(
      "../src/pages/Projects/components/UsersAccessSection.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /\/access-governance/);
  assert.match(source, /governance\?\.canManageAdditionalAccesses/);
  assert.match(source, /GESTÃO POR ORGANIZAÇÃO/);
  assert.match(source, /Usuários e Acessos/);
  assert.match(source, /Delegação limitada ativa/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("function can("),
      source.indexOf("function profileOptions"),
    ),
    /permission\.grant|permission\.revoke|users\.manage_access/,
  );
});

test("Painel Admin apenas configura limites e direciona a operação para Projects", async () => {
  const source = await readFile(
    new URL(
      "../src/pages/Admin/components/AdminUserManager.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /access-delegations/);
  assert.match(source, /PAINEL OBRIGATÓRIO/);
  assert.match(source, /Limites de delegação/);
  assert.match(source, /Projects → Usuários e Acessos/);
  assert.match(source, /Somente Consulta\/Colaborador/);
  assert.match(source, /Justificativa da delegação/);
  assert.match(source, /Resumo para confirmação/);
  assert.match(source, /disabled=\{blocked\}/);
  assert.match(source, /Não delegável:/);
});
