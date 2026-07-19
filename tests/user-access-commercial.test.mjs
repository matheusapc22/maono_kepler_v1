import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../src/pages/Projects/components/UsersAccessSection.tsx", import.meta.url), "utf8");
const catalog = await readFile(new URL("../src/pages/Projects/components/user-access-commercial.ts", import.meta.url), "utf8");

test("interface usa vocabulário comercial obrigatório", () => {
  for (const text of ["Adicionar pessoa", "Perfil de participação", "Editar acesso", "Pessoas com acesso", "Vagas disponíveis", "Acessos suspensos"]) {
    assert.match(component, new RegExp(text));
  }
  assert.doesNotMatch(component, />Role</);
  assert.doesNotMatch(component, />AccessLevel</);
  assert.doesNotMatch(component, /Conceder permissão|Revogar permissão/);
});

test("catálogo mantém tradução técnica centralizada", () => {
  for (const profile of ["Responsável da organização", "Gestor da organização", "Colaborador", "Consulta", "Perfil personalizado"]) {
    assert.match(`${catalog}\n${component}`, new RegExp(profile));
  }
  for (const group of ["Projetos", "Arquivos e documentos", "Central de chamados", "Roadmap", "Equipe e acessos", "Organização e capacidade", "Administração Maõno"]) {
    assert.match(catalog, new RegExp(group));
  }
  assert.match(catalog, /role: "owner", accessLevel: "owner"/);
  assert.match(catalog, /role: "admin", accessLevel: "editor"/);
});

test("combinações existentes desconhecidas preservam perfil personalizado", () => {
  assert.match(component, /Perfil personalizado/);
  assert.match(catalog, /Acesso personalizado/);
  assert.match(catalog, /Capacidade existente preservada/);
});
