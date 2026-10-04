import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const source = await readFile(new URL("../src/pages/Projects/components/RoadmapSection.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/pages/Projects/components/roadmap-workspace.css", import.meta.url), "utf8");

test("Roadmap keeps real controls and headers while only unknown values use shared Skeleton", () => {
  assert.match(source, /import \{ Skeleton, LoadingStatus \} from "\.\.\/\.\.\/\.\.\/components\/loading\/Skeleton"/);
  assert.match(source, /import \{ useSkeletonCount \} from "\.\.\/\.\.\/\.\.\/components\/loading\/useSkeletonCount"/);
  const metrics = source.slice(source.indexOf("function RoadmapMetrics"), source.indexOf("function GanttView"));
  const gantt = source.slice(source.indexOf("function GanttView"), source.indexOf("function ListView"));
  const list = source.slice(source.indexOf("function ListView"), source.indexOf("type TaskForm"));
  assert.match(metrics, /<small>\{label\}<\/small>/);
  assert.match(metrics, /value \?\? \(loading \? <Skeleton/);
  assert.match(gantt, /role="columnheader">Tarefa \/ responsável/);
  assert.match(gantt, /className="roadmap-loading" aria-hidden="true"/);
  assert.match(list, /<th scope="col">Tarefa<\/th><th scope="col">Fase<\/th><th scope="col">Período<\/th><th scope="col">Status<\/th><th scope="col">Progresso<\/th><th scope="col">Responsável<\/th>/);
  assert.match(source, /useSkeletonCount\(\{ layout: "table", pageSize: page.pageSize, itemHeight: 58, reservedHeight: 500 \}\)/);
  assert.match(source, /const skeletonCount = loading && !bundle \? estimatedRows : 0/);
  assert.match(source, /value=\{filters.phaseId\} disabled=\{!bundle\}/);
  assert.match(source, /value=\{filters.assigneeId\} disabled=\{!bundle\}/);
  assert.doesNotMatch(source, /RoadmapLoadingSkeleton|roadmap-loading-footer|roadmap-loading-columns/);
  assert.doesNotMatch(css, /@keyframes|animation:/);
  assert.match(css, /roadmap-loading-row[^}]*min-height: 58px/);
});

test("Roadmap requests are abortable and scoped, while current data remains during refresh", () => {
  assert.match(source, /listRoadmaps\(organizationId, controller.signal\)/);
  assert.match(source, /getRoadmap\(organizationId, roadmapId, filters, controller.signal\)/);
  assert.match(source, /!controller.signal.aborted && mountedRef.current/);
  assert.match(source, /currentRequestRef.current.scopeKey === scopeKey/);
  assert.match(source, /currentRequestRef.current.queryKey === queryKey/);
  assert.match(source, /indexControllerRef.current\?\.abort\(\); bundleControllerRef.current\?\.abort\(\)/);
  assert.match(source, /loading \|\| bundle \|\| roadmapId \|\| error \? <>/);
  assert.match(source, /items: current.scopeKey === scopeKey \? current.items : \[\]/);
  assert.match(source, /<div ref=\{scrollRef\} className="roadmap-scroll"/);
  assert.doesNotMatch(source, /key=\{`\$\{view\}/);
  assert.match(source, /\[view, queryKey, page.pageIndex, page.pageSize\]/);
  assert.match(source, /<LoadingStatus loading refreshing=\{Boolean\(bundle\)\}/);
  assert.match(source, /announce=\{false\} visuallyHidden=\{false\}/);
  assert.match(source, /loadedBundleKey !== queryKey && !error/);
  assert.match(source, /className="roadmap-scroll" aria-busy=\{loading\}/);
  // Preserve only the existing user-search debounce, with no artificial loading duration.
  assert.equal((source.match(/setTimeout\(/g) || []).length, 1);
  assert.match(source, /filters.search \? window.setTimeout\(\(\) => void loadBundle\(\), 250\) : null/);
});

test("Roadmap access denial clears incompatible data and invalidates every pending read", () => {
  assert.match(source, /import \{ isRegionAccessDenied \} from "\.\.\/\.\.\/\.\.\/components\/loading\/region-loading-policy"/);
  const clearDenied = source.slice(source.indexOf("const clearDeniedScope"), source.indexOf("const loadIndex"));
  assert.match(clearDenied, /\+\+indexRequestRef.current; \+\+requestRef.current/);
  assert.match(clearDenied, /indexControllerRef.current\?\.abort\(\); bundleControllerRef.current\?\.abort\(\)/);
  assert.match(clearDenied, /setIndex\(\{ scopeKey, items: \[\], status: "error" \}\)/);
  assert.match(clearDenied, /setSelection\(\{ scopeKey, id: null \}\)/);
  for (const setter of ["setBundleState(null)", "setLoadingQueryKey(null)", "setDrawerOpen(false)", "setSelected(null)"]) assert.ok(clearDenied.includes(setter), setter);
  assert.match(clearDenied, /setErrorState\(\{ scopeKey, queryKey: null/);
  assert.equal((source.match(/if \(isRegionAccessDenied\(value\)\) \{ clearDeniedScope\(value\); return; \}/g) || []).length, 2);
  // Ordinary retryable failures retain the existing current-scope bundle and index.
  const transientIndex = source.slice(source.indexOf("if (isRegionAccessDenied(value))"), source.indexOf("const loadBundle"));
  assert.match(transientIndex, /items: current.scopeKey === scopeKey \? current.items : \[\]/);
  assert.doesNotMatch(source.slice(source.indexOf("const loadBundle"), source.indexOf("mountedRef.current = true")), /setBundleState\(null\)/);
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
    globalThis.window = { innerWidth: 1440, innerHeight: 1100 };
    const user = { id: 7, role: "viewer", organizationId: 1, activeOrganizationId: 1, permissions: ["roadmap.view"] };
    const loading = render({ organizationId: 1, user });
    assert.match(loading, /class="roadmap-scroll" aria-busy="true"/);
    assert.match(loading, /roadmap-loading-gantt/);
    assert.equal((loading.match(/role="status"/g) || []).length, 1);
    assert.equal((loading.match(/class="roadmap-loading-row"/g) || []).length, 10);
    assert.doesNotMatch(loading, /Nenhum roadmap ativo|Nenhuma tarefa no período|Exibindo 0|Tentar novamente/);
    assert.match(loading, /<h1>Roadmap<\/h1>/);
    assert.match(loading, /<small>Progresso geral<\/small>/);
    assert.match(loading, /type="search"/);
    assert.match(loading, /Todos os status/);
    assert.match(loading, /role="columnheader">Tarefa \/ responsável/);
    assert.match(loading, /class="roadmap-pagination"/);
    assert.match(loading, /Carregando roadmap\./);
    assert.match(loading, /aria-label="Página anterior" disabled=""/);
    assert.ok(loading.indexOf('role="status"') > loading.indexOf('<footer class="roadmap-pagination"'));
    globalThis.window = { innerWidth: 390, innerHeight: 844 };
    const mobile = render({ organizationId: 1, user });
    assert.match(mobile, /roadmap-loading-list/);
    assert.match(mobile, /<th scope="col">Tarefa<\/th><th scope="col">Fase<\/th>/);
    assert.equal((mobile.match(/class="roadmap-loading-row"/g) || []).length, 6);
    globalThis.window = { innerWidth: 1440, innerHeight: 680 };
    assert.equal((render({ organizationId: 1, user }).match(/class="roadmap-loading-row"/g) || []).length, 4);
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
