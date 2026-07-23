import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const card = await readFile(
  new URL(
    "../src/pages/Projects/components/ProjectCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const section = await readFile(
  new URL(
    "../src/pages/Projects/components/ProjectsSection.tsx",
    import.meta.url,
  ),
  "utf8",
);
const styles = await readFile(
  new URL(
    "../src/pages/Projects/components/project-cards.css",
    import.meta.url,
  ),
  "utf8",
);

test("ProjectCard uses semantic article with an explicit CTA Link", () => {
  assert.match(card, /<article className=\{cardClassName\}/);
  assert.match(card, /className="mm-project-card__preview"/);
  assert.match(card, /className="mm-project-card__content"/);
  assert.match(card, /className="mm-project-card__footer"/);
  assert.match(card, /className="mm-project-card__open"/);
  assert.match(
    card,
    /to=\{`\/projects\/\$\{encodeURIComponent\(project\.slug\)\}\/map`\}/,
  );
  assert.match(card, /Abrir projeto/);
  assert.doesNotMatch(card, /Abrir mapa/);
});

test("ProjectCard does not expose the authenticated user as author", () => {
  assert.doesNotMatch(card, /\buser\?\.(name|email)/);
  assert.doesNotMatch(card, /MaonoUser/);
});

test("favorite remains an independent accessible button", () => {
  assert.match(card, /aria-pressed=\{isFavorite\}/);
  assert.match(card, /event\.preventDefault\(\)/);
  assert.match(card, /event\.stopPropagation\(\)/);
  assert.match(styles, /width:\s*44px/);
  assert.match(styles, /height:\s*44px/);
});

test("ProjectSection no longer receives or forwards user", () => {
  assert.doesNotMatch(section, /MaonoUser/);
  assert.doesNotMatch(section, /\buser=\{/);
});

test("title, description, slug and CTA have final visual rules", () => {
  assert.match(styles, /mm-project-card__header h2[\s\S]*-webkit-line-clamp:\s*2/);
  assert.match(styles, /mm-project-card__description[\s\S]*-webkit-line-clamp:\s*2/);
  assert.match(styles, /mm-project-card__slug[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(styles, /mm-project-card__open[\s\S]*min-height:\s*46px/);
});
