import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const source = await readFile(new URL("../src/pages/Projects/components/RoadmapSection.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/pages/Projects/components/roadmap-workspace.css", import.meta.url), "utf8");

test("Roadmap loading uses shared decorative geometry, not an independent animation", () => {
  const skeleton = source.slice(source.indexOf("function RoadmapLoadingSkeleton"), source.indexOf("function RoadmapMetrics"));
  assert.match(source, /import \{ Skeleton \} from "\.\.\/\.\.\/\.\.\/components\/loading\/Skeleton"/);
  for (const name of ["roadmap-tools", "roadmap-filters", "roadmap-metrics", "roadmap-content", "roadmap-loading-columns", "roadmap-loading-row", "roadmap-loading-footer"]) assert.ok(skeleton.includes(name), name);
  assert.equal((skeleton.match(/role="status"/g) || []).length, 1);
  assert.equal((skeleton.match(/aria-busy="true"/g) || []).length, 1);
  assert.match(skeleton, /className="roadmap-loading-layout" aria-hidden="true"/);
  assert.doesNotMatch(skeleton, /<button|<input|<select|tabIndex/);
  assert.doesNotMatch(css, /@keyframes|animation:/);
  assert.match(css, /roadmap-loading-scroll[^}]*overflow: hidden/);
});

test("Roadmap requests are abortable and scoped, while current data remains during refresh", () => {
  assert.match(source, /listRoadmaps\(organizationId, controller.signal\)/);
  assert.match(source, /getRoadmap\(organizationId, roadmapId, filters, controller.signal\)/);
  assert.match(source, /!controller.signal.aborted && mountedRef.current/);
  assert.match(source, /currentRequestRef.current.scopeKey === scopeKey/);
  assert.match(source, /currentRequestRef.current.queryKey === queryKey/);
  assert.match(source, /indexControllerRef.current\?\.abort\(\); bundleControllerRef.current\?\.abort\(\)/);
  assert.match(source, /loading && !bundle \? <RoadmapLoadingSkeleton/);
  assert.match(source, /loadedBundleKey !== queryKey && !error/);
  assert.match(source, /className="roadmap-scroll" aria-busy=\{loading\}/);
  // Preserve only the existing user-search debounce, with no artificial loading duration.
  assert.equal((source.match(/setTimeout\(/g) || []).length, 1);
  assert.match(source, /filters.search \? window.setTimeout\(\(\) => void loadBundle\(\), 250\) : null/);
});

test("the initial render distinguishes authorized loading, no organization and denied permission", async () => {
  const result = await build({
    stdin: {
      contents: `import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import RoadmapSection from './src/pages/Projects/components/RoadmapSection';
export function render(props) { return renderToStaticMarkup(<StaticRouter location="/projects"><RoadmapSection {...props} /></StaticRouter>); }`,
      loader: "tsx", resolveDir: new URL("../", import.meta.url).pathname,
    },
    bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
    loader: { ".css": "empty", ".png": "dataurl" },
    external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "react-router"],
  });
  const directory = await mkdtemp(new URL("../.roadmap-loading-test-", import.meta.url).pathname);
  const previousWindow = globalThis.window;
  try {
    const modulePath = join(directory, "render.mjs");
    await writeFile(modulePath, result.outputFiles[0].text);
    const { render } = await import(modulePath);
    globalThis.window = { innerWidth: 1440 };
    const user = { id: 7, role: "viewer", organizationId: 1, activeOrganizationId: 1, permissions: ["roadmap.view"] };
    const loading = render({ organizationId: 1, user });
    assert.match(loading, /class="roadmap-loading" aria-busy="true"/);
    assert.match(loading, /roadmap-loading-gantt/);
    assert.equal((loading.match(/role="status"/g) || []).length, 1);
    assert.equal((loading.match(/class="roadmap-loading-row"/g) || []).length, 10);
    assert.doesNotMatch(loading, /Nenhum roadmap ativo|Tentar novamente/);
    globalThis.window = { innerWidth: 390 };
    assert.match(render({ organizationId: 1, user }), /roadmap-loading-list/);
    const noOrganization = render({ user });
    assert.match(noOrganization, /Selecione uma organização/);
    assert.doesNotMatch(noOrganization, /roadmap-loading|aria-busy="true"/);
    const denied = render({ organizationId: 1, user: { ...user, deniedPermissions: ["roadmap.view"] } });
    assert.match(denied, /Você não possui permissão para visualizar este roadmap/);
    assert.doesNotMatch(denied, /roadmap-loading|aria-busy="true"|Criar roadmap/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await rm(directory, { recursive: true, force: true });
  }
});
