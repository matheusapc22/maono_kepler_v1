import { expect, test, type Page } from "@playwright/test";

// Synthetic HTTP responses exercise the compiled React route and user events.
// This is deliberately NOT backend integration or production acceptance.
const organizations = [
  { id: 1, name: "Organização de demonstração", slug: "demo", active: true },
  { id: 2, name: "Outra organização", slug: "other", active: true },
];
type Project = {
  id: number; slug: string; name: string; description: string; organizationId: number;
  active: boolean; accessLevel: string; favorite: boolean; favorited?: boolean;
  createdAt: string; updatedAt: string; thumbnailStatus: string; thumbnailUrl?: string;
  createdBy: { id: number; name: string }; permissions?: string[]; deniedPermissions?: string[];
  configRevision?: number; thumbnailRevision?: number;
};
const projects: Project[] = Array.from({ length: 73 }, (_, index) => ({
  id: index + 1, slug: `projeto-${String(index + 1).padStart(2, "0")}`,
  name: `${index === 72 ? "Árvore especial" : "Projeto"} ${String(index + 1).padStart(2, "0")}`,
  description: index === 71 ? "Marcador somente na descrição" : "Análise geográfica para decisões de mercado.",
  organizationId: 1, active: index % 3 !== 0, accessLevel: "owner", favorite: index < 11,
  createdAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
  createdBy: { id: 1, name: "Operador de demonstração" }, thumbnailStatus: "MISSING",
}));
type RequestRecord = { method: string; path: string; query: string; body: string | null; organizationId: number };
type FixtureOptions = {
  dataset?: Project[]; recentIds?: number[]; role?: string; deniedPermissions?: string[];
  userName?: string; userEmail?: string; organizationRoles?: Record<number, string>;
  failFavorite?: boolean | ((attempt: number) => boolean); beforeFavorite?: (attempt: number) => Promise<void>; beforeList?: (path: string) => Promise<void>;
  failList?: () => boolean;
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(page: Page, options: FixtureOptions = {}) {
  const state = (options.dataset ?? projects).map(item => ({ ...item }));
  const recentIds = options.recentIds ?? projects.slice(40, 53).map(item => item.id);
  const requests: RequestRecord[] = [];
  let organizationId = 1;
  let favoriteAttempt = 0;
  let authenticated = true;
  const fixtureOrganizations = organizations.map(organization => ({
    ...organization, role: options.organizationRoles?.[organization.id],
  }));
  const session = () => authenticated ? ({
    authenticated: true,
    user: { id: 1, name: options.userName ?? "Operador de demonstração", email: options.userEmail ?? "qa@example.test", role: options.role ?? "super_admin", activeOrganizationId: organizationId, deniedPermissions: options.deniedPermissions ?? [] },
    projects: state.filter(item => item.organizationId === organizationId), organizations: fixtureOrganizations,
    activeOrganization: fixtureOrganizations.find(item => item.id === organizationId),
  }) : ({ authenticated: false, user: null, projects: [], organizations: [], activeOrganization: null });
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    requests.push({ method: request.method(), path, query: url.search, body: request.postData(), organizationId });
    if (path === "/api/session") return route.fulfill({ json: session() });
    if (path === "/api/auth/logout" && request.method() === "POST") {
      // Fully local logout: exercise the existing callback without a real account.
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/session/active-organization" && request.method() === "PUT") {
      organizationId = Number(JSON.parse(request.postData() || "{}").organizationId);
      return route.fulfill({ json: { ok: true, ...session() } });
    }
    if (/^\/api\/projects\/[^/]+\/favorite$/.test(path)) {
      const attempt = ++favoriteAttempt;
      await options.beforeFavorite?.(attempt);
      if (typeof options.failFavorite === "function" ? options.failFavorite(attempt) : options.failFavorite) return route.fulfill({ status: 403, json: { ok: false, error: { code: "AUTH_PERMISSION_DENIED", category: "AUTH", retryable: false } } });
      const project = state.find(item => item.slug === path.split("/")[3]);
      if (!project || project.organizationId !== organizationId) return route.fulfill({ status: 404, json: { ok: false } });
      project.favorite = request.method() === "POST"; project.favorited = project.favorite;
      return route.fulfill({ json: { ok: true, project } });
    }
    if (["/api/projects", "/api/projects/recent", "/api/projects/favorites"].includes(path)) {
      // Always return the FULL endpoint set; no fake server paging/filtering.
      const snapshot = state.filter(item => item.organizationId === organizationId &&
        (path.endsWith("/favorites") ? item.favorite : path.endsWith("/recent") ? recentIds.includes(item.id) : true)).map(item => ({ ...item }));
      await options.beforeList?.(path);
      if (options.failList?.()) return route.fulfill({ status: 403, json: { ok: false, error: { code: "AUTH_PERMISSION_DENIED", category: "AUTH", retryable: false } } });
      return route.fulfill({ json: { ok: true, projects: snapshot } });
    }
    if (path.endsWith("/metadata")) {
      const project = state.find(item => item.slug === path.split("/")[3]);
      return route.fulfill({ json: { ok: true, project: { ...project, organization: organizations[0], metadataVersion: 1 } } });
    }
    if (path.endsWith("/thumbnail/status")) return route.fulfill({ json: { ok: true, thumbnailStatus: "READY", configRevision: 1, thumbnailRevision: 1, thumbnailAttempts: 1 } });
    if (path.endsWith("/thumbnail") || path === "/api/fixture-preview") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#183124"/><path d="M0 280L640 80M120 0L440 360" stroke="#d8ad50" stroke-width="8"/></svg>' });
    if (path.endsWith("/map-navigation")) {
      const project = state.find(item => item.slug === path.split("/")[3]);
      const requestedMode = url.searchParams.get("mode");
      return route.fulfill({ json: { ok: true, context: {
        project, organization: organizations[0], requestedMode, mode: "viewer", policyVersion: 1,
        assignedMode: "viewer", defaultPanel: "viewer", allowed: true,
        availablePanels: { viewer: true, editor: false, create: false }, capabilities: {}, features: {},
      } } });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 403, json: { ok: false } });
    return route.fulfill({ json: { ok: true, projects: [], files: [], folders: [], items: [], tickets: [], users: [], facets: { types: [], projects: [], folderCounts: [] }, pagination: { total: 0, hasMore: false } } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  return { requests, state };
}
const cards = (page: Page) => page.locator(".mm-project-card:not(.mm-project-skeleton)");
const filters = (page: Page) => page.getByRole("form", { name: "Filtros de projetos" });
const pagination = (page: Page) => page.getByRole("navigation", { name: "Paginação dos projetos" });
const listRequests = (requests: RequestRecord[]) => requests.filter(item => ["/api/projects", "/api/projects/recent", "/api/projects/favorites"].includes(item.path));
async function openSection(page: Page, name: string) {
  await page.locator(".mm-sidebar-item").filter({ hasText: name }).click();
  await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
}
async function expectCount(page: Page, visible: number, total: number) {
  await expect(cards(page)).toHaveCount(visible);
  await expect(page.getByText(`Exibindo ${visible}/${total}.`, { exact: true })).toBeVisible();
}
async function apply(page: Page) { await filters(page).getByRole("button", { name: "Aplicar", exact: true }).click(); }
async function titles(page: Page) { return cards(page).locator("h2").allTextContents(); }

for (const entry of [
  { name: "Todos os Projetos", description: "Visualize e gerencie todos os seus projetos.", total: 73, endpoint: "/api/projects" },
  { name: "Recentes", description: "Veja os projetos acessados ou atualizados recentemente.", total: 13, endpoint: "/api/projects/recent" },
  { name: "Favoritos", description: "Encontre rapidamente seus projetos favoritos.", total: 11, endpoint: "/api/projects/favorites" },
]) {
  test(`${entry.name}: shared header, complete endpoint set, controls and empty state`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { requests } = await setup(page); await openSection(page, entry.name);
    await expect(page.getByText(entry.description, { exact: true })).toBeVisible();
    const crumb = page.getByRole("navigation", { name: "Caminho da página" });
    await expect(crumb.getByRole("button", { name: "Início", exact: true }).or(crumb.getByRole("link", { name: "Início", exact: true }))).toBeVisible();
    await expect(filters(page).getByLabel("Buscar", { exact: true })).toHaveAttribute("placeholder", "Nome do projeto...");
    await expect(filters(page).getByRole("combobox", { name: "Status", exact: true }).locator("option:checked")).toHaveText("Todos os status");
    await expect(filters(page).getByRole("combobox", { name: "Ordenar por", exact: true }).locator("option")).toHaveText(["Mais recentes", "Mais antigos"]);
    await expect(page.getByRole("link", { name: "Novo mapa", exact: true })).toHaveAttribute("href", "/maps/new/create");
    await expectCount(page, 10, entry.total);
    expect(requests.some(item => item.path === entry.endpoint)).toBe(true);
    await page.locator(".mm-project-pages").screenshot({ path: testInfo.outputPath(`${entry.endpoint.split("/").at(-1)}-desktop.png`), animations: "disabled" });
    await filters(page).getByLabel("Buscar", { exact: true }).fill("não existe"); await apply(page);
    await expectCount(page, 0, 0);
    await expect(page.locator(".mm-project-pages__empty h2")).toHaveText(entry.name === "Favoritos" ? "Nenhum projeto favorito." : entry.name === "Recentes" ? "Nenhum projeto recente." : "Nenhum projeto encontrado.");
    await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
    await expectCount(page, 10, entry.total);
    await expect(page.getByRole("heading", { name: entry.name, exact: true, level: 1 })).toBeVisible();
  });
}

test("draft/apply/clear filters the full set before page slicing and keeps true totals", async ({ page }) => {
  const { requests } = await setup(page); await expectCount(page, 10, 73);
  const original = await titles(page); const initialRequests = listRequests(requests).length;
  await filters(page).getByLabel("Buscar", { exact: true }).fill("  projeto  ");
  await filters(page).getByRole("combobox", { name: "Status", exact: true }).selectOption({ label: "Inativos" });
  await filters(page).getByRole("combobox", { name: "Ordenar por", exact: true }).selectOption({ label: "Mais antigos" });
  expect(await titles(page)).toEqual(original); await expectCount(page, 10, 73);
  await apply(page); await expectCount(page, 10, 25);
  const expected = projects.filter(item => !item.active);
  expect(await titles(page)).toEqual(expected.slice(0, 10).map(item => item.name));
  await pagination(page).getByRole("button", { name: "Próxima página", exact: true }).click();
  expect(await titles(page)).toEqual(expected.slice(10, 20).map(item => item.name));
  await pagination(page).getByRole("button", { name: "Próxima página", exact: true }).click();
  await expectCount(page, 5, 25);
  expect(await titles(page)).toEqual(expected.slice(20).map(item => item.name));
  await expect(pagination(page).getByRole("button", { name: "Próxima página" })).toBeDisabled();
  expect(listRequests(requests).length).toBe(initialRequests);
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await expectCount(page, 10, 73); expect(await titles(page)).toEqual(original);
});

test("all page sizes, last page and name search include items beyond first endpoint batch", async ({ page }) => {
  await setup(page); await expectCount(page, 10, 73);
  for (const size of [20, 50, 10]) {
    await page.getByRole("combobox", { name: "Itens por página", exact: true }).selectOption(String(size));
    await expectCount(page, size, 73);
    await expect(pagination(page).getByRole("button", { name: "Página anterior" })).toBeDisabled();
  }
  await filters(page).getByLabel("Buscar", { exact: true }).fill("Árvore"); await apply(page);
  await expectCount(page, 1, 1); expect(await titles(page)).toEqual([projects[72].name]);
  await filters(page).getByLabel("Buscar", { exact: true }).fill("Marcador somente na descrição"); await apply(page);
  await expectCount(page, 1, 1);
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await page.getByPlaceholder("Buscar", { exact: true }).fill("Marcador somente na descrição");
  await expectCount(page, 1, 1); expect(await titles(page)).toEqual([projects[71].name]);
});

test("Recentes keeps the server-defined set; clear does not navigate to all projects", async ({ page }) => {
  await setup(page, { recentIds: [1, 73] }); await expectCount(page, 10, 73);
  await openSection(page, "Recentes"); await expectCount(page, 2, 2);
  expect(await titles(page)).toEqual([projects[72].name, projects[0].name]);
  await filters(page).getByRole("combobox", { name: "Status", exact: true }).selectOption({ label: "Ativos" }); await apply(page);
  await expectCount(page, 0, 0);
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click(); await expectCount(page, 2, 2);
  await expect(page.getByRole("heading", { name: "Recentes", exact: true, level: 1 })).toBeVisible();
});

test("favorite POST persists across section navigation and reload; DELETE updates the full result", async ({ page }) => {
  const { requests } = await setup(page); await expectCount(page, 10, 73);
  const card = cards(page).filter({ has: page.getByRole("heading", { name: projects[72].name, exact: true }) });
  await card.getByRole("button", { name: "Adicionar projeto aos favoritos" }).click();
  await expect(card.getByRole("button", { name: "Remover projeto dos favoritos" })).toBeVisible();
  await openSection(page, "Favoritos"); await expectCount(page, 10, 12);
  expect(await titles(page)).toContain(projects[72].name);
  await page.reload(); await expectCount(page, 10, 73); await openSection(page, "Favoritos"); await expectCount(page, 10, 12);
  await cards(page).filter({ hasText: projects[72].name }).getByRole("button", { name: "Remover projeto dos favoritos" }).click();
  await expectCount(page, 10, 11);
  expect(requests.filter(item => item.path === "/api/projects/projeto-73/favorite").map(item => item.method)).toEqual(["POST", "DELETE"]);
});

test("unfavorite is optimistic and removing the only last-page result safely clamps", async ({ page }) => {
  const gate = deferred(); const { requests } = await setup(page, { beforeFavorite: () => gate.promise });
  await openSection(page, "Favoritos"); await expectCount(page, 10, 11);
  await pagination(page).getByRole("button", { name: "Próxima página" }).click(); await expectCount(page, 1, 11);
  await cards(page).first().getByRole("button", { name: "Remover projeto dos favoritos" }).click();
  await expectCount(page, 10, 10); // The HTTP mutation is still held here.
  await expect(pagination(page).getByRole("button", { name: "Página anterior" })).toBeDisabled();
  gate.resolve();
  await expect.poll(() => requests.filter(item => item.method === "DELETE").length).toBe(1);
  await openSection(page, "Todos os Projetos"); await openSection(page, "Favoritos"); await expectCount(page, 10, 10);
});

test("favorite failure rolls back inline without replacing the populated grid", async ({ page }) => {
  const gate = deferred(); await setup(page, { failFavorite: true, beforeFavorite: () => gate.promise });
  await openSection(page, "Favoritos"); await expectCount(page, 10, 11);
  const removed = (await titles(page))[0];
  await cards(page).first().getByRole("button", { name: "Remover projeto dos favoritos" }).click();
  await expectCount(page, 10, 10); expect(await titles(page)).not.toContain(removed);
  gate.resolve(); await expectCount(page, 10, 11); expect(await titles(page)).toContain(removed);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Não foi possível carregar os projetos" })).toHaveCount(0);
});

test("removing the last favorite presents the Favorites empty state", async ({ page }) => {
  await setup(page, { dataset: [projects[0]] }); await openSection(page, "Favoritos"); await expectCount(page, 1, 1);
  await cards(page).getByRole("button", { name: "Remover projeto dos favoritos" }).click();
  await expectCount(page, 0, 0);
  await expect(page.getByRole("heading", { name: "Nenhum projeto favorito." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Favoritos", exact: true, level: 1 })).toBeVisible();
});

for (const name of ["Todos os Projetos", "Recentes", "Favoritos"]) {
  test(`${name}: empty endpoint retains header and filters`, async ({ page }) => {
    await setup(page, { dataset: [] }); await openSection(page, name); await expectCount(page, 0, 0);
    await expect(filters(page)).toBeVisible(); await expect(page.locator(".mm-project-pages__empty h2")).toBeVisible();
  });
}

test("loading and list failure preserve the shell and retry the same endpoint", async ({ page }) => {
  const gate = deferred(); let fails = true;
  await setup(page, { beforeList: () => gate.promise, failList: () => fails });
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true, level: 1 })).toBeVisible();
  await expect(filters(page)).toBeVisible(); await expect(page.locator(".mm-project-skeleton").first()).toBeVisible();
  gate.resolve(); await expect(page.getByRole("heading", { name: "Não foi possível carregar os projetos" })).toBeVisible();
  fails = false; await page.getByRole("button", { name: "Tentar novamente" }).click(); await expectCount(page, 10, 73);
});

test("organization switch clears page/filter state and cannot show the previous organization's cards", async ({ page }) => {
  const other = { ...projects[0], id: 201, organizationId: 2, slug: "outro-projeto", name: "Projeto da outra organização" };
  const { requests } = await setup(page, { dataset: [...projects, other] }); await expectCount(page, 10, 73);
  await filters(page).getByLabel("Buscar", { exact: true }).fill("Projeto 2"); await apply(page);
  await page.getByRole("button", { name: /Trocar organização ativa/ }).click();
  await page.getByRole("option", { name: /Outra organização/ }).click();
  await expectCount(page, 1, 1); expect(await titles(page)).toEqual([other.name]);
  await expect(filters(page).getByLabel("Buscar", { exact: true })).toHaveValue("");
  expect(requests.some(item => item.path === "/api/session/active-organization" && item.method === "PUT" && JSON.parse(item.body!).organizationId === 2)).toBe(true);
});

test("viewer permission boundary preserves readonly cards and hides creation/edit controls", async ({ page }) => {
  const readonly = { ...projects[0], accessLevel: "viewer", permissions: ["project.view"], deniedPermissions: ["project.save", "project.edit", "project.create", "project.favorite"] };
  await setup(page, { dataset: [readonly], role: "viewer", deniedPermissions: ["project.create", "project.edit", "project.save", "project.favorite"] });
  await expectCount(page, 1, 1);
  await expect(page.getByRole("link", { name: "Novo mapa", exact: true })).toHaveCount(0);
  await expect(cards(page).getByText("Somente leitura", { exact: true })).toBeVisible();
  await expect(cards(page).getByRole("button", { name: /Mais ações|favoritos/ })).toHaveCount(0);
  await expect(cards(page).getByRole("link", { name: "Abrir projeto" })).toHaveAttribute("href", "/projects/projeto-01/manage");
});

test("existing thumbnail, menu keyboard dismissal and metadata editing flow remain intact", async ({ page }) => {
  await setup(page, { dataset: [{ ...projects[0], thumbnailStatus: "READY", thumbnailUrl: "/api/fixture-preview", configRevision: 1, thumbnailRevision: 1 }] });
  await expectCount(page, 1, 1);
  await expect(cards(page).getByRole("img", { name: `Prévia do projeto ${projects[0].name}` })).toHaveClass("is-loaded");
  const trigger = cards(page).getByRole("button", { name: `Mais ações do projeto ${projects[0].name}` });
  await trigger.click(); await expect(page.getByRole("menuitem", { name: /Editar/ })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("menu")).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await page.getByRole("menuitem", { name: /Editar/ }).click();
  await expect(page.getByRole("dialog", { name: "Editar projeto" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar edição do projeto" }).click();
  await expectCount(page, 1, 1);
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`desktop/mobile reflow at ${width}px preserves every card and field`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); await setup(page); await expectCount(page, 10, 73);
    const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
    for (const control of await page.locator('.mm-project-pages input, .mm-project-pages select, .mm-project-pages button').all()) {
      const box = await control.boundingBox(); if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    const grid = await page.locator(".mm-project-pages__grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(grid).toBeGreaterThanOrEqual(1); expect(grid).toBeLessThanOrEqual(4);
    if (width === 1920) expect(grid).toBe(4);
    if (width <= 390) expect(grid).toBe(1);
    await page.locator(".mm-project-pages").screenshot({ path: testInfo.outputPath(`projects-${width}.png`), animations: "disabled" });
  });
}

test("container-only grid adapts 4→3→2→1 without modifying card internals", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 }); await setup(page); await expectCount(page, 10, 73);
  const counts = new Set<number>();
  for (const width of [1500, 1200, 950, 700, 500, 320]) {
    await page.locator(".mm-project-pages").evaluate((el, value) => { (el as HTMLElement).style.width = `${value}px`; }, width);
    const count = await page.locator(".mm-project-pages__grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    counts.add(count);
  }
  expect([...counts].sort()).toEqual([1, 2, 3, 4]);
});

test("leaving project sections removes scoped styling and returning preserves existing navigation", async ({ page }) => {
  await setup(page); await expectCount(page, 10, 73);
  await page.locator(".mm-sidebar-item").filter({ hasText: "Arquivos e Documentos" }).click();
  await expect(page.locator("#mm-docs-title")).toBeVisible(); await expect(page.locator(".mm-project-pages")).toHaveCount(0);
  await expect(page.locator(".mm-docs")).not.toHaveClass(/mm-project-pages/);
  await openSection(page, "Todos os Projetos"); await expectCount(page, 10, 73);
  await openSection(page, "Favoritos");
  const crumb = page.getByRole("navigation", { name: "Caminho da página" });
  await crumb.getByRole("button", { name: "Início", exact: true }).or(crumb.getByRole("link", { name: "Início", exact: true })).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true, level: 1 })).toBeVisible();
});

