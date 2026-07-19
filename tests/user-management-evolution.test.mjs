import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminUser = await readFile(new URL("../functions/api/admin/users/[id].js", import.meta.url), "utf8");
const organizationUser = await readFile(new URL("../functions/api/organizations/[id]/users/[userId].js", import.meta.url), "utf8");
const membership = await readFile(new URL("../functions/api/admin/users/[id]/organizations/[organizationId].js", import.meta.url), "utf8");
const adminUi = await readFile(new URL("../src/pages/Admin/components/AdminUserManager.tsx", import.meta.url), "utf8");

test("alterações de senha usam hash e invalidam sessões", () => {
  assert.match(adminUser, /hashPassword\(password\)/);
  assert.match(organizationUser, /hashPassword\(password\)/);
  assert.match(organizationUser, /DELETE FROM sessions WHERE user_id/);
  assert.doesNotMatch(`${adminUser}\n${organizationUser}`, /password_hash\s*=\s*password/);
});

test("exclusões protegem conta em uso e último responsável", () => {
  assert.match(adminUser, /SELF_DELETE_BLOCKED/);
  assert.match(organizationUser, /SELF_MEMBERSHIP_DELETE_BLOCKED/);
  assert.match(`${organizationUser}\n${membership}`, /LAST_OWNER_REMOVAL_BLOCKED/);
});

test("somente super admin gerencia organizações de usuário", () => {
  assert.match(membership, /SUPER_ADMIN_REQUIRED/);
  assert.match(membership, /admin\.user_organization\.assign/);
  assert.match(membership, /admin\.user_organization\.remove/);
});

test("painel oferece criação, edição, senha, exclusão e organizações", () => {
  for (const label of ["Novo usuário", "Editar usuário", "Atribuir ou alterar senha", "Excluir usuário", "Organizações atribuídas"]) {
    assert.match(adminUi, new RegExp(label));
  }
});
