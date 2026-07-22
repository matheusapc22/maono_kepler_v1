import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DELEGABLE_PERMISSION_CATALOG,
  getAccessGovernanceCapabilities,
  ORGANIZATION_ACCESS_DELEGATE_PERMISSION,
} from "../functions/_lib/access-governance.js";
import { can as backendCan } from "../functions/_lib/permissions.js";

const catalogCodes = new Set(
  DELEGABLE_PERMISSION_CATALOG.map((item) => item.code),
);

function permissionDb({
  memberships = [],
  projectAccesses = [],
  denials = [],
} = {}) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              if (sql.includes("FROM user_permission_denials")) {
                const [userId, organizationId, permission] = params;
                return {
                  results: denials
                    .filter(
                      (row) =>
                        String(row.user_id) === String(userId) &&
                        String(row.organization_id) ===
                          String(organizationId) &&
                        row.permission === permission,
                    )
                    .map((row, index) => ({ id: row.id ?? index + 1 })),
                };
              }
              if (sql.includes("FROM organization_users")) {
                const [userId, organizationId] = params;
                return {
                  results: memberships
                    .filter(
                      (row) =>
                        String(row.user_id) === String(userId) &&
                        String(row.organization_id) === String(organizationId),
                    )
                    .map((row) => ({ ...row, role: null, active: 1 })),
                };
              }
              if (sql.includes("FROM user_projects")) {
                const [userId, projectId] = params;
                return {
                  results: projectAccesses.filter(
                    (row) =>
                      String(row.user_id) === String(userId) &&
                      String(row.project_id) === String(projectId),
                  ),
                };
              }
              if (
                sql.includes("FROM user_permissions") ||
                sql.includes("FROM role_permissions")
              ) {
                return { results: [] };
              }
              throw new Error(`Consulta inesperada no teste: ${sql}`);
            },
          };
        },
      };
    },
  };
}

test("Painel Admin e Auditoria são exclusivos do Super Admin", async () => {
  const superAdminDecision = await backendCan(
    {},
    { id: 1, role: "super_admin" },
    "admin.panel.access",
    { organizationId: 999 },
  );
  const adminDecision = await backendCan(
    {},
    { id: 2, role: "admin", activeOrganizationId: 999 },
    "admin.panel.access",
    { organizationId: 999 },
  );
  const superAdminAuditDecision = await backendCan(
    {},
    { id: 1, role: "super_admin" },
    "audit.view",
    { organizationId: 999 },
  );
  const adminAuditDecision = await backendCan(
    {},
    {
      id: 2,
      role: "admin",
      activeOrganizationId: 999,
      permissions: ["audit.view"],
    },
    "audit.view",
    { organizationId: 999 },
  );

  assert.equal(superAdminDecision.allowed, true);
  assert.equal(superAdminDecision.reason, "SUPER_ADMIN");
  assert.equal(adminDecision.allowed, false);
  assert.equal(adminDecision.reason, "ADMIN_PANEL_SUPER_ADMIN_ONLY");
  assert.equal(superAdminAuditDecision.allowed, true);
  assert.equal(superAdminAuditDecision.reason, "SUPER_ADMIN");
  assert.equal(adminAuditDecision.allowed, false);
  assert.equal(adminAuditDecision.reason, "AUDIT_SUPER_ADMIN_ONLY");
});

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
  assert.equal(catalogCodes.has("export.view"), false);
  assert.equal(catalogCodes.has("export.create"), false);

  assert.equal(catalogCodes.has("document.view"), true);
  assert.equal(catalogCodes.has("ticket.create"), true);
  assert.equal(catalogCodes.has("organization.metrics.view"), true);
  assert.equal(catalogCodes.has("plan.view"), true);
  assert.equal(catalogCodes.has("limits.increase_request"), true);
});

test("Super Admin pode limpar grants legados de Auditoria, mas não concedê-los", async () => {
  const capabilities = await getAccessGovernanceCapabilities({}, 10, {
    id: 1,
    role: "super_admin",
  });

  assert.equal(capabilities.grantPermissions.includes("audit.view"), false);
  assert.equal(capabilities.revokePermissions.includes("audit.view"), true);
  assert.equal(capabilities.allowedPermissions.includes("audit.view"), true);
});

