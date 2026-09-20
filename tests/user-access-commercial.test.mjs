import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMERCIAL_ACCESSES, COMMERCIAL_PROFILES, accessFromCode, profileFromTechnical } from "../src/pages/Projects/components/user-access-commercial.ts";

const entry = await readFile(new URL("../src/pages/Projects/components/UsersAccessSection.tsx", import.meta.url), "utf8");
const component = await readFile(new URL("../src/pages/Projects/components/UsersAccessOverviewSection.tsx", import.meta.url), "utf8");

test("interface atual usa vocabulário comercial e encaminha gestão ao painel/delegação", () => {
  assert.match(entry, /export \{ default \} from "\.\/UsersAccessOverviewSection"/);
  for (const text of ["Gerenciar no Painel Admin", "Delegação limitada ativa", "Consulta operacional", "Pessoas com acesso", "Vagas disponíveis", "Acessos suspensos"]) {
    assert.match(component, new RegExp(text));
  }
  assert.match(component, /isSuperAdmin && \([\s\S]*href=\{"\/admin\?section=users&organization="/);
  assert.match(component, /managementTargetUserId !== null && delegatedAlternative && \([\s\S]*<OrganizationPermissionManager/);
  assert.doesNotMatch(component, />Role</);
  assert.doesNotMatch(component, />AccessLevel</);
  assert.doesNotMatch(component, /Conceder permissão|Revogar permissão/);
});

test("catálogo mantém tradução técnica centralizada", () => {
  for (const [role, level, name] of [
    ["owner", "owner", "Responsável da organização"],
    ["admin", "editor", "Gestor da organização"],
    ["editor", "editor", "Colaborador"],
    ["viewer", "viewer", "Consulta"],
    ["super_admin", "owner", "Administrador da plataforma"],
  ]) {
    const profile = profileFromTechnical(role, level);
    assert.equal(profile.name, name);
    assert.equal(profile.role, role);
    assert.equal(profile.accessLevel, level);
    assert.equal(profileFromTechnical(role.toUpperCase(), level.toUpperCase()), profile);
  }
  assert.equal(profileFromTechnical("client", "owner"), COMMERCIAL_PROFILES[0]);
  const groups = new Set(COMMERCIAL_ACCESSES.map(access => access.group));
  for (const group of ["Projetos", "Arquivos e documentos", "Central de chamados", "Roadmap", "Equipe e acessos", "Organização e capacidade", "Auditoria"]) {
    assert.ok(groups.has(group), group);
  }
  assert.equal(new Set(COMMERCIAL_ACCESSES.map(access => access.code)).size, COMMERCIAL_ACCESSES.length);
  for (const access of COMMERCIAL_ACCESSES) assert.equal(accessFromCode(access.code), access);
});

test("combinações existentes desconhecidas preservam perfil personalizado", () => {
  for (const [role, level] of [["editor", "owner"], ["viewer", "editor"], ["legacy", "legacy"]]) {
    assert.equal(profileFromTechnical(role, level), null);
  }
  assert.match(component, /profileFromTechnical\(person.role, person.accessLevel\)\?\.shortName \?\? "Perfil personalizado"/);
  assert.deepEqual(accessFromCode("legacy.custom.permission"), {
    code: "legacy.custom.permission", name: "Acesso personalizado",
    description: "Capacidade existente preservada nesta configuração.", group: "Outros acessos",
  });
});
