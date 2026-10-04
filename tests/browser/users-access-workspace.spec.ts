import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import type { OrganizationUser } from "../../src/lib/api";
import type { AccessGovernanceCapabilities } from "../../src/components/access/OrganizationPermissionManager";
import type { ProjectMapAccessPolicy } from "../../src/components/access/project-map-access-api";

// The real compiled React route, with a complete server-authorized synthetic team.
// Pagination is intentionally client-side; these fixtures do not claim backend authorization coverage.
const NOW = "2026-10-04T12:00:00.000Z";
const organizations = [
  { id: 1, name: "Organização de demonstração", slug: "demo", active: true },
  { id: 2, name: "Organização secundária", slug: "second", active: true },
];
const people: OrganizationUser[] = Array.from({ length: 36 }, (_, index) => ({
  id: index + 1, organizationId: 1, name: `Pessoa ${String(index + 1).padStart(2, "0")} · Equipe territorial`,
  email: `pessoa${String(index + 1).padStart(2, "0")}@example.test`, role: index % 2 ? "viewer" : "editor",
  accessLevel: index % 2 ? "viewer" : "editor", active: index % 6 !== 4,
  permissions: index % 3 === 0 ? ["project.create"] : [], createdAt: NOW, updatedAt: NOW,
}));
const governance: AccessGovernanceCapabilities = {
  mode: "organization", organizationId: 1, canManageAdditionalAccesses: true, canGrant: true, canRevoke: true,
  allowedPermissions: ["project.create", "project.view"], grantPermissions: ["project.create", "project.view"],
  revokePermissions: ["project.create", "project.view"], allowedTargetLevels: ["editor", "viewer"],
  delegation: { enabled: true, expired: false, version: 1 }, reason: "delegated",
};
const gatePeople: OrganizationUser[] = [
  { ...people[0], id: "1", name: "Própria conta", accessLevel: "viewer" },
  { ...people[1], id: 2, name: "Consulta permitida" },
  { ...people[2], id: 3, name: "Colaborador permitido" },
  { ...people[3], id: 4, name: "Responsável fora do escopo", role: "owner", accessLevel: "owner" },
  { ...people[4], id: 5, name: "Pessoa suspensa", accessLevel: "viewer", active: false },
  { ...people[5], id: 6, name: "Perfil sem nível", accessLevel: "" },
  { ...people[6], id: 7, name: "Nível normalizado", accessLevel: " VIEWER " },
];
type RecordedRequest = { method: string; path: string; query: string; body: Record<string, unknown> | null; response?: { status: number; body: unknown } };
type FixtureOptions = {
  dataset?: OrganizationUser[]; role?: string; permissions?: string[]; open?: boolean;
  capabilities?: Partial<AccessGovernanceCapabilities>; failUsers?: boolean; failGovernance?: boolean; failLimits?: boolean;
  beforeUsers?: (organizationId: number, attempt: number) => Promise<void>; allowMapWrite?: boolean; allowPermissionWrite?: boolean;
};
type Diagnostics = { requests: RecordedRequest[]; errors: string[]; unexpectedWrites: string[]; unknownReads: string[] };
const diagnostics = new WeakMap<Page, Diagnostics>();
async function setup(page: Page, options: FixtureOptions = {}) {
  const state = structuredClone(options.dataset ?? people);
  const secondary = people.slice(0, 3).map(person => ({ ...person, id: Number(person.id) + 100, organizationId: 2, name: `Outra equipe ${person.id}` }));
  const data: Diagnostics = { requests: [], errors: [], unexpectedWrites: [], unknownReads: [] };
  diagnostics.set(page, data);
  let organizationId = 1, failUsers = Boolean(options.failUsers);
  const attempts = new Map<number, number>();
  const mapPolicies = new Map<string, ProjectMapAccessPolicy>();
  const session = () => ({ authenticated: true, user: {
    id: 1, name: "Operador de demonstração", email: "qa@example.test", role: options.role ?? "owner",
    permissions: options.permissions ?? ["users.view", "limits.view"], activeOrganizationId: organizationId, organizationId,
  }, projects: [], organizations, activeOrganization: organizations.find(item => item.id === organizationId) });
  page.on("pageerror", error => data.errors.push(error.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()!) as Record<string, unknown> : null;
    const recorded: RecordedRequest = { method, path, query: url.search, body };
    data.requests.push(recorded);
    if (path === "/api/session") return route.fulfill({ json: session() });
    if (path === "/api/session/active-organization" && method === "PUT") {
      organizationId = Number(body?.organizationId); return route.fulfill({ json: { ok: true, ...session() } });
    }
    const permissionMatch = path.match(/^\/api\/organizations\/(\d+)\/users\/(\d+)\/permissions$/);
    if (permissionMatch && method === "POST" && options.allowPermissionWrite) {
      const person = state.find(item => String(item.id) === permissionMatch[2]);
      if (!person || typeof body?.permission !== "string") return route.fulfill({ status: 400, json: { ok: false } });
      person.permissions = [...new Set([...(person.permissions ?? []), body.permission])];
      const json = { ok: true, grant: { organizationId: Number(permissionMatch[1]), userId: person.id, permission: body.permission } };
      recorded.response = { status: 200, body: json };
      return route.fulfill({ json });
    }
    const match = path.match(/^\/api\/organizations\/(\d+)\/(users|limits|access-governance)(?:\/(\d+)\/map-access)?$/);
    if (match) {
      const requestedOrganization = Number(match[1]), resource = match[2], targetId = match[3];
      const source = requestedOrganization === 2 ? secondary : state;
      if (resource === "users" && targetId && (method === "GET" || options.allowMapWrite && method === "PATCH")) {
        const person = source.find(item => String(item.id) === targetId)!;
        const key = `${requestedOrganization}:${targetId}`;
        let policy = mapPolicies.get(key);
        if (!policy) {
          policy = { target: { ...person, organizationAccessLevel: person.accessLevel },
            projectRoutes: [{ projectId: 100, projectName: "Projeto de demonstração", projectSlug: "demo", mode: "viewer" }],
            create: { allowed: false, explicitlyDenied: false } };
          mapPolicies.set(key, policy);
        }
        // The real API returns the complete policy. A partial PATCH must not reset
        // other permissions; map route and project creation are independent.
        if (method === "PATCH") {
          if (body?.mode === "viewer" || body?.mode === "editor") {
            const project = policy.projectRoutes.find(item => String(item.projectId) === String(body.projectId));
            if (project) project.mode = body.mode;
          }
          if (typeof body?.createEnabled === "boolean") {
            policy.create.allowed = body.createEnabled;
            policy.create.explicitlyDenied = !body.createEnabled;
          }
        }
        const json = { ok: true, ...structuredClone(policy) };
        recorded.response = { status: 200, body: json };
        return route.fulfill({ json });
      }
      if (method === "GET" && resource === "users") {
        const snapshot = structuredClone(source); // A delayed request really holds old organization data.
        const attempt = (attempts.get(requestedOrganization) ?? 0) + 1; attempts.set(requestedOrganization, attempt);
        await options.beforeUsers?.(requestedOrganization, attempt);
        if (failUsers) return route.fulfill({ status: 503, json: { ok: false, error: { code: "INFRASTRUCTURE_UNEXPECTED_ERROR", category: "INFRASTRUCTURE", retryable: true } } });
        const json = { ok: true, users: snapshot };
        recorded.response = { status: 200, body: json };
        return route.fulfill({ json });
      }
      if (method === "GET" && resource === "limits") return route.fulfill(options.failLimits
        ? { status: 503, json: { ok: false } }
        : { json: { ok: true, limits: { plan: "professional", users: { limit: requestedOrganization === 2 ? 8 : 50, used: source.filter(person => person.active !== false).length }, projects: { limit: 100, used: 0 }, storageMb: { limit: 1000, used: 0 }, exports: { limit: 100, used: 0 } }, pendingRequests: [] } });
      if (method === "GET" && resource === "access-governance") return route.fulfill(options.failGovernance
        ? { status: 503, json: { ok: false } }
        : { json: { ok: true, capabilities: { ...governance, ...options.capabilities, organizationId: requestedOrganization } } });
    }
    if (method !== "GET") { data.unexpectedWrites.push(`${method} ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    if (["/api/projects", "/api/projects/recent", "/api/projects/favorites"].includes(path)) return route.fulfill({ json: { ok: true, projects: [], pagination: { total: 0, hasMore: false, nextCursor: null } } });
    if (!/notifications|export-jobs|session/.test(path)) data.unknownReads.push(path);
    return route.fulfill({ json: { ok: true, enabled: false, notifications: [], items: [], jobs: [], unread: 0, unreadCount: 0 } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  if (options.open !== false) await openUsers(page);
  return { ...data, state, recover: () => { failUsers = false; } };
}
const workspace = (page: Page) => page.locator(".people-access-section.users-access-workspace");
const rows = (page: Page) => workspace(page).locator(".people-table-wrap tbody tr").filter({ has: page.locator(".mm-docs-menu-trigger") });
const footer = (page: Page) => workspace(page).locator(".mm-docs-pagination");
const next = (page: Page) => footer(page).getByRole("button", { name: "Próxima página", exact: true });
const previous = (page: Page) => footer(page).getByRole("button", { name: "Página anterior", exact: true });
const search = (page: Page) => workspace(page).getByPlaceholder("Nome, e-mail ou acesso", { exact: true });
const menu = (page: Page) => page.locator(".mm-docs-action-menu");
async function openUsers(page: Page) {
  await page.locator(".mm-sidebar-nav").getByRole("button", { name: "Usuários e Acessos", exact: true }).click();
  await expect(workspace(page).getByRole("heading", { name: "Usuários e Acessos", level: 1, exact: true })).toBeVisible();
}
async function choose(page: Page, name: string, option: string, scope: Locator = workspace(page)) {
  await scope.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox", { name: `Opções: ${name}`, exact: true }).getByRole("option", { name: option, exact: true }).click();
}
async function expectPage(page: Page, visible: number, total: number, number: number) {
  await expect(footer(page).getByRole("status")).toHaveText(`Exibindo ${visible}/${total}.`);
  await expect(footer(page).locator(".mm-docs-page-number")).toHaveText(String(number));
  await expect(rows(page)).toHaveCount(visible);
}
async function openPersonMenu(page: Page, name: string) {
  const row = rows(page).filter({ has: page.getByText(name, { exact: true }) });
  const trigger = row.locator(".mm-docs-menu-trigger");
  await trigger.click(); await expect(menu(page)).toBeVisible(); return trigger;
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function expectViewportBackdrop(page: Page) {
  const geometry = await page.locator(".org-permission-modal").evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
  });
  expect(geometry.x, "Modal backdrop starts at the viewport left, not its query container").toBeCloseTo(0, 0);
  expect(geometry.y, "Modal backdrop starts at the viewport top, not its query container").toBeCloseTo(0, 0);
  expect(geometry.width).toBeCloseTo(geometry.viewportWidth, 0);
  expect(geometry.height).toBeCloseTo(geometry.viewportHeight, 0);
}
test.afterEach(async ({ page }, testInfo) => {
  const data = diagnostics.get(page);
  if (data) {
    await mkdir(testInfo.outputDir, { recursive: true });
    const path = testInfo.outputPath("fixture-request-trace.json");
    await writeFile(path, JSON.stringify(data, null, 2));
    await testInfo.attach("fixture-request-trace", { path, contentType: "application/json" });
  }
  expect(data?.errors ?? []).toEqual([]);
  expect(data?.unexpectedWrites ?? []).toEqual([]);
});

test("desktop header, full-width filters, table and real shared footer are compact", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); const fixture = await setup(page);
  await expectPage(page, 10, 36, 1);
  await expect(workspace(page).getByRole("navigation").getByRole("link", { name: "Início", exact: true })).toHaveAttribute("href", "/projects");
  await expect(workspace(page).locator(".people-access-header p, .people-eyebrow")).toHaveCount(0);
  expect(await workspace(page).locator(".people-access-header").evaluate(element => getComputedStyle(element).backgroundImage)).toBe("none");
  for (const name of ["Situação", "Perfil"]) await expect(workspace(page).getByRole("combobox", { name, exact: true })).toBeVisible();
  const tools = await workspace(page).locator(".people-tools").boundingBox();
  const fields = await workspace(page).locator(".people-tools input, .people-tools select").evaluateAll(elements => elements.map(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })));
  expect(fields).toHaveLength(3);
  expect(Math.max(...fields.map(field => field.right)) - Math.min(...fields.map(field => field.left))).toBeGreaterThan(tools!.width * .9);
  await expect(workspace(page).locator(".people-capacity-grid article strong")).toHaveText(["30", "50", "20", "6"]);
  await expect(previous(page)).toBeDisabled(); await expect(next(page)).toBeEnabled();
  await expect(footer(page).locator("time")).toHaveCount(0); await expectNoOverflow(page);
  for (const endpoint of ["users", "limits", "access-governance"]) expect(fixture.requests.some(item => item.method === "GET" && item.path === `/api/organizations/1/${endpoint}`)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("users-access-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await workspace(page).getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
  await expect(footer(page)).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("users-access-desktop-footer.png"), fullPage: true });
  await workspace(page).getByRole("link", { name: "Início", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
});

test("10, 25 and 50 page sizes cover every person without extra server pages or metric changes", async ({ page }) => {
  const fixture = await setup(page); await expectPage(page, 10, 36, 1);
  const metrics = await workspace(page).locator(".people-capacity-grid").innerText();
  const initialReads = fixture.requests.filter(item => item.path.endsWith("/users")).length;
  for (let number = 2; number <= 4; number += 1) {
    await next(page).click(); await expectPage(page, number === 4 ? 6 : 10, 36, number);
    await expect(rows(page).first()).toContainText(`Pessoa ${number === 2 ? "11" : number === 3 ? "21" : "31"}`);
  }
  await expect(next(page)).toBeDisabled();
  await previous(page).focus(); await page.keyboard.press("Enter"); await expectPage(page, 10, 36, 3); await expect(previous(page)).toBeFocused();
  await choose(page, "Itens por página", "25"); await expectPage(page, 25, 36, 1);
  await next(page).click(); await expectPage(page, 11, 36, 2);
  await choose(page, "Itens por página", "50"); await expectPage(page, 36, 36, 1);
  await expect(next(page)).toBeDisabled(); await expect(previous(page)).toBeDisabled();
  expect(await workspace(page).locator(".people-capacity-grid").innerText()).toBe(metrics);
  const reads = fixture.requests.filter(item => item.path.endsWith("/users"));
  expect(reads).toHaveLength(initialReads); expect(reads.every(item => item.query === "")).toBe(true);
});

test("name, email, access, status and profile filters run before pagination and reset page one", async ({ page }) => {
  const fixture = await setup(page); await expectPage(page, 10, 36, 1);
  const metrics = await workspace(page).locator(".people-capacity-grid").innerText();
  const status = workspace(page).getByRole("combobox", { name: "Situação", exact: true });
  await status.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Opções: Situação", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Escape");
  await expect(status).toHaveValue("all"); await expect(status).toBeFocused();
  await next(page).click(); await expectPage(page, 10, 36, 2);
  await search(page).fill("pessoa36@example.test"); await expectPage(page, 1, 1, 1); await expect(rows(page)).toContainText("Pessoa 36");
  await search(page).fill("Pessoa 31"); await expectPage(page, 1, 1, 1);
  await search(page).fill("Criar novos projetos"); await expectPage(page, 10, 12, 1);
  await next(page).click(); await expectPage(page, 2, 12, 2);
  await search(page).fill(""); await expectPage(page, 10, 36, 1);
  await next(page).click(); await choose(page, "Situação", "Suspenso"); await expectPage(page, 6, 6, 1);
  await choose(page, "Situação", "Todas"); await choose(page, "Perfil", "Consulta"); await expectPage(page, 10, 18, 1);
  await next(page).click(); await expectPage(page, 8, 18, 2);
  await choose(page, "Perfil", "Colaborador"); await expectPage(page, 10, 18, 1);
  await choose(page, "Situação", "Ativo"); await expectPage(page, 10, 12, 1);
  await search(page).fill("não existe"); await expectPage(page, 0, 0, 1);
  await expect(workspace(page).getByText("Nenhuma pessoa encontrada.", { exact: true })).toBeVisible();
  await expect(previous(page)).toBeDisabled(); await expect(next(page)).toBeDisabled();
  expect(await workspace(page).locator(".people-capacity-grid").innerText()).toBe(metrics);
  expect(fixture.requests.filter(item => item.path.endsWith("/users"))).toHaveLength(1);
  await workspace(page).getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await expectPage(page, 10, 36, 1); await expect(search(page)).toHaveValue("");
  await expect(status).toHaveValue("all");
  await expect(workspace(page).getByRole("combobox", { name: "Perfil", exact: true })).toHaveValue("all");
  await expect(workspace(page).getByRole("button", { name: "Limpar filtros", exact: true })).toBeDisabled();
});

test("same-query reload clamps a shortened team and keeps its valid page when it grows", async ({ page }, testInfo) => {
  const fixture = await setup(page, { allowMapWrite: true }); await expectPage(page, 10, 36, 1);
  const pageEvidence = [{ status: await footer(page).getByRole("status").innerText(), page: await footer(page).locator(".mm-docs-page-number").innerText() }];
  for (let number = 2; number <= 4; number += 1) { await next(page).click(); await expectPage(page, number === 4 ? 6 : 10, 36, number); }
  pageEvidence.push({ status: await footer(page).getByRole("status").innerText(), page: await footer(page).locator(".mm-docs-page-number").innerText() });
  await openPersonMenu(page, people[30].name!); await menu(page).getByRole("menuitem", { name: "Mapa", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Acesso Viewer ou Editor", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Rota do projeto Projeto de demonstração", exact: true })).toBeEnabled();
  fixture.state.splice(0, fixture.state.length, ...structuredClone(people.slice(0, 10)), structuredClone(people[30]));
  await choose(page, "Rota do projeto Projeto de demonstração", "Editor", dialog);
  await expectPage(page, 1, 11, 2); await expect(rows(page)).toContainText("Pessoa 31");
  pageEvidence.push({ status: await footer(page).getByRole("status").innerText(), page: await footer(page).locator(".mm-docs-page-number").innerText() });
  fixture.state.push(...structuredClone(people.slice(10, 20))); fixture.state.sort((left, right) => Number(left.id) - Number(right.id));
  // This controlled checkbox commits its checked value only after the policy
  // response. check() tests the state synchronously immediately after clicking;
  // clicking then asserting awaits the same real asynchronous API contract.
  await dialog.getByRole("checkbox", { name: /Pode criar novos projetos/ }).click();
  await expect(dialog.getByRole("checkbox", { name: /Pode criar novos projetos/ })).toBeChecked();
  await expectPage(page, 10, 21, 2); await expect(rows(page).first()).toContainText("Pessoa 11");
  await expect(dialog.getByRole("combobox", { name: "Rota do projeto Projeto de demonstração", exact: true })).toHaveValue("editor");
  pageEvidence.push({ status: await footer(page).getByRole("status").innerText(), page: await footer(page).locator(".mm-docs-page-number").innerText() });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
  await flushFrames(page);
  await expect(workspace(page).locator(".mm-docs-menu-trigger:focus")).toHaveCount(0);
  const writes = fixture.requests.filter(item => item.method !== "GET");
  expect(writes.map(item => `${item.method} ${item.path}`)).toEqual(["PATCH /api/organizations/1/users/31/map-access", "PATCH /api/organizations/1/users/31/map-access"]);
  expect(writes.map(item => item.body)).toEqual([{ projectId: 100, mode: "editor" }, { createEnabled: true }]);
  expect(writes.map(item => (item.response!.body as ProjectMapAccessPolicy).projectRoutes[0].mode)).toEqual(["editor", "editor"]);
  expect(writes.map(item => (item.response!.body as ProjectMapAccessPolicy).create.allowed)).toEqual([false, true]);
  await mkdir(testInfo.outputDir, { recursive: true });
  const evidencePath = testInfo.outputPath("clamp-state-evidence.json");
  await writeFile(evidencePath, JSON.stringify({ pageEvidence, writes }, null, 2));
  await testInfo.attach("clamp-state-evidence", { path: evidencePath, contentType: "application/json" });
});

test("person menu supports keyboard, Escape, Tab, outside click, single-open and exact modal target", async ({ page }, testInfo) => {
  await setup(page); await expectPage(page, 10, 36, 1);
  const trigger = rows(page).nth(1).locator(".mm-docs-menu-trigger"), second = rows(page).nth(2).locator(".mm-docs-menu-trigger");
  for (const key of ["Enter", "Space", "ArrowDown"]) {
    await trigger.focus(); await page.keyboard.press(key);
    await expect(menu(page).getByRole("menuitem", { name: "Mapa", exact: true })).toBeFocused();
    await page.keyboard.press("End"); await expect(menu(page).getByRole("menuitem", { name: "Gerenciar", exact: true })).toBeFocused();
    await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown");
    await expect(menu(page).getByRole("menuitem", { name: "Gerenciar", exact: true })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(menu(page)).toHaveCount(0); await expect(trigger).toBeFocused();
  }
  await trigger.click(); await page.keyboard.press("Tab"); await expect(menu(page)).toHaveCount(0); await expect(second).toBeFocused();
  await second.click(); await page.keyboard.press("Shift+Tab"); await expect(menu(page)).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await workspace(page).getByRole("heading", { level: 1 }).click(); await expect(menu(page)).toHaveCount(0);
  await trigger.click(); await second.click(); await expect(menu(page)).toHaveCount(1);
  await expect(trigger).toHaveAttribute("aria-expanded", "false"); await expect(second).toHaveAttribute("aria-expanded", "true");
  expect(await menu(page).evaluate(element => element.parentElement === document.body)).toBe(true);
  await menu(page).getByRole("menuitem", { name: "Mapa", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Acesso Viewer ou Editor", exact: true });
  await expect(dialog.locator(".org-permission-scope strong")).toHaveText(people[2].name!);
  await expectViewportBackdrop(page);
  await page.screenshot({ path: testInfo.outputPath("users-access-map-modal-desktop.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
  await expect(second).toBeFocused();
  const mapCloseRestoredFocus = await second.evaluate(element => document.activeElement === element);
  await openPersonMenu(page, people[1].name!); await menu(page).getByRole("menuitem", { name: "Gerenciar", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Gerenciar funcionalidades e acessos", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Pessoa", exact: true })).toHaveValue("2");
  await expect(dialog.getByRole("combobox", { name: "Pessoa", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Salvar acessos", exact: true })).toBeDisabled();
  await expectViewportBackdrop(page);
  await page.screenshot({ path: testInfo.outputPath("users-access-additional-modal-desktop.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
  await expect(trigger).toBeFocused();
  const additionalCloseRestoredFocus = await trigger.evaluate(element => document.activeElement === element);
  await mkdir(testInfo.outputDir, { recursive: true });
  const focusPath = testInfo.outputPath("manager-focus-restoration.json");
  await writeFile(focusPath, JSON.stringify({ mapCloseRestoredFocus, additionalCloseRestoredFocus }));
  await testInfo.attach("manager-focus-restoration", { path: focusPath, contentType: "application/json" });
  expect(diagnostics.get(page)!.requests.filter(item => item.method !== "GET")).toEqual([]);
});

for (const scenario of [
  { name: "delegated", role: "owner", capabilities: {}, map: [2, 3, 7], manage: [2, 3, 7] },
  { name: "super-admin", role: "super_admin", capabilities: { mode: "super_admin" as const }, map: [2, 3, 4, 6, 7], manage: [] },
  { name: "super-admin with viewer-only delegation", role: "super_admin", capabilities: { allowedTargetLevels: ["viewer"] }, map: [2, 3, 4, 6, 7], manage: [2, 7] },
  { name: "non-organization governance", role: "owner", capabilities: { mode: "super_admin" as const }, map: [], manage: [] },
  { name: "read-only", role: "viewer", capabilities: { canManageAdditionalAccesses: false }, map: [], manage: [] },
  { name: "delegation without target whitelist", role: "owner", capabilities: { allowedTargetLevels: [] }, map: [], manage: [] },
]) test(`permission gates: ${scenario.name} preserves self, active, delegation and target-level rules`, async ({ page }) => {
  await setup(page, { dataset: gatePeople, role: scenario.role, capabilities: scenario.capabilities }); await expectPage(page, 7, 7, 1);
  for (const person of gatePeople) {
    const allowedLabels = [scenario.map.includes(Number(person.id)) ? "Mapa" : null, scenario.manage.includes(Number(person.id)) ? "Gerenciar" : null].filter(Boolean);
    if (!allowedLabels.length) {
      const disabled = rows(page).filter({ has: page.getByText(person.name!, { exact: true }) }).getByRole("button", { name: `Nenhuma ação disponível para ${person.name}`, exact: true });
      await expect(disabled).toBeDisabled();
      continue;
    }
    const trigger = await openPersonMenu(page, person.name!);
    await expect(menu(page).getByRole("menuitem")).toHaveText(allowedLabels as string[]);
    for (const item of await menu(page).getByRole("menuitem").all()) await expect(item).toBeEnabled();
    await page.keyboard.press("Escape"); await expect(menu(page)).toHaveCount(0); await expect(trigger).toBeFocused();
  }
  await expect(workspace(page).getByRole("link", { name: "Gerenciar no Painel Admin", exact: true })).toHaveCount(scenario.role === "super_admin" ? 1 : 0);
  expect(diagnostics.get(page)!.requests.some(item => item.path.endsWith("/map-access"))).toBe(false);
});

test("mobile long names, wide table and portalled menu keep 44px targets inside the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dataset = people.map(person => ({ ...person }));
  dataset[1].name = "Maria da Conceição de Albuquerque e Silva · Coordenação de Planejamento Territorial e Gestão de Projetos";
  dataset[1].email = "maria.conceicao.albuquerque.planejamento.territorial@example.test";
  await setup(page, { dataset }); await expectPage(page, 10, 36, 1); await expectNoOverflow(page);
  const table = workspace(page).locator(".people-table-wrap");
  expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await workspace(page).evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath("users-access-mobile.png"), fullPage: false });
  await page.screenshot({ path: testInfo.outputPath("users-access-mobile-overview.png"), fullPage: true });
  await table.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const trigger = rows(page).nth(1).locator(".mm-docs-menu-trigger"); await trigger.scrollIntoViewIfNeeded();
  const box = await trigger.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  await trigger.click(); await expect(menu(page)).toBeVisible();
  const panel = await menu(page).boundingBox(); expect(panel!.x).toBeGreaterThanOrEqual(0); expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  expect(panel!.y).toBeGreaterThanOrEqual(0); expect(panel!.y + panel!.height).toBeLessThanOrEqual(844);
  for (const item of await menu(page).getByRole("menuitem").all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("users-access-mobile-menu.png"), fullPage: false });
  await menu(page).getByRole("menuitem", { name: "Mapa", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Acesso Viewer ou Editor", exact: true });
  await expect(dialog.locator(".org-permission-scope strong")).toHaveText(dataset[1].name!);
  await expectViewportBackdrop(page);
  await page.screenshot({ path: testInfo.outputPath("users-access-map-modal-mobile.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
  await expect(trigger).toBeFocused();
  await trigger.click(); await menu(page).getByRole("menuitem", { name: "Gerenciar", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Gerenciar funcionalidades e acessos", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Pessoa", exact: true })).toHaveValue("2");
  await expectViewportBackdrop(page);
  await page.screenshot({ path: testInfo.outputPath("users-access-additional-modal-mobile.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
  await expect(trigger).toBeFocused();
  await footer(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("users-access-mobile-footer.png"), fullPage: false });
  for (const arrow of [next(page), previous(page)]) { const target = await arrow.boundingBox(); expect(target!.height).toBeGreaterThanOrEqual(44); expect(target!.width).toBeGreaterThanOrEqual(44); }
  await choose(page, "Itens por página", "25"); await expectPage(page, 25, 36, 1);
  await next(page).click(); await expectPage(page, 11, 36, 2); await expectNoOverflow(page);
});

test("menu flips above a bottom-edge row and closes when its scrolling anchor moves", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await setup(page); await expectPage(page, 10, 36, 1);
  const trigger = rows(page).nth(2).locator(".mm-docs-menu-trigger");
  await trigger.evaluate(element => element.scrollIntoView({ block: "end" }));
  await trigger.click(); await expect(menu(page)).toBeVisible();
  const anchor = await trigger.boundingBox(), popup = await menu(page).boundingBox();
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(anchor!.y);
  expect(popup!.x).toBeGreaterThanOrEqual(8); expect(popup!.x + popup!.width).toBeLessThanOrEqual(1280 - 8);
  await workspace(page).locator(".people-table-wrap").dispatchEvent("scroll"); await expect(menu(page)).toBeVisible();
  await page.locator(".mm-projects-main").evaluate(element => { element.scrollTop += element.scrollTop > 0 ? -36 : 36; });
  await expect(menu(page)).toHaveCount(0);
});

test("loading and service failure disable stale counts and recover without leaving the workspace", async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  const fixture = await setup(page, { failUsers: true, beforeUsers: () => delay });
  await expect(workspace(page).getByText("Carregando pessoas com acesso...", { exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(0); await expect(previous(page)).toBeDisabled(); await expect(next(page)).toBeDisabled();
  release(); await expect(workspace(page).getByRole("alert")).toBeVisible();
  await expect(rows(page)).toHaveCount(0); await expect(footer(page).getByRole("status")).not.toContainText("36");
  fixture.recover(); await workspace(page).getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expectPage(page, 10, 36, 1); await expect(workspace(page).getByRole("alert")).toHaveCount(0);
});

test("empty team retains zero-count real pagination at every supported size", async ({ page }, testInfo) => {
  await setup(page, { dataset: [] }); await expectPage(page, 0, 0, 1);
  for (const size of ["25", "50", "10"]) {
    await choose(page, "Itens por página", size); await expectPage(page, 0, 0, 1);
    await expect(previous(page)).toBeDisabled(); await expect(next(page)).toBeDisabled();
  }
  await expect(workspace(page).getByText("Nenhuma pessoa encontrada.", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("users-access-empty.png"), fullPage: true });
});

test("missing team permission prevents opening the workspace or requesting organization people", async ({ page }) => {
  const fixture = await setup(page, { role: "viewer", permissions: [], open: false });
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  const entry = page.locator(".mm-sidebar-nav").getByRole("button", { name: "Usuários e Acessos", exact: true });
  await expect(entry).toHaveCount(0); await expect(workspace(page)).toHaveCount(0);
  expect(fixture.requests.some(item => /\/(users|access-governance|limits)$/.test(item.path))).toBe(false);
});

test("governance and limits failures preserve visible team but never infer delegated authority", async ({ page }) => {
  await setup(page, { failGovernance: true, failLimits: true }); await expectPage(page, 10, 36, 1);
  await expect(workspace(page).getByRole("alert")).toContainText("as configurações de acesso não puderam ser carregadas");
  await expect(workspace(page).locator(".people-capacity-grid article strong")).toHaveText(["30", "36", "6", "6"]);
  await expect(rows(page).nth(1).getByRole("button", { name: `Nenhuma ação disponível para ${people[1].name}`, exact: true })).toBeDisabled();
  await expect(menu(page)).toHaveCount(0);
});

test("organization switch clears old rows, filters, page and permissions before delayed results", async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  const fixture = await setup(page, { beforeUsers: async organizationId => { if (organizationId === 2) await delay; } });
  await expectPage(page, 10, 36, 1); await next(page).click(); await expectPage(page, 10, 36, 2);
  await page.getByRole("button", { name: /Trocar organização ativa/ }).click();
  await page.getByRole("option", { name: /Organização secundária/ }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  await openUsers(page); await expect(rows(page)).toHaveCount(0);
  await expect(workspace(page)).not.toContainText("Pessoa 11"); await expect(footer(page).getByRole("status")).not.toContainText("36");
  await expect(next(page)).toBeDisabled(); await expect(previous(page)).toBeDisabled();
  release(); await expectPage(page, 3, 3, 1); await expect(rows(page).first()).toContainText("Outra equipe 1");
  await expect(search(page)).toHaveValue("");
  expect(fixture.requests.some(item => item.path === "/api/organizations/2/users")).toBe(true);
  await expect(workspace(page).locator(".people-capacity-grid article strong")).toHaveText(["3", "8", "5", "0"]);
});


test("a late old-organization response cannot replace the current team", async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  await setup(page, { beforeUsers: async organizationId => { if (organizationId === 1) await delay; } });
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole("button", { name: /Trocar organização ativa/ }).click();
  await page.getByRole("option", { name: /Organização secundária/ }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  await openUsers(page); await expectPage(page, 3, 3, 1);
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/organizations/1/users");
  release(); await oldResponse;
  // Flush the response's microtasks and paint instead of sleeping a guessed interval.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expectPage(page, 3, 3, 1); await expect(workspace(page)).not.toContainText("Pessoa 01");
  await expect(rows(page).first()).toContainText("Outra equipe 1");
});


test("changing a filter, page or section removes the old person menu", async ({ page }) => {
  await setup(page); await expectPage(page, 10, 36, 1);
  await openPersonMenu(page, people[1].name!); await search(page).fill("Pessoa 03");
  await expectPage(page, 1, 1, 1); await expect(menu(page)).toHaveCount(0);
  await workspace(page).getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await expectPage(page, 10, 36, 1); await openPersonMenu(page, people[1].name!);
  await next(page).click(); await expectPage(page, 10, 36, 2); await expect(menu(page)).toHaveCount(0);
  await openPersonMenu(page, people[11].name!);
  await workspace(page).getByRole("link", { name: "Início", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
});


async function flushFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
const personTrigger = (page: Page, id: number) => workspace(page).locator(`tr[data-user-id="${id}"] .mm-docs-menu-trigger`);
async function openManager(page: Page, action: "Mapa" | "Gerenciar", input: "mouse" | "keyboard" = "mouse") {
  const trigger = personTrigger(page, 3);
  if (input === "keyboard") {
    await trigger.focus(); await page.keyboard.press("Enter");
    if (action === "Gerenciar") await page.keyboard.press("End");
    await expect(menu(page).getByRole("menuitem", { name: action, exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
  } else {
    await trigger.click(); await menu(page).getByRole("menuitem", { name: action, exact: true }).click();
  }
  const dialog = page.getByRole("dialog", { name: action === "Mapa" ? "Acesso Viewer ou Editor" : "Gerenciar funcionalidades e acessos", exact: true });
  await expect(dialog).toBeVisible();
  if (action === "Mapa") await expect(dialog.locator(".org-permission-scope strong")).toContainText("Pessoa 03");
  else await expect(dialog.getByRole("combobox", { name: "Pessoa", exact: true })).toHaveValue("3");
  return dialog;
}

test("both managers return focus to the same person after mouse and keyboard opening", async ({ page }) => {
  await setup(page); await expectPage(page, 10, 36, 1);
  for (const action of ["Mapa", "Gerenciar"] as const) for (const input of ["mouse", "keyboard"] as const) {
    const dialog = await openManager(page, action, input);
    const close = dialog.getByRole("button", { name: "Fechar", exact: true });
    if (input === "keyboard") { await close.last().focus(); await page.keyboard.press("Enter"); }
    else await close.first().click();
    await expect(dialog).toHaveCount(0); await expect(personTrigger(page, 3)).toBeFocused();
    await expect(menu(page)).toHaveCount(0);
  }
});

for (const action of ["Mapa", "Gerenciar"] as const) test(`${action} close reacquires the same person after a refresh replaces the row DOM`, async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  const fixture = await setup(page, { allowMapWrite: true, allowPermissionWrite: true,
    beforeUsers: async (organizationId, attempt) => { if (organizationId === 1 && attempt === (action === "Mapa" ? 2 : 4)) await delay; } });
  await expectPage(page, 10, 36, 1);
  const oldTrigger = await personTrigger(page, 3).elementHandle();
  const dialog = await openManager(page, action, "keyboard");
  fixture.state.find(person => person.id === 3)!.name = "Pessoa 03 atualizada";
  if (action === "Mapa") await choose(page, "Rota do projeto Projeto de demonstração", "Editor", dialog);
  else {
    await dialog.getByRole("checkbox", { name: /Criar novos projetos/ }).check();
    await dialog.getByRole("button", { name: "Salvar acessos", exact: true }).click();
  }
  await expect(workspace(page).getByText("Carregando pessoas com acesso...", { exact: true })).toBeVisible();
  expect(await oldTrigger!.evaluate(element => element.isConnected), "A live DOM lookup is required; the opening button is detached").toBe(false);
  release(); await expectPage(page, 10, 36, 1);
  await expect(workspace(page).locator('tr[data-user-id="3"]')).toContainText("Pessoa 03 atualizada");
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
  await expect(personTrigger(page, 3)).toBeFocused();
  expect(await oldTrigger!.evaluate(element => element.isConnected)).toBe(false);
});

for (const change of ["removed", "disabled"] as const) test(`closing after the target is ${change} never focuses another person`, async ({ page }) => {
  const fixture = await setup(page, { allowMapWrite: true }); await expectPage(page, 10, 36, 1);
  const dialog = await openManager(page, "Mapa");
  if (change === "removed") fixture.state.splice(fixture.state.findIndex(person => person.id === 3), 1);
  else fixture.state.find(person => person.id === 3)!.active = false;
  await choose(page, "Rota do projeto Projeto de demonstração", "Editor", dialog);
  await expectPage(page, 10, change === "removed" ? 35 : 36, 1);
  if (change === "removed") await expect(personTrigger(page, 3)).toHaveCount(0); else await expect(personTrigger(page, 3)).toBeDisabled();
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click(); await flushFrames(page);
  await expect(workspace(page).locator(".mm-docs-menu-trigger:focus")).toHaveCount(0);
});

for (const change of ["page", "section"] as const) test(`a pending close focus does not override newer ${change} navigation`, async ({ page }) => {
  await setup(page); await expectPage(page, 10, 36, 1);
  const dialog = await openManager(page, "Mapa");
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().evaluate((element, change) => {
    // Both user-visible actions happen in one task, before the scheduled focus
    // animation frame; no timers or artificial pause duration are involved.
    element.click();
    const nextControl = document.querySelector<HTMLButtonElement>(change === "page"
      ? '.users-access-workspace [aria-label="Próxima página"]'
      : '.mm-sidebar-nav button[aria-label="Todos os Projetos"]');
    nextControl!.focus(); nextControl!.click();
  }, change);
  if (change === "page") {
    await expectPage(page, 10, 36, 2); await flushFrames(page);
    await expect(next(page)).toBeFocused();
    await expect(workspace(page).locator(".mm-docs-menu-trigger:focus")).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible(); await flushFrames(page);
    await expect(page.locator('.mm-sidebar-nav button[aria-label="Todos os Projetos"]')).toBeFocused();
    await expect(workspace(page)).toHaveCount(0);
    await openUsers(page); await expectPage(page, 10, 36, 1); await flushFrames(page);
    await expect(personTrigger(page, 3)).not.toBeFocused();
  }
});

test("closing while the team refresh is pending never schedules a late focus steal", async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  await setup(page, { allowMapWrite: true, beforeUsers: async (organizationId, attempt) => { if (organizationId === 1 && attempt === 2) await delay; } });
  await expectPage(page, 10, 36, 1);
  const dialog = await openManager(page, "Mapa", "keyboard");
  await choose(page, "Rota do projeto Projeto de demonstração", "Editor", dialog);
  await expect(workspace(page).getByText("Carregando pessoas com acesso...", { exact: true })).toBeVisible();
  await expect(personTrigger(page, 3)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
  await expect(dialog).toHaveCount(0); await flushFrames(page);
  await expect(workspace(page).locator(".mm-docs-menu-trigger:focus")).toHaveCount(0);
  await search(page).focus(); release();
  await expectPage(page, 10, 36, 1); await flushFrames(page);
  await expect(search(page)).toBeFocused(); await expect(personTrigger(page, 3)).not.toBeFocused();
});
