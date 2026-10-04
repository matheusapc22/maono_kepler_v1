import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = await readFile(new URL("../src/pages/Projects/components/RoadmapSection.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/pages/Projects/components/roadmap-workspace.css", import.meta.url), "utf8");
const router = await readFile(new URL("../src/pages/Projects.tsx", import.meta.url), "utf8");

test("Roadmap uses the shared minimal page hierarchy and a working home breadcrumb", () => {
  assert.match(source, /<h1>Roadmap<\/h1>/);
  assert.match(source, /className="roadmap-breadcrumb"/);
  assert.match(source, /<Link to="\/projects"[\s\S]*?onHome\?\.\(\)/);
  assert.match(router, /<RoadmapSection[\s\S]*?onHome=\{onHome\}/);
  assert.doesNotMatch(source, /PLANEJAMENTO OPERACIONAL|Roadmap da prestação de serviços|entregas, marcos e progresso/);
  assert.match(css, /\.roadmap-header \{[^}]*background: none/);
});

test("Roadmap retains real timeline/list modes, filters, metrics and mutation handlers", () => {
  for (const contract of ["<GanttView", "<ListView", "<RoadmapMetrics", "ROADMAP_VIEW", "ROADMAP_MANAGE", "ROADMAP_COMMENT_CREATE", "createRoadmapTask", "updateRoadmapTask", "deleteRoadmapTask", "createTaskComment"]) assert.ok(source.includes(contract), contract);
  for (const filter of ["filters.search", "filters.status", "filters.phaseId", "filters.assigneeId"]) assert.ok(source.includes(filter), filter);
  assert.doesNotMatch(source, /<select\b/);
  assert.match(source, /aria-label="Escala do cronograma"[\s\S]*?disabled=\{view === "list"\}/);
  assert.match(source, /aria-pressed=\{view === "gantt"\}/);
  assert.match(source, /aria-pressed=\{view === "list"\}/);
  assert.match(source, /<div key=\{view\} className="roadmap-scroll"/);
  assert.match(source, /title=\{formatDate\(item.date\)\}/);
});

test("The timeline footer uses API calendar metadata without fake paging or totals", () => {
  const footer = source.match(/<footer className="roadmap-footer"[\s\S]*?<\/footer>/)?.[0] || "";
  for (const field of ["startDate", "endDate", "calendarPolicy", "timezone"]) assert.ok(footer.includes(`bundle.roadmap.${field}`), field);
  assert.doesNotMatch(footer, /tasks\.length|total|pageSize|pagination|Página/);
  assert.match(css, /\.roadmap-scroll \{[^}]*max-height:[^}]*overflow: auto/);
  assert.match(css, /\.roadmap-footer \{[^}]*border-top:/);
  assert.match(css, /\.roadmap-content \{ display: block/);
  assert.match(css, /\.roadmap-view-switch button \{ display: inline-flex/);
  assert.match(css, /focus-visible/);
  assert.match(css, /\.roadmap-tools \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.roadmap-drawer \{ color-scheme: dark/);
  assert.match(css, /input\[type="range"\][\s\S]*accent-color: var\(--maono-accent-bright\)/);
  assert.match(css, /@container \(max-width: 560px\)/);
});
