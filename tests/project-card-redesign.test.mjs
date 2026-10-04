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
const interactions = await readFile(
  new URL(
    "../src/pages/Projects/components/project-card-interactions.css",
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

test("the article is the named keyboard-focusable project link", () => {
  assert.match(card, /<article\s+className=\{cardClassName\}/);
  assert.match(card, /role="link"/);
  assert.match(card, /tabIndex=\{opening \? -1 : 0\}/);
  assert.match(card, /aria-label=\{`Abrir projeto \$\{project\.name\}`\}/);
  assert.match(card, /onClick=\{handleCardClick\}/);
  assert.match(card, /onKeyDown=\{handleCardKeyDown\}/);
  assert.match(card, /className="mm-project-card__preview"/);
  assert.match(card, /className="mm-project-card__content"/);
  assert.match(card, /className="mm-project-card__footer"/);
  assert.doesNotMatch(card, /mm-project-card__open|<Link|<ArrowIcon/);
  assert.doesNotMatch(card, /Abrir mapa/);
});

test("whole-card activation keeps the callback and original encoded fallback", () => {
  assert.match(card, /await onOpen\(project\)/);
  assert.match(card, /`\/projects\/\$\{encodeURIComponent\(project\.slug\)\}\/manage`/);
  assert.match(card, /await navigate\(projectDestination\)/);
  assert.match(card, /useHref\(projectDestination\)/);
  assert.match(card, /window\.open\(projectHref, "_blank", "noopener,noreferrer"\)/);
  assert.match(card, /opening \|\| openingRef\.current/);
  assert.match(card, /event\.target !== event\.currentTarget/);
  assert.match(card, /event\.key !== "Enter"/);
  assert.match(card, /event\.repeat/);
});

test("ProjectCard does not expose the authenticated user as author", () => {
  assert.doesNotMatch(card, /\buser\?\.(name|email)/);
  assert.doesNotMatch(card, /MaonoUser/);
});

test("favorite remains independent, accessible and visible on light maps", () => {
  assert.match(card, /aria-pressed=\{isFavorite\}/);
  assert.match(card, /aria-busy=\{favoriteBusy\}/);
  assert.match(card, /event\.preventDefault\(\)/);
  assert.match(card, /event\.stopPropagation\(\)/);
  assert.match(card, /<FavoriteIcon active=\{isFavorite\} \/>/);
  assert.match(styles, /mm-project-card__favorite[\s\S]*width:\s*48px/);
  assert.match(styles, /mm-project-card__favorite[\s\S]*height:\s*48px/);
  assert.match(styles, /mm-project-card__favorite[\s\S]*background:\s*#09111a/);
  assert.match(styles, /mm-project-card__favorite[\s\S]*box-shadow:/);
  assert.match(styles, /mm-project-card__preview::after/);
});

test("ProjectSection no longer receives or forwards user", () => {
  assert.doesNotMatch(section, /MaonoUser/);
  assert.doesNotMatch(section, /\buser=\{/);
});

test("approved visual hierarchy is represented in markup", () => {
  assert.doesNotMatch(card, /mm-project-card__status|mm-project-card__chip/);
  assert.doesNotMatch(card, /Proprietário|Pode salvar|Somente leitura|OwnerIcon/);
  assert.match(card, /canSave: boolean/);
  assert.match(section, /canSave=\{canProjectSave\(project\)\}/);
  assert.match(card, /mm-project-card__metadata-item/);
  assert.match(card, /mm-project-card__metadata-divider/);
  assert.match(card, /<ClockIcon \/>/);
  assert.match(card, /<TagIcon \/>/);
});

test("title, description and slug keep their refined visual rules", () => {
  assert.match(
    styles,
    /mm-project-card__header h2[\s\S]*background:\s*transparent\s*!important/,
  );
  assert.match(
    styles,
    /mm-project-card__header h2[\s\S]*-webkit-line-clamp:\s*2/,
  );
  assert.match(
    styles,
    /mm-project-card__description[\s\S]*-webkit-line-clamp:\s*2/,
  );
  assert.match(
    styles,
    /mm-project-card__slug[\s\S]*text-overflow:\s*ellipsis/,
  );
});

test("whole card has restrained gold hover, visible keyboard focus and reduced motion", () => {
  assert.match(card, /import "\.\/project-card-interactions\.css"/);
  assert.match(interactions, /\[role="link"\]:hover[\s\S]*transform: translateY\(-1px\)/);
  assert.match(interactions, /border-color: var\(--maono-accent-border\)/);
  assert.match(interactions, /\[role="link"\]:focus-visible[\s\S]*outline: 3px solid var\(--project-focus-ring\)/);
  assert.match(interactions, /\[aria-disabled="true"\][\s\S]*cursor: wait/);
  assert.match(interactions, /prefers-reduced-motion: reduce[\s\S]*transform: none/);
  assert.doesNotMatch(interactions, /font-size|zoom|scale\(|padding|gap:|aspect-ratio|--project-grid/);
});

// Exercise the actual typed event-handler block, independent of DOM rendering.
const { transform } = await import("esbuild");
const interactionSource = card.slice(
  card.indexOf("  const openProject = async () => {"),
  card.indexOf("  const cardClassName = ["),
);
assert.ok(interactionSource.includes("const handleCardKeyDown"));
const { code: executableHandlers } = await transform(interactionSource, {
  loader: "ts",
  target: "es2022",
});
const makeHandlers = new Function(
  "opening", "onOpen", "project", "navigate", "projectDestination",
  "projectHref", "openingRef", "Element", "window",
  `${executableHandlers}; return { handleCardClick, handleCardKeyDown };`,
);
class CardTarget {
  constructor(control = false) { this.control = control; }
  closest(selector) {
    assert.equal(selector, "button, [role='menu']");
    return this.control ? this : null;
  }
}
const sampleProject = { name: "Projeto de teste", slug: "teste com espaço" };
function handlers({ opening = false, onOpen } = {}) {
  const navigated = [];
  const opened = [];
  const target = new CardTarget();
  return {
    ...makeHandlers(
      opening, onOpen, sampleProject, path => navigated.push(path),
      "/projects/teste%20com%20espa%C3%A7o/manage",
      "/projects/teste%20com%20espa%C3%A7o/manage", { current: false },
      CardTarget, { open: (...args) => opened.push(args) },
    ),
    target, navigated, opened,
  };
}
function cardEvent(target, extra = {}) {
  return {
    target, currentTarget: target, button: 0, key: "Enter", repeat: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  };
}

test("actual handler opens preview, body, footer and action-gap targets through the same callback", async () => {
  const calls = [];
  const card = handlers({ onOpen: project => calls.push(project) });
  for (const region of ["preview", "title", "description", "footer", "actions-gap"]) {
    card.handleCardClick(cardEvent(card.target, { target: new CardTarget(), region }));
    await Promise.resolve();
  }
  assert.equal(calls.length, 5);
  assert.ok(calls.every(project => project === sampleProject));
  assert.deepEqual(card.navigated, []);
  assert.deepEqual(card.opened, []);
});

test("actual handler ignores controls, prevented events and descendant or repeated Enter", async () => {
  const calls = [];
  const card = handlers({ onOpen: project => calls.push(project) });
  card.handleCardClick(cardEvent(card.target, { target: new CardTarget(true) }));
  card.handleCardClick(cardEvent(card.target, { defaultPrevented: true }));
  card.handleCardKeyDown(cardEvent(card.target, { target: new CardTarget(true) }));
  card.handleCardKeyDown(cardEvent(card.target, { repeat: true }));
  card.handleCardKeyDown(cardEvent(card.target, { key: " " }));
  assert.equal(calls.length, 0);
  card.handleCardKeyDown(cardEvent(card.target));
  await Promise.resolve();
  assert.deepEqual(calls, [sampleProject]);
});

test("actual handler blocks duplicate activation while opening and while callback is pending", async () => {
  const calls = [];
  const disabled = handlers({ opening: true, onOpen: project => calls.push(project) });
  disabled.handleCardClick(cardEvent(disabled.target));
  disabled.handleCardKeyDown(cardEvent(disabled.target));
  disabled.handleCardClick(cardEvent(disabled.target, { ctrlKey: true }));
  assert.deepEqual(calls, []);
  assert.deepEqual(disabled.opened, []);

  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const card = handlers({ onOpen: project => { calls.push(project); return pending; } });
  card.handleCardClick(cardEvent(card.target));
  card.handleCardClick(cardEvent(card.target));
  card.handleCardKeyDown(cardEvent(card.target));
  assert.deepEqual(calls, [sampleProject]);
  finish();
  await Promise.resolve();
  card.handleCardClick(cardEvent(card.target));
  assert.deepEqual(calls, [sampleProject, sampleProject]);
});

test("actual handler retains encoded manage fallback and modified-click destination", async () => {
  const fallback = handlers();
  fallback.handleCardClick(cardEvent(fallback.target));
  await Promise.resolve();
  assert.deepEqual(fallback.navigated, ["/projects/teste%20com%20espa%C3%A7o/manage"]);
  const calls = [];
  const card = handlers({ onOpen: project => calls.push(project) });
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    card.handleCardClick(cardEvent(card.target, modifier));
  }
  assert.deepEqual(calls, []);
  assert.equal(card.opened.length, 4);
  assert.ok(card.opened.every(([path, target, features]) =>
    path === "/projects/teste%20com%20espa%C3%A7o/manage" &&
    target === "_blank" && features === "noopener,noreferrer"));
});
