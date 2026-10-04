import { expect, test, type Page } from "@playwright/test";
import type { Ticket, TicketFacets, TicketListResponse, TicketPerson, TicketStatus } from "../../src/pages/Projects/components/ticket-types";

// Actual compiled /projects route and actual React event handlers. HTTP is fully
// intercepted: this is browser regression coverage, never production acceptance.
const NOW = "2026-10-03T12:00:00.000Z";
const organizations = [
  { id: 1, name: "Organização de demonstração", slug: "demo", active: true },
  { id: 2, name: "Outra organização", slug: "other", active: true },
];
const people: TicketPerson[] = [{ id: 2, name: "Ana Souza", email: "ana@example.test" }, { id: 3, name: "Bruno Lima", email: "bruno@example.test" }];
const statuses: TicketStatus[] = ["new", "open", "in_progress", "in_review", "closed"];
const tickets: Ticket[] = Array.from({ length: 63 }, (_, index) => ({
  id: index + 1, organizationId: 1, code: `CH-${String(index + 1).padStart(4, "0")}`,
  subject: `Chamado ${String(index + 1).padStart(2, "0")} · revisão do mapa`,
  description: index === 62 ? "Marcador exclusivo além da primeira página" : "Conferir as informações e registrar o atendimento.",
  status: statuses[index % statuses.length], priority: (["low", "normal", "high"] as const)[index % 3], category: "map",
  dueAt: index % 9 === 0 ? null : `2026-10-${String(index % 14 + 1).padStart(2, "0")}T09:00:00.000Z`,
  createdAt: new Date(Date.UTC(2026, 7, index + 1, 9)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 7, index + 1, 12)).toISOString(),
  createdBy: { id: 1, name: "Operador de demonstração" }, assignedTo: index % 4 === 0 ? null : people[index % 2],
  attachmentsCount: index % 3, version: 1, etag: `"ticket-${index + 1}-v1"`, visibility: "organization",
}));
const attachmentLimits = { maxFiles: 5, maxFileBytes: 83886080, maxTicketBytes: 157286400, chunkBytes: 8388608 };
type RequestRecord = { method: string; path: string; params: URLSearchParams; body: string | null; headers: Record<string, string>; organizationId: number };
type FixtureOptions = {
  dataset?: Ticket[]; role?: string; permissions?: string[]; deniedPermissions?: string[];
  organizationPermissions?: Record<number, string[]>; snapshot?: boolean; exportsEnabled?: boolean;
  beforeList?: (request: RequestRecord, response: TicketListResponse) => Promise<void>;
  failList?: (request: RequestRecord) => boolean | number; startUrl?: string;
  beforeOrganizationSwitch?: (organizationId: number) => Promise<void>;
};
const diagnostics = new WeakMap<Page, { errors: string[]; unexpectedWrites: string[]; allowedStatuses: Set<number> }>();
function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
function isOverdue(ticket: Ticket) { return ticket.status !== "closed" && Boolean(ticket.dueAt) && String(ticket.dueAt) < NOW; }
function filtered(all: Ticket[], params: URLSearchParams, includeStatus = true) {
  const q = (params.get("q") || "").trim().toLocaleLowerCase();
  const queue = params.get("queue");
  return all.filter(ticket =>
    (!q || `${ticket.code} ${ticket.subject} ${ticket.description}`.toLocaleLowerCase().includes(q)) &&
    (!includeStatus || !params.get("status") || ticket.status === params.get("status")) &&
    (!params.get("priority") || ticket.priority === params.get("priority")) &&
    (!params.get("assigneeId") || (params.get("assigneeId") === "unassigned" ? !ticket.assignedTo : String(ticket.assignedTo?.id) === params.get("assigneeId"))) &&
    (!params.get("overdueOnly") || isOverdue(ticket)) &&
    (!queue || (queue === "open" ? ["new", "open"].includes(ticket.status) : ticket.status === queue)) &&
    ((!params.get("from") && !params.get("to")) || (!ticket.dueAt && params.get("includeUndated") === "1") ||
      Boolean(ticket.dueAt && (!params.get("from") || ticket.dueAt.slice(0, 10) >= params.get("from")!) && (!params.get("to") || ticket.dueAt.slice(0, 10) <= params.get("to")!)))
  );
}
function sorted(all: Ticket[], sort = "updated_desc") {
  const recent = (a: Ticket, b: Ticket) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || Number(b.id) - Number(a.id);
  const ranks = { high: 0, normal: 1, low: 2 };
  return [...all].sort((a, b) => sort === "updated_asc" ? -recent(a, b) : sort === "priority_desc" ? ranks[a.priority] - ranks[b.priority] || recent(a, b) : sort === "due_asc" ?
    Number(!a.dueAt) - Number(!b.dueAt) || String(a.dueAt || "").localeCompare(String(b.dueAt || "")) || recent(a, b) : recent(a, b));
}
function facetsFor(all: Ticket[]): TicketFacets {
  return { byStatus: Object.fromEntries(statuses.map(status => [status, all.filter(ticket => ticket.status === status).length])) as TicketFacets["byStatus"], overdue: all.filter(isOverdue).length };
}
async function setup(page: Page, options: FixtureOptions = {}) {
  const state = structuredClone(options.dataset ?? tickets);
  const requests: RequestRecord[] = [];
  const hiddenIds = new Set<number>();
  const snapshots = new Map<string, number[]>();
  let organizationId = 1;
  const diagnostic = { errors: [] as string[], unexpectedWrites: [] as string[], allowedStatuses: new Set<number>() };
  diagnostics.set(page, diagnostic);
  page.on("pageerror", error => diagnostic.errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Deliberate HTTP failures still must not produce React/runtime exceptions.
    if (/Failed to load resource/i.test(text) && [...diagnostic.allowedStatuses].some(status => text.includes(String(status)))) return;
    diagnostic.errors.push(text);
  });
  const session = () => ({
    authenticated: true,
    user: { id: 1, name: "Operador de demonstração", email: "qa@example.test", role: options.role ?? "super_admin", activeOrganizationId: organizationId,
      permissions: options.organizationPermissions?.[organizationId] ?? options.permissions ?? [], deniedPermissions: options.deniedPermissions ?? [] },
    projects: [], organizations, activeOrganization: organizations.find(item => item.id === organizationId),
  });
  await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const record: RequestRecord = { method: request.method(), path, params: url.searchParams, body: request.postData(), headers: request.headers(), organizationId };
    requests.push(record);
    if (path === "/api/session") return route.fulfill({ json: session() });
    if (path === "/api/session/active-organization" && request.method() === "PUT") {
      const targetOrganization = Number(JSON.parse(record.body || "{}").organizationId);
      await options.beforeOrganizationSwitch?.(targetOrganization);
      organizationId = targetOrganization;
      return route.fulfill({ json: { ok: true, ...session() } });
    }
    if (["/api/projects", "/api/projects/recent", "/api/projects/favorites"].includes(path)) return route.fulfill({ json: { ok: true, projects: [] } });
    const listMatch = path.match(/^\/api\/organizations\/(\d+)\/tickets$/);
    if (listMatch && request.method() === "GET") {
      const requestedOrg = Number(listMatch[1]), params = record.params;
      const pageNumber = Number(params.get("page") || 1), limit = Number(params.get("limit") || 50);
      const authorized = state.filter(ticket => Number(ticket.organizationId) === requestedOrg && !hiddenIds.has(Number(ticket.id)));
      let query = sorted(filtered(authorized, params), params.get("sort") || undefined);
      let snapshot = params.get("snapshot"), ordinalIds: number[] | null = null;
      if (options.snapshot) {
        if (!snapshot) {
          snapshot = `fixture-snapshot-${snapshots.size + 1}`;
          snapshots.set(snapshot, query.map(ticket => Number(ticket.id)));
        }
        ordinalIds = snapshots.get(snapshot) ?? [];
        query = ordinalIds.map(id => authorized.find(ticket => Number(ticket.id) === id)).filter((ticket): ticket is Ticket => Boolean(ticket));
      }
      const start = (pageNumber - 1) * limit;
      const size = ordinalIds?.length ?? query.length;
      const visible = ordinalIds ? ordinalIds.slice(start, start + limit).map(id => query.find(ticket => Number(ticket.id) === id)).filter((ticket): ticket is Ticket => Boolean(ticket)) : query.slice(start, start + limit);
      const response: TicketListResponse = {
        ok: true, tickets: structuredClone(visible), facets: facetsFor(options.snapshot ? query : filtered(authorized, params, false)),
        pagination: { page: pageNumber, limit, total: query.length, totalPages: Math.max(1, Math.ceil(size / limit)), hasMore: start + limit < size,
          snapshot: options.snapshot ? snapshot : null, snapshotAt: options.snapshot ? NOW : null, loaded: visible.length },
        range: { from: params.get("from"), to: params.get("to") }, assignees: people, attachmentLimits,
        flowEnabled: Boolean(options.snapshot), queuePolicies: [], lifecycleEnabled: false, triageEnabled: false,
      };
      await options.beforeList?.(record, response);
      const failure = options.failList?.(record);
      if (failure) {
        const status = typeof failure === "number" ? failure : 503;
        diagnostic.allowedStatuses.add(status);
        return route.fulfill({ status, json: { ok: false, error: { code: status === 403 ? "AUTH_PERMISSION_DENIED" : status === 409 ? "TICKET_QUERY_EXPIRED" : "TICKET_SERVICE_UNAVAILABLE", category: status === 403 ? "AUTH" : "INFRASTRUCTURE", retryable: true } } });
      }
      return route.fulfill({ json: response });
    }
    if (listMatch && request.method() === "POST") {
      const payload = JSON.parse(record.body || "{}");
      const id = Math.max(0, ...state.map(ticket => Number(ticket.id))) + 1;
      const ticket: Ticket = { ...tickets[0], ...payload, id, organizationId: Number(listMatch[1]), code: `CH-${String(id).padStart(4, "0")}`, status: "new", updatedAt: NOW, createdAt: NOW, etag: `"ticket-${id}-v1"`, attachmentsCount: 0,
        assignedTo: people.find(person => String(person.id) === String(payload.assignedTo)) ?? null };
      state.push(ticket);
      return route.fulfill({ json: { ok: true, ticket } });
    }
    const detailMatch = path.match(/^\/api\/organizations\/(\d+)\/tickets\/(\d+)$/);
    if (detailMatch) {
      const ticket = state.find(item => Number(item.organizationId) === Number(detailMatch[1]) && Number(item.id) === Number(detailMatch[2]));
      if (!ticket) { diagnostic.allowedStatuses.add(404); return route.fulfill({ status: 404, json: { ok: false } }); }
      if (request.method() === "PATCH") {
        const payload = JSON.parse(record.body || "{}");
        Object.assign(ticket, payload, { assignedTo: people.find(person => String(person.id) === String(payload.assignedTo)) ?? null, version: Number(ticket.version) + 1, updatedAt: NOW, etag: `"ticket-${ticket.id}-v${Number(ticket.version) + 1}"` });
        return route.fulfill({ json: { ok: true, ticket } });
      }
      if (request.method() === "GET") return route.fulfill({ json: { ok: true, ticket, attachments: [], events: [], assignees: people, attachmentLimits, lifecycleEnabled: false, triageEnabled: false,
        conversation: { enabled: false, schemaReady: true, permissions: { comment: false, noteView: false, noteCreate: false }, messages: [], drafts: [], hasMore: false } } });
    }
    if (/\/tickets\/exports$/.test(path) && request.method() === "GET") return route.fulfill({ json: { enabled: options.exportsEnabled ?? false, jobs: [], nextCursor: null } });
    if (request.method() !== "GET") {
      diagnostic.unexpectedWrites.push(`${request.method()} ${path}`);
      diagnostic.allowedStatuses.add(403);
      return route.fulfill({ status: 403, json: { ok: false } });
    }
    // Existing optional panels/notifications are disabled through their real APIs.
    return route.fulfill({ json: { ok: true, enabled: false, projects: [], files: [], folders: [], tickets: [], users: [], items: [], jobs: [], unread: 0, nextCursor: null, facets: { types: [], projects: [], folderCounts: [] }, pagination: { total: 0, hasMore: false } } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto(options.startUrl ?? "/projects");
  return { state, requests, hiddenIds, snapshots };
}
test.afterEach(async ({ page }) => {
  const diagnostic = diagnostics.get(page);
  expect(diagnostic?.errors ?? [], "No browser console or runtime errors").toEqual([]);
  expect(diagnostic?.unexpectedWrites ?? [], "All mutations remain bounded to explicitly intercepted local fixtures").toEqual([]);
});
const shell = (page: Page) => page.locator(".ticket-center-final");
const filters = (page: Page) => page.getByRole("region", { name: "Filtros de chamados", exact: true });
const rows = (page: Page) => page.locator(".ticket-list-table tbody tr");
const pagination = (page: Page) => shell(page).locator(".mm-docs-pagination");
const listRequests = (requests: RequestRecord[]) => requests.filter(item => item.method === "GET" && /^\/api\/organizations\/\d+\/tickets$/.test(item.path));
async function openCentral(page: Page) {
  await page.locator(".mm-sidebar-item").filter({ hasText: "Central de Chamados" }).click();
  await expect(page.getByRole("heading", { name: "Central de Chamados", exact: true, level: 1 })).toBeVisible();
}
async function expectCount(page: Page, visible: number, total: number) {
  await expect(rows(page)).toHaveCount(visible);
  await expect(pagination(page).getByRole("status")).toHaveText(`Exibindo ${visible}/${total}.`);
}
async function rowCodes(page: Page) { return rows(page).locator(".ticket-code").allTextContents(); }
async function clear(page: Page) { await filters(page).getByRole("button", { name: "Limpar filtros", exact: true }).click(); }
async function refresh(page: Page) {
  await shell(page).getByRole("button", { name: "Mais opções dos chamados", exact: true }).click();
  await page.getByRole("menuitem", { name: "Atualizar consulta", exact: true }).click();
}
async function switchOrganization(page: Page, name: string) {
  await page.getByRole("button", { name: /Trocar organização ativa/ }).click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true, level: 1 })).toBeVisible();
}

