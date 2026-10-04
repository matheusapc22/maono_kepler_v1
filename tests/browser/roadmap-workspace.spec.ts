import { expect, test, type Page } from "@playwright/test";
import type { RoadmapBundle, RoadmapSummary, RoadmapTask } from "../../src/pages/Projects/components/roadmap-types";

// Actual compiled React route with intercepted synthetic data, never production acceptance.
const NOW = "2026-10-04T12:00:00.000Z";
const roadmap: RoadmapSummary = { id: 1, organizationId: 1, name: "Entregas do trimestre", startDate: "2026-09-01", endDate: "2026-12-31", calendarPolicy: "business_days", timezone: "America/Sao_Paulo", status: "active", version: 1, createdAt: NOW, updatedAt: NOW };
const tasks: RoadmapTask[] = Array.from({ length: 36 }, (_, index) => ({
  id: index + 1, roadmapId: 1, phaseId: index % 2 + 1, phaseName: index % 2 ? "Validação" : "Planejamento", phaseColor: "#c5a059",
  title: `Entrega ${String(index + 1).padStart(2, "0")} · revisão territorial`, description: "Tarefa de demonstração para revisão visual.",
  startDate: index === 35 ? "2026-11-15" : "2026-09-10", endDate: "2026-11-15", durationDays: index === 35 ? 1 : 67, status: index !== 35 && index % 2 ? "in_progress" : "planned", progress: index !== 35 && index % 2 ? 45 : 0,
  priority: "normal", assigneeId: index % 2 + 2, assigneeName: index % 2 ? "Bruno Lima" : "Ana Souza", isMilestone: index === 35,
  sortOrder: index, version: 1, createdAt: NOW, updatedAt: NOW,
}));
const errors = new WeakMap<Page, string[]>();
const writes = new WeakMap<Page, string[]>();
type FixtureOptions = { dataset?: RoadmapTask[]; emptyIndex?: boolean; fail?: boolean; delay?: Promise<void>; role?: string; multipleRoadmaps?: boolean; beforeBundle?: (params: URLSearchParams) => Promise<void> };
async function setup(page: Page, options: FixtureOptions = {}) {
  const state = structuredClone(options.dataset ?? tasks);
  const requests: { path: string; method: string; params: URLSearchParams; body: Record<string, unknown> | null }[] = [];
  let fail = options.fail, organizationId = 1;
  const organizations = [{ id: 1, name: "Organização de demonstração", slug: "demo", active: true }, { id: 2, name: "Organização secundária", slug: "second", active: true }];
  const session = () => ({ authenticated: true, user: { id: 1, name: "Operador de demonstração", email: "qa@example.test", role: options.role ?? "super_admin", activeOrganizationId: organizationId, organizationId, permissions: options.role === "viewer" ? ["roadmap.view", "roadmap.comment.create"] : [] }, projects: [], organizations, activeOrganization: organizations.find(item => item.id === organizationId) });
  errors.set(page, []); writes.set(page, []);
  page.on("pageerror", error => errors.get(page)?.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("503")) errors.get(page)?.push(message.text()); });
  await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) as Record<string, unknown> : null;
    requests.push({ path, method, params: url.searchParams, body });
    if (path === "/api/session") return route.fulfill({ json: session() });
    if (path === "/api/session/active-organization" && method === "PUT") { organizationId = Number(body?.organizationId); return route.fulfill({ json: { ok: true, ...session() } }); }
    if (["/api/projects", "/api/projects/recent", "/api/projects/favorites"].includes(path)) return route.fulfill({ json: { ok: true, projects: [] } });
    const roadmapsMatch = path.match(/^\/api\/organizations\/(\d+)\/roadmaps(?:\/(\d+))?$/);
    if (roadmapsMatch) {
      const requestedOrganization = Number(roadmapsMatch[1]), roadmapId = Number(roadmapsMatch[2] || 1);
      const selectedRoadmap = { ...roadmap, organizationId: requestedOrganization, id: roadmapId, name: roadmapId === 2 ? "Outro planejamento" : roadmap.name };
      if (!roadmapsMatch[2]) return route.fulfill({ json: { roadmaps: options.emptyIndex ? [] : [selectedRoadmap, ...(options.multipleRoadmaps ? [{ ...selectedRoadmap, id: 2, name: "Outro planejamento" }] : [])] } });
      await options.delay; await options.beforeBundle?.(url.searchParams);
      if (fail) return route.fulfill({ status: 503, json: { ok: false, error: "Não foi possível carregar o roadmap.", code: "SERVICE_UNAVAILABLE" } });
      const params = url.searchParams;
      const source = requestedOrganization === 2 ? state.slice(0, 4) : roadmapId === 2 ? state.slice(0, 3) : state;
      const filtered = source.filter(task => (!params.get("search") || task.title.toLowerCase().includes(params.get("search")!.toLowerCase())) && (!params.get("status") || task.status === params.get("status")) && (!params.get("phaseId") || String(task.phaseId) === params.get("phaseId")) && (!params.get("assigneeId") || String(task.assigneeId) === params.get("assigneeId")));
      const bundle: RoadmapBundle = { roadmap: selectedRoadmap, phases: [{ id: 1, name: "Planejamento", color: "#c5a059", sortOrder: 0 }, { id: 2, name: "Validação", color: "#c5a059", sortOrder: 1 }], assignees: [{ id: 2, name: "Ana Souza" }, { id: 3, name: "Bruno Lima" }], metrics: { progress: filtered.length ? Math.round(filtered.reduce((sum, task) => sum + task.progress, 0) / filtered.length) : 0, inProgress: filtered.filter(task => task.status === "in_progress").length, overdue: 0, blocked: 0, nextMilestone: filtered.find(task => task.isMilestone) ?? null }, tasks: filtered.map(task => ({ ...task, roadmapId })) };
      return route.fulfill({ json: bundle });
    }
    if (/\/roadmaps\/1\/tasks\/\d+\/comments$/.test(path)) {
      return route.fulfill({ json: { comments: method === "POST" ? [{ id: 1, content: body?.content, authorId: 1, authorName: "Operador de demonstração", createdAt: NOW }] : [] } });
    }
    const taskMatch = path.match(/\/roadmaps\/1\/tasks\/(\d+)$/);
    if (taskMatch && method === "PATCH") {
      const task = state.find(item => item.id === Number(taskMatch[1]))!;
      Object.assign(task, body);
      return route.fulfill({ json: { task } });
    }
    if (method !== "GET") { writes.get(page)?.push(`${method} ${path}`); return route.fulfill({ status: 400, json: { ok: false } }); }
    return route.fulfill({ json: { ok: true, notifications: [], unreadCount: 0, jobs: [], enabled: false } });
  });
  await page.goto("/projects");
  await page.locator(".mm-sidebar-item").filter({ hasText: "Roadmap" }).click();
  await expect(page.getByRole("heading", { name: "Roadmap", exact: true, level: 1 })).toBeVisible();
  return { requests, state, recover: () => { fail = false; } };
}
const shell = (page: Page) => page.locator(".roadmap-workspace");
const region = (page: Page) => shell(page).locator(".roadmap-scroll");
const pagination = (page: Page) => shell(page).locator(".mm-docs-pagination");
async function choose(page: Page, name: string, option: string) {
  await shell(page).getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox", { name: `Opções: ${name}`, exact: true }).getByRole("option", { name: option, exact: true }).click();
}
async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
async function expectFullWidthFilters(page: Page) {
  const gap = await shell(page).locator(".roadmap-tools").evaluate(element => {
    const style = getComputedStyle(element);
    const inner = element.querySelector(".roadmap-filters")!.getBoundingClientRect();
    const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.abs(available - inner.width);
  });
  expect(gap, "Filters fill the available panel width").toBeLessThanOrEqual(1);
}
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); expect(writes.get(page) ?? []).toEqual([]); });

