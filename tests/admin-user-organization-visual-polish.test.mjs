import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(
  new URL("../src/pages/Admin/components/AdminUserManager.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL(
    "../src/pages/Admin/components/admin-user-manager-polish.css",
    import.meta.url,
  ),
  "utf8",
);

test("polish final é carregado depois do enhancement base", () => {
  assert.match(
    shell,
    /admin-user-manager-enhancement\.css";[\s\S]*admin-user-manager-polish\.css";/,
  );
});

test("select organizacional habilitado não pode voltar ao preenchimento branco", () => {
  assert.match(styles, /select:not\(:disabled\)/);
  assert.match(styles, /appearance: none !important/);
  assert.match(styles, /background: #0e1c2a !important/);
  assert.match(styles, /background-color: #0e1c2a !important/);
  assert.match(styles, /-webkit-text-fill-color: #f4f1e8 !important/);
});

test("Concluir gestão usa CTA dourado inclusive no hover", () => {
  assert.match(styles, /footer\.admin-user-section-actions > button\.mm-btn\.primary/);
  assert.match(styles, /linear-gradient\(135deg, #ffd35f 0%, #f5b92c 100%\) !important/);
  assert.match(styles, /background-color: #f5b92c !important/);
  assert.match(styles, /button\.mm-btn\.primary::before[\s\S]*content: "✓"/);
  assert.match(styles, /button\.mm-btn\.primary:hover[\s\S]*background-color: #ffc443 !important/);
});
