import { expect, test, type Page } from "@playwright/test";
import type { RoadmapBundle, RoadmapSummary, RoadmapTask } from "../../src/pages/Projects/components/roadmap-types";

// Real compiled React UI with synthetic intercepted HTTP only. No production validation.
const NOW = "2026-10-04T12:00:00.000Z";
const roadmap: RoadmapSummary = { id: 1, organizationId: 1, name: "Plano progressivo", startDate: "2026-09-01", endDate: "2026-12-31", calendarPolicy: "business_days", timezone: "America/Sao_Paulo", status: "active", version: 1, createdAt: NOW, updatedAt: NOW };
const tasks: RoadmapTask[] = Array.from({ length: 26 }, (_, index) => ({
  id: index + 1, roadmapId: 1, phaseId: 1, phaseName: "Planejamento", phaseColor: "#c5a059", title: `Entrega ${String(index + 1).padStart(2, "0")}`,
  description: "Dado sintético.", startDate: "2026-09-10", endDate: "2026-11-15", durationDays: 67,
  status: "planned", progress: 0, priority: "normal", assigneeId: 2, assigneeName: "Pessoa de teste", isMilestone: false,
  sortOrder: index, version: 1, createdAt: NOW, updatedAt: NOW,
}));
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const shell = (page: Page) => page.locator(".roadmap-workspace");
const region = (page: Page) => shell(page).locator(".roadmap-scroll");
const status = (page: Page) => shell(page).locator(".roadmap-pagination").getByRole("status");
const search = (page: Page) => shell(page).getByRole("searchbox", { name: "Buscar tarefa" });
type FixtureFailure = { status: number; category?: string; code?: string };
async function setup(page: Page, hooks: { index?: () => Promise<void>; bundle?: (search: string, read: number) => Promise<void | FixtureFailure> } = {}) {
  const state = structuredClone(tasks), reads: string[] = [], settled: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const session = { authenticated: true, user: { id: 1, name: "Pessoa de teste", email: "qa@example.test", role: "super_admin", activeOrganizationId: 1, organizationId: 1, permissions: [] }, projects: [], organizations: [{ id: 1, name: "Organização sintética", slug: "synthetic", active: true }], activeOrganization: { id: 1, name: "Organização sintética" } };
  await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === "/api/session") return route.fulfill({ json: session });
    if (["/api/projects", "/api/projects/recent", "/api/projects/favorites"].includes(path)) return route.fulfill({ json: { ok: true, projects: [] } });
    if (path === "/api/organizations/1/roadmaps") { await hooks.index?.(); return route.fulfill({ json: { roadmaps: [roadmap] } }); }
    if (path === "/api/organizations/1/roadmaps/1") {
      const query = url.searchParams.get("search") || "";
      reads.push(query); const failure = await hooks.bundle?.(query, reads.length);
      if (failure) return route.fulfill({ status: failure.status, json: { ok: false, error: "Falha simulada.", category: failure.category, code: failure.code } });
      const filtered = state.filter(task => task.title.includes(query));
      const bundle: RoadmapBundle = { roadmap, phases: [{ id: 1, name: "Planejamento", color: "#c5a059", sortOrder: 0 }], assignees: [{ id: 2, name: "Pessoa de teste" }], metrics: { progress: 0, inProgress: 0, overdue: 0, blocked: 0, nextMilestone: null }, tasks: filtered };
      await route.fulfill({ json: bundle }); settled.push(query); return;
    }
    if (/\/tasks\/\d+\/comments$/.test(path)) return route.fulfill({ json: { comments: [] } });
    const taskMatch = path.match(/\/tasks\/(\d+)$/);
    if (taskMatch && request.method() === "PATCH") {
      const task = state.find(item => item.id === Number(taskMatch[1]))!;
      Object.assign(task, request.postDataJSON()); return route.fulfill({ json: { task } });
    }
    expect(request.method(), `Unexpected mutation: ${path}`).toBe("GET");
    return route.fulfill({ json: { ok: true, notifications: [], unreadCount: 0, jobs: [], enabled: false } });
  });
  await page.goto("/projects");
  await page.locator(".mm-sidebar-item").filter({ hasText: "Roadmap" }).click();
  await expect(shell(page).getByRole("heading", { name: "Roadmap", exact: true })).toBeVisible();
  return { reads, settled, errors };
}