test("minimal header, Gantt and shared quantity footer remain stable with many tasks", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await setup(page);
  await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(10);
  await expectFullWidthFilters(page);
  await expect(shell(page).locator(".roadmap-header p, .roadmap-header small")).toHaveCount(0);
  await expect(shell(page).getByRole("navigation").getByRole("link", { name: "Início" })).toHaveAttribute("href", "/projects");
  expect(await shell(page).locator(".roadmap-header").evaluate(el => getComputedStyle(el).backgroundImage)).toBe("none");
  const footer = shell(page).locator(".roadmap-pagination");
  await expect(footer.getByRole("status")).toHaveText("Exibindo 10/36.");
  await expect(footer.getByRole("combobox", { name: "Itens por página" })).toHaveValue("10");
  await expect(footer.getByRole("button", { name: "Página anterior" })).toBeDisabled();
  await expect(footer.getByRole("button", { name: "Próxima página" })).toBeEnabled();
  await expect(footer.locator("time")).toHaveCount(0);
  await footer.scrollIntoViewIfNeeded();
  const before = await footer.boundingBox();
  expect(await region(page).evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await region(page).evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
  await expect(shell(page).locator(".roadmap-gantt-row").last()).toBeVisible();
  expect((await footer.boundingBox())?.y).toBe(before?.y);
  expect(await overflow(page)).toBe(false);
  await region(page).evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await shell(page).getByRole("heading", { name: "Roadmap", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("roadmap-desktop.png"), fullPage: true });
  const labels = await shell(page).locator(".roadmap-gantt-head > div > span").evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { text: element.textContent, left: rect.left, right: rect.right, width: rect.width }; }));
  await testInfo.attach("timeline-label-geometry", { body: JSON.stringify({ labels, overlaps: labels.slice(1).map((label, index) => ({ left: labels[index].text, right: label.text, pixels: Math.max(0, labels[index].right - label.left) })).filter(item => item.pixels > 0) }, null, 2), contentType: "application/json" });
  for (let index = 1; index < labels.length; index += 1) expect(labels[index].left, `Timeline labels ${labels[index - 1].text} / ${labels[index].text} do not overlap`).toBeGreaterThanOrEqual(labels[index - 1].right);
  await choose(page, "Escala do cronograma", "Mês");
  await expect(shell(page).getByRole("combobox", { name: "Escala do cronograma" })).toHaveValue("month");
  await shell(page).getByRole("navigation").getByRole("link", { name: "Início" }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
});

