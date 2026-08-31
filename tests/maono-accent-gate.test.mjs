import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const ROOT_URL = new URL("../", import.meta.url);
const ROOT = fileURLToPath(ROOT_URL);

const [gate, compat, tokens] = await Promise.all([
  readFile(new URL("scripts/design/maono-accent-gate.mjs", ROOT_URL), "utf8"),
  readFile(new URL("src/pages/Projects/maono-residual-accent.css", ROOT_URL), "utf8"),
  readFile(new URL("src/maono-design-tokens.css", ROOT_URL), "utf8"),
]);

test("gate congela explicitamente apenas dívida estrutural conhecida", () => {
  for (const file of [
    "src/pages/Projects/projects.css",
    "src/pages/Projects/components/project-cards.css",
    "src/pages/Projects/components/project-metadata-panel.css",
    "src/pages/Admin/admin.css",
  ]) {
    assert.ok(gate.includes(file), `arquivo legado não documentado no gate: ${file}`);
  }

  for (const legacy of [
    "#20c7b5",
    "#67e8dd",
    "#9af5eb",
    "#99f6e4",
    "#34d399",
    "#6ee7b7",
  ]) {
    assert.ok(gate.toLowerCase().includes(legacy), `assinatura legada ausente: ${legacy}`);
  }
});

test("bridge de compatibilidade transforma aliases em consumidores dos tokens oficiais", () => {
  assert.match(compat, /html:root\s*\{/);
  assert.match(compat, /--mm-gold:\s*var\(--maono-accent-strong\)/);
  assert.match(compat, /--mm-gold-bright:\s*var\(--maono-accent-bright\)/);
  assert.match(compat, /--mm-gold-muted:\s*var\(--maono-accent-muted\)/);
  assert.match(compat, /--mm-teal:\s*var\(--maono-accent\)/);
  assert.match(compat, /--mm-danger:\s*var\(--maono-semantic-danger\)/);
  assert.match(compat, /--mm-success:\s*var\(--maono-semantic-success\)/);
  assert.doesNotMatch(compat, /var\(--mm-teal\)/);
  assert.match(tokens, /--maono-accent-muted:\s*#8a6a2f/);
});

test("gate impede nova paleta paralela de accent em arquivos modernos", () => {
  assert.match(gate, /RAW_GOLD_ALIAS_PATTERNS/);
  assert.match(gate, /LEGACY_BRAND_PATTERNS/);
  assert.match(gate, /tombstone --mm-teal precisa apontar para --maono-accent/);
  assert.match(gate, /a camada moderna não pode consumir var\(--mm-teal\)/);
});

test("gate global executa sem violações modernas", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["scripts/design/maono-accent-gate.mjs"],
    { cwd: ROOT },
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Maõno accent gate: OK/);
  assert.match(stdout, /Dívida histórica congelada e neutralizada no runtime/);
});