test("Central uses the shared composition, real API paging, named columns and optional export gating", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  await expect(shell(page).getByRole("navigation", { name: "Caminho da página" }).getByRole("link", { name: "Início", exact: true })).toHaveAttribute("href", "/projects");
  await expect(shell(page).locator(".ticket-center-header p")).toHaveCount(0);
  await expect(filters(page).getByRole("searchbox", { name: "Buscar", exact: true })).toHaveAttribute("placeholder", "Código, assunto ou descrição");
  await expect(rows(page).first().locator("td")).toHaveCount(8);
  await expect(shell(page).getByRole("columnheader")).toHaveText(["", "Código", "Assunto", "Prioridade", "Situação", "Atendente", "Última atualização", "Ações"]);
  await expect(shell(page).getByRole("combobox", { name: "Visualização dos chamados" }).locator("option")).toHaveText(["Lista", "Kanban", "Calendário"]);
  await expect(pagination(page).getByRole("combobox", { name: "Itens por página" }).locator("option")).toHaveText(["10", "25", "50"]);
  await expect(shell(page).getByRole("button", { name: "Exportar", exact: true })).toBeDisabled();
  await expect(shell(page).locator(".ticket-exports")).toHaveCount(0);
  expect(listRequests(requests).at(-1)?.params.get("limit")).toBe("10");
  expect(listRequests(requests).at(-1)?.params.get("page")).toBe("1");
  expect(await rowCodes(page)).toEqual(tickets.slice(-10).reverse().map(ticket => ticket.code));
});

