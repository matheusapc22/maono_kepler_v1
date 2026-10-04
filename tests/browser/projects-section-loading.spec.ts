import { expect, test, type Page } from "@playwright/test";

// Compiled local React application with controlled synthetic HTTP responses.
// No real account, production URL, credentials or acceptance window.
const sections = [
  { name: "Organização", resource: "organization", selector: ".mm-organization-section", loaded: "organização-1" },
  { name: "Limites e Planos", resource: "limits", selector: ".mm-limits-section", loaded: "Enterprise" },
  { name: "Usuários e Acessos", resource: "users", selector: ".users-access-workspace", loaded: "Pessoa da organização 1" },
] as const;
type Section = typeof sections[number];
const errors = new WeakMap<Page, string[]>();
const unexpectedWrites = new WeakMap<Page, string[]>();
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function setup(page: Page, options: {
  beforeRead?: (resource: string, organizationId: number, attempt: number) => Promise<void>;
  failure?: boolean; role?: string; allowRequest?: boolean; failureResources?: string[]; failureStatus?: number; emptyUsers?: boolean; delegated?: boolean;
} = {}) {
  let organizationId = 1, failure = Boolean(options.failure);
  const organizations = [{ id: 1, name: "Organização de demonstração", slug: "demo", active: true }, { id: 2, name: "Organização secundária", slug: "second", active: true }];
  const requests: string[] = [], attempts = new Map<string, number>();
  errors.set(page, []); unexpectedWrites.set(page, []);
  page.on("pageerror", error => errors.get(page)!.push(error.message));
  const session = () => ({ authenticated: true, user: { id: 1, name: "Operador sintético", email: "qa@example.test", role: options.role ?? "super_admin", activeOrganizationId: organizationId, organizationId, permissions: [] }, projects: [], organizations, activeOrganization: organizations.find(item => item.id === organizationId) });
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    requests.push(`${method} ${path}`);
    if (path === "/api/session") return route.fulfill({ json: session() });
    if (path === "/api/session/active-organization" && method === "PUT") {
      organizationId = Number(request.postDataJSON().organizationId);
      return route.fulfill({ json: { ok: true, ...session() } });
    }
    if (options.allowRequest && path === "/api/organizations/1/limits/requests" && method === "POST") return route.fulfill({ json: { ok: true, request: { id: 1, status: "pending" } } });
    if (method !== "GET") { unexpectedWrites.get(page)!.push(`${method} ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    const match = path.match(/^\/api\/organizations\/(\d+)(?:\/(limits|users|access-governance))?$/);
    if (match) {
      const id = Number(match[1]), resource = match[2] ?? "organization", key = `${id}:${resource}`;
      const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt);
      await options.beforeRead?.(resource, id, attempt);
      if (failure || options.failureResources?.includes(resource)) return route.fulfill({ status: options.failureStatus ?? 503, json: { ok: false, error: { code: "INFRASTRUCTURE_UNEXPECTED_ERROR", category: "INFRASTRUCTURE", retryable: true } } });
      if (resource === "organization") return route.fulfill({ json: { ok: true, organization: { id, name: `Organização carregada ${id}`, slug: `organização-${id}`, plan: "enterprise", active: true, metrics: { users: 8, projects: 3, files: 12, tickets: 2, exports: 5 } } } });
      if (resource === "limits") return route.fulfill({ json: { ok: true, limits: { plan: id === 1 ? "enterprise" : "pro", users: { used: 8, limit: 50 }, projects: { used: 3, limit: 100 }, storageMb: { used: 120, limit: 1000 }, exports: { used: 5, limit: 100 } }, pendingRequests: [] } });
      if (resource === "users") return route.fulfill({ json: { ok: true, users: options.emptyUsers ? [] : [{ id: 2, organizationId: id, name: `Pessoa da organização ${id}`, email: `pessoa${id}@example.test`, role: "viewer", accessLevel: "viewer", active: true, permissions: [] }] } });
      return route.fulfill({ json: { ok: true, capabilities: { mode: options.delegated ? "organization" : "super_admin", organizationId: id, canManageAdditionalAccesses: Boolean(options.delegated), allowedPermissions: [], grantPermissions: [], revokePermissions: [], allowedTargetLevels: options.delegated ? ["viewer"] : [], reason: "synthetic" } } });
    }
    if (/^\/api\/projects/.test(path)) return route.fulfill({ json: { ok: true, projects: [] } });
    return route.fulfill({ json: { ok: true, enabled: false, notifications: [], jobs: [], unreadCount: 0 } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  return { requests, recover: () => { failure = false; } };
}
async function open(page: Page, section: Section) {
  await page.locator(".mm-sidebar-nav").getByRole("button", { name: section.name, exact: true }).click();
  await expect(page.locator(section.selector)).toBeVisible();
}
async function flushFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
  expect(unexpectedWrites.get(page) ?? []).toEqual([]);
});

for (const section of sections) for (const width of [1440, 390]) {
  test(`${section.name}: ${width}px real pending shimmer then success`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const gate = deferred();
    await setup(page, { beforeRead: async resource => { if (resource === section.resource) await gate.promise; } });
    await open(page, section);
    const region = page.locator(section.selector), placeholders = region.locator(".mm-skeleton");
    await expect(placeholders.first()).toBeVisible();
    expect(await placeholders.evaluateAll(elements => elements.every(element => element.getAttribute("aria-hidden") === "true"))).toBe(true);
    expect(await placeholders.first().evaluate(element => getComputedStyle(element, "::after").animationName)).toBe("mm-shimmer");
    await expect(region.getByRole("status")).toHaveCount(1);
    expect(await region.getByRole("status").evaluate(element => element.closest('[aria-busy="true"]') === null)).toBe(true);
    await expect(section.resource === "limits" ? region.locator(".mm-tags-list") : region).not.toContainText(section.loaded);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const heading = await region.getByRole("heading", { name: section.name, exact: true }).boundingBox();
    await page.screenshot({ path: testInfo.outputPath(`${section.resource}-${width}-pending.png`), fullPage: true });
    gate.release();
    await expect(placeholders).toHaveCount(0);
    await expect(section.resource === "limits" ? region.locator(".mm-tags-list") : region).toContainText(section.loaded);
    const after = await region.getByRole("heading", { name: section.name, exact: true }).boundingBox();
    expect(after?.y).toBe(heading?.y);
    await page.screenshot({ path: testInfo.outputPath(`${section.resource}-${width}-loaded.png`), fullPage: true });
  });
}

for (const section of sections) test(`${section.name}: reduced motion keeps static placeholders`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const gate = deferred();
  await setup(page, { beforeRead: async resource => { if (resource === section.resource) await gate.promise; } });
  await open(page, section);
  const placeholder = page.locator(section.selector).locator(".mm-skeleton").first();
  await expect(placeholder).toBeVisible();
  expect(await placeholder.evaluate(element => getComputedStyle(element, "::after").animationName)).toBe("none");
  gate.release(); await expect(page.locator(section.selector).locator(".mm-skeleton")).toHaveCount(0);
});

for (const section of sections.slice(0, 2)) {
  test(`${section.name}: failure stops shimmer and retry starts a genuine request`, async ({ page }) => {
    const first = deferred(), retry = deferred();
    const fixture = await setup(page, { failure: true, beforeRead: async (resource, _id, attempt) => { if (resource === section.resource) await (attempt === 1 ? first.promise : retry.promise); } });
    await open(page, section);
    const region = page.locator(section.selector);
    await expect(region.locator(".mm-skeleton").first()).toBeVisible(); first.release();
    await expect(region.getByRole("alert")).toBeVisible();
    await expect(region.locator(".mm-skeleton")).toHaveCount(0);
    await expect(region).not.toContainText("Free"); await expect(region).not.toContainText("Ativa");
    fixture.recover(); await region.getByRole("alert").getByRole("button").click();
    await expect(region.locator(".mm-skeleton").first()).toBeVisible(); retry.release();
    await expect(region.locator(".mm-skeleton")).toHaveCount(0); await expect(section.resource === "limits" ? region.locator(".mm-tags-list") : region).toContainText(section.loaded);
  });

  test(`${section.name}: old organization response cannot replace current data`, async ({ page }) => {
    const gate = deferred();
    await setup(page, { beforeRead: async (resource, id) => { if (resource === section.resource && id === 1) await gate.promise; } });
    await open(page, section); await expect(page.locator(section.selector).locator(".mm-skeleton").first()).toBeVisible();
    await page.getByRole("button", { name: /Trocar organização ativa/ }).click();
    await page.getByRole("option", { name: /Organização secundária/ }).click();
    await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
    await open(page, section);
    const region = page.locator(section.selector), current = section.resource === "organization" ? "organização-2" : "Pro";
    await expect(section.resource === "limits" ? region.locator(".mm-tags-list .mm-tag") : region.getByText(current, { exact: true })).toHaveText(current);
    const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/organizations/1${section.resource === "limits" ? "/limits" : ""}`);
    gate.release(); await oldResponse; await flushFrames(page);
    await expect(section.resource === "limits" ? region.locator(".mm-tags-list .mm-tag") : region.getByText(current, { exact: true })).toHaveText(current); await expect(section.resource === "limits" ? region.locator(".mm-tags-list") : region).not.toContainText(section.loaded);
  });

  test(`${section.name}: delayed unmounted route does not restore old content`, async ({ page }) => {
    const gate = deferred();
    await setup(page, { beforeRead: async (resource, _id, attempt) => { if (resource === section.resource && attempt === 1) await gate.promise; } });
    await open(page, section); await expect(page.locator(section.selector).locator(".mm-skeleton").first()).toBeVisible();
    await page.locator(".mm-sidebar-nav").getByRole("button", { name: "Todos os Projetos", exact: true }).click();
    const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/organizations/1${section.resource === "limits" ? "/limits" : ""}`);
    gate.release(); await oldResponse; await flushFrames(page);
    await expect(page.locator(section.selector)).toHaveCount(0);
    await open(page, section); await expect(section.resource === "limits" ? page.locator(section.selector).locator(".mm-tags-list") : page.locator(section.selector)).toContainText(section.loaded);
  });
}

test("limits refresh after synthetic request keeps loaded plan and usage visible", async ({ page }) => {
  const gate = deferred(), section = sections[1];
  await setup(page, { allowRequest: true, beforeRead: async (resource, _id, attempt) => { if (resource === "limits" && attempt === 2) await gate.promise; } });
  await open(page, section); const region = page.locator(section.selector);
  await expect(region.locator(".mm-tags-list .mm-tag").filter({ hasText: "Enterprise" })).toBeVisible();
  await region.getByPlaceholder("Explique a necessidade de aumento ou upgrade.").fill("Teste sintético de solicitação.");
  await region.getByRole("button", { name: "Enviar solicitação", exact: true }).click();
  await expect(region.locator(".mm-section-load-region")).toHaveAttribute("aria-busy", "true");
  await expect(region.locator(".mm-tags-list .mm-tag").filter({ hasText: "Enterprise" })).toBeVisible();
  await expect(region.getByRole("heading", { name: "Uso e limites" })).toBeVisible();
  await expect(region.locator(".mm-skeleton")).toHaveCount(0);
  gate.release(); await expect(region.locator(".mm-section-load-region")).toHaveAttribute("aria-busy", "false");
  await expect(region.getByText("Não há solicitações pendentes no momento.")).toBeVisible();
});

test("restricted sections make no authorized-data requests or fake skeletons", async ({ page }) => {
  const fixture = await setup(page, { role: "viewer" });
  for (const section of sections) {
    await expect(page.locator(".mm-sidebar-nav").getByRole("button", { name: section.name, exact: true })).toHaveCount(0);
    await expect(page.locator(section.selector)).toHaveCount(0);
  }
  expect(fixture.requests.some(request => /\/api\/organizations\//.test(request))).toBe(false);
});


test("organization keeps authorized labels, current role and static edit controls real while values load", async ({ page }, testInfo) => {
  const gate = deferred();
  await setup(page, { beforeRead: async resource => { if (resource === "organization") await gate.promise; } });
  await open(page, sections[0]); const region = page.locator(sections[0].selector);
  for (const title of ["Dados principais", "Métricas", "Edição"]) await expect(region.getByRole("heading", { name: title, exact: true })).toBeVisible();
  for (const label of ["Nome", "Slug", "Plano", "Status", "Criada em", "Atualizada em", "Perfil atual"]) await expect(region.getByRole("rowheader", { name: label, exact: true })).toBeVisible();
  await expect(region.getByText("super_admin", { exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "Editar organização", exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "Editar organização", exact: true })).toBeDisabled();
  await expect(region.getByText("Ativa", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("organization-real-structure-pending.png"), fullPage: true });
  gate.release(); await expect(region.locator(".mm-skeleton")).toHaveCount(0);
});

test("limits keeps authorized real form mounted, focused and typed through initial data reveal", async ({ page }, testInfo) => {
  const gate = deferred();
  await setup(page, { beforeRead: async resource => { if (resource === "limits") await gate.promise; } });
  await open(page, sections[1]); const region = page.locator(sections[1].selector);
  const reason = region.getByPlaceholder("Explique a necessidade de aumento ou upgrade.");
  await reason.fill("Rascunho preservado antes dos dados.");
  await expect(reason).toBeFocused();
  expect(await reason.evaluate(element => element.closest('[aria-busy="true"]'))).toBeNull();
  await expect(region.getByRole("columnheader", { name: "Categoria", exact: true })).toBeVisible();
  await expect(region.getByRole("heading", { name: "Plano atual", exact: true })).toBeVisible();
  await expect(region.getByText("Não há solicitações pendentes no momento.")).toHaveCount(0);
  const marker = await reason.evaluate(element => { element.setAttribute("data-same-control", "true"); return element.getBoundingClientRect().y; });
  await page.screenshot({ path: testInfo.outputPath("limits-partial-form-ready.png"), fullPage: true });
  gate.release(); await expect(region.locator(".mm-skeleton")).toHaveCount(0);
  await expect(reason).toHaveValue("Rascunho preservado antes dos dados."); await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("data-same-control", "true");
  expect(Math.abs((await reason.boundingBox())!.y - marker)).toBeLessThanOrEqual(2);
});

test("users reveal roster before limits and governance without granting pending authority", async ({ page }, testInfo) => {
  const limits = deferred(), governance = deferred();
  const fixture = await setup(page, { role: "owner", delegated: true, beforeRead: async resource => {
    if (resource === "limits") await limits.promise;
    if (resource === "access-governance") await governance.promise;
  } });
  await open(page, sections[2]); const region = page.locator(sections[2].selector);
  await expect(region.getByText("Pessoa da organização 1", { exact: true })).toBeVisible();
  await expect(region.locator(".people-table-wrap")).toHaveAttribute("aria-busy", "false");
  await expect(region.locator(".people-capacity-grid article").first().locator("strong")).toHaveText("1");
  await expect(region.locator(".people-capacity-grid article").nth(1).locator(".mm-skeleton")).toBeVisible();
  await expect(region.getByRole("button", { name: "Ações de Pessoa da organização 1", exact: true })).toHaveCount(0);
  expect(fixture.requests).toContain("GET /api/organizations/1/users");
  expect(fixture.requests).toContain("GET /api/organizations/1/limits");
  expect(fixture.requests).toContain("GET /api/organizations/1/access-governance");
  await expect(region.getByRole("status")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("users-roster-ready-metadata-pending.png"), fullPage: true });
  limits.release(); await expect(region.locator(".people-capacity-grid article").nth(1).locator("strong")).toHaveText("50");
  await expect(region.getByRole("button", { name: "Ações de Pessoa da organização 1", exact: true })).toHaveCount(0);
  governance.release(); await expect(region.getByRole("button", { name: "Ações de Pessoa da organização 1", exact: true })).toBeVisible();
  await expect(region.locator(".mm-skeleton")).toHaveCount(0);
});

test("users auxiliary failure leaves ready roster and honest unknown limits without skeleton", async ({ page }) => {
  await setup(page, { role: "owner", failureResources: ["limits", "access-governance"] });
  await open(page, sections[2]); const region = page.locator(sections[2].selector);
  await expect(region.getByText("Pessoa da organização 1", { exact: true })).toBeVisible();
  await expect(region.locator(".people-capacity-grid article strong")).toHaveText(["1", "—", "—", "0"]);
  await expect(region.getByRole("alert")).toContainText("Os limites não puderam ser atualizados");
  await expect(region.locator(".mm-skeleton")).toHaveCount(0);
  await expect(region.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(region.getByRole("button", { name: /Nenhuma ação disponível/ })).toBeDisabled();
});

test("empty roster settles independently while auxiliary metadata remains pending", async ({ page }) => {
  const gate = deferred();
  await setup(page, { emptyUsers: true, beforeRead: async resource => { if (resource === "limits") await gate.promise; } });
  await open(page, sections[2]); const region = page.locator(sections[2].selector);
  await expect(region.getByText("Nenhuma pessoa encontrada.", { exact: true })).toBeVisible();
  await expect(region.locator(".people-table-wrap")).toHaveAttribute("aria-busy", "false");
  await expect(region.locator(".people-table-wrap .mm-skeleton")).toHaveCount(0);
  await expect(region.locator(".people-capacity-grid .mm-skeleton").first()).toBeVisible();
  gate.release(); await expect(region.locator(".mm-skeleton")).toHaveCount(0);
});

test("prolonged loading is understandable and cancellation removes its timer and busy regions", async ({ page }) => {
  await page.clock.install(); const gate = deferred();
  await setup(page, { beforeRead: async resource => { if (resource === "organization") await gate.promise; } });
  await open(page, sections[0]); const region = page.locator(sections[0].selector);
  await page.clock.fastForward(8_100);
  await expect(region.getByRole("status")).toContainText("continua em andamento");
  await expect(region.getByRole("status")).toBeVisible();
  await page.locator(".mm-sidebar-nav").getByRole("button", { name: "Todos os Projetos", exact: true }).click();
  gate.release(); await page.clock.fastForward(8_100);
  await expect(page.locator(sections[0].selector)).toHaveCount(0);
  await expect(page.getByText("O carregamento continua em andamento. Aguarde mais um pouco.", { exact: true })).toHaveCount(0);
});


for (const status of [401, 403]) test(`limits ${status} after refresh clears the previously revealed plan and counts`, async ({ page }) => {
  const failureResources: string[] = [];
  await setup(page, { allowRequest: true, failureResources, failureStatus: status });
  await open(page, sections[1]); const region = page.locator(sections[1].selector);
  await expect(region.locator(".mm-tags-list .mm-tag")).toHaveText("Enterprise");
  failureResources.push("limits");
  await region.getByPlaceholder("Explique a necessidade de aumento ou upgrade.").fill("Solicitação sintética de validação.");
  await region.getByRole("button", { name: "Enviar solicitação", exact: true }).click();
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(region.locator(".mm-tags-list .mm-tag")).toHaveCount(0);
  await expect(region.locator(".mm-skeleton")).toHaveCount(0);
  await expect(region.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(region.locator(".mm-section-load-region").getByText("Enterprise", { exact: true })).toHaveCount(0);
});