test("all existing filters preserve requests, task order and clearing in the list", async ({ page }) => {
  const { requests } = await setup(page);
  await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(10);
  await shell(page).getByRole("button", { name: "Lista", exact: true }).click();
  await expect(shell(page).getByRole("combobox", { name: "Escala do cronograma" })).toBeDisabled();
  await choose(page, "Status", "Em andamento");
  await choose(page, "Fase", "Validação");
  await choose(page, "Responsável", "Bruno Lima");
  await shell(page).getByRole("searchbox", { name: "Buscar tarefa" }).fill("Entrega 02");
  await expect(shell(page).locator(".roadmap-list tbody tr")).toHaveCount(1);
  await expect(shell(page).locator(".roadmap-list tbody tr").first()).toContainText("Entrega 02");
  const params = requests.filter(request => request.path.endsWith("/roadmaps/1")).at(-1)!.params;
  for (const [key, value] of [["status", "in_progress"], ["phaseId", "2"], ["assigneeId", "3"], ["search", "Entrega 02"]]) expect(params.get(key)).toBe(value);
  await shell(page).getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await expect(shell(page).locator(".roadmap-list tbody tr")).toHaveCount(10);
  await expect(shell(page).locator(".roadmap-list tbody tr").first()).toContainText("Entrega 01");
  await expect(shell(page).getByRole("button", { name: "Limpar filtros", exact: true })).toBeDisabled();
});