test("search matches code, subject and description beyond page one and clear preserves chosen sort", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  const input = filters(page).getByRole("searchbox", { name: "Buscar", exact: true });
  for (const [query, id] of [["CH-0001", 1], ["Chamado 07", 7], ["Marcador exclusivo", 63]] as const) {
    await input.fill(query); await expectCount(page, 1, 1);
    expect(await rowCodes(page)).toEqual([tickets[id - 1].code]);
    expect(listRequests(requests).at(-1)?.params.get("q")).toBe(query);
    expect(listRequests(requests).at(-1)?.params.get("page")).toBe("1");
  }
  await filters(page).getByRole("combobox", { name: "Ordenar por", exact: true }).selectOption("updated_asc");
  await clear(page); await expectCount(page, 10, 63);
  await expect(filters(page).getByRole("combobox", { name: "Ordenar por", exact: true })).toHaveValue("updated_asc");
  expect(await rowCodes(page)).toEqual(tickets.slice(0, 10).map(ticket => ticket.code));
  await input.fill("nenhum resultado local"); await expectCount(page, 0, 0);
  await expect(shell(page).getByRole("heading", { name: "Nenhum chamado encontrado", exact: true })).toBeVisible();
  await clear(page); await expectCount(page, 10, 63);
});

test("every filter participates in the server query, including undated range semantics and all sorts", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  await filters(page).getByRole("combobox", { name: "Situação", exact: true }).selectOption("in_progress");
  await expectCount(page, 10, 13);
  await filters(page).getByRole("combobox", { name: "Prioridade", exact: true }).selectOption("high");
  await expectCount(page, 5, 5);
  await filters(page).getByRole("combobox", { name: "Atendente", exact: true }).selectOption("2");
  await expectCount(page, 2, 2);
  await filters(page).getByLabel("De", { exact: true }).fill("2026-10-05");
  await filters(page).getByLabel("Até", { exact: true }).fill("2026-10-08");
  await expectCount(page, 1, 1);
  expect(await rowCodes(page)).toEqual(["CH-0063"]);
  const latest = listRequests(requests).at(-1)!.params;
  expect(Object.fromEntries(latest)).toMatchObject({ status: "in_progress", priority: "high", assigneeId: "2", from: "2026-10-05", to: "2026-10-08", includeUndated: "1", page: "1", limit: "10" });
  await clear(page); await expectCount(page, 10, 63);
  await filters(page).getByRole("combobox", { name: "Atendente", exact: true }).selectOption("unassigned");
  await expectCount(page, 10, 16);
  await clear(page); await expectCount(page, 10, 63);
  for (const sort of ["updated_asc", "due_asc", "priority_desc", "updated_desc"]) {
    await filters(page).getByRole("combobox", { name: "Ordenar por", exact: true }).selectOption(sort);
    await expect.poll(() => rowCodes(page)).toEqual(sorted(tickets, sort).slice(0, 10).map(ticket => ticket.code));
    expect(listRequests(requests).at(-1)?.params.get("sort")).toBe(sort);
  }
  await filters(page).getByLabel("De", { exact: true }).fill("2026-11-01");
  await filters(page).getByLabel("Até", { exact: true }).fill("2026-11-30");
  await expectCount(page, 7, 7); // Real includeUndated=1 contract keeps undated tickets.
  expect(await rowCodes(page)).toEqual(sorted(tickets.filter(ticket => !ticket.dueAt)).map(ticket => ticket.code));
});