test("existing open-project action uses prepared navigation; new-map uses its established route", async ({ page }) => {
  const { requests } = await setup(page, { dataset: [projects[0]] }); await expectCount(page, 1, 1);
  await cards(page).getByRole("link", { name: "Abrir projeto" }).click();
  await expect.poll(() => requests.some(item => item.path === "/api/projects/projeto-01/map-navigation" && item.query === "?mode=manage")).toBe(true);
  await expect(page).toHaveURL(/\/projects\/projeto-01\/(?:view|manage)$/);
  await page.goto("/projects"); await expectCount(page, 1, 1);
  await page.getByRole("link", { name: "Novo mapa", exact: true }).click();
  await expect(page).toHaveURL(/\/maps\/new\/create$/);
});

for (const delayedList of [false, true]) {
  test(`favorite POST completing after switching tabs survives ${delayedList ? "a stale held" : "an earlier"} Favorites GET`, async ({ page }) => {
    const mutation = deferred(); const listing = deferred();
    const { requests, state } = await setup(page, {
      beforeFavorite: () => mutation.promise,
      beforeList: path => path === "/api/projects/favorites" && delayedList ? listing.promise : Promise.resolve(),
    });
    await expectCount(page, 10, 73);
    await cards(page).filter({ hasText: projects[72].name }).getByRole("button", { name: "Adicionar projeto aos favoritos" }).click();
    await openSection(page, "Favoritos");
    await expect.poll(() => requests.some(item => item.path === "/api/projects/favorites")).toBe(true);
    mutation.resolve();
    await expect.poll(() => state.find(item => item.id === 73)?.favorite).toBe(true);
    listing.resolve();
    await expectCount(page, 10, 12);
    await expect(cards(page).filter({ hasText: projects[72].name })).toBeVisible();
  });
}

