import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DELEGABLE_PERMISSION_CATALOG,
  ORGANIZATION_ACCESS_DELEGATE_PERMISSION,
} from "../functions/_lib/access-governance.js";

const catalogCodes = new Set(
  DELEGABLE_PERMISSION_CATALOG.map((item) => item.code),
);

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

test("Projects fica em consulta e a exceção delegada exige ausência de Painel Admin", async () => {
  const [entrySource, overviewSource, managerSource] = await Promise.all([
    readFile(
      new URL(
        "../src/pages/Projects/components/UsersAccessSection.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/Projects/components/UsersAccessOverviewSection.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/access/OrganizationPermissionManager.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(entrySource, /UsersAccessOverviewSection/);
  assert.doesNotMatch(
    entrySource,
    /grantOrganizationUserPermission|revokeOrganizationUserPermission/,
  );
  assert.doesNotMatch(
    overviewSource,
    /grantOrganizationUserPermission|revokeOrganizationUserPermission|createOrganizationUser|updateOrganizationUser|deleteOrganizationUserMembership/,
  );
  assert.match(overviewSource, /governance\?\.mode === "organization"/);
  assert.match(overviewSource, /governance\.canManageAdditionalAccesses/);
  assert.match(overviewSource, /!hasAdminPanelAccess/);
  const adminPermissionCheck = overviewSource.slice(
    overviewSource.indexOf("function hasPermission"),
    overviewSource.indexOf("function canViewTeam"),
  );
  assert.doesNotMatch(adminPermissionCheck, /role === "admin"/);
  assert.match(adminPermissionCheck, /admin\.panel\.access|userPermissions/);
  assert.match(overviewSource, /Gerenciar acessos delegados/);
  assert.match(overviewSource, /managementOpen && delegatedAlternative/);
  assert.match(overviewSource, /Gerenciar no Painel Admin/);
  assert.match(managerSource, /mode: "admin" \| "delegated"/);
  assert.match(managerSource, /grantOrganizationUserPermission/);
  assert.match(managerSource, /revokeOrganizationUserPermission/);
  assert.match(managerSource, /allowedTargetLevels/);
  assert.match(managerSource, /actorUserId/);
});

test("Painel Admin centraliza grants e mantém a política exclusiva do Super Admin", async () => {
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
  assert.match(source, /Gerenciar acessos/);
  assert.match(source, /OrganizationPermissionManager/);
  assert.match(source, /mode="admin"/);
  assert.match(source, /isSuperAdmin &&/);
  assert.match(source, /painel suspenso de Projects é uma exceção exclusiva/);
  assert.doesNotMatch(
    source,
    /A gestão ocorrerá em Projects → Usuários e Acessos/,
  );
});