async function stableNodes(page: Page) {
  return shell(page).locator(".roadmap-header, .roadmap-tools, .roadmap-search input, .roadmap-metrics, .roadmap-content-header, .roadmap-scroll, .roadmap-gantt-head, .roadmap-list thead, .roadmap-pagination").elementHandles();
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1100 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`fast data does not wait for visual onset and pending controls retain identity on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const index = gate(), detail = gate();
    const fixture = await setup(page, { index: () => index.promise, bundle: () => detail.promise });
    try {
      await expect(region(page)).toHaveAttribute("aria-busy", "true");
      const stable = await stableNodes(page);
      await expect(search(page)).toBeEnabled();
      await expect(shell(page).getByRole("combobox", { name: "Status", exact: true })).toBeEnabled();
      await expect(shell(page).getByRole("combobox", { name: "Fase", exact: true })).toBeDisabled();
      await expect(shell(page).getByRole("combobox", { name: "Responsável", exact: true })).toBeDisabled();
      await search(page).fill("Entrega");
      expect(fixture.reads, "The bundle really depends on the roadmap index").toEqual([]);
      // A deliberately long visual threshold must never hold ready content back.
      await page.addStyleTag({ content: ":root { --mm-skeleton-activation-delay: 60000ms; }" });
      const shimmer = shell(page).locator(".mm-skeleton").first();
      expect(parseFloat(await shimmer.evaluate(node => getComputedStyle(node, "::after").animationDelay))).toBeGreaterThanOrEqual(60);
      index.release();
      await expect.poll(() => fixture.reads).toEqual(["Entrega"]);
      await expect(search(page)).toBeFocused();
      await expect(status(page)).toHaveText("Carregando roadmap.");
      await expect(shell(page)).not.toContainText("Exibindo 0/0");
      detail.release();
      await expect(status(page)).toHaveText("Exibindo 10/26.", { timeout: 1500 });
      await expect(shell(page).locator(".mm-skeleton")).toHaveCount(0);
      await expect(search(page)).toHaveValue("Entrega");
      await expect(search(page)).toBeFocused();
      await expect(shell(page).getByRole("combobox", { name: "Fase", exact: true })).toBeEnabled();
      for (const node of stable) expect(await node.evaluate(element => element.isConnected)).toBe(true);
      expect(fixture.errors).toEqual([]);
    } finally { index.release(); detail.release(); }
  });
}

test("slow filters keep real content, input selection and nodes while newer results win", async ({ page }, testInfo) => {
  const delayed = gate(); let oldReturned = false;
  const fixture = await setup(page, { bundle: async query => { if (query === "Entrega 01") { await delayed.promise; oldReturned = true; } } });
  await expect(status(page)).toHaveText("Exibindo 10/26.");
  const stable = await stableNodes(page);
  await search(page).fill("Entrega 01");
  try {
    await expect.poll(() => fixture.reads.includes("Entrega 01")).toBe(true);
    await expect(region(page)).toHaveAttribute("aria-busy", "true");
    await expect(status(page)).toHaveText("Atualizando tarefas.");
    await expect(shell(page).locator(".mm-skeleton")).toHaveCount(0);
    await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(10);
    await search(page).evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await page.screenshot({ path: testInfo.outputPath("roadmap-progressive-filter-refresh.png"), fullPage: true });
    expect(await search(page).evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await search(page).fill("Entrega 02");
    await expect(status(page)).toHaveText("Exibindo 1/1.");
    delayed.release(); await expect.poll(() => oldReturned).toBe(true);
    await expect(shell(page).locator(".roadmap-gantt-row")).toContainText("Entrega 02");
    await expect(search(page)).toHaveValue("Entrega 02");
    await expect(search(page)).toBeFocused();
    await expect(region(page)).toHaveAttribute("aria-busy", "false");
    for (const node of stable) expect(await node.evaluate(element => element.isConnected)).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally { delayed.release(); }
});

test("same-query refresh preserves loaded cache, focused input and internal scroll through completion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const delayed = gate();
  const fixture = await setup(page, { bundle: async (_query, read) => { if (read > 1) await delayed.promise; } });
  await expect(status(page)).toHaveText("Exibindo 10/26.");
  const stable = await stableNodes(page);
  await shell(page).locator(".roadmap-gantt-row").first().click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Título", { exact: true }).fill("Entrega revisada");
  await drawer.getByRole("button", { name: "Salvar tarefa", exact: true }).click();
  try {
    await expect(drawer).toHaveCount(0);
    await expect(status(page)).toHaveText("Atualizando tarefas.");
    await search(page).focus();
    // Focus is outside the scroller, so restoring it must not move internal offsets.
    const offset = await region(page).evaluate(node => { node.scrollTop = 110; node.scrollLeft = 90; return [node.scrollTop, node.scrollLeft]; });
    expect(offset[0]).toBeGreaterThan(0);
    await expect(shell(page).locator(".mm-skeleton")).toHaveCount(0);
    await expect(shell(page).locator(".roadmap-gantt-row").first()).toContainText("Entrega 01");
    await page.screenshot({ path: testInfo.outputPath("roadmap-progressive-same-query-refresh.png"), fullPage: true });
    delayed.release();
    await expect(status(page)).toHaveText("Exibindo 10/26.");
    await expect(shell(page).locator(".roadmap-gantt-row").first()).toContainText("Entrega revisada");
    await expect(search(page)).toBeFocused();
    expect(await region(page).evaluate(node => [node.scrollTop, node.scrollLeft])).toEqual(offset);
    for (const node of stable) expect(await node.evaluate(element => element.isConnected)).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally { delayed.release(); }
});

test("prolonged loading announces once outside busy data and stops when the response arrives", async ({ page }) => {
  const detail = gate();
  await setup(page, { bundle: () => detail.promise });
  try {
    await expect(status(page)).toHaveText("Carregando roadmap.");
    await expect(shell(page).getByRole("status")).toHaveCount(1);
    expect(await status(page).evaluate(node => node.closest('[aria-busy="true"]') === null)).toBe(true);
    await expect(status(page)).toHaveText("O roadmap continua carregando. Aguarde mais um pouco.", { timeout: 12_000 });
    await expect(shell(page).getByRole("status")).toHaveCount(1);
    await expect(region(page)).toHaveAttribute("aria-busy", "true");
    detail.release();
    await expect(status(page)).toHaveText("Exibindo 10/26.");
    await expect(region(page)).toHaveAttribute("aria-busy", "false");
    await expect(shell(page).locator(".mm-skeleton, .is-prolonged")).toHaveCount(0);
  } finally { detail.release(); }
});

for (const deniedStatus of [401, 403]) {
  test(`denied ${deniedStatus} refresh clears prior data and a cancelled late success cannot restore it`, async ({ page }) => {
    const older = gate(); let deny = true;
    const fixture = await setup(page, { bundle: async query => {
      if (query === "Entrega 01") await older.promise;
      if (query === "Entrega 02" && deny) return { status: deniedStatus, category: deniedStatus === 401 ? "AUTH" : "PERMISSION", code: deniedStatus === 401 ? "AUTH_SESSION_EXPIRED" : "PERMISSION_DENIED" };
    } });
    await expect(status(page)).toHaveText("Exibindo 10/26.");
    await search(page).fill("Entrega 01");
    try {
      await expect.poll(() => fixture.reads.includes("Entrega 01")).toBe(true);
      await search(page).fill("Entrega 02");
      await expect(shell(page).getByRole("alert")).toBeVisible();
      await expect(region(page)).toHaveAttribute("aria-busy", "false");
      await expect(shell(page).locator(".mm-skeleton, .roadmap-gantt-row")).toHaveCount(0);
      await expect(shell(page).getByRole("combobox", { name: "Roadmap ativo" })).toHaveCount(0);
      await expect(shell(page)).not.toContainText("Pessoa de teste");
      await expect(shell(page).getByRole("combobox", { name: "Fase", exact: true })).toBeDisabled();
      await expect(status(page)).toHaveText("Não foi possível atualizar tarefas.");
      older.release(); await expect.poll(() => fixture.settled.includes("Entrega 01")).toBe(true);
      await expect(shell(page).locator(".mm-skeleton, .roadmap-gantt-row")).toHaveCount(0);
      await expect(shell(page).getByRole("alert")).toBeVisible();
      expect(fixture.reads).toEqual(["", "Entrega 01", "Entrega 02"]);
      deny = false;
      await shell(page).getByRole("button", { name: "Tentar novamente", exact: true }).click();
      await expect(status(page)).toHaveText("Exibindo 1/1.");
      await expect(shell(page).locator(".roadmap-gantt-row")).toContainText("Entrega 02");
      await expect(shell(page).getByRole("alert")).toHaveCount(0);
      expect(fixture.errors).toEqual([]);
    } finally { older.release(); }
  });
}

test("transient refresh failure preserves valid same-scope content and still exposes retry", async ({ page }) => {
  let fail = true;
  const fixture = await setup(page, { bundle: async (_query, read) => {
    if (read > 1 && fail) return { status: 503, category: "INFRASTRUCTURE", code: "INFRASTRUCTURE_NETWORK_FAILURE" };
  } });
  await expect(status(page)).toHaveText("Exibindo 10/26.");
  await search(page).fill("Entrega 02");
  await expect(shell(page).getByRole("alert")).toBeVisible();
  await expect(region(page)).toHaveAttribute("aria-busy", "false");
  await expect(shell(page).locator(".mm-skeleton")).toHaveCount(0);
  await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(10);
  await expect(shell(page).getByRole("combobox", { name: "Roadmap ativo" })).toHaveValue("1");
  await expect(shell(page).getByRole("combobox", { name: "Fase", exact: true })).toBeEnabled();
  await expect(status(page)).toHaveText("Não foi possível atualizar tarefas.");
  await expect(search(page)).toHaveValue("Entrega 02");
  fail = false;
  await shell(page).getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(status(page)).toHaveText("Exibindo 1/1.");
  await expect(shell(page).locator(".roadmap-gantt-row")).toContainText("Entrega 02");
  await expect(shell(page).getByRole("alert")).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});
