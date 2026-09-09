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

test("select real preserva interação sobre superfície visual escura sincronizada", () => {
  assert.match(shell, /function ensureMembershipLevelSurface/);
  assert.match(shell, /admin-membership-level-surface/);
  assert.match(shell, /function syncMembershipLevelSurfaces/);
  assert.match(shell, /selectedOptions\[0\]/);
  assert.match(shell, /data-disabled/);
  assert.match(shell, /onChange=\{handleChange\}/);

  assert.match(styles, /admin-membership-level-surface/);
  assert.match(styles, /background: #0e1c2a/);
  assert.match(
    styles,
    /admin-membership-level select[\s\S]*opacity: 0 !important/,
  );
  assert.match(styles, /:has\(select:focus-visible\)/);
  assert.match(styles, /:has\(select:hover:not\(:disabled\)\)/);
});

test("valor do perfil fica centralizado e contido dentro do controle", () => {
  assert.match(
    styles,
    /admin-membership-level-surface[\s\S]*height: 52px !important/,
  );
  assert.match(
    styles,
    /admin-membership-level-surface[\s\S]*min-height: 52px !important/,
  );
  assert.match(
    styles,
    /admin-membership-level-surface[\s\S]*display: grid !important/,
  );
  assert.match(
    styles,
    /admin-membership-level-surface[\s\S]*align-items: center !important/,
  );
  assert.match(
    styles,
    /admin-membership-level-surface[\s\S]*line-height: 20px !important/,
  );
  assert.match(styles, /white-space: nowrap/);
  assert.match(styles, /text-overflow: ellipsis/);
});

test("estado disabled continua visualmente diferenciado sem reexpor face nativa", () => {
  assert.match(
    styles,
    /admin-membership-level-surface\[data-disabled="true"\][\s\S]*background: #0b1722/,
  );
  assert.match(
    styles,
    /admin-membership-level select:disabled[\s\S]*opacity: 0 !important/,
  );
});

test("Concluir gestão usa CTA dourado inclusive no hover", () => {
  assert.match(
    styles,
    /footer\.admin-user-section-actions > button\.mm-btn\.primary/,
  );
  assert.match(
    styles,
    /linear-gradient\(135deg, #ffd35f 0%, #f5b92c 100%\) !important/,
  );
  assert.match(styles, /background-color: #f5b92c !important/);
  assert.match(
    styles,
    /button\.mm-btn\.primary::before[\s\S]*content: "✓"/,
  );
  assert.match(
    styles,
    /button\.mm-btn\.primary:hover[\s\S]*background-color: #ffc443 !important/,
  );
});
