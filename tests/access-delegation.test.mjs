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
  assert.match(source, /Projects → Usuários e Acessos/);
  assert.doesNotMatch(
    source.slice(source.indexOf("function can("), source.indexOf("function profileOptions")),
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
});