test("old favorite failure after A→B→A cannot roll back or unlock a new same-slug mutation", async ({ page }) => {
  const first = deferred(); const second = deferred();
  const other = { ...projects[0], id: 201, organizationId: 2, name: "Projeto da outra organização", slug: "outro-projeto" };
  await setup(page, { dataset: [projects[0], other], beforeFavorite: attempt => attempt === 1 ? first.promise : second.promise, failFavorite: attempt => attempt === 1 });
  await expectCount(page, 1, 1);
  await cards(page).getByRole("button", { name: "Remover projeto dos favoritos" }).click();
  for (const organization of ["Outra organização", "Organização de demonstração"]) {
    await page.getByRole("button", { name: /Trocar organização ativa/ }).click();
    await page.getByRole("option", { name: new RegExp(organization) }).click();
    await expectCount(page, 1, 1);
    await expect(page.getByRole("button", { name: new RegExp(`${organization} Workspace`) })).toBeVisible();
  }
  await cards(page).getByRole("button", { name: "Remover projeto dos favoritos" }).click();
  const pending = cards(page).getByRole("button", { name: "Adicionar projeto aos favoritos" });
  await expect(pending).toBeDisabled();
  first.resolve();
  await page.waitForTimeout(200); // Let the stale response's catch/finally run.
  await expect(pending).toBeDisabled(); await expect(pending).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  second.resolve(); await expect(pending).toBeEnabled();
});