test("keyboard select and task details preserve editing and comments", async ({ page }, testInfo) => {
  const { requests } = await setup(page, { dataset: tasks.slice(0, 2) });
  const status = shell(page).getByRole("combobox", { name: "Status", exact: true });
  await status.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Opções: Status", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Escape");
  await expect(status).toHaveValue(""); await expect(status).toBeFocused();
  await shell(page).locator(".roadmap-gantt-row").first().focus(); await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog"); await expect(drawer).toBeVisible();
  expect(await drawer.evaluate(element => getComputedStyle(element).colorScheme)).toBe("dark");
  for (const type of ["range", "checkbox"]) expect(await drawer.locator(`input[type="${type}"]`).evaluate(element => getComputedStyle(element).accentColor)).toBe("rgb(242, 199, 102)");
  await page.screenshot({ path: testInfo.outputPath("roadmap-task-desktop.png"), fullPage: false });
  await drawer.getByLabel("Título", { exact: true }).fill("Entrega revisada");
  await drawer.getByRole("button", { name: "Salvar tarefa", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(shell(page).locator(".roadmap-gantt-row").first()).toContainText("Entrega revisada");
  expect(requests.some(item => item.method === "PATCH" && item.path.endsWith("/tasks/1") && item.body?.title === "Entrega revisada")).toBe(true);
  await shell(page).locator(".roadmap-gantt-row").first().click();
  await drawer.getByPlaceholder("Adicione um comentário...").fill("Revisão conferida.");
  await drawer.getByRole("button", { name: "Comentar", exact: true }).click();
  await expect(drawer.locator(".roadmap-comments")).toContainText("Revisão conferida.");
  await drawer.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(drawer).toHaveCount(0);
});

test("mobile keeps both real views scrollable without clipping the footer", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page);
  await expect(shell(page).locator(".roadmap-list tbody tr")).toHaveCount(10);
  await expectFullWidthFilters(page);
  expect(await overflow(page)).toBe(false);
  await shell(page).getByRole("button", { name: "Gantt", exact: true }).click();
  await expect(shell(page).getByRole("table", { name: "Cronograma Gantt" })).toBeVisible();
  expect(await region(page).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await shell(page).locator(".roadmap-pagination").scrollIntoViewIfNeeded();
  const before = await shell(page).locator(".roadmap-pagination").boundingBox();
  await region(page).evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
  expect((await shell(page).locator(".roadmap-pagination").boundingBox())?.y).toBe(before?.y);
  expect(await overflow(page)).toBe(false);
  await shell(page).getByRole("button", { name: "Lista", exact: true }).click();
  await expect(region(page)).toHaveJSProperty("scrollLeft", 0);
  await expect(region(page)).toHaveJSProperty("scrollTop", 0);
  await page.screenshot({ path: testInfo.outputPath("roadmap-mobile-footer.png"), fullPage: true });
  await shell(page).getByRole("heading", { name: "Roadmap", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("roadmap-mobile.png"), fullPage: true });
  await shell(page).locator(".roadmap-primary-action").click();
  const drawer = page.getByRole("dialog"); await expect(drawer).toBeVisible();
  await drawer.getByRole("combobox", { name: "Fase", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Opções: Fase", exact: true })).toBeVisible();
  expect(await overflow(page)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("roadmap-task-mobile.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await drawer.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(drawer).toHaveCount(0);
});

test("few tasks and no matches retain real zero-count pagination", async ({ page }, testInfo) => {
  await setup(page, { dataset: tasks.slice(0, 1) });
  await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(1);
  expect(await region(page).evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(280);
  await shell(page).getByRole("searchbox", { name: "Buscar tarefa" }).fill("inexistente");
  await expect(shell(page).getByText("Nenhuma tarefa no período", { exact: true })).toBeVisible();
  await expect(pagination(page).getByRole("status")).toHaveText("Exibindo 0/0.");
  await expect(pagination(page).getByRole("button", { name: "Página anterior" })).toBeDisabled();
  await expect(pagination(page).getByRole("button", { name: "Próxima página" })).toBeDisabled();
  await expect(pagination(page).locator(".mm-docs-page-number")).toHaveText("1");
  await page.screenshot({ path: testInfo.outputPath("roadmap-empty.png"), fullPage: true });
});

test("initial loading and service error recover in the same minimal workspace", async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  const fixture = await setup(page, { delay, fail: true });
  await expect(shell(page).getByRole("status", { name: "Carregando roadmap" })).toBeVisible();
  release(); await expect(shell(page).getByRole("alert")).toBeVisible();
  await expect(shell(page).getByText("Nenhum roadmap ativo", { exact: true })).toHaveCount(0);
  fixture.recover(); await shell(page).getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(10);
  await expect(shell(page).getByRole("alert")).toHaveCount(0);
});

test("empty roadmap collection and read-only access preserve permission controls", async ({ page }) => {
  await setup(page, { emptyIndex: true, role: "viewer" });
  await expect(shell(page).getByText("Nenhum roadmap ativo", { exact: true })).toBeVisible();
  await expect(shell(page).getByRole("button", { name: "Criar roadmap", exact: true })).toHaveCount(0);
  await expect(shell(page).locator(".roadmap-pagination")).toHaveCount(0);
});

test("read-only task details keep management controls disabled", async ({ page }) => {
  await setup(page, { dataset: tasks.slice(0, 1), role: "viewer" });
  await expect(shell(page).getByRole("button", { name: "Nova tarefa", exact: true })).toHaveCount(0);
  await shell(page).locator(".roadmap-gantt-row").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByLabel("Título", { exact: true })).toBeDisabled();
  await expect(drawer.getByRole("combobox", { name: "Status", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Salvar tarefa", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Arquivar", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Comentar", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Fechar", exact: true }).click();
});

async function expectPage(page: Page, visible: number, total: number, number: number) {
  await expect(pagination(page).getByRole("status")).toHaveText(`Exibindo ${visible}/${total}.`);
  await expect(pagination(page).locator(".mm-docs-page-number")).toHaveText(String(number));
}
const nextPage = (page: Page) => pagination(page).getByRole("button", { name: "Próxima página", exact: true });
const previousPage = (page: Page) => pagination(page).getByRole("button", { name: "Página anterior", exact: true });

test("real paging in both views preserves full metrics, timeline and every filtered task", async ({ page }) => {
  const fixture = await setup(page); await expectPage(page, 10, 36, 1);
  const metrics = await shell(page).locator(".roadmap-metrics").innerText();
  const timeline = await shell(page).locator(".roadmap-gantt-head > div > span").evaluateAll(elements => elements.map(element => element.getAttribute("title")));
  const reads = () => fixture.requests.filter(request => request.path === "/api/organizations/1/roadmaps/1").length;
  const initialReads = reads();
  await nextPage(page).click(); await expectPage(page, 10, 36, 2);
  await expect(shell(page).locator(".roadmap-gantt-row").first()).toContainText("Entrega 11");
  await shell(page).getByRole("button", { name: "Lista", exact: true }).click();
  await expectPage(page, 10, 36, 2);
  await expect(shell(page).locator(".roadmap-list tbody tr").first()).toContainText("Entrega 11");
  await nextPage(page).click(); await expectPage(page, 10, 36, 3);
  await nextPage(page).click(); await expectPage(page, 6, 36, 4);
  await expect(shell(page).locator(".roadmap-list tbody tr")).toHaveCount(6);
  await expect(shell(page).locator(".roadmap-list tbody tr").first()).toContainText("Entrega 31");
  await expect(nextPage(page)).toBeDisabled();
  await shell(page).getByRole("button", { name: "Gantt", exact: true }).click();
  await expectPage(page, 6, 36, 4);
  await expect(shell(page).locator(".roadmap-milestone")).toHaveCount(1);
  expect(await shell(page).locator(".roadmap-metrics").innerText()).toBe(metrics);
  expect(await shell(page).locator(".roadmap-gantt-head > div > span").evaluateAll(elements => elements.map(element => element.getAttribute("title")))).toEqual(timeline);
  await previousPage(page).focus(); await page.keyboard.press("Enter");
  await expectPage(page, 10, 36, 3); await expect(previousPage(page)).toBeFocused();
  await choose(page, "Itens por página", "25"); await expectPage(page, 25, 36, 1);
  await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(25);
  await nextPage(page).click(); await expectPage(page, 11, 36, 2);
  await choose(page, "Itens por página", "50"); await expectPage(page, 36, 36, 1);
  await expect(shell(page).locator(".roadmap-gantt-row")).toHaveCount(36);
  await expect(previousPage(page)).toBeDisabled(); await expect(nextPage(page)).toBeDisabled();
  expect(reads(), "Client pagination does not invent backend pages or truncate the loaded bundle").toBe(initialReads);
  expect(await shell(page).locator(".roadmap-metrics").innerText()).toBe(metrics);
});

test("filters reset the page and pending results never expose stale actionable totals", async ({ page }) => {
  let release!: () => void; const delayed = new Promise<void>(resolve => { release = resolve; });
  await setup(page, { beforeBundle: async params => { if (params.get("search") === "Entrega 01") await delayed; } });
  await expectPage(page, 10, 36, 1); await nextPage(page).click(); await expectPage(page, 10, 36, 2);
  await shell(page).getByRole("searchbox", { name: "Buscar tarefa" }).fill("Entrega 01");
  await expect(pagination(page).getByRole("status")).toHaveText("Atualizando tarefas.");
  await expect(nextPage(page)).toBeDisabled(); await expect(previousPage(page)).toBeDisabled();
  await expect(pagination(page).getByRole("combobox", { name: "Itens por página" })).toBeDisabled();
  release(); await expectPage(page, 1, 1, 1);
  await shell(page).getByRole("button", { name: "Limpar filtros", exact: true }).click(); await expectPage(page, 10, 36, 1);
  await nextPage(page).click(); await expectPage(page, 10, 36, 2);
  await choose(page, "Status", "Planejado"); await expectPage(page, 10, 19, 1);
  await nextPage(page).click(); await expectPage(page, 9, 19, 2);
  await shell(page).getByRole("button", { name: "Limpar filtros", exact: true }).click(); await expectPage(page, 10, 36, 1);
  await shell(page).getByRole("searchbox", { name: "Buscar tarefa" }).fill("inexistente"); await expectPage(page, 0, 0, 1);
});

test("same-query refresh clamps a shortened dataset and later growth keeps the clamped page", async ({ page }) => {
  const fixture = await setup(page); await expectPage(page, 10, 36, 1);
  for (let number = 2; number <= 4; number += 1) { await nextPage(page).click(); await expectPage(page, number === 4 ? 6 : 10, 36, number); }
  await shell(page).locator(".roadmap-gantt-row").first().click();
  const drawer = page.getByRole("dialog"); await expect(drawer).toBeVisible();
  const selected = fixture.state.find(task => task.id === 31)!;
  fixture.state.splice(0, fixture.state.length, ...fixture.state.slice(0, 10), selected);
  await drawer.getByLabel("Título", { exact: true }).fill("Entrega atualizada");
  await drawer.getByRole("button", { name: "Salvar tarefa", exact: true }).click();
  await expect(drawer).toHaveCount(0); await expectPage(page, 1, 11, 2);
  await expect(shell(page).locator(".roadmap-gantt-row").first()).toContainText("Entrega atualizada");
  await expect(nextPage(page)).toBeDisabled();
  await shell(page).locator(".roadmap-gantt-row").first().click();
  fixture.state.push(...structuredClone(tasks.slice(10, 20))); fixture.state.sort((left, right) => left.sortOrder - right.sortOrder);
  await drawer.getByRole("button", { name: "Salvar tarefa", exact: true }).click();
  await expectPage(page, 10, 21, 2);
  await expect(shell(page).locator(".roadmap-gantt-row").first()).toContainText("Entrega 11");
});

test("roadmap and organization switches restart the correct dataset at page one", async ({ page }) => {
  const fixture = await setup(page, { multipleRoadmaps: true }); await expectPage(page, 10, 36, 1);
  await nextPage(page).click(); await expectPage(page, 10, 36, 2);
  await choose(page, "Roadmap ativo", "Outro planejamento"); await expectPage(page, 3, 3, 1);
  await expect(nextPage(page)).toBeDisabled();
  await choose(page, "Roadmap ativo", "Entregas do trimestre"); await expectPage(page, 10, 36, 1);
  await nextPage(page).click(); await expectPage(page, 10, 36, 2);
  await page.getByRole("button", { name: /Trocar organização ativa/ }).click();
  await page.getByRole("option", { name: /Organização secundária/ }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  await page.locator(".mm-sidebar-item").filter({ hasText: "Roadmap" }).click();
  await expectPage(page, 4, 4, 1); await expect(nextPage(page)).toBeDisabled();
  expect(fixture.requests.some(request => request.path === "/api/organizations/2/roadmaps/1")).toBe(true);
});

test("an initially empty roadmap has zero-count shared pagination at every supported size", async ({ page }) => {
  await setup(page, { dataset: [] }); await expectPage(page, 0, 0, 1);
  for (const size of ["25", "50", "10"]) {
    await choose(page, "Itens por página", size); await expectPage(page, 0, 0, 1);
    await expect(previousPage(page)).toBeDisabled(); await expect(nextPage(page)).toBeDisabled();
  }
  await expect(shell(page).getByText("Nenhuma tarefa no período", { exact: true })).toBeVisible();
  await expect(shell(page).locator(".roadmap-pagination")).not.toContainText("Dias úteis");
  await expect(shell(page).locator(".roadmap-footer")).toHaveCount(0);
});
