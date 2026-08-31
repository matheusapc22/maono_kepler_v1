import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [tokens, main, audit] = await Promise.all([
  readFile(new URL("src/maono-design-tokens.css", ROOT), "utf8"),
  readFile(new URL("src/main.tsx", ROOT), "utf8"),
  readFile(new URL("docs/design/maono-golden-accent-audit.md", ROOT), "utf8"),
]);

test("tokens dourados globais são carregados antes dos estilos da aplicação", () => {
  const tokenImport = 'import "./maono-design-tokens.css";';
  const indexImport = 'import "./index.css";';

  assert.ok(main.includes(tokenImport));
  assert.ok(main.includes(indexImport));
  assert.ok(
    main.indexOf(tokenImport) < main.indexOf(indexImport),
    "tokens globais devem ser carregados antes do CSS da aplicação",
  );
});

test("accent oficial da Maõno é dourado e possui estados visuais reutilizáveis", () => {
  for (const token of [
    "--maono-accent:",
    "--maono-accent-strong:",
    "--maono-accent-bright:",
    "--maono-accent-text:",
    "--maono-accent-surface:",
    "--maono-accent-border:",
    "--maono-accent-glow:",
    "--maono-focus-ring:",
  ]) {
    assert.ok(tokens.includes(token), `token obrigatório ausente: ${token}`);
  }

  assert.match(tokens, /--maono-accent:\s*#c5a059\s*;/i);
  assert.match(tokens, /--maono-focus-ring:\s*var\(--maono-accent-bright\)/);
});

test("semântica funcional permanece separada da identidade visual", () => {
  assert.match(tokens, /--maono-semantic-success:\s*#22c55e\s*;/i);
  assert.match(tokens, /--maono-semantic-warning:/);
  assert.match(tokens, /--maono-semantic-danger:/);
  assert.match(tokens, /--maono-semantic-info:/);
  assert.doesNotMatch(tokens, /--maono-accent:\s*var\(--maono-semantic-success\)/i);
});

test("arquivo de tokens não reintroduz accents verdes legados de marca", () => {
  for (const legacyColor of [
    "#20c7b5",
    "#34d399",
    "#6ee7b7",
    "#67e8dd",
    "#9af5eb",
    "#99f6e4",
  ]) {
    assert.ok(
      !tokens.toLowerCase().includes(legacyColor),
      `accent legado não deve entrar nos tokens de marca: ${legacyColor}`,
    );
  }
});

test("auditoria registra fontes legadas e separa marca de estado semântico", () => {
  for (const reference of [
    "src/pages/Projects/projects.css",
    "src/pages/Projects/components/project-cards.css",
    "src/pages/Projects/components/project-metadata-panel.css",
    "--mm-teal",
    "--maono-semantic-success",
  ]) {
    assert.ok(audit.includes(reference), `auditoria não registra ${reference}`);
  }

  assert.match(audit, /Verde só é aceito quando houver semântica funcional explícita/i);
});