// Footer placement is a document-flow contract, not a fixed/sticky toolbar.
// Exercise every tab with both spare space and content taller than the viewport.
for (const name of ["Todos os Projetos", "Recentes", "Favoritos"]) {
  for (const viewport of [{ width: 1440, height: 1600 }, { width: 390, height: 1600 }]) {
    for (const count of [0, 1, 30]) {
      test(`${name}: footer fills remaining page at ${viewport.width}px with ${count} projects`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        const dataset = projects.slice(0, count).map(project => ({ ...project, favorite: true }));
        await setup(page, { dataset, recentIds: dataset.map(project => project.id) });
        await openSection(page, name);
        await expectCount(page, Math.min(count, 10), count);
        if (count > 10) {
          await pagination(page).getByRole("combobox", { name: "Itens por página", exact: true }).selectOption("50");
          await expectCount(page, count, count);
        }
        await page.evaluate(() => document.fonts.ready);
        const originalCardHeights = await cards(page).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
        const evidence = [];
        for (const tallSidebar of [false, true]) {
          // A tall sidebar reproduces the otherwise-empty main column in the reference.
          // On mobile the same sidebar remains above the naturally flowing main area.
          await page.locator(".mm-projects-sidebar").evaluate((element, tall) => {
            (element as HTMLElement).style.minHeight = tall ? "2200px" : "";
          }, tallSidebar);
          await page.evaluate(() => window.scrollTo(0, 0));
          const top = await footerGeometry(page);
          const label = `${name}, ${viewport.width}px, ${count} projects, tall sidebar: ${tallSidebar}`;
          expect(["fixed", "absolute", "sticky"], label).not.toContain(top.footerPosition);
          expect(top.footerBottom, label).toBeCloseTo(top.contentBottom - top.paddingBottom, 0);
          expect(top.contentBottom, label).toBeCloseTo(top.mainBottom, 0);
          expect(top.mainBottom, label).toBeCloseTo(top.layoutBottom, 0);
          expect(top.paddingBottom, label).toBeGreaterThan(0);
          expect(top.paddingBottom, label).toBeLessThanOrEqual(24);
          expect(top.mainHeight, label).toBeGreaterThanOrEqual(viewport.height - 1);
          expect(top.footerTop - top.resultsBottom, label).toBeGreaterThanOrEqual(27.5);
          // scrollHeight is integer-rounded; WebKit may keep a half-pixel layout edge.
          expect(Math.abs(top.documentBottom - top.footerBottom - top.paddingBottom), label).toBeLessThanOrEqual(1);
          expect(top.horizontalOverflow, label).toBeLessThanOrEqual(1);
          if (tallSidebar && viewport.width > 760) {
            expect(top.mainBottom, label).toBeGreaterThanOrEqual(top.sidebarBottom - 1);
          }
          if (count > 10) {
            expect(top.resultsHeight, label).toBeGreaterThan(viewport.height);
            expect(top.footerTop, label).toBeGreaterThan(viewport.height);
          }
          const cardHeights = await cards(page).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
          expect(cardHeights, `${label}: spare space must not stretch the cards`).toEqual(originalCardHeights);
          // Scrolling moves the footer by precisely the document scroll distance.
          // At the real scroll end it is fully visible, separated from every result.
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await expect.poll(async () => (await footerGeometry(page)).scrollY).toBeCloseTo(Math.max(0, top.documentBottom - viewport.height), 0);
          const bottom = await footerGeometry(page);
          expect(bottom.footerTop, label).toBeCloseTo(top.footerTop, 0);
          expect(bottom.footerViewportTop, label).toBeCloseTo(top.footerViewportTop - (bottom.scrollY - top.scrollY), 0);
          expect(bottom.footerViewportBottom, label).toBeLessThanOrEqual(viewport.height - top.paddingBottom + 1);
          expect(bottom.footerViewportTop, label).toBeGreaterThanOrEqual(0);
          await expect(pagination(page)).toBeInViewport();
          evidence.push({ tallSidebar, top, bottom });
        }
        await testInfo.attach("footer-geometry", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
        if (count === 1) {
          await page.screenshot({ path: testInfo.outputPath("footer-at-page-bottom.png"), animations: "disabled" });
        }
      });
    }
  }
}