test("matriz nativa respeita organização ativa, vínculo e perfil", async () => {
  const env = {
    DB: permissionDb({
      memberships: [
        { user_id: 2, organization_id: 10, access_level: "editor" },
        { user_id: 3, organization_id: 10, access_level: "owner" },
        { user_id: 4, organization_id: 10, access_level: "editor" },
        { user_id: 5, organization_id: 10, access_level: "viewer" },
      ],
      projectAccesses: [
        { user_id: 3, project_id: 77, access_level: "owner" },
        { user_id: 4, project_id: 77, access_level: "editor" },
        { user_id: 5, project_id: 77, access_level: "viewer" },
      ],
    }),
  };
  const admin = { id: 2, role: "admin", activeOrganizationId: 10 };
  const owner = { id: 3, role: "owner", activeOrganizationId: 10 };
  const editor = { id: 4, role: "editor", activeOrganizationId: 10 };
  const viewer = { id: 5, role: "viewer", activeOrganizationId: 10 };
  const organization = { organizationId: 10 };
  const project = {
    organizationId: 10,
    project: { id: 77, slug: "projeto-77", organization_id: 10 },
  };

  for (const permission of [
    "document.download",
    "ticket.manage",
    "roadmap.manage",
    "users.delete",
    "organization.edit",
    "plan.view",
  ]) {
    assert.equal(
      (await backendCan(env, admin, permission, organization)).allowed,
      true,
    );
    assert.equal(
      (await backendCan(env, owner, permission, organization)).allowed,
      true,
    );
  }

  assert.equal(
    (await backendCan(env, admin, "project.create", organization)).allowed,
    true,
  );
  assert.equal(
    (await backendCan(env, owner, "project.create", organization)).allowed,
    true,
  );

  for (const permission of [
    "project.save",
    "project.edit",
    "project.thumbnail.update",
  ]) {
    assert.equal(
      (await backendCan(env, admin, permission, project)).allowed,
      true,
    );
    assert.equal(
      (await backendCan(env, owner, permission, project)).allowed,
      true,
    );
  }

  assert.equal(
    (await backendCan(env, editor, "project.save", project)).allowed,
    true,
  );
  assert.equal(
    (await backendCan(env, editor, "project.edit", project)).allowed,
    false,
  );
  assert.equal(
    (await backendCan(env, viewer, "project.save", project)).allowed,
    false,
  );

  assert.equal(
    (await backendCan(env, admin, "project.view", project)).allowed,
    false,
  );
  assert.equal(
    (await backendCan(env, owner, "project.view", project)).allowed,
    true,
  );
  assert.equal(
    (await backendCan(env, editor, "project.favorite", project)).allowed,
    true,
  );

  assert.equal(
    (
      await backendCan(
        env,
        owner,
        "organization.projects.geojson.view",
        organization,
      )
    ).allowed,
    false,
  );
  assert.equal(
    (await backendCan(env, admin, "export.view", organization)).allowed,
    false,
  );
  assert.equal(
    (await backendCan(env, admin, "admin.panel.access", organization)).allowed,
    false,
  );
  assert.equal(
    (await backendCan(env, admin, "document.view", { organizationId: 11 }))
      .allowed,
    false,
  );
});

