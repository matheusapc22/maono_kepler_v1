import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [layer, main] = await Promise.all([
  readFile(
    new URL("src/pages/Projects/maono-card-list-accent.css", ROOT),
    "utf8",
  ),
  readFile(new URL("src/main.tsx", ROOT), "utf8"),
]);

function ruleFor(selector) {
  const start = layer.indexOf(selector);
  assert.notEqual(start, -1, `seletor ausente: ${selector}`);
  const open = layer.indexOf("{", start);
  const close = layer.indexOf("}", open);
  assert.notEqual(open, -1, `bloco sem abertura: ${selector}`);
  assert.notEqual(close, -1, `bloco sem fechamento: ${selector}`);
  return layer.slice(open + 1, close);
}

test("camada de cards é carregada depois dos tokens e da camada de formulários", () => {
  const tokens = 'import "./maono-design-tokens.css";';
  const forms = 'import "./pages/Projects/maono-form-accent.css";';
  const cards = 'import "./pages/Projects/maono-card-list-accent.css";';

  for (const entry of [tokens, forms, cards]) {
    assert.ok(main.includes(entry), `import obrigatório ausente: ${entry}`);
  }

  assert.ok(main.indexOf(tokens) < main.indexOf(forms));
  assert.ok(main.indexOf(forms) < main.indexOf(cards));
});

test("hover e abertura do card usam contorno e glow dourados", () => {
  const hover = ruleFor(".mm-projects-content .mm-project-card:hover");
  const opening = ruleFor(".mm-projects-content .mm-project-card.is-opening");

  assert.match(hover, /--maono-accent-border/);
  assert.match(hover, /--maono-accent-glow/);
  assert.match(opening, /--maono-accent-border-strong/);
  assert.match(opening, /--maono-accent-glow-strong/);
});

test("fallbacks de preview não usam verde como decoração de marca", () => {
  const fallback = ruleFor(
    ".mm-projects-content .mm-project-card__preview-fallback",
  );
  const icon = ruleFor(
    ".mm-projects-content .mm-project-card__preview-fallback > span",
  );

  assert.match(fallback, /--maono-accent-surface/);
  assert.match(icon, /--maono-accent-text/);
});

test("ações do card usam tokens dourados em hover e estados ativos", () => {
  assert.match(layer, /\.mm-project-card__favorite\.is-active/);
  assert.match(layer, /\.mm-project-card__more\[aria-expanded="true"\]/);
  assert.match(layer, /--maono-accent-border-strong/);
  assert.match(layer, /--maono-accent-surface-strong/);
  assert.match(layer, /--maono-accent-text/);
});

test("itens de listagem do menu de ações usam dourado no hover e foco", () => {
  const menuState = ruleFor(".mm-project-actions-menu__item:hover");

  assert.match(menuState, /--maono-accent-text/);
  assert.match(menuState, /--maono-accent-surface-strong/);
  assert.match(
    layer,
    /\.mm-project-actions-menu__item:focus-visible\s*\{[\s\S]*?--maono-accent-border-strong/,
  );
});

test("focus ring dos controles de card vem do contrato global", () => {
  assert.match(layer, /outline-color:\s*var\(--maono-focus-ring\)/);
  assert.match(layer, /--project-focus-ring:\s*var\(--maono-focus-ring\)/);
});

test("nova camada não reintroduz accents verdes legados", () => {
  const normalized = layer.toLowerCase();

  for (const legacy of [
    "#20c7b5",
    "#34d399",
    "#6ee7b7",
    "#d1fae5",
    "rgba(52, 211, 153",
    "rgba(110, 231, 183",
    "rgba(16, 185, 129",
    "var(--mm-teal)",
  ]) {
    assert.ok(!normalized.includes(legacy), `accent verde legado encontrado: ${legacy}`);
  }
});

test("camada de cards não interfere em estados semânticos de sucesso", () => {
  assert.doesNotMatch(layer, /\.is-success/);
  assert.doesNotMatch(layer, /--maono-semantic-success/);
});
