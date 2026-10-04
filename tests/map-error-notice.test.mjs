import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const notice = read('src/pages/Kepler/components/map-notice/MapErrorNotice.tsx');
const css = read('src/pages/Kepler/components/map-notice/map-error-notice.css');
const loader = read('src/pages/Kepler/map-url-loader/index.tsx');
const gate = read('src/pages/Kepler/map-panel/MapPanelProvider.tsx');
const manage = read('src/pages/Kepler/map-panel/MapManagementPage.tsx');
const runtime = read('src/pages/Kepler/components/maono-map-shell/MaonoMapRuntime.tsx');

test('map load failure uses a named alert and an explicit readable retry action', () => {
  assert.match(loader, /<MapErrorNotice title="Erro ao carregar o projeto" message=\{error\}/);
  assert.match(loader, /Tentar carregar novamente/);
  assert.match(loader, /return createPortal\(/);
  assert.match(loader, /document\.getElementById\("root"\)/);
  assert.match(loader, /onClick=\{\(\) => setRetryToken\(\(current\) => current \+ 1\)\}/);
  assert.match(loader, /setError\(normalizeUserError\(err\)\.message\)/);
  assert.doesNotMatch(loader, /bg-white|text-red-950|bg-red-950/);
  assert.match(notice, /role="alert" aria-labelledby=\{titleId\} aria-describedby=\{messageId\}/);
  assert.match(notice, /aria-hidden="true"/);
  assert.match(notice, /\{supportReference\}/);
});

test('equivalent access and route failures share the notice while retaining authorized destinations', () => {
  for (const source of [gate, manage]) assert.match(source, /<MapErrorNotice/);
  assert.match(gate, /state\.status === "blocked" \|\| state\.status === "error"/);
  assert.match(gate, /supportReference=\{presentation\.supportReference\}/);
  assert.match(gate, /replacementRoute \? \([\s\S]*?to=\{replacementRoute\}/);
  assert.match(gate, /fallback === "viewer" && projectSlug/);
  assert.match(gate, /encodeURIComponent\(projectSlug\)\}\/view/);
  for (const source of [gate, manage]) assert.match(source, /<Link to="\/projects">Voltar aos projetos<\/Link>/);
  assert.match(manage, /prepareProjectMapDestination/);
});

test('notice owns foreground and background together, focus and narrow-screen reflow', () => {
  assert.match(css, /#root \.maono-map-notice \.maono-map-notice__actions > :is\(button, a\)/);
  assert.match(css, /background: var\(--maono-accent, #c5a059\);\s*color: #17140e/);
  assert.match(css, /-webkit-text-fill-color: currentColor/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /white-space: normal/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /:focus-visible[\s\S]*?outline-offset: 4px/);
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /text-overflow:\s*ellipsis|transition:\s*all/);
});

test('only the floating Requests shortcut is removed; review, inbox and mutations remain wired', () => {
  assert.doesNotMatch(runtime, />Solicitações<|bottom: 55|\/requests`/);
  assert.match(runtime, /<PointFromPinWorkflow \/>/);
  assert.match(read('src/Routes.tsx'), /path="\/projects\/:projectSlug\/requests"/);
  assert.match(read('src/pages/Kepler/change-requests/ChangeRequestReviewPage.tsx'), /encodeURIComponent\(projectSlug\)\}\/requests/);
  assert.match(read('src/pages/Projects/components/TicketChanges.tsx'), /item\.reviewUrl \? <a href=\{item\.reviewUrl\}>Abrir revisão/);
});

test('notice browser regression uses compiled route gate and is excluded from Vite dev', () => {
  assert.match(read('playwright.project-pages.config.ts'), /map-error-notice\.spec\.ts/);
  assert.match(read('playwright.config.ts'), /\*\*\/map-error-notice\.spec\.ts/);
  assert.match(read('.github/workflows/project-pages.yml'), /tests\/map-error-notice\.test\.mjs/);
});