test("negação do Super Admin prevalece sobre acesso nativo por organização", async () => {
  const env = {
    DB: permissionDb({
      memberships: [
        { user_id: 2, organization_id: 10, access_level: "owner" },
        { user_id: 3, organization_id: 10, access_level: "owner" },
      ],
      projectAccesses: [
        { user_id: 3, project_id: 77, access_level: "owner" },
      ],
      denials: [
        {
          id: 1,
          user_id: 2,
          organization_id: 10,
          permission: "document.download",
        },
        {
          id: 2,
          user_id: 3,
          organization_id: 10,
          permission: "project.save",
        },
      ],
    }),
  };
  const admin = { id: 2, role: "admin", activeOrganizationId: 10 };
  const owner = { id: 3, role: "owner", activeOrganizationId: 10 };
  const organization = { organizationId: 10 };
  const project = {
    organizationId: 10,
    project: { id: 77, slug: "projeto-77", organization_id: 10 },
  };

  const adminDenied = await backendCan(
    env,
    admin,
    "document.download",
    organization,
  );
  const ownerDenied = await backendCan(
    env,
    owner,
    "project.save",
    project,
  );
  const superAdminAllowed = await backendCan(
    env,
    { id: 2, role: "super_admin" },
    "document.download",
    organization,
  );

  assert.equal(adminDenied.allowed, false);
  assert.equal(adminDenied.reason, "USER_PERMISSION_EXPLICITLY_DENIED");
  assert.equal(ownerDenied.allowed, false);
  assert.equal(ownerDenied.reason, "USER_PERMISSION_EXPLICITLY_DENIED");
  assert.equal(
    (await backendCan(env, admin, "ticket.view", organization)).allowed,
    true,
  );
  assert.equal(superAdminAllowed.allowed, true);
  assert.equal(superAdminAllowed.reason, "SUPER_ADMIN");
});