test("summary cards use exact facets: Abertos excludes Novo and each card applies its correct filter", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  const metrics = shell(page).getByRole("region", { name: "Resumo dos chamados" });
  const expected = facetsFor(tickets);
  for (const [label, status, count] of [
    ["Abertos", "open", expected.byStatus.open], ["Em andamento", "in_progress", expected.byStatus.in_progress],
    ["Em revisão", "in_review", expected.byStatus.in_review], ["Concluídos", "closed", expected.byStatus.closed],
  ] as const) {
    const card = metrics.getByRole("button", { name: new RegExp(`^${label}`) });
    await expect(card.locator("strong")).toHaveText(String(count));
    await card.click(); await expectCount(page, Math.min(count, 10), count);
    await expect(card).toHaveAttribute("aria-pressed", "true");
    expect(listRequests(requests).at(-1)?.params.get("status")).toBe(status);
    expect(await rowCodes(page)).toEqual(sorted(tickets.filter(ticket => ticket.status === status)).slice(0, 10).map(ticket => ticket.code));
    await clear(page); await expectCount(page, 10, 63);
  }
  const overdue = metrics.getByRole("button", { name: /^Vencidos/ });
  await expect(overdue.locator("strong")).toHaveText(String(expected.overdue));
  await overdue.click(); await expectCount(page, Math.min(expected.overdue, 10), expected.overdue);
  expect(listRequests(requests).at(-1)?.params.get("overdueOnly")).toBe("1");
  expect(listRequests(requests).at(-1)?.params.has("status")).toBe(false);
  await overdue.click(); await expectCount(page, 10, 63);
});

test("10, 25 and 50 issue real page/limit requests with previous, next and terminal boundaries", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  for (const size of [25, 50, 10]) {
    await pagination(page).getByRole("combobox", { name: "Itens por página" }).selectOption(String(size));
    await expectCount(page, size, 63);
    await expect(pagination(page).getByRole("button", { name: "Página anterior" })).toBeDisabled();
    expect(listRequests(requests).at(-1)?.params.get("limit")).toBe(String(size));
    expect(listRequests(requests).at(-1)?.params.get("page")).toBe("1");
    await pagination(page).getByRole("button", { name: "Próxima página" }).click();
    await expectCount(page, Math.min(size, 63 - size), 63);
    expect(listRequests(requests).at(-1)?.params.get("page")).toBe("2");
    expect(await rowCodes(page)).toEqual(sorted(tickets).slice(size, size * 2).map(ticket => ticket.code));
    await pagination(page).getByRole("button", { name: "Página anterior" }).click();
    await expectCount(page, size, 63);
  }
  for (let number = 2; number <= 7; number++) {
    await pagination(page).getByRole("button", { name: "Próxima página" }).click();
    await expectCount(page, number === 7 ? 3 : 10, 63);
    await expect(pagination(page).locator('[aria-current="page"]')).toHaveText(String(number));
  }
  await expect(pagination(page).getByRole("button", { name: "Próxima página" })).toBeDisabled();
  await filters(page).getByRole("searchbox", { name: "Buscar", exact: true }).fill("CH-0063");
  await expectCount(page, 1, 1);
  await expect(pagination(page).getByRole("button", { name: "Página anterior" })).toBeDisabled();
  expect(listRequests(requests).at(-1)?.params.get("page")).toBe("1");
});

test("row selection and select-all are page-local, reset on filters and page size, and never perform batch actions", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  const selectAll = shell(page).getByRole("checkbox", { name: "Selecionar todos os chamados desta página", exact: true });
  await rows(page).first().getByRole("checkbox").check();
  await expect(shell(page).getByText("1 chamado(s) selecionado(s) nesta página.", { exact: true })).toBeAttached();
  await expect(selectAll).toHaveJSProperty("indeterminate", true);
  await selectAll.check(); await expect(rows(page).locator('input:checked')).toHaveCount(10);
  await expect(selectAll).toHaveJSProperty("indeterminate", false);
  await selectAll.uncheck(); await expect(rows(page).locator('input:checked')).toHaveCount(0);
  await rows(page).first().getByRole("checkbox").check();
  await pagination(page).getByRole("button", { name: "Próxima página" }).click(); await expectCount(page, 10, 63);
  await expect(rows(page).locator('input:checked')).toHaveCount(0);
  await pagination(page).getByRole("button", { name: "Página anterior" }).click(); await expectCount(page, 10, 63);
  await expect(rows(page).locator('input:checked')).toHaveCount(0);
  await selectAll.check();
  await filters(page).getByRole("combobox", { name: "Prioridade", exact: true }).selectOption("high"); await expectCount(page, 10, 21);
  await expect(rows(page).locator('input:checked')).toHaveCount(0);
  await selectAll.check();
  await pagination(page).getByRole("combobox", { name: "Itens por página" }).selectOption("25"); await expectCount(page, 21, 21);
  await expect(rows(page).locator('input:checked')).toHaveCount(0);
  expect(requests.filter(request => request.method !== "GET")).toEqual([]);
});

