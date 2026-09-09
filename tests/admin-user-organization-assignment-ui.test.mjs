import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(
  new URL("../src/pages/Admin/components/AdminUserManager.tsx", import.meta.url),
  "utf8",
);
const legacy = await readFile(
  new URL("../src/pages/Admin/components/AdminUserManagerLegacy.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/pages/Admin/components/admin-user-manager-enhancement.css", import.meta.url),
  "utf8",
);
const membershipApi = await readFile(
  new URL(
    "../functions/api/admin/users/[id]/organizations/[organizationId].js",
    import.meta.url,
  ),
  "utf8",
);

test("estado visível da organização é o controle explícito de conceder/remover acesso", () => {
  assert.match(shell, /\.admin-membership-state/);
  assert.match(shell, /setAttribute\("role", "button"\)/);
  assert.match(shell, /setAttribute\("aria-pressed"/);
  assert.match(shell, /checkbox\.click\(\)/);
  assert.match(shell, /target\.closest\("\.admin-membership-switch"\)/);
  assert.match(shell, /event\.preventDefault\(\)/);
});

test("repair mantém o contrato PUT/DELETE e os níveis organizacionais existentes", () => {
  assert.match(legacy, /\/api\/admin\/users\/\$\{selected\.id\}\/organizations\/\$\{organization\.id\}/);
  assert.match(legacy, /method: assigned \? "PUT" : "DELETE"/);
  assert.match(membershipApi, /new Set\(\["viewer", "editor", "owner"\]\)/);
  assert.doesNotMatch(shell, /fetch\(/);
});

test("navegação fundamental da gestão do usuário permanece disponível", () => {
  for (const label of [
    "Dados do usuário",
    "Organizações",
    "Funcionalidades",
    "Delegação",
  ]) {
    assert.match(legacy, new RegExp(label));
  }
});

test("redesign remove o checkbox branco da apresentação e usa estados escuros acessíveis", () => {
  assert.match(styles, /admin-membership-switch[\s\S]*input\[type="checkbox"\][\s\S]*clip-path: inset\(50%\)/);
  assert.match(styles, /admin-membership-level select[\s\S]*appearance: none/);
  assert.match(styles, /background: #0e1c2a !important/);
  assert.match(styles, /admin-membership-state\[role="button"\]/);
  assert.match(styles, /admin-membership-state\.active\[role="button"\]/);
  assert.match(styles, /position: sticky/);
});
