import { expect, test, type Page } from "@playwright/test";

// The actual compiled /projects route. Every API is intercepted locally; no
// production account, data mutation or substitute HTML component is exercised.
async function openCentral(page: Page) {
  const errors: string[] = [];
  const writes: string[] = [];
  const queries: URLSearchParams[] = [];
  const tickets = [
    { id: 1, code: "CH-0001", subject: "Revisar o mapa", status: "in_progress", priority: "high", assignedTo: { id: 2, name: "Ana Souza" } },
    { id: 2, code: "CH-0002", subject: "Atualizar o título", status: "new", priority: "low", assignedTo: null },
  ].map(ticket => ({ ...ticket, organizationId: 1, description: "Atendimento de demonstração.", category: "map", dueAt: null,
    createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-02T12:00:00.000Z", createdBy: { id: 1, name: "Operador de demonstração" },
    attachmentsCount: 0, version: 1, etag: `"ticket-${ticket.id}-v1"`, visibility: "organization" }));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.clock.setFixedTime(new Date("2026-10-04T12:00:00.000Z"));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 403, json: { ok: false } });
    }
    if (path === "/api/session") return route.fulfill({ json: {
      authenticated: true,
      user: { id: 1, name: "Operador de demonstração", email: "qa@example.test", role: "super_admin", activeOrganizationId: 1, permissions: [], deniedPermissions: [] },
      projects: [], organizations: [{ id: 1, name: "Organização de demonstração", slug: "demo", active: true }],
      activeOrganization: { id: 1, name: "Organização de demonstração", slug: "demo", active: true },
    } });
    if (path === "/api/organizations/1/tickets") {
      const params = new URL(request.url()).searchParams;
      queries.push(params);
      const visible = tickets.filter(ticket =>
        (!params.get("status") || ticket.status === params.get("status")) &&
        (!params.get("priority") || ticket.priority === params.get("priority")) &&
        (!params.get("assigneeId") || String(ticket.assignedTo?.id) === params.get("assigneeId")));
      return route.fulfill({ json: {
      ok: true, tickets: visible, assignees: [{ id: 2, name: "Ana Souza", email: "ana@example.test" }],
      facets: { byStatus: { new: visible.filter(ticket => ticket.status === "new").length, open: 0, in_progress: visible.filter(ticket => ticket.status === "in_progress").length, in_review: 0, closed: 0 }, overdue: 0 },
      pagination: { page: 1, limit: 10, total: visible.length, totalPages: 1, hasMore: false, snapshot: null, snapshotAt: null, loaded: visible.length },
      attachmentLimits: { maxFiles: 5, maxFileBytes: 83886080, maxTicketBytes: 157286400, chunkBytes: 8388608 },
      range: { from: null, to: null }, flowEnabled: false, lifecycleEnabled: false, triageEnabled: false, queuePolicies: [],
      } });
    }
    return route.fulfill({ json: { ok: true, enabled: false, projects: [], files: [], folders: [], tickets: [], users: [], items: [], jobs: [], unread: 0, nextCursor: null, facets: { types: [], projects: [], folderCounts: [] }, pagination: { total: 0, hasMore: false } } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  await page.locator(".mm-sidebar-item").filter({ hasText: "Central de Chamados" }).click();
  await expect(page.getByRole("heading", { name: "Central de Chamados", exact: true, level: 1 })).toBeVisible();
  return { errors, writes, queries };
}

const control = (page: Page) => page.getByRole("combobox", { name: "Visualização dos chamados", exact: true });
const menu = (page: Page) => page.getByRole("listbox");
async function chooseView(page: Page, label: string) {
  await control(page).click();
  await menu(page).getByRole("option", { name: label, exact: true }).click();
  await expect(control(page)).toHaveValue(({ Lista: "list", Kanban: "kanban", Calendário: "calendar" } as Record<string, string>)[label]);
  await expect(control(page)).toHaveAttribute("aria-expanded", "false");
}

test("view dropdown uses dark Maõno options, selected gold and the same centered chevron", async ({ page }, testInfo) => {
  const { errors, writes } = await openCentral(page);
  const trigger = control(page);
  await expect(trigger).toHaveValue("list");
  const icon = page.locator(".ticket-view-control .maono-select__chevron");
  const closed = await icon.evaluate(element => ({ path: element.innerHTML, rect: element.getBoundingClientRect().toJSON(), transform: getComputedStyle(element).transform }));
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu(page).getByRole("option")).toHaveText(["Lista", "Kanban", "Calendário"]);
  await expect(menu(page).getByRole("option", { name: "Lista", exact: true })).toHaveAttribute("aria-selected", "true");
  const paint = await menu(page).evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, border: style.borderColor };
  });
  expect(paint.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(paint.background).not.toBe("rgb(255, 255, 255)");
  const selectedColor = await menu(page).getByRole("option", { name: "Lista", exact: true }).evaluate(element => getComputedStyle(element).color);
  expect(selectedColor).toBe("rgb(243, 213, 138)");
  await expect.poll(async () => icon.evaluate(element => getComputedStyle(element).transform)).not.toBe(closed.transform);
  const opened = await icon.evaluate(element => ({ path: element.innerHTML, rect: element.getBoundingClientRect().toJSON() }));
  expect(opened.path).toBe(closed.path);
  expect(Math.abs(opened.rect.x + opened.rect.width / 2 - closed.rect.x - closed.rect.width / 2)).toBeLessThan(1);
  expect(Math.abs(opened.rect.y + opened.rect.height / 2 - closed.rect.y - closed.rect.height / 2)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("view-dropdown-desktop.png") });
  await page.keyboard.press("Escape");
  await chooseView(page, "Kanban");
  await expect(page.getByRole("region", { name: "Kanban de chamados", exact: true })).toBeVisible();
  await chooseView(page, "Calendário");
  await expect(page.getByRole("region", { name: "Calendário de chamados", exact: true })).toBeVisible();
  await chooseView(page, "Lista");
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test("view dropdown keeps keyboard selection, cancellation and normal focus order", async ({ page }) => {
  const { errors, writes } = await openCentral(page);
  const trigger = control(page);
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveValue("list");
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveValue("calendar");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(trigger).toHaveValue("kanban");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveValue("list");
  await page.keyboard.press("Space");
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  await expect(trigger).toHaveValue("list");
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo chamado", exact: true })).toBeFocused();
  await trigger.focus();
  await page.keyboard.press("k");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveValue("kanban");
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test("all Central filter popups share the theme and retain their API values", async ({ page }) => {
  const { errors, writes, queries } = await openCentral(page);
  const filters = page.getByRole("region", { name: "Filtros de chamados", exact: true });
  await expect(page.locator(".ticket-list-table tbody tr")).toHaveCount(2);
  for (const [name, label, value, param] of [
    ["Situação", "Em andamento", "in_progress", "status"],
    ["Prioridade", "Alta", "high", "priority"],
    ["Atendente", "Ana Souza", "2", "assigneeId"],
    ["Ordenar por", "Maior prioridade", "priority_desc", "sort"],
  ]) {
    const field = filters.getByRole("combobox", { name, exact: true });
    await field.click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page)).toHaveClass(/maono-select-menu/);
    await expect(field).toHaveAttribute("aria-expanded", "true");
    await menu(page).getByRole("option", { name: label, exact: true }).click();
    await expect(field).toHaveValue(value);
    await expect(field).toBeFocused();
    await expect.poll(() => queries.at(-1)?.get(param)).toBe(value);
    await expect(page.locator(".ticket-list-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".ticket-list-table .ticket-code")).toHaveText("CH-0001");
  }
  await filters.getByRole("button", { name: "Limpar filtros", exact: true }).click();
  for (const name of ["Situação", "Prioridade", "Atendente"]) await expect(filters.getByRole("combobox", { name, exact: true })).toHaveValue("");
  await expect(filters.getByRole("combobox", { name: "Ordenar por", exact: true })).toHaveValue("priority_desc");
  await expect(page.locator(".ticket-list-table tbody tr")).toHaveCount(2);
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test.describe("touch input", () => {
  test.use({ hasTouch: true });
  test("a tap opens the same DOM options and selecting keeps normal focus", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { errors, writes } = await openCentral(page);
    await control(page).tap();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("option")).toHaveText(["Lista", "Kanban", "Calendário"]);
    await menu(page).getByRole("option", { name: "Calendário", exact: true }).tap();
    await expect(control(page)).toHaveValue("calendar");
    await expect(menu(page)).toHaveCount(0);
    await expect(control(page)).toBeFocused();
    await control(page).tap();
    await page.getByRole("heading", { name: "Central de Chamados", exact: true }).tap();
    await expect(menu(page)).toHaveCount(0);
    expect(errors).toEqual([]); expect(writes).toEqual([]);
  });
});

test("view dropdown dismisses outside and on repeated clicks without changing the view", async ({ page }) => {
  const { errors, writes } = await openCentral(page);
  await control(page).click();
  await page.getByRole("heading", { name: "Central de Chamados", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(control(page)).toHaveValue("list");
  await control(page).click();
  await control(page).click();
  await expect(menu(page)).toHaveCount(0);
  await control(page).click();
  await page.getByRole("searchbox", { name: "Buscar", exact: true }).focus();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Buscar", exact: true })).toBeFocused();
  await chooseView(page, "Lista");
  await expect(control(page)).toBeFocused();
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test("view dropdown fits narrow layouts, remains clickable and respects reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { errors, writes } = await openCentral(page);
  await control(page).click();
  const bounds = await menu(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  // The platform's reduced-motion rule caps all transitions at one millisecond.
  const duration = await page.locator(".ticket-view-control .maono-select__chevron").evaluate(element => getComputedStyle(element).transitionDuration);
  expect(Math.max(...duration.split(",").map(value => Number.parseFloat(value)))).toBeLessThanOrEqual(0.001);
  await page.screenshot({ path: testInfo.outputPath("view-dropdown-mobile.png") });
  await menu(page).getByRole("option", { name: "Kanban", exact: true }).click();
  await expect(control(page)).toHaveValue("kanban");
  await expect(menu(page)).toHaveCount(0);
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});