test("a sparse frozen snapshot keeps an empty middle page navigable and refresh rebuilds membership", async ({ page }) => {
  const { requests, hiddenIds, snapshots } = await setup(page, { dataset: tickets.slice(0, 31), snapshot: true });
  await openCentral(page); await expectCount(page, 10, 31);
  const ordered = sorted(tickets.slice(0, 31));
  ordered.slice(10, 20).forEach(ticket => hiddenIds.add(Number(ticket.id)));
  await pagination(page).getByRole("button", { name: "Próxima página" }).click(); await expectCount(page, 0, 21);
  await expect(shell(page).getByRole("heading", { name: "Nenhum chamado acessível nesta página", exact: true })).toBeVisible();
  await expect(pagination(page).locator('[aria-current="page"]')).toHaveText("2");
  await expect(pagination(page).getByRole("button", { name: "Próxima página" })).toBeEnabled();
  expect(listRequests(requests).at(-1)?.params.get("snapshot")).toBe([...snapshots.keys()].at(-1));
  await pagination(page).getByRole("button", { name: "Próxima página" }).click(); await expectCount(page, 10, 21);
  expect(await rowCodes(page)).toEqual(ordered.slice(20, 30).map(ticket => ticket.code));
  await pagination(page).getByRole("button", { name: "Próxima página" }).click(); await expectCount(page, 1, 21);
  await expect(pagination(page).getByRole("button", { name: "Próxima página" })).toBeDisabled();
  await refresh(page); await expectCount(page, 10, 21);
  expect(listRequests(requests).at(-1)?.params.has("snapshot")).toBe(false);
  await expect(pagination(page).locator('[aria-current="page"]')).toHaveText("1");
});

test("ordinary offset pagination clamps after records disappear without a snapshot", async ({ page }) => {
  const { requests, state } = await setup(page, { dataset: tickets.slice(0, 21) });
  await openCentral(page); await expectCount(page, 10, 21);
  await pagination(page).getByRole("button", { name: "Próxima página" }).click(); await expectCount(page, 10, 21);
  state.splice(9);
  await pagination(page).getByRole("button", { name: "Próxima página" }).click(); await expectCount(page, 9, 9);
  await expect(pagination(page).locator('[aria-current="page"]')).toHaveText("1");
  await expect(pagination(page).getByRole("button", { name: "Página anterior" })).toBeDisabled();
  await expect(pagination(page).getByRole("button", { name: "Próxima página" })).toBeDisabled();
  expect(listRequests(requests).slice(-2).map(request => request.params.get("page"))).toEqual(["3", "1"]);
});

test("loading disables list controls; a failed response retries locally without losing the Central shell", async ({ page }) => {
  const gate = deferred(); let fails = true;
  await setup(page, { beforeList: () => gate.promise, failList: () => fails });
  try {
    await openCentral(page);
    await expect(filters(page)).toBeVisible();
    await expect(shell(page).getByRole("button", { name: "Mais opções dos chamados" })).toBeDisabled();
    await expect(pagination(page).getByRole("combobox", { name: "Itens por página" })).toBeDisabled();
    gate.resolve();
    await expect(shell(page).getByRole("alert")).toBeVisible();
    await expect(shell(page).getByRole("heading", { name: "Nenhum chamado encontrado" })).toHaveCount(0);
    fails = false;
    await shell(page).getByRole("button", { name: "Tentar novamente", exact: true }).click(); await expectCount(page, 10, 63);
    await expect(shell(page).getByRole("alert")).toHaveCount(0);
  } finally { gate.resolve(); }
});

test("an authorization failure clears cached rows and facets before a successful retry", async ({ page }) => {
  let revoked = false;
  await setup(page, { failList: () => revoked ? 403 : false });
  await openCentral(page); await expectCount(page, 10, 63);
  await rows(page).first().getByRole("checkbox").check();
  revoked = true; await refresh(page);
  await expect(shell(page).getByRole("alert")).toBeVisible();
  await expectCount(page, 0, 0);
  await expect(shell(page).locator(".ticket-metric-copy strong")).toHaveText(["0", "0", "0", "0", "0"]);
  await expect(shell(page).getByText(tickets[62].subject, { exact: true })).toHaveCount(0);
  revoked = false; await shell(page).getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expectCount(page, 10, 63); await expect(rows(page).locator('input:checked')).toHaveCount(0);
});

test("an expired snapshot retry starts a fresh first page rather than replaying the stale token", async ({ page }) => {
  let expired = true;
  const { requests, snapshots } = await setup(page, { snapshot: true, failList: request => expired && request.params.has("snapshot") ? 409 : false });
  await openCentral(page); await expectCount(page, 10, 63);
  await pagination(page).getByRole("button", { name: "Próxima página" }).click();
  await expect(shell(page).getByRole("alert")).toBeVisible();
  expect(listRequests(requests).at(-1)?.params.get("snapshot")).toBe([...snapshots.keys()].at(-1));
  expired = false; await shell(page).getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expectCount(page, 10, 63);
  expect(listRequests(requests).at(-1)?.params.get("page")).toBe("1");
  expect(listRequests(requests).at(-1)?.params.has("snapshot")).toBe(false);
  await expect(shell(page).getByRole("alert")).toHaveCount(0);
});

