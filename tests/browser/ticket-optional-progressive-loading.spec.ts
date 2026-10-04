import { expect, test, type Page } from "@playwright/test";

// Real UI with controlled synthetic HTTP only. Never exercises a live account.
const panels = [
  { key: "feedback", path: "/ticket-feedback", selector: ".ticket-feedback-panel", title: "Resultado, esforço e feedback" },
  { key: "metrics", path: "/tickets/metrics", selector: ".ticket-metrics-panel", title: "Métricas do atendimento" },
  { key: "knowledge", path: "/ticket-knowledge", selector: ".ticket-knowledge", title: "Conhecimento e respostas reutilizáveis" },
  { key: "cases", path: "/ticket-cases", selector: ".ticket-cases", title: "Incidentes e problemas" },
  { key: "exports", path: "/tickets/exports", selector: ".ticket-exports", title: "Relatórios e exportações" },
] as const;
const selectors = panels.map(panel => panel.selector).join(",");
type Key = typeof panels[number]["key"];
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function optionalPayload(key: Key, enabled: boolean) {
  const distribution = { population: 0, observed: 0, unknown: 0, censored: 0, coverage: null, p50: null, p90: null, p95: null };
  if (key !== "metrics") return { enabled, items: [], jobs: [], nextCursor: null };
  return { enabled, definitionVersion: 1, authorizedTickets: 0, window: { from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z", asOf: "2026-10-01T00:00:00Z" }, firstResponse: distribution, resolution: { ...distribution, uniqueTickets: 0, openingCohort: { population: 0, censored: 0 } }, age: distribution, cycleAge: distribution, wait: distribution, waiting: 0, reopening: { hours: null, numerator: 0, denominator: 0, immature: 0, unknown: 0, rate: null }, flow: { wip: 0, unknown: 0, throughput: 0, uniqueTickets: 0, cycleTime: distribution }, quality: { legacy: 0, corrections: 0, unknownNature: 0 }, watermark: 0, eventCount: 0, aggregation: { matched: 0, pending: 0, builtAt: null, lagMs: null } };
}
async function setup(page: Page, respond: (key: Key, org: number) => Promise<{ enabled?: boolean; status?: number }>) {
  const organizations = [{ id: 1, name: "Organização sintética", slug: "synthetic", active: true }, { id: 2, name: "Outra organização", slug: "other", active: true }];
  let organizationId = 1;
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const session = () => ({ authenticated: true, user: { id: 1, name: "Operador sintético", email: "qa@example.test", role: "super_admin", permissions: [], activeOrganizationId: organizationId }, projects: [], organizations, activeOrganization: organizations.find(org => org.id === organizationId) });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === "/api/session") return route.fulfill({ json: session() });
    if (path === "/api/session/active-organization" && request.method() === "PUT") { organizationId = Number(request.postDataJSON().organizationId); return route.fulfill({ json: { ok: true, ...session() } }); }
    if (request.method() !== "GET") { writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    const panel = panels.find(item => path.endsWith(item.path));
    if (panel) {
      const org = Number(path.match(/organizations\/(\d+)/)?.[1]);
      const result = await respond(panel.key, org);
      if (result.status) return route.fulfill({ status: result.status, json: { ok: false, error: { code: result.status === 401 ? "AUTH_SESSION_EXPIRED" : result.status === 403 ? "PERMISSION_DENIED" : "INFRASTRUCTURE_UNEXPECTED_ERROR", category: result.status === 401 ? "AUTH" : result.status === 403 ? "PERMISSION" : "INFRASTRUCTURE", retryable: result.status === 503 } } });
      return route.fulfill({ json: { ok: true, ...optionalPayload(panel.key, result.enabled ?? false) } });
    }
    if (path.endsWith("/instrument")) return route.fulfill({ json: { version: 1 } });
    if (/\/organizations\/\d+\/tickets$/.test(path)) return route.fulfill({ json: { ok: true, tickets: [], facets: { byStatus: { new: 0, open: 0, in_progress: 0, in_review: 0, closed: 0 }, overdue: 0 }, pagination: { total: 0, page: 1, limit: 10, totalPages: 1, hasMore: false, snapshot: "synthetic" }, assignees: [{ id: 2, name: "Revisor sintético" }], attachmentLimits: { maxFiles: 5, maxFileBytes: 83886080, maxTicketBytes: 157286400, chunkBytes: 8388608 }, flowEnabled: false, lifecycleEnabled: false, triageEnabled: false } });
    return route.fulfill({ json: { ok: true, enabled: false, schemaReady: true, notifications: [], projects: [], users: [], unreadCount: 0 } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  return { errors, writes };
}
async function openCentral(page: Page) {
  await page.locator(".mm-sidebar-item").filter({ hasText: "Central de Chamados" }).click();
  await expect(page.getByRole("heading", { name: "Central de Chamados", exact: true })).toBeVisible();
}
async function capture(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: "image/png" });
}
async function checkDiagnostics(state: { errors: string[]; writes: string[] }) { expect(state.errors).toEqual([]); expect(state.writes).toEqual([]); }

for (const width of [1440, 390]) test(`optional modules never flash ready UI before disabled availability at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const pending = deferred();
  const state = await setup(page, async () => { await pending.promise; return { enabled: false }; });
  await page.evaluate(selectors => {
    const seen: string[] = [];
    Object.assign(window, { optionalPanelMounts: seen });
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element) {
        if (node.matches(selectors)) seen.push(node.className);
        node.querySelectorAll(selectors).forEach(element => seen.push(element.className));
      }
    }))).observe(document.body, { childList: true, subtree: true });
  }, selectors);
  await openCentral(page);
  await expect(page.locator(selectors)).toHaveCount(0);
  await expect(page.getByText("Nenhum chamado encontrado", { exact: true })).toBeVisible();
  await capture(page, "unknown-availability");
  pending.release();
  await page.waitForTimeout(350);
  await expect(page.locator(selectors)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { optionalPanelMounts: string[] }).optionalPanelMounts)).toEqual([]);
  await capture(page, "disabled-availability");
  await checkDiagnostics(state);
});

for (const width of [1440, 390]) test(`enabled modules reveal independently with dark surfaces at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const gates = Object.fromEntries(panels.map(panel => [panel.key, deferred()])) as Record<Key, ReturnType<typeof deferred>>;
  const state = await setup(page, async key => { await gates[key].promise; return { enabled: true }; });
  await openCentral(page);
  await expect(page.locator(selectors)).toHaveCount(0);
  for (const panel of panels) {
    gates[panel.key].release();
    await expect(page.locator(panel.selector)).toBeVisible();
  }
  for (const selector of [".ticket-knowledge", ".ticket-cases"]) {
    const panel = page.locator(selector);
    await panel.locator("summary").first().click();
    await panel.scrollIntoViewIfNeeded();
    expect(await panel.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(14, 17, 22)");
    const inputs = panel.locator("input:not([type=checkbox]), textarea");
    for (const input of await inputs.all()) expect(await input.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgb(255, 255, 255)");
    await capture(page, `enabled-${selector.slice(1)}`);
  }
  await checkDiagnostics(state);
});

for (const width of [1440, 390]) test(`optional availability errors stay visible without ready controls and retry independently at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const failed = new Set<Key>(panels.map(panel => panel.key));
  const state = await setup(page, async key => failed.has(key) ? { status: 503 } : { enabled: true });
  await openCentral(page);
  await expect(page.locator(".ticket-optional-panel-error")).toHaveCount(5);
  await expect(page.locator(selectors)).toHaveCount(0);
  await expect(page.locator(".ticket-optional-panel-error input,.ticket-optional-panel-error select,.ticket-optional-panel-error textarea")).toHaveCount(0);
  await capture(page, "availability-errors");
  for (const panel of panels) {
    const error = page.getByRole("region", { name: panel.title, exact: true });
    await expect(error.getByRole("alert")).toBeVisible();
    failed.delete(panel.key);
    await error.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await expect(page.locator(panel.selector)).toBeVisible();
  }
  await expect(page.locator(".ticket-optional-panel-error")).toHaveCount(0);
  await checkDiagnostics(state);
});

for (const status of [401, 403]) test(`optional ${status} invalidates displayed module data and controls`, async ({ page }) => {
  let revoked = false;
  const state = await setup(page, async () => revoked ? { status } : { enabled: true });
  await openCentral(page);
  await expect(page.locator(selectors)).toHaveCount(5);
  revoked = true;
  for (const panel of panels) {
    const region = page.locator(panel.selector);
    await region.locator("summary").first().click();
    if (panel.key === "knowledge") await region.getByLabel("Buscar artigos").fill("revoked");
    else await region.getByRole("button", { name: { feedback: "Atualizar pesquisas", metrics: "Consultar métricas", cases: "Atualizar", exports: "Atualizar exportações" }[panel.key], exact: true }).click();
    await expect(page.locator(panel.selector)).toHaveCount(0);
    await expect(page.getByRole("region", { name: panel.title, exact: true }).getByRole("alert")).toBeVisible();
  }
  await expect(page.locator(".ticket-optional-panel-error input,.ticket-optional-panel-error select,.ticket-optional-panel-error textarea")).toHaveCount(0);
  await checkDiagnostics(state);
});

test("late optional replies cannot remount a departed Central context", async ({ page }) => {
  const pending = deferred();
  const state = await setup(page, async () => { await pending.promise; return { enabled: true }; });
  await openCentral(page);
  await page.locator(".mm-sidebar-item").filter({ hasText: "Todos os Projetos" }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  pending.release();
  await page.waitForTimeout(350);
  await expect(page.locator(selectors)).toHaveCount(0);
  await expect(page.locator(".ticket-optional-panel-error")).toHaveCount(0);
  await checkDiagnostics(state);
});


test("a previous organization's delayed availability cannot reveal modules in the new organization", async ({ page }) => {
  const old = deferred();
  const state = await setup(page, async (_key, org) => {
    if (org === 1) { await old.promise; return { enabled: true }; }
    return { enabled: false };
  });
  await openCentral(page);
  await expect(page.locator(selectors)).toHaveCount(0);
  const trigger = page.getByRole("button", { name: /Trocar organização ativa/ });
  await trigger.click();
  await page.getByRole("option", { name: /Outra organização/ }).click();
  await expect(trigger).toContainText("Outra organização");
  await openCentral(page);
  old.release();
  await page.waitForTimeout(350);
  await expect(page.locator(selectors)).toHaveCount(0);
  await expect(page.locator(".ticket-optional-panel-error")).toHaveCount(0);
  await checkDiagnostics(state);
});


for (const key of ["feedback", "metrics"] as const) test(`confirmed ${key} availability keeps refresh mounted, open and focused`, async ({ page }) => {
  let refreshing = false;
  const pending = deferred();
  const state = await setup(page, async current => {
    if (current === key && refreshing) await pending.promise;
    return { enabled: true };
  });
  await openCentral(page);
  const panel = page.locator(panels.find(panel => panel.key === key)!.selector);
  await panel.locator("summary").first().click();
  const original = await panel.elementHandle();
  const button = panel.getByRole("button", { name: key === "feedback" ? "Atualizar pesquisas" : "Consultar métricas", exact: true });
  await button.focus();
  refreshing = true;
  await button.click();
  await expect(button).toBeDisabled();
  await expect(panel).toHaveAttribute("open", "");
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  pending.release();
  await expect(button).toBeEnabled();
  await expect(panel).toHaveAttribute("open", "");
  await expect(button).toBeFocused();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await checkDiagnostics(state);
});

for (const key of ["knowledge", "cases"] as const) test(`confirmed ${key} mutation retry retains idempotency and recovered detail`, async ({ page }) => {
  const state = await setup(page, async () => ({ enabled: true }));
  const path = `/api/organizations/1/ticket-${key}`;
  const writes: unknown[] = [];
  const title = key === "knowledge" ? "Artigo recuperado" : "Incidente recuperado";
  await page.route(url => url.pathname === path || url.pathname === path + "/recovered", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      writes.push(request.postDataJSON());
      if (writes.length === 1) return route.fulfill({ status: 503, json: { ok: false, error: { code: "INFRASTRUCTURE_UNEXPECTED_ERROR", category: "INFRASTRUCTURE", retryable: true } } });
      return route.fulfill({ json: { id: "recovered" } });
    }
    if (new URL(request.url()).pathname.endsWith("/recovered")) return route.fulfill({ json: key === "knowledge"
      ? { id: "recovered", revision: { id: "revision-1", number: 1, title, body: "Solução sintética", audience: "private", hash: "synthetic", authorId: 1 }, published: null, state: "draft", version: "v1", canEdit: true, canReview: false, canRevise: true, reviewerId: 2, history: [], events: [] }
      : { record: { id: "recovered", kind: "incident", title, state: "open", visibility: "private", version: "v1", coordinatorId: 1, data: {} }, links: [], history: [], canManage: true } });
    await route.fallback();
  });
  await openCentral(page);
  const panel = page.locator(key === "knowledge" ? ".ticket-knowledge" : ".ticket-cases");
  await panel.locator("summary").first().click();
  const original = await panel.elementHandle();
  await panel.getByLabel("Título", { exact: true }).fill(title);
  if (key === "knowledge") {
    await panel.getByLabel("Diagnóstico e solução").fill("Solução sintética");
    await panel.getByRole("combobox", { name: "Revisor independente" }).click();
    await page.getByRole("listbox", { name: "Opções: Revisor independente", exact: true }).getByRole("option", { name: "Revisor sintético", exact: true }).click();
    await panel.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
  } else await panel.getByRole("button", { name: "Criar registro", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await panel.getByRole("button", { name: "Repetir tentativa", exact: true }).click();
  if (key === "knowledge") {
    await expect(panel.getByLabel("Título", { exact: true })).toHaveValue(title);
    await expect(panel.getByRole("button", { name: "Solicitar revisão", exact: true })).toBeVisible();
  } else await expect(panel.getByRole("region", { name: "Detalhes do registro", exact: true })).toContainText(title);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  await checkDiagnostics(state);
});

test("authoritative disabled availability removes previously confirmed modules", async ({ page }) => {
  let enabled = true;
  const state = await setup(page, async () => ({ enabled }));
  await openCentral(page);
  await expect(page.locator(selectors)).toHaveCount(5);
  enabled = false;
  for (const panel of panels) {
    const region = page.locator(panel.selector);
    await region.locator("summary").first().click();
    if (panel.key === "knowledge") await region.getByLabel("Buscar artigos").fill("disabled");
    else await region.getByRole("button", { name: { feedback: "Atualizar pesquisas", metrics: "Consultar métricas", cases: "Atualizar", exports: "Atualizar exportações" }[panel.key], exact: true }).click();
    await expect(page.locator(panel.selector)).toHaveCount(0);
  }
  await expect(page.locator(".ticket-optional-panel-error")).toHaveCount(0);
  await checkDiagnostics(state);
});

test("confirmed knowledge read failure retains its panel and exposes a read-only retry", async ({ page }) => {
  let failing = false;
  const state = await setup(page, async key => key === "knowledge" && failing ? { status: 503 } : { enabled: true });
  await openCentral(page);
  const panel = page.locator(".ticket-knowledge");
  await panel.locator("summary").first().click();
  const original = await panel.elementHandle();
  failing = true;
  await panel.getByLabel("Buscar artigos").fill("nova busca");
  await expect(panel.getByRole("alert")).toBeVisible();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  failing = false;
  await panel.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByLabel("Buscar artigos")).toHaveValue("nova busca");
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await checkDiagnostics(state);
});

test("fast enabled optional modules share the Central 80/260 clock without restarting it", async ({ page }) => {
  const state = await setup(page, async () => ({ enabled: true }));
  const time = new Date("2026-10-04T12:01:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await page.locator(".mm-sidebar-item").filter({ hasText: "Central de Chamados" }).evaluate(node => (node as HTMLElement).click());
  await expect(page.locator(selectors)).toHaveCount(5);
  const summaries = page.locator(selectors).locator("summary").first();
  await expect(summaries.locator('[data-loading-structure="pending"]')).toHaveCount(1);
  for (const panel of panels) {
    await expect(page.locator(panel.selector).locator("summary").first().locator('[data-loading-structure="pending"]')).toHaveCount(1);
    await expect(page.locator(panel.selector).locator("[data-ticket-optional-body]")).toHaveAttribute("hidden", "");
  }
  await page.clock.runFor(79);
  await expect(summaries.locator('[data-loading-structure="pending"]')).toHaveCount(1);
  await page.clock.runFor(1);
  for (const panel of panels) await expect(page.locator(panel.selector).locator("summary").first().locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await page.clock.runFor(179);
  for (const panel of panels) await expect(page.locator(panel.selector).locator("[data-ticket-optional-body]")).toHaveAttribute("hidden", "");
  await page.clock.runFor(1);
  for (const panel of panels) await expect(page.locator(panel.selector).locator("[data-ticket-optional-body]")).not.toHaveAttribute("hidden", "");
  await checkDiagnostics(state);
});

test("optional initial errors bypass the shared visual hold immediately", async ({ page }) => {
  const state = await setup(page, async () => ({ status: 503 }));
  const time = new Date("2026-10-04T12:01:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await page.locator(".mm-sidebar-item").filter({ hasText: "Central de Chamados" }).evaluate(node => (node as HTMLElement).click());
  await expect(page.locator(".ticket-optional-panel-error")).toHaveCount(5);
  await expect(page.locator(".ticket-optional-panel-error [data-loading-structure]")).toHaveCount(0);
  for (const panel of panels) await expect(page.getByRole("region", { name: panel.title, exact: true }).getByRole("alert")).toBeVisible();
  await checkDiagnostics(state);
});

test("an optional error cancels the remaining shared hold for a successful immediate retry", async ({ page }) => {
  let failing = true;
  const state = await setup(page, async () => failing ? { status: 503 } : { enabled: true });
  const time = new Date("2026-10-04T12:01:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await page.locator(".mm-sidebar-item").filter({ hasText: "Central de Chamados" }).evaluate(node => (node as HTMLElement).click());
  await expect(page.locator(".ticket-optional-panel-error")).toHaveCount(5);
  failing = false;
  for (const panel of panels) {
    await page.getByRole("region", { name: panel.title, exact: true }).getByRole("button", { name: "Tentar novamente", exact: true }).evaluate(node => (node as HTMLElement).click());
    await expect(page.locator(panel.selector)).toBeVisible();
    await expect(page.locator(panel.selector).locator('[data-loading-structure="pending"]')).toHaveCount(0);
    await expect(page.locator(panel.selector).locator("[data-ticket-optional-body]")).not.toHaveAttribute("hidden", "");
  }
  await checkDiagnostics(state);
});


for (const key of ["feedback", "metrics"] as const) for (const interaction of ["control", "body", "navigation"] as const) test(`manual ${key} refresh never steals focus after ${interaction}`, async ({ page }) => {
  let refreshing = false;
  const pending = deferred();
  const state = await setup(page, async current => {
    if (current === key && refreshing) await pending.promise;
    return { enabled: true };
  });
  await openCentral(page);
  const panel = page.locator(panels.find(panel => panel.key === key)!.selector);
  await panel.locator("summary").first().click();
  const button = panel.getByRole("button", { name: key === "feedback" ? "Atualizar pesquisas" : "Consultar métricas", exact: true });
  await button.focus();
  refreshing = true;
  await button.click();
  await expect(button).toBeDisabled();
  if (interaction === "control") {
    await page.locator(".ticket-filter-search input").focus();
  } else if (interaction === "body") {
    await page.getByRole("heading", { name: "Central de Chamados", exact: true }).click();
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  } else {
    await page.locator(".mm-sidebar-item").filter({ hasText: "Todos os Projetos" }).click();
    await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  }
  pending.release();
  if (interaction === "navigation") {
    await expect(page.locator(selectors)).toHaveCount(0);
  } else {
    await expect(button).toBeEnabled();
    if (interaction === "control") await expect(page.locator(".ticket-filter-search input")).toBeFocused();
    else expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  }
  await checkDiagnostics(state);
});

for (const key of ["feedback", "metrics"] as const) test(`manual ${key} refresh never invents focus for an unfocused trigger`, async ({ page }) => {
  let refreshing = false;
  const pending = deferred();
  const state = await setup(page, async current => {
    if (current === key && refreshing) await pending.promise;
    return { enabled: true };
  });
  await openCentral(page);
  const panel = page.locator(panels.find(panel => panel.key === key)!.selector);
  await panel.locator("summary").first().click();
  const button = panel.getByRole("button", { name: key === "feedback" ? "Atualizar pesquisas" : "Consultar métricas", exact: true });
  await expect(button).toBeVisible();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  refreshing = true;
  await button.evaluate(node => (node as HTMLButtonElement).click());
  await expect(button).toBeDisabled();
  pending.release();
  await expect(button).toBeEnabled();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await checkDiagnostics(state);
});