test("migration mantém política, whitelist e perfis vinculados à organização", async () => {
  const sql = await readFile(
    new URL("../migrations/0012_access_delegation_policy.sql", import.meta.url),
    "utf8",
  );

  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS organization_access_delegations/,
  );
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

test("migration cria negações nativas isoladas por usuário e organização", async () => {
  const sql = await readFile(
    new URL("../migrations/0013_user_permission_denials.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_permission_denials/);
  assert.match(sql, /UNIQUE\s*\(user_id, organization_id, permission\)/);
  assert.match(sql, /denied_by INTEGER/);
  assert.match(sql, /FOREIGN KEY \(denied_by\).*ON DELETE SET NULL/);
  assert.match(sql, /REFERENCES users\(id\)/);
  assert.match(sql, /REFERENCES organizations\(id\)/);
  assert.match(sql, /idx_user_permission_denials_user_org/);
  assert.match(sql, /idx_user_permission_denials_org_permission/);
  assert.match(sql, /trg_user_permission_denials_membership_removed/);
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

test("Projects mantém consulta e abre a delegação por usuário elegível", async () => {
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
  assert.doesNotMatch(overviewSource, /!hasAdminPanelAccess/);
  assert.match(overviewSource, /people-manage-button/);
  assert.match(overviewSource, /canManagePerson\(person\)/);
  assert.match(overviewSource, /managementTargetUserId !== null/);
  assert.match(
    overviewSource,
    /initialTargetUserId=\{managementTargetUserId\}/,
  );
  assert.match(overviewSource, /Gerenciar no Painel Admin/);
  assert.match(overviewSource, /roleOf\(user\) === "super_admin"/);
  assert.match(managerSource, /mode: "admin" \| "delegated"/);
  assert.match(managerSource, /grantOrganizationUserPermission/);
  assert.match(managerSource, /revokeOrganizationUserPermission/);
  assert.match(managerSource, /allowedTargetLevels/);
  assert.match(managerSource, /actorUserId/);
  assert.match(managerSource, /targetLevel\(person\) === "owner"/);
  assert.match(managerSource, /deniedPermissions/);
  assert.match(managerSource, /Acesso nativo negado/);
  assert.match(managerSource, /baselinePermissions/);
});

test("Painel Admin centraliza grants e mantém a política exclusiva do Super Admin", async () => {
  const [source, adminPageSource, apiSource] = await Promise.all([
    readFile(
      new URL(
        "../src/pages/Admin/components/AdminUserManager.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/pages/Admin.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../functions/api/admin/users/index.js", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(source, /access-delegations/);
  assert.match(source, /PAINEL OBRIGATÓRIO/);
  assert.match(source, /Limites de delegação/);
  assert.match(source, /Gerenciar acessos/);
  assert.match(source, /OrganizationPermissionManager/);
  assert.match(source, /mode="admin"/);
  assert.match(source, /isSuperAdmin &&/);
  assert.match(source, /Dados do usuário/);
  assert.match(source, /selectedView === "organizations"/);
  assert.match(source, /selectedView === "features"/);
  assert.match(source, /selectedView === "delegation"/);
  assert.match(source, /Abrir concessão\/revogação/);
  assert.match(source, /setAccessEditor/);
  assert.match(source, /Configurar delegação/);
  assert.doesNotMatch(source, /selectedView === "accesses"/);
  assert.match(source, /admin-user-filters/);
  assert.match(source, /organizationFilter/);
  assert.match(source, /profileFilter/);
  assert.match(source, /statusFilter/);
  assert.match(source, /Projects → Usuários e Acessos/);
  assert.doesNotMatch(source, /painel suspenso de Projects é uma exceção/);
  assert.match(adminPageSource, /organizations=\{organizations\}/);
  assert.match(apiSource, /organizationsByUser/);
  assert.match(apiSource, /organization_users/);
});

test("frontend e backend declaram a mesma matriz nativa revisada", async () => {
  const [
    policySource,
    clientCanSource,
    backendCanSource,
    routesSource,
    adminSource,
  ] = await Promise.all([
    readFile(
      new URL("../src/access-control/policy.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/access-control/can.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../functions/_lib/permissions.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/Routes.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Admin.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(policySource, /const OWNER_NATIVE_PERMISSIONS/);
  assert.match(policySource, /admin:\s*OWNER_NATIVE_PERMISSIONS/);
  assert.match(policySource, /owner:\s*OWNER_NATIVE_PERMISSIONS/);
  assert.match(policySource, /"project\.save"/);
  assert.match(policySource, /"project\.edit"/);
  assert.match(clientCanSource, /nativeAdminOrOwnerPersistence/);
  assert.match(clientCanSource, /nativeEditorSave/);
  assert.match(clientCanSource, /PROJECT_MEMBERSHIP_ONLY_PERMISSIONS/);
  assert.match(clientCanSource, /projectCreationPermissionAllows/);
  assert.match(clientCanSource, /hasExplicitDenial/);
  assert.match(clientCanSource, /user\.deniedPermissions/);
  assert.match(backendCanSource, /ADMIN_NATIVE_PROJECT_PERSISTENCE/);
  assert.match(backendCanSource, /OWNER_NATIVE_PROJECT_PERSISTENCE/);
  assert.match(backendCanSource, /EDITOR_NATIVE_LINKED_PROJECT_SAVE/);
  assert.match(backendCanSource, /ADMIN_NATIVE_PROJECT_CREATION/);
  assert.match(backendCanSource, /OWNER_NATIVE_PROJECT_CREATION/);
  assert.match(backendCanSource, /PROJECT_MEMBERSHIP_REQUIRED/);
  assert.match(backendCanSource, /ADMIN_NATIVE_ORGANIZATION_PERMISSION/);
  assert.match(backendCanSource, /ADMIN_PANEL_SUPER_ADMIN_ONLY/);
  assert.match(backendCanSource, /AUDIT_SUPER_ADMIN_ONLY/);
  assert.match(backendCanSource, /USER_PERMISSION_EXPLICITLY_DENIED/);
  assert.match(backendCanSource, /FROM user_permission_denials/);
  assert.match(clientCanSource, /todas as superfícies de Auditoria/);
  assert.ok(
    backendCanSource.indexOf('reason: "SUPER_ADMIN"') <
      backendCanSource.indexOf(
        'reason: "ACTIVE_ORGANIZATION_CONTEXT_MISMATCH"',
      ),
    "Super Admin deve ser autorizado antes da validação da organização ativa",
  );
  assert.match(routesSource, /normalizeRole\(user\?\.role\) === "super_admin"/);
  assert.match(adminSource, /normalizeRole\(user\?\.role\) === "super_admin"/);
  assert.doesNotMatch(adminSource, /normalized === "admin" \|\|/);
});
