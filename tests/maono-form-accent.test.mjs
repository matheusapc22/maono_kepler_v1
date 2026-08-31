import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [forms, tokens, main] = await Promise.all([
  readFile(new URL("src/pages/Projects/maono-form-accent.css", ROOT), "utf8"),
  readFile(new URL("src/maono-design-tokens.css", ROOT), "utf8"),
  readFile(new URL("src/main.tsx", ROOT), "utf8"),
]);

test("camada de formulários é carregada depois dos tokens globais", () => {
  const tokenImport = 'import "./maono-design-tokens.css";';
  const formImport = 'import "./pages/Projects/maono-form-accent.css";';

  assert.ok(main.includes(tokenImport));
  assert.ok(main.includes(formImport));
  assert.ok(
    main.indexOf(tokenImport) < main.indexOf(formImport),
    "a camada de formulários deve consumir tokens já carregados",
  );
});

test("inputs, textareas e selects usam borda e glow dourados no foco", () => {
  assert.match(forms, /:is\(input, textarea, select\):focus/);
  assert.match(forms, /border-color:\s*var\(--maono-accent-border-strong\)/);
  assert.match(forms, /box-shadow:\s*0 0 0 3px var\(--maono-accent-glow\)/);
});

test("focus-visible usa o focus ring dourado da PR 109", () => {
  assert.match(forms, /focus-visible[\s\S]*outline:\s*3px solid var\(--maono-focus-ring\)/);
  assert.match(forms, /ticket-center-shell[\s\S]*focus-visible[\s\S]*outline:\s*2px solid var\(--maono-focus-ring\)/);
  assert.match(tokens, /--maono-focus-ring:\s*var\(--maono-accent-bright\)/);
});

test("drawer de metadados migra branding visual para dourado", () => {
  for (const requiredToken of [
    "var(--maono-accent-surface)",
    "var(--maono-accent-text)",
    "var(--maono-accent-bright)",
    "var(--maono-accent-strong)",
    "var(--maono-accent-glow)",
  ]) {
    assert.ok(forms.includes(requiredToken), `token ausente no drawer: ${requiredToken}`);
  }

  assert.match(forms, /mm-project-metadata-panel__eyebrow/);
  assert.match(forms, /mm-project-metadata-panel__spinner/);
  assert.match(forms, /mm-project-metadata-button\.is-primary/);
});

test("labels comuns permanecem neutros para preservar hierarquia", () => {
  assert.match(forms, /mm-project-metadata-field[\s\S]*> span[\s\S]*color:\s*#e2e8f0/);
  assert.match(forms, /ticket-filter-label/);
  assert.match(forms, /var\(--mm-text-soft, #c6c0b1\)/);
});

test("camada de formulários não reintroduz accents verdes legados", () => {
  const lower = forms.toLowerCase();

  for (const legacy of [
    "#20c7b5",
    "#34d399",
    "#6ee7b7",
    "#67e8dd",
    "#9af5eb",
    "#99f6e4",
    "rgba(32, 199, 181",
    "rgba(52, 211, 153",
    "rgba(110, 231, 183",
    "var(--mm-teal)",
  ]) {
    assert.ok(!lower.includes(legacy), `accent verde legado encontrado: ${legacy}`);
  }
});

test("a migração não sobrescreve estados semânticos de sucesso", () => {
  assert.ok(!forms.includes(".is-success"));
  assert.match(tokens, /--maono-semantic-success:/);
});
