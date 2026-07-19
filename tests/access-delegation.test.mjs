import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACCESS_DELEGATION_PERMISSION,
  authorizePermissionMutation,
  getOrganizationAccessCapabilities,
  ownerDelegablePermissions,
  permissionCatalog,
  saveDelegationPolicy,
} from "../functions/_lib/access-delegation.js";

function fakeEnv(options = {}) {
  const policy = {
    id: 50, organization_id: 3, delegate_user_id: 10,
    enabled: options.policyEnabled === false ? 0 : 1,
    expires_at: options.expiresAt || null, version: options.version || 2,
  };
  const actor = { id: 10, access_level: options.actorLevel || "owner", role: options.actorRole || "viewer", active: 1 };
  const target = { id: 20, access_level: options.targetLevel || "viewer", role: options.targetRole || "viewer", active: 1 };
  const permissions = options.permissions || [{ permission: "document.view", can_grant: 1, can_revoke: 1 }];
  const levels = options.levels || ["viewer", "editor"];
  const DB = {
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() {
          if (sql.includes("organization_access_delegations")) return policy;
          if (sql.includes("organization_users ou INNER JOIN users")) return Number(params[1]) === 20 ? target : actor;
          if (sql.includes("FROM organization_users") && sql.includes("NULL AS role")) return { organization_id: 3, user_id: 10, access_level: actor.access_level, role: null, active: 1 };
          if (sql.includes("FROM projects")) return null;
          return null;
        },
        async all() {
          if (sql.includes("delegation_permissions")) return { results: permissions };
          if (sql.includes("delegation_target_levels")) return { results: levels.map(access_level => ({ access_level })) };
          if (sql.includes("FROM organization_users ou INNER JOIN users")) return { results: [actor] };
          return { results: [] };
        },
        async run() { return { success: true }; },
      };
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
  return { DB, ACCESS_GOVERNANCE_V2: "true" };
}

const request = new Request("https://example.test/api");
const owner = { id: 10, role: "owner", activeOrganizationId: 3 };

test("catálogo canônico nunca torna meta-permissões ou GeoJSON delegáveis", () => {
  const allowed = ownerDelegablePermissions();
  assert.ok(allowed.includes("document.view"));
  assert.ok(allowed.includes("ticket.create"));
  assert.ok(!allowed.includes(ACCESS_DELEGATION_PERMISSION));
  assert.ok(!allowed.includes("organization.projects.geojson.view"));
  assert.equal(permissionCatalog().find(item => item.code === ACCESS_DELEGATION_PERMISSION)?.superAdminOnly, true);
});

test("owner delegado concede somente dentro da política e do próprio teto", async () => {
  const result = await authorizePermissionMutation(fakeEnv(), request, owner, 3, 20, "document.view", "grant");
  assert.equal(result.mode, "delegated");
  assert.equal(result.policyVersion, 2);
  await assert.rejects(
    authorizePermissionMutation(fakeEnv(), request, owner, 3, 20, "organization.projects.geojson.view", "grant"),
    error => error?.code === "OWNER_CEILING_EXCEEDED",
  );
});

test("nega escopo cruzado, autogestão, alvo owner e operação fora da policy", async () => {
  await assert.rejects(authorizePermissionMutation(fakeEnv(), request, { ...owner, activeOrganizationId: 4 }, 3, 20, "document.view", "grant"), error => error?.code === "CROSS_ORGANIZATION_DENIED");
  await assert.rejects(authorizePermissionMutation(fakeEnv(), request, owner, 3, 10, "document.view", "grant"), error => error?.code === "SELF_SERVICE_BLOCKED");
  await assert.rejects(authorizePermissionMutation(fakeEnv({ targetLevel: "owner", targetRole: "owner" }), request, owner, 3, 20, "document.view", "grant"), error => error?.code === "TARGET_ROLE_NOT_ALLOWED");
  await assert.rejects(authorizePermissionMutation(fakeEnv({ permissions: [{ permission: "document.view", can_grant: 1, can_revoke: 0 }] }), request, owner, 3, 20, "document.view", "revoke"), error => error?.code === "POLICY_PERMISSION_DENIED");
});

test("política expirada nega e Super Admin não depende de delegação", async () => {
  await assert.rejects(authorizePermissionMutation(fakeEnv({ expiresAt: "2020-01-01T00:00:00.000Z" }), request, owner, 3, 20, "document.view", "grant"), error => error?.code === "DELEGATION_REQUIRED" && error?.reason === "DELEGATION_EXPIRED");
  const superResult = await authorizePermissionMutation({}, request, { id: 1, role: "super_admin" }, 3, 20, "admin.panel.access", "grant");
  assert.equal(superResult.mode, "super_admin");
});

test("rollout permanece desligado por padrão e expiração inválida falha de forma controlada", async () => {
  const capabilities = await getOrganizationAccessCapabilities({}, owner, 3);
  assert.equal(capabilities.governanceV2, false);
  assert.equal(capabilities.canManageAdditionalAccess, false);
  assert.equal(capabilities.reason, "ACCESS_GOVERNANCE_V2_DISABLED");
  await assert.rejects(
    saveDelegationPolicy(fakeEnv({ actorRole: "admin" }), request, { id: 1, role: "super_admin" }, 3, 10, { version: 2, enabled: true, expiresAt: "não-é-data", targetLevels: ["viewer"], permissions: [{ permission: "document.view", canGrant: true, canRevoke: true }] }),
    error => error?.code === "POLICY_EXPIRATION_INVALID" && error instanceof RangeError === false,
  );
});

test("controle de versão impede sobrescrita concorrente", async () => {
  await assert.rejects(
    saveDelegationPolicy(fakeEnv({ actorRole: "admin", version: 3 }), request, { id: 1, role: "super_admin" }, 3, 10, { version: 2, enabled: true, targetLevels: ["viewer"], permissions: [{ permission: "document.view", canGrant: true, canRevoke: true }] }),
    error => error?.code === "POLICY_VERSION_CONFLICT" && error?.policyVersion === 3,
  );
});

test("migration, rotas e interfaces preservam a fronteira Admin → Projects", async () => {
  const migration = await readFile(new URL("../migrations/0012_access_delegation_policy.sql", import.meta.url), "utf8");
  const projectUi = await readFile(new URL("../src/pages/Projects/components/UsersAccessSection.tsx", import.meta.url), "utf8");
  const adminUi = await readFile(new URL("../src/pages/Admin/components/AdminOrganizationAccessPanel.tsx", import.meta.url), "utf8");
  const grantRoute = await readFile(new URL("../functions/api/organizations/[id]/users/[userId]/permissions.js", import.meta.url), "utf8");
  const revokeRoute = await readFile(new URL("../functions/api/organizations/[id]/users/[userId]/permissions/[permission].js", import.meta.url), "utf8");
  for (const table of ["organization_access_delegations", "delegation_permissions", "delegation_target_levels"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /revision_token TEXT NOT NULL/);
  assert.match(projectUi, /getOrganizationAccessCapabilities/);
  assert.match(projectUi, /delegação limitada/);
  assert.match(adminUi, /Delegar acessos da organização/);
  assert.match(adminUi, /Projects → Usuários e Acessos/);
  assert.match(grantRoute, /authorizePermissionMutation/);
  assert.match(revokeRoute, /authorizePermissionMutation/);
});