test("a late stale search response cannot replace a newer query or unlock controls prematurely", async ({ page }) => {
  const stale = deferred(), newest = deferred();
  const { requests } = await setup(page, { beforeList: request => request.params.get("q") === "Chamado" ? stale.promise : request.params.get("q") === "Marcador exclusivo" ? newest.promise : Promise.resolve() });
  try {
    await openCentral(page); await expectCount(page, 10, 63);
    const search = filters(page).getByRole("searchbox", { name: "Buscar", exact: true });
    await search.fill("Chamado");
    await expect.poll(() => listRequests(requests).some(request => request.params.get("q") === "Chamado")).toBe(true);
    await search.fill("Marcador exclusivo");
    await expect.poll(() => listRequests(requests).some(request => request.params.get("q") === "Marcador exclusivo")).toBe(true);
    stale.resolve();
    await expect(pagination(page).getByRole("combobox", { name: "Itens por página" })).toBeDisabled();
    newest.resolve(); await expectCount(page, 1, 1);
    expect(await rowCodes(page)).toEqual(["CH-0063"]);
    await expect(search).toHaveValue("Marcador exclusivo");
    await expect(shell(page).getByRole("alert")).toHaveCount(0);
  } finally { stale.resolve(); newest.resolve(); }
});

test("refresh menu is keyboard-operable, Escape restores focus, and breadcrumb returns to projects", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  const trigger = shell(page).getByRole("button", { name: "Mais opções dos chamados", exact: true });
  await trigger.focus(); await page.keyboard.press("ArrowDown");
  const item = page.getByRole("menuitem", { name: "Atualizar consulta", exact: true });
  await expect(item).toBeFocused(); await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0); await expect(trigger).toBeFocused();
  const before = listRequests(requests).length;
  await page.keyboard.press("Enter"); await expect(item).toBeFocused(); await page.keyboard.press("Enter");
  await expectCount(page, 10, 63);
  await expect.poll(() => listRequests(requests).length).toBe(before + 1);
  await shell(page).getByRole("navigation", { name: "Caminho da página" }).getByRole("link", { name: "Início", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true, level: 1 })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("cc_org")).toBe(false);
  await expect(shell(page)).toHaveCount(0);
});

test("breadcrumb Back and Forward restore the authorized filter and detail URL history", async ({ page }) => {
  await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  await filters(page).getByRole("searchbox", { name: "Buscar", exact: true }).fill("CH-0063");
  await expectCount(page, 1, 1);
  await rows(page).getByRole("button", { name: "Abrir CH-0063", exact: true }).click();
  const detail = page.getByRole("dialog", { name: tickets[62].subject, exact: true });
  await expect(detail).toBeVisible(); await expect(page).toHaveURL(/cc_ticket=63/);
  await detail.getByRole("button", { name: "Fechar detalhes" }).click(); await expect(detail).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has("cc_ticket")).toBe(false);
  await shell(page).getByRole("navigation", { name: "Caminho da página" }).getByRole("link", { name: "Início", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true, level: 1 })).toBeVisible();
  await page.goBack(); await expectCount(page, 1, 1);
  await expect(filters(page).getByRole("searchbox", { name: "Buscar", exact: true })).toHaveValue("CH-0063");
  expect(new URL(page.url()).searchParams.get("cc_q")).toBe("CH-0063");
  await page.goBack(); await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/cc_ticket=63/);
  await page.goForward(); await expect(detail).toHaveCount(0); await expectCount(page, 1, 1);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true, level: 1 })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has("cc_org")).toBe(false);
});