async function footerGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const footer = document.querySelector(".mm-project-pages__footer")!;
    const content = document.querySelector(".mm-project-pages > .mm-projects-content")!;
    const footerBox = footer.getBoundingClientRect();
    const mainBox = box(".mm-project-pages");
    const resultsBox = box(".mm-project-pages__grid, .mm-project-pages__empty");
    const offset = window.scrollY;
    return {
      scrollY: offset,
      footerPosition: getComputedStyle(footer).position,
      footerTop: footerBox.top + offset,
      footerBottom: footerBox.bottom + offset,
      footerViewportTop: footerBox.top,
      footerViewportBottom: footerBox.bottom,
      contentBottom: content.getBoundingClientRect().bottom + offset,
      paddingBottom: Number.parseFloat(getComputedStyle(content).paddingBottom),
      mainBottom: mainBox.bottom + offset,
      mainHeight: mainBox.height,
      layoutBottom: box(".mm-projects-layout").bottom + offset,
      sidebarBottom: box(".mm-projects-sidebar").bottom + offset,
      resultsBottom: resultsBox.bottom + offset,
      resultsHeight: resultsBox.height,
      documentBottom: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

for (const name of ["Todos os Projetos", "Recentes", "Favoritos"]) {
  for (const width of [1440, 390]) {
    test(`${name}: new-map CTA keeps its dimensions with the approved inset at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await setup(page, { dataset: [projects[0]], recentIds: [projects[0].id] });
      await openSection(page, name); await expectCount(page, 1, 1);
      await page.evaluate(() => document.fonts.ready);
      const cta = page.getByRole("link", { name: "Novo mapa", exact: true });
      await expect(cta).toHaveAttribute("href", "/maps/new/create");
      const geometry = await cta.evaluate(element => {
        const button = element.getBoundingClientRect();
        const header = element.closest("header")!;
        const box = header.getBoundingClientRect();
        const styles = getComputedStyle(header);
        return {
          width: button.width, height: button.height, x: button.x, y: button.y,
          rightInset: box.right - button.right,
          contentWidth: box.width - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight),
          paddingRight: Number.parseFloat(styles.paddingRight),
          marginEnd: Number.parseFloat(getComputedStyle(element).marginInlineEnd),
        };
      });
      // DOMRect floats can differ by ~0.000008px after Firefox relayout.
      // Keep the geometry contract within 0.0005px instead of comparing bits.
      expect(geometry.height).toBeCloseTo(48, 3);
      if (width > 760) {
        expect(geometry.width).toBeCloseTo(164, 3);
        expect(geometry.marginEnd).toBe(32);
        expect(geometry.rightInset).toBeCloseTo(geometry.paddingRight + 32, 3);
        // Compare to the former right-aligned position, keeping the same DOM and viewport.
        await cta.evaluate(element => { (element as HTMLElement).style.marginInlineEnd = "0"; });
        const former = await cta.boundingBox();
        expect(former!.x - geometry.x).toBeCloseTo(32, 3);
        expect(former!.width).toBeCloseTo(geometry.width, 3);
        expect(former!.height).toBeCloseTo(geometry.height, 3);
        expect(former!.y).toBeCloseTo(geometry.y, 3);
        await cta.evaluate(element => { (element as HTMLElement).style.removeProperty("margin-inline-end"); });
      } else {
        expect(geometry.marginEnd).toBe(0);
        expect(geometry.width).toBeCloseTo(geometry.contentWidth, 3);
        expect(geometry.rightInset).toBe(geometry.paddingRight);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const footer = await footerGeometry(page);
      expect(footer.footerBottom).toBeCloseTo(footer.mainBottom - footer.paddingBottom, 0);
      await testInfo.attach("new-map-geometry", { body: JSON.stringify({ geometry, footer }, null, 2), contentType: "application/json" });
      await page.locator(".mm-project-pages").screenshot({ path: testInfo.outputPath("new-map-and-footer.png"), animations: "disabled" });
    });
  }
}

// Sidebar-only redesign acceptance. The compiled app and real components run
// against synthetic HTTP fixtures; this is not authenticated Preview acceptance.
test('sidebar: flat navigation, existing icons and every section remain functional', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, { dataset: projects.slice(1, 2) });
  await page.route('**/tickets/exports**', route => route.fulfill({ json: { enabled: false, jobs: [], nextCursor: null } }));
  await page.route(url => /\/api\/organizations\/[^/]+\/tickets$/.test(url.pathname), route => route.fulfill({ json: {
    ok: true, tickets: [], assignees: [],
    facets: { byStatus: { new: 0, open: 0, in_progress: 0, in_review: 0, closed: 0 }, overdue: 0 },
    pagination: { page: 1, limit: 50, total: 0, hasMore: false },
  } }));
  const sidebar = page.getByRole('complementary', { name: 'Navegação da área de projetos' });
  await expect(sidebar.locator('.mm-sidebar-title')).toHaveText(['Projetos', 'Organização', 'Gestão', 'Administração Maõno']);
  await expect(sidebar.locator('.mm-sidebar-count')).toHaveText('1');
  await expect(sidebar.locator('.mm-sidebar-user-copy strong')).toHaveText('Operador de demonstração - Super Admin');
  await expect(sidebar.locator('.mm-sidebar-user')).toContainText('qa@example.test');
  const routes = [
    ['Todos os Projetos', '▦'], ['Recentes', '◷'], ['Favoritos', '☆'],
    ['Arquivos e Documentos', '▤'], ['Central de Chamados', 'svg'], ['Roadmap', '◫'],
    ['Usuários e Acessos', '☷'], ['Organização', '▥'], ['Limites e Planos', '▧'], ['Auditoria', '◌'],
  ];
  for (const [name, icon] of routes) {
    const item = sidebar.getByRole('button', { name, exact: true });
    await item.click();
    await expect(item).toHaveAttribute('aria-current', 'page');
    await expect(sidebar.locator('.mm-sidebar-item.active')).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe('/projects'); // Existing internal section router.
    if (icon === 'svg') await expect(item.locator('svg')).toBeVisible();
    else await expect(item.locator('.mm-sidebar-icon')).toHaveText(icon);
    await expect(item).not.toHaveAttribute('title');
    const visual = await item.evaluate(element => {
      const style = getComputedStyle(element); const marker = getComputedStyle(element, '::before');
      return { border: style.borderTopWidth, background: style.backgroundImage, marker: marker.width, markerColor: marker.backgroundColor };
    });
    expect(visual.border).toBe('0px');
    expect(visual.background).toContain('linear-gradient');
    expect(visual.marker).toBe('3px');
    expect(visual.markerColor).not.toBe('rgba(0, 0, 0, 0)');
    await sidebar.getByRole('button', { name: 'Recentes', exact: true }).click();
    if (name !== 'Recentes') await expect(item).not.toHaveAttribute('aria-current');
  }
  await sidebar.getByRole('button', { name: 'Central de Chamados', exact: true }).click();
  await page.mouse.move(1400, 20);
  for (const item of await sidebar.locator('.mm-sidebar-item:not(.active)').all()) {
    await expect(item).toHaveCSS('border-top-width', '0px');
    await expect(item).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  await expect(sidebar.getByRole('link', { name: 'Painel Admin' })).toHaveAttribute('href', '/admin');
  await expect(sidebar.locator('.mm-sidebar-user')).toHaveCSS('border-top-width', '0px');
  for (const title of await sidebar.locator('.mm-sidebar-title').all()) {
    expect(await title.evaluate(element => getComputedStyle(element, '::after').content)).toBe('""');
  }
  await sidebar.screenshot({ path: testInfo.outputPath('sidebar-expanded.png'), animations: 'disabled' });
});

test('sidebar: hover, keyboard focus, truncation and collapsed tooltips', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { dataset: projects.slice(0, 1) });
  const sidebar = page.locator('.mm-projects-sidebar');
  const recent = sidebar.getByRole('button', { name: 'Recentes', exact: true });
  await recent.hover();
  await expect(recent).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(recent).toHaveCSS('border-top-width', '0px');
  await recent.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  expect(await recent.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  await expect(recent).toHaveCSS('outline-style', 'solid');
  const label = sidebar.getByRole('button', { name: 'Arquivos e Documentos', exact: true }).locator('.mm-sidebar-label');
  await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  await expect(label).toHaveCSS('white-space', 'nowrap');
  // Stress a long label without changing application copy or sidebar width.
  await label.evaluate(element => { element.textContent += ' com um título muito longo de teste'; });
  expect(await label.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(sidebar).toHaveCSS('width', '300px');
  await sidebar.getByRole('button', { name: 'Recolher sidebar' }).click();
  await expect(sidebar).toHaveCSS('width', '92px');
  await expect(sidebar.locator('.mm-sidebar-label').first()).toBeHidden();
  await expect(sidebar.locator('.mm-sidebar-count')).toBeHidden();
  await expect(sidebar.locator('.mm-sidebar-title')).toHaveCount(0);
  await expect(sidebar.locator('.mm-sidebar-user')).toHaveCount(0);
  for (const item of await sidebar.locator('.mm-sidebar-nav .mm-sidebar-item').all()) {
    await expect(item).toHaveAttribute('title', (await item.getAttribute('aria-label'))!);
    await expect(item.locator('.mm-sidebar-label')).toBeHidden();
    await expect(item.locator('.mm-sidebar-icon')).toBeVisible();
  }
  await expect(recent).toHaveAttribute('title', 'Recentes');
  await recent.click(); await expect(recent).toHaveAttribute('aria-current', 'page');
  await expect(recent.locator('.mm-sidebar-icon')).toBeVisible();
  await sidebar.screenshot({ path: testInfo.outputPath('sidebar-collapsed.png'), animations: 'disabled' });
  await sidebar.getByRole('button', { name: 'Expandir sidebar' }).click();
  await expect(sidebar).toHaveCSS('width', '300px');
  await expect(recent).toHaveAttribute('aria-current', 'page');
});

test('sidebar: search, organization switching and permission-filtered navigation', async ({ page }) => {
  await setup(page, { role: 'viewer', deniedPermissions: ['document.view', 'ticket.view', 'roadmap.view', 'users.view', 'organization.view', 'limits.view'] });
  const sidebar = page.locator('.mm-projects-sidebar');
  await expect(sidebar.locator('.mm-sidebar-title')).toHaveText(['Projetos']);
  await expect(sidebar.locator('.mm-sidebar-item')).toHaveCount(3);
  await sidebar.getByRole('textbox', { name: 'Buscar projetos' }).fill('Projeto 01');
  await expectCount(page, 1, 1);
  await sidebar.getByRole('textbox', { name: 'Buscar projetos' }).clear();
  await expectCount(page, 10, 73);
  const trigger = sidebar.getByRole('button', { name: /Trocar organização ativa/ });
  await trigger.click();
  await page.getByRole('option', { name: /Outra organização/ }).click();
  await expect(trigger).toContainText('Outra organização');
  await expectCount(page, 0, 0);
  await expect(sidebar.locator('.mm-sidebar-count')).toHaveText('0');
  await expect(sidebar.getByRole('button', { name: 'Todos os Projetos', exact: true })).toHaveAttribute('aria-current', 'page');
  await trigger.click(); await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const viewport of [
  { width: 1366, height: 768 }, { width: 1024, height: 600 },
  { width: 1366, height: 480 }, { width: 390, height: 844 }, { width: 390, height: 568 },
]) {
  test(`sidebar: responsive navigation and scroll at ${viewport.width}x${viewport.height}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await setup(page, { dataset: projects.slice(0, 1), userName: 'Matheus Andrade' });
    await expectCount(page, 1, 1);
    const sidebar = page.locator('.mm-projects-sidebar');
    await expect(sidebar.getByRole('button', { name: 'Todos os Projetos', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.evaluate(() => document.fonts.ready);
    if (viewport.width === 1366 && viewport.height === 768) {
      await page.screenshot({ path: testInfo.outputPath('sidebar-all-projects-desktop.png'), animations: 'disabled' });
      await sidebar.screenshot({ path: testInfo.outputPath('sidebar-all-projects-crop.png'), animations: 'disabled' });
    }
    const limits = sidebar.getByRole('button', { name: 'Limites e Planos', exact: true });
    await limits.click(); await expect(limits).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // WebKit can round 100dvh to 843.984375px for an 844px viewport.
    await expect.poll(async () => Math.abs((await sidebar.boundingBox())!.height - viewport.height)).toBeLessThanOrEqual(0.05);
    await expect(sidebar).toHaveCSS('overflow-y', 'hidden');
    await expect(sidebar).toHaveCSS('overflow-x', 'hidden');
    const nav = sidebar.locator('.mm-sidebar-nav');
    await expect(nav).toHaveCSS('min-height', '0px');
    await expect(nav).toHaveCSS('overflow-y', 'auto');
    await expect(nav).toHaveCSS('overscroll-behavior-y', 'contain');
    // Every tested viewport needs real overflow with the full permitted registry.
    expect(await nav.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await nav.evaluate(element => { element.scrollTop = 0; });
    const before = await sidebarGeometry(page);
    for (const [name, box] of Object.entries(before.pinned)) {
      expect(box.top, `${name} is inside the viewport`).toBeGreaterThanOrEqual(-1);
      expect(box.bottom, `${name} is inside the viewport`).toBeLessThanOrEqual(viewport.height + 1);
    }
    expect(before.nav.top).toBeGreaterThanOrEqual(before.pinned.header.bottom - 1);
    expect(before.nav.bottom).toBeLessThanOrEqual(before.pinned.footer.top + 1);
    await nav.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => nav.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const after = await sidebarGeometry(page);
    expect(after.sidebarScrollTop).toBe(0);
    expect(after.documentScrollTop).toBe(before.documentScrollTop);
    for (const [name, box] of Object.entries(before.pinned)) {
      expect(after.pinned[name].top, `${name} stays pinned while nav scrolls`).toBeCloseTo(box.top, 0);
      expect(after.pinned[name].bottom, `${name} stays pinned while nav scrolls`).toBeCloseTo(box.bottom, 0);
    }
    expect(after.firstItemTop).toBeLessThan(before.firstItemTop);
    // Reaching the navigation's end must not chain the gesture to the page.
    await nav.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.mouse.wheel(0, 700);
    await expect(sidebar.getByRole('button', { name: 'Auditoria', exact: true })).toBeInViewport();
    expect((await sidebarGeometry(page)).documentScrollTop).toBe(before.documentScrollTop);
    if (viewport.height === 480) await sidebar.screenshot({ path: testInfo.outputPath('sidebar-short-height-scrolled.png'), animations: 'disabled' });
    await testInfo.attach('sidebar-scroll-geometry', { body: JSON.stringify({ viewport, before, after }, null, 2), contentType: 'application/json' });
    await sidebar.getByRole('button', { name: 'Recolher sidebar' }).click();
    await sidebar.getByRole('button', { name: 'Favoritos', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: 'Favoritos', exact: true })).toHaveAttribute('aria-current', 'page');
    if (viewport.height === 480) await sidebar.screenshot({ path: testInfo.outputPath('sidebar-short-height-collapsed.png'), animations: 'disabled' });
    await sidebar.getByRole('button', { name: 'Expandir sidebar' }).click();
    await sidebar.screenshot({ path: testInfo.outputPath('sidebar-responsive.png'), animations: 'disabled' });
  });
}

async function sidebarGeometry(page: Page) {
  return page.locator('.mm-projects-sidebar').evaluate(element => {
    const bounds = (selector: string) => {
      const box = element.querySelector(selector)!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    const selectors = {
      header: '.mm-sidebar-head', brand: '.mm-sidebar-brand-row', user: '.mm-sidebar-user',
      search: '.mm-sidebar-search', organization: '.mm-organization-switcher', footer: '.mm-sidebar-footer',
    };
    return {
      pinned: Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, bounds(selector)])),
      nav: bounds('.mm-sidebar-nav'), firstItemTop: bounds('.mm-sidebar-nav .mm-sidebar-item').top,
      sidebarScrollTop: element.scrollTop, documentScrollTop: window.scrollY,
    };
  });
}

// Values come from the existing API/session role schema; client is normalized
// to owner by the real session provider before it reaches ProjectsSidebar.
for (const [role, label] of [
  ['super_admin', 'Super Admin'], ['admin', 'Admin'], ['owner', 'Owner'],
  ['client', 'Owner'], ['editor', 'Editor'], ['viewer', 'Viewer'],
]) {
  test(`sidebar: session identity renders ${role} independently of organization membership`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await setup(page, {
      dataset: [], role, userName: 'Ana Oliveira', userEmail: 'ana.oliveira@example.test',
      organizationRoles: { 1: 'editor', 2: 'viewer' },
    });
    const sidebar = page.locator('.mm-projects-sidebar');
    const identity = sidebar.locator('.mm-sidebar-user-copy');
    await expect(identity.locator('strong')).toHaveText(`Ana Oliveira - ${label}`);
    await expect(identity.locator('span')).toHaveText('ana.oliveira@example.test');
    const [nameBox, emailBox] = await Promise.all([identity.locator('strong').boundingBox(), identity.locator('span').boundingBox()]);
    expect(emailBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
    await expect(sidebar.locator('.mm-sidebar-footer')).toHaveText(/^\s*Maõno Maps\s*Sair\s*$/);
    const membership = sidebar.locator('.mm-organization-trigger-copy > span');
    await expect(membership).toHaveText('Editor');
    await sidebar.getByRole('button', { name: /Trocar organização ativa/ }).click();
    await page.getByRole('option', { name: /Outra organização/ }).click();
    await expect(membership).toHaveText('Visualizador');
    await expect(identity.locator('strong')).toHaveText(`Ana Oliveira - ${label}`);
    await expect(sidebar.locator('.mm-sidebar-count')).toHaveText('0');
  });
}

test('sidebar: long session name and email truncate without growing the identity block', async ({ page }) => {
  const name = 'Ana Maria de Albuquerque dos Santos Oliveira de Souza';
  const email = 'ana.maria.albuquerque.santos.oliveira@example.test';
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page, { dataset: [], role: 'super_admin', userName: name, userEmail: email });
  const sidebar = page.locator('.mm-projects-sidebar');
  const identity = sidebar.locator('.mm-sidebar-user-copy strong');
  const emailLine = sidebar.locator('.mm-sidebar-user-copy > span');
  await expect(identity).toHaveText(`${name} - Super Admin`);
  await expect(emailLine).toHaveText(email);
  await expect(identity).toHaveAttribute('title', `${name} - Super Admin`);
  await expect(emailLine).toHaveAttribute('title', email);
  for (const line of [identity, emailLine]) {
    await expect(line).toHaveCSS('white-space', 'nowrap');
    await expect(line).toHaveCSS('overflow', 'hidden');
    await expect(line).toHaveCSS('text-overflow', 'ellipsis');
    expect(await line.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    const geometry = await line.evaluate(element => {
      const box = element.getBoundingClientRect();
      const sidebar = element.closest('.mm-projects-sidebar')!.getBoundingClientRect();
      return { right: box.right, sidebarRight: sidebar.right, height: box.height, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight) };
    });
    expect(geometry.right).toBeLessThan(geometry.sidebarRight);
    // WebKit rounds a 19.5px line box to 19px without adding another line.
    expect(Math.abs(geometry.height - geometry.lineHeight)).toBeLessThanOrEqual(0.5);
  }
  await expect(sidebar).toHaveCSS('width', '300px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

for (const collapsed of [false, true]) {
  test(`sidebar: ${collapsed ? 'collapsed' : 'expanded'} minimalist footer and existing logout callback`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const { requests } = await setup(page, { dataset: [] });
    const sidebar = page.locator('.mm-projects-sidebar');
    if (collapsed) await sidebar.getByRole('button', { name: 'Recolher sidebar' }).click();
    const footer = sidebar.locator('.mm-sidebar-footer');
    const logout = footer.getByRole('button', { name: 'Sair da conta', exact: true });
    await expect(logout).toHaveAttribute('type', 'button');
    await expect(logout).toHaveAttribute('title', 'Sair');
    await expect(logout).toBeInViewport();
    await expect(logout.locator('svg')).toBeVisible();
    await expect(logout.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(await logout.locator('svg path, svg line, svg polyline').count()).toBeGreaterThan(0);
    await expect(footer.locator('img')).toHaveCount(0);
    if (collapsed) {
      await expect(sidebar).toHaveCSS('width', '92px');
      await expect(footer.getByText('Maõno Maps', { exact: true })).toBeHidden();
      await expect(logout.getByText('Sair', { exact: true })).toBeHidden();
    } else {
      await expect(footer).toHaveText(/^\s*Maõno Maps\s*Sair\s*$/);
      await expect(logout.getByText('Sair', { exact: true })).toBeVisible();
    }
    for (const element of [footer, logout]) {
      for (const edge of ['top', 'right', 'bottom', 'left']) {
        // The footer keeps its single requested divider; logout has no border.
        await expect(element).toHaveCSS(`border-${edge}-width`, element === footer && edge === 'top' ? '1px' : '0px');
      }
      await expect(element).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(element).toHaveCSS('background-image', 'none');
      await expect(element).toHaveCSS('box-shadow', 'none');
    }
    await logout.hover();
    await expect(logout).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(logout).toHaveCSS('border-top-width', '0px');
    await logout.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(logout).toBeFocused();
    expect(await logout.evaluate(element => element.matches(':focus-visible'))).toBe(true);
    await expect(logout).toHaveCSS('outline-style', 'solid');
    expect(await logout.evaluate(element => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
    await footer.screenshot({ path: testInfo.outputPath(`sidebar-footer-${collapsed ? 'collapsed' : 'expanded'}.png`), animations: 'disabled' });
    expect(requests.filter(request => request.path === '/api/auth/logout')).toHaveLength(0);
    if (collapsed) await logout.click();
    else await page.keyboard.press('Enter');
    await expect.poll(() => requests.filter(request => request.path === '/api/auth/logout').length).toBe(1);
    expect(requests.find(request => request.path === '/api/auth/logout')?.method).toBe('POST');
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(sidebar).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(sidebar).toHaveCount(0);
    expect(requests.filter(request => request.path === '/api/auth/logout')).toHaveLength(1);
  });
}