test("Exportar only reveals the existing export panel and never silently creates a new report", async ({ page }) => {
  const { requests } = await setup(page, { exportsEnabled: true }); await openCentral(page); await expectCount(page, 10, 63);
  const button = shell(page).getByRole("button", { name: "Exportar", exact: true });
  await expect(button).toBeEnabled();
  const panel = shell(page).locator(".ticket-exports"); await expect(panel).not.toHaveAttribute("open", "");
  await button.click(); await expect(panel).toHaveAttribute("open", "");
  await expect(panel.locator("summary")).toBeFocused();
  await expect(panel.getByRole("button", { name: "Solicitar exportação", exact: true })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Relatório", exact: true }).locator("option")).toHaveText(["Visão completa", "Chamados com incidentes", "Incidentes e causas por chamado", "Backlog no instante de referência", "Ciclos encerrados no período", "SLA e cobertura"]);
  await panel.getByRole("button", { name: "Atualizar exportações", exact: true }).click();
  await expect.poll(() => requests.filter(request => request.path.endsWith("/tickets/exports")).length).toBeGreaterThanOrEqual(2);
  expect(requests.filter(request => request.method !== "GET")).toEqual([]);
});

test("read-only permission hides create, management and exports but preserves authorized detail reading", async ({ page }) => {
  const { requests } = await setup(page, { role: "viewer", permissions: ["ticket.view"], exportsEnabled: true });
  await openCentral(page); await expectCount(page, 10, 63);
  await expect(shell(page).getByRole("button", { name: "Novo chamado", exact: true })).toHaveCount(0);
  await expect(shell(page).getByRole("button", { name: "Exportar", exact: true })).toHaveCount(0);
  expect(requests.some(request => request.path.endsWith("/tickets/exports"))).toBe(false);
  await rows(page).first().locator(".ticket-subject-button").click();
  const dialog = page.getByRole("dialog", { name: tickets[62].subject, exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Salvar alterações", exact: true })).toHaveCount(0);
  await expect(dialog.getByText(tickets[62].description, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar detalhes" }).click(); await expect(dialog).toHaveCount(0);
});

test("forced Central URL cannot bypass a denied ticket.view permission", async ({ page }) => {
  const { requests } = await setup(page, { role: "owner", deniedPermissions: ["ticket.view"], startUrl: "/projects?cc_org=1&cc_view=list" });
  await expect(page.getByRole("heading", { name: "Acesso restrito", exact: true })).toBeVisible();
  await expect(shell(page)).toHaveCount(0);
  expect(listRequests(requests)).toEqual([]);
});

test("switching organizations clears search, selected rows, detail and prior-org request state", async ({ page }) => {
  const other = { ...tickets[0], id: 201, organizationId: 2, code: "OTHER-0201", subject: "Atendimento exclusivo da outra organização" };
  const { requests } = await setup(page, { dataset: [...tickets, other] });
  await openCentral(page); await expectCount(page, 10, 63);
  await filters(page).getByRole("searchbox", { name: "Buscar", exact: true }).fill("CH-0063"); await expectCount(page, 1, 1);
  await rows(page).first().getByRole("checkbox").check();
  await rows(page).first().locator(".ticket-subject-button").click();
  await expect(page.getByRole("dialog", { name: tickets[62].subject, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await switchOrganization(page, "Outra organização"); await openCentral(page); await expectCount(page, 1, 1);
  expect(await rowCodes(page)).toEqual([other.code]);
  await expect(filters(page).getByRole("searchbox", { name: "Buscar", exact: true })).toHaveValue("");
  await expect(rows(page).locator('input:checked')).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(listRequests(requests).at(-1)?.path).toBe("/api/organizations/2/tickets");
  await switchOrganization(page, "Organização de demonstração"); await openCentral(page); await expectCount(page, 10, 63);
  await expect(rows(page).locator('input:checked')).toHaveCount(0);
});

test("a late old-organization response cannot expose its tickets in the new organization", async ({ page }) => {
  const gate = deferred();
  const other = { ...tickets[0], id: 201, organizationId: 2, code: "OTHER-0201", subject: "Somente organização dois" };
  const { requests } = await setup(page, { dataset: [...tickets, other], beforeList: request => request.path === "/api/organizations/1/tickets" && request.params.get("q") === "Chamado" ? gate.promise : Promise.resolve() });
  try {
    await openCentral(page); await expectCount(page, 10, 63);
    await filters(page).getByRole("searchbox", { name: "Buscar", exact: true }).fill("Chamado");
    await expect.poll(() => listRequests(requests).some(request => request.params.get("q") === "Chamado")).toBe(true);
    await switchOrganization(page, "Outra organização"); await openCentral(page); await expectCount(page, 1, 1);
    gate.resolve();
    await expectCount(page, 1, 1); expect(await rowCodes(page)).toEqual([other.code]);
    await expect(shell(page).getByText(tickets[62].subject, { exact: true })).toHaveCount(0);
  } finally { gate.resolve(); }
});

test("create, interrupted draft, detail opening and existing PATCH update remain functional", async ({ page }) => {
  const { requests, state } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  const trigger = shell(page).getByRole("button", { name: "Novo chamado", exact: true });
  await trigger.click();
  const createDialog = page.getByRole("dialog", { name: "Novo chamado", exact: true });
  await expect(createDialog).toBeVisible();
  await createDialog.getByRole("textbox", { name: /^Assunto/ }).fill("Solicitação criada pela interface compilada");
  await createDialog.getByRole("textbox", { name: /^Descrição/ }).fill("Dados sintéticos mantidos apenas no interceptador local.");
  await page.keyboard.press("Escape"); await expect(createDialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(createDialog.getByRole("textbox", { name: /^Assunto/ })).toHaveValue("Solicitação criada pela interface compilada");
  await createDialog.getByRole("combobox", { name: "Categoria", exact: true }).selectOption("support");
  await createDialog.getByRole("button", { name: "Criar chamado", exact: true }).click();
  await expect(createDialog).toHaveCount(0); await expectCount(page, 10, 64);
  expect(requests.filter(request => request.method === "POST" && /\/tickets$/.test(request.path))).toHaveLength(1);
  const created = state.find(ticket => ticket.subject === "Solicitação criada pela interface compilada")!;
  await rows(page).filter({ hasText: created.code }).getByRole("button", { name: `Abrir ${created.code}`, exact: true }).click();
  const detail = page.getByRole("dialog", { name: created.subject, exact: true }); await expect(detail).toBeVisible();
  await detail.getByRole("combobox", { name: "Situação", exact: true }).selectOption("in_progress");
  await detail.getByRole("combobox", { name: "Atendente", exact: true }).selectOption("2");
  await detail.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(detail.locator(".ticket-detail-summary .ticket-status-badge")).toHaveText("Em andamento");
  const patch = requests.find(request => request.method === "PATCH" && request.path.endsWith(`/tickets/${created.id}`));
  expect(patch?.headers["if-match"]).toBeUndefined(); // Legacy flow intentionally has no lifecycle ETag requirement.
  expect(JSON.parse(patch?.body || "{}")).toMatchObject({ status: "in_progress", assignedTo: "2" });
  await detail.getByRole("button", { name: "Fechar detalhes" }).click(); await expect(detail).toHaveCount(0);
  await expect(rows(page).filter({ hasText: created.code }).locator(".ticket-status-badge")).toHaveText("Em andamento");
});

test("existing Kanban and Calendar controls remain wired to queue and date-range APIs", async ({ page }) => {
  const { requests } = await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  const view = shell(page).getByRole("combobox", { name: "Visualização dos chamados" });
  await view.selectOption("kanban");
  await expect(shell(page).getByRole("region", { name: "Kanban de chamados", exact: true })).toBeVisible();
  await expect.poll(() => new Set(listRequests(requests).map(request => request.params.get("queue")).filter(Boolean)).size).toBe(4);
  for (const queue of ["open", "in_progress", "in_review", "closed"]) {
    const request = listRequests(requests).find(item => item.params.get("queue") === queue)!;
    expect(request.params.get("limit")).toBe("25");
  }
  await expect(shell(page).locator(".ticket-kanban-column.column-open .ticket-kanban-card")).toHaveCount(25);
  await shell(page).locator(".ticket-kanban-column.column-open").getByRole("button", { name: "Carregar mais nesta fila" }).click();
  await expect(shell(page).locator(".ticket-kanban-column.column-open .ticket-kanban-card")).toHaveCount(26);
  await view.selectOption("calendar");
  await expect(shell(page).getByRole("region", { name: "Calendário de chamados", exact: true })).toBeVisible();
  await shell(page).getByRole("button", { name: "Próximo mês", exact: true }).click();
  await expect.poll(() => listRequests(requests).at(-1)?.params.get("from")).toBe("2026-11-01");
  expect(listRequests(requests).at(-1)?.params.get("to")).toBe("2026-11-30");
  expect(listRequests(requests).at(-1)?.params.get("limit")).toBe("50");
  await view.selectOption("list"); await expectCount(page, 7, 7);
  expect(listRequests(requests).at(-1)?.params.get("limit")).toBe("10");
  await clear(page); await expectCount(page, 10, 63);
});

for (const width of [1440, 900, 390]) {
  test(`responsive Central at ${width}px keeps page bounded with horizontal overflow confined to its table`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page); await openCentral(page); await expectCount(page, 10, 63);
    await page.evaluate(() => document.fonts.ready);
    await expect(filters(page).getByRole("searchbox", { name: "Buscar", exact: true })).toBeVisible();
    for (const name of ["Situação", "Prioridade", "Atendente", "Ordenar por"]) await expect(filters(page).getByRole("combobox", { name, exact: true })).toBeVisible();
    for (const name of ["De", "Até"]) await expect(filters(page).getByLabel(name, { exact: true })).toBeVisible();
    const geometry = await shell(page).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const table = element.querySelector(".ticket-list-scroll") as HTMLElement;
      const roots = [document.documentElement, document.body, document.querySelector(".mm-projects-main"), element].filter(Boolean) as HTMLElement[];
      const panels = [".ticket-center-header", ".ticket-filter-surface", ".ticket-metrics", ".ticket-list-region", ".mm-docs-pagination"].map(selector => {
        const node = element.querySelector(selector) as HTMLElement, bounds = node.getBoundingClientRect();
        return { selector, left: bounds.left, right: bounds.right, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
      });
      return { left: rect.left, right: rect.right, width: window.innerWidth, roots: roots.map(root => ({ clientWidth: root.clientWidth, scrollWidth: root.scrollWidth })),
        panels, table: { clientWidth: table.clientWidth, scrollWidth: table.scrollWidth, overflowX: getComputedStyle(table).overflowX } };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(-1); expect(geometry.right).toBeLessThanOrEqual(width + 1);
    for (const root of geometry.roots) expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    for (const panel of geometry.panels) {
      expect(panel.left, panel.selector).toBeGreaterThanOrEqual(geometry.left - 1);
      expect(panel.right, panel.selector).toBeLessThanOrEqual(geometry.right + 1);
      expect(panel.scrollWidth, panel.selector).toBeLessThanOrEqual(panel.clientWidth + 1);
    }
    expect(geometry.table.overflowX).toMatch(/auto|scroll/);
    if (width < 1440) expect(geometry.table.scrollWidth).toBeGreaterThan(geometry.table.clientWidth);
    const scroll = shell(page).getByRole("region", { name: "Tabela de chamados", exact: true });
    await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(rows(page).first().getByRole("button", { name: /^Abrir CH-/ })).toBeVisible();
    await scroll.evaluate(element => { element.scrollLeft = 0; });
    if (width > 760) await page.setViewportSize({ width, height: 1800 });
    await shell(page).screenshot({ path: testInfo.outputPath(`ticket-center-${width}.png`), animations: "disabled" });
  });
}


test("keyboard pagination restores focus without remounting the footer", async ({ page }) => {
  await setup(page); await openCentral(page); await expectCount(page, 10, 63);
  const next = shell(page).locator(".mm-docs-pagination").getByRole("button", { name: "Próxima página", exact: true });
  await next.focus(); await page.keyboard.press("Enter");
  await expectCount(page, 10, 63); await expect(shell(page).locator(".mm-docs-pagination").locator('[aria-current="page"]')).toHaveText("2");
  await expect(next).toBeFocused();
  const size = shell(page).locator(".mm-docs-pagination").getByRole("combobox", { name: "Itens por página", exact: true });
  await size.focus(); await size.selectOption("25"); await expectCount(page, 25, 63); await expect(size).toBeFocused();
});


test("Forward Home invalidates a delayed cross-organization breadcrumb restoration", async ({ page }) => {
  const gate = deferred(); let delayRestore = false;
  const { requests } = await setup(page, { beforeOrganizationSwitch: id => delayRestore && id === 1 ? gate.promise : Promise.resolve() });
  try {
    await openCentral(page); await expectCount(page, 10, 63);
    await shell(page).getByRole("navigation", { name: "Caminho da página" }).getByRole("link", { name: "Início", exact: true }).click();
    await switchOrganization(page, "Outra organização");
    delayRestore = true;
    await page.goBack();
    await expect.poll(() => requests.some(request => request.path === "/api/session/active-organization" && String(JSON.parse(request.body || "{}").organizationId) === "1")).toBe(true);
    await page.goForward();
    await expect.poll(() => new URL(page.url()).searchParams.has("cc_org")).toBe(false);
    gate.resolve();
    await expect(page.locator('.mm-projects-main')).not.toHaveClass(/is-context-switching/);
    await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true, level: 1 })).toBeVisible();
    await expect(shell(page)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("cc_org")).toBe(false);
  } finally { gate.resolve(); }
});


test("refresh keeps keyboard focus while a delayed request disables only the pending action", async ({ page }) => {
  const gate = deferred(); let pending = false;
  await setup(page, { beforeList: () => pending ? gate.promise : Promise.resolve() });
  try {
    await openCentral(page); await expectCount(page, 10, 63);
    pending = true;
    const trigger = shell(page).getByRole("button", { name: "Mais opções dos chamados", exact: true });
    await trigger.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Atualizar consulta", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(shell(page).locator(".ticket-view-region")).toHaveAttribute("aria-busy", "true");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Atualizar consulta", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    pending = false; gate.resolve(); await expectCount(page, 10, 63);
    await expect(trigger).toBeFocused();
  } finally { gate.resolve(); }
});
