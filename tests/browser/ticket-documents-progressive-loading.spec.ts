import { expect, test, type Page } from "@playwright/test";

// Real compiled React routes; controlled synthetic HTTP only. These tests do not
// claim integrated production/API/storage acceptance or authorize any writes.
const organizations = [{ id: 1, name: "Organização sintética", slug: "synthetic", active: true }, { id: 2, name: "Outra organização", slug: "other", active: true }];
const attachmentLimits = { maxFiles: 5, maxFileBytes: 83886080, maxTicketBytes: 157286400, chunkBytes: 8388608 };
const tickets = Array.from({ length: 63 }, (_, index) => ({ id: index + 1, organizationId: 1, code: `CH-${String(index + 1).padStart(4, "0")}`, subject: `Chamado ${String(index + 1).padStart(3, "0")}`, description: "Descrição sintética.", status: index < 32 ? "open" : ["in_progress", "in_review", "closed"][index % 3], priority: "normal", category: "map", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-02T12:00:00Z", dueAt: index % 4 ? "2026-10-15T12:00:00Z" : null, createdBy: { id: 1, name: "Pessoa sintética" }, assignedTo: null, attachmentsCount: 0, version: 1, etag: `"ticket-${index + 1}-v1"`, visibility: "organization" }));
const files = Array.from({ length: 62 }, (_, index) => ({ id: index + 1, name: `Documento ${String(index + 1).padStart(3, "0")}.pdf`, fileType: "pdf", size: 1024, updatedAt: "2026-10-01T12:00:00Z", folderId: null }));
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
type Fixture = { assignees?: Array<{ id: number; name: string }>; allowStatusMove?: boolean; expireRetainedPin?: boolean; beforeRead?: (url: URL) => Promise<void>; failRead?: (url: URL) => boolean | number };
const diagnostics = new WeakMap<Page, { errors: string[]; writes: string[] }>();
async function setup(page: Page, options: Fixture = {}) {
  let organizationId = 1, retainedPinExpired = false;
  const ticketState = tickets.map(ticket => ({ ...ticket }));
  const requests: URL[] = [], state = { errors: [] as string[], writes: [] as string[] };
  diagnostics.set(page, state); page.on("pageerror", error => state.errors.push(error.message));
  const session = () => ({ authenticated: true, user: { id: 1, name: "Operador sintético", email: "qa@example.test", role: "super_admin", permissions: [], activeOrganizationId: organizationId }, projects: [], organizations, activeOrganization: organizations.find(org => org.id === organizationId) });
  await page.clock.setFixedTime(new Date("2026-10-04T12:00:00Z"));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    requests.push(url);
    if (path === "/api/session") return route.fulfill({ json: session() });
    if (path === "/api/session/active-organization" && request.method() === "PUT") { organizationId = Number(request.postDataJSON().organizationId); return route.fulfill({ json: { ok: true, ...session() } }); }
    if ((options.allowStatusMove || options.expireRetainedPin) && request.method() === "PATCH" && path === "/api/organizations/1/tickets/1") {
      const updated = { ...ticketState[0], ...request.postDataJSON(), version: 2, etag: '"ticket-1-v2"' };
      ticketState[0] = updated; retainedPinExpired = Boolean(options.expireRetainedPin);
      return route.fulfill({ json: { ok: true, ticket: updated } });
    }
    if (retainedPinExpired && path === "/api/organizations/1/tickets/1") return route.fulfill({ status: 401, json: { ok: false, error: { code: "AUTH_SESSION_EXPIRED", category: "AUTH", retryable: false } } });
    if (request.method() !== "GET") { state.writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 403, json: { ok: false } }); }
    const match = path.match(/^\/api\/organizations\/(\d+)\/(tickets|files|document-folders)(?:\/(\d+))?$/);
    if (match) {
      const id = Number(match[1]), resource = match[2], params = url.searchParams;
      let response: object;
      if (resource === "document-folders") response = { ok: true, folders: [{ id: 1, organizationId: id, name: `Pasta ${id}`, parentId: null }] };
      else if (resource === "files") {
        const search = (params.get("search") || "").toLowerCase(), trash = params.get("state") === "trash", offset = Number(params.get("cursor") || 0), limit = Number(params.get("limit") || 50);
        const all = files.filter(file => file.name.toLowerCase().includes(search)).map(file => ({ ...file, name: id === 1 ? file.name : `Outra ${file.name}`, ...(trash ? { deletedAt: "2026-10-02T12:00:00Z", purgeAfter: "2999-01-01", deletedBy: { name: "Pessoa sintética" } } : {}) }));
        response = { ok: true, files: all.slice(offset, offset + limit), facets: { types: ["pdf"], projects: [], rootCount: all.length, folderCounts: [{ folderId: 1, count: 0 }] }, pagination: { total: all.length, limit, hasMore: offset + limit < all.length, nextCursor: offset + limit < all.length ? String(offset + limit) : null, sort: params.get("sort") || "updated_desc" }, capabilities: { permanentPurgeEnabled: false } };
      } else if (match[3]) response = { ok: true, ticket: { ...tickets[Number(match[3]) - 1], organizationId: id }, attachments: [], events: [], assignees: options.assignees ?? [], attachmentLimits, lifecycleEnabled: false, triageEnabled: false, conversation: { enabled: false, schemaReady: true, permissions: { comment: false, noteView: false, noteCreate: false }, messages: [], drafts: [], hasMore: false } };
      else {
        const query = (params.get("q") || "").toLowerCase(), queue = params.get("queue"), pageNumber = Number(params.get("page") || 1), limit = Number(params.get("limit") || 50);
        const all = ticketState.filter(ticket => (!retainedPinExpired || ticket.id !== 1) && ticket.subject.toLowerCase().includes(query) && (!queue || ticket.status === queue) && (!params.get("status") || ticket.status === params.get("status"))).map(ticket => ({ ...ticket, organizationId: id, subject: id === 1 ? ticket.subject : `Outro ${ticket.subject}` }));
        response = { ok: true, tickets: all.slice((pageNumber - 1) * limit, pageNumber * limit), facets: { byStatus: Object.fromEntries(["new", "open", "in_progress", "in_review", "closed"].map(status => [status, all.filter(ticket => ticket.status === status).length])), overdue: 0 }, pagination: { total: all.length, page: pageNumber, limit, totalPages: Math.max(1, Math.ceil(all.length / limit)), hasMore: pageNumber * limit < all.length, snapshot: `snapshot-${id}-${query}`, snapshotAt: "2026-10-04T12:00:00Z" }, range: { from: params.get("from"), to: params.get("to") }, assignees: options.assignees ?? [], attachmentLimits, flowEnabled: false, lifecycleEnabled: false, triageEnabled: false };
      }
      // Snapshot payload is captured before releasing deliberately stale replies.
      await options.beforeRead?.(url);
      const failure = options.failRead?.(url);
      if (failure) { const status = typeof failure === "number" ? failure : 503; return route.fulfill({ status, json: { ok: false, error: { code: status === 401 ? "AUTH_SESSION_EXPIRED" : status === 403 ? "PERMISSION_DENIED" : "INFRASTRUCTURE_UNEXPECTED_ERROR", category: status === 401 ? "AUTH" : status === 403 ? "PERMISSION" : "INFRASTRUCTURE", retryable: status === 503 } } }); }
      return route.fulfill({ json: response });
    }
    return route.fulfill({ json: { ok: true, enabled: false, schemaReady: true, notifications: [], jobs: [], items: [], projects: [], tickets: [], users: [], unreadCount: 0 } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Todos os Projetos", exact: true })).toBeVisible();
  return requests;
}
async function open(page: Page, name: "Arquivos e Documentos" | "Central de Chamados") { await page.locator(".mm-sidebar-item").filter({ hasText: name }).click(); await expect(page.getByRole("heading", { name, exact: true })).toBeVisible(); }
async function view(page: Page, label: "Lista" | "Kanban" | "Calendário") { await page.getByRole("combobox", { name: "Visualização dos chamados", exact: true }).click(); await page.getByRole("listbox").getByRole("option", { name: label, exact: true }).click(); }
async function refresh(page: Page) { await page.getByRole("button", { name: "Mais opções dos chamados", exact: true }).click(); await page.getByRole("menuitem", { name: "Atualizar consulta", exact: true }).click(); }
const docs = (page: Page) => page.locator(".mm-docs-results"), central = (page: Page) => page.locator(".ticket-center-shell");
const frames = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
test.afterEach(async ({ page }) => { expect(diagnostics.get(page)?.errors ?? []).toEqual([]); expect(diagnostics.get(page)?.writes ?? []).toEqual([]); });

for (const width of [1440, 390]) for (const mode of ["list", "grid"] as const) test(`Documents ${mode} ${width}px: initial shared geometry, unknown facets and immediate reveal`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); const gate = deferred();
  await setup(page, { beforeRead: async url => { if (url.pathname.endsWith("/files")) await gate.promise; } });
  await open(page, "Arquivos e Documentos");
  // Settle the independent folder reveal before clicking a view control below it.
  const readyFolder = page.locator('.mm-docs-folder-card:not(.mm-loading-folder-card)').first();
  await expect(readyFolder).toBeVisible(); await expect(readyFolder).not.toContainText('0 documentos');
  if (mode === "grid") {
    const gridButton = page.getByRole("button", { name: "Visualização em grade" });
    await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");
  }
  const results = docs(page); await expect(results.locator(".mm-skeleton").first()).toBeVisible();
  await expect(page.locator(".mm-docs-folder-card").first()).not.toContainText("0 documentos");
  await expect(results).not.toContainText("Exibindo 0/0"); await expect(results.getByText("Itens por página")).toBeVisible();
  await expect(results.locator(mode === "list" ? ".mm-loading-table-row" : ".mm-loading-document-card").first()).toBeVisible();
  expect(await results.getByRole('status').evaluateAll(nodes => nodes.length === 1 && nodes.every(node => !node.closest('[aria-busy="true"]')))).toBe(true);
  await page.screenshot({ path: info.outputPath(`documents-${mode}-${width}-initial.png`), fullPage: true });
  // WebKit trace: viewportY447.5+scroll1558 === viewportY699.5+scroll1306.
  // Document Y stayed2005.5; settle the capture/click scroll before measuring.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); await frames(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const heading = await results.getByRole("heading").boundingBox();
  gate.release(); await expect(results.locator(".mm-skeleton")).toHaveCount(0); await expect(results).toContainText("Documento 001.pdf");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await results.getByRole("heading").boundingBox())?.y).toBe(heading?.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

for (const width of [1440, 390]) test(`Documents folder ${width}px: reserved outer height matches the real card including borders`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const foldersGate = deferred(), filesGate = deferred();
  await setup(page, { beforeRead: async url => {
    if (url.pathname.endsWith('/document-folders')) await foldersGate.promise;
    if (url.pathname.endsWith('/files')) await filesGate.promise;
  } });
  await open(page, 'Arquivos e Documentos');
  const placeholder = page.locator('.mm-loading-folder-card').first(); await expect(placeholder).toBeVisible();
  const reserved = await placeholder.boundingBox(); expect(reserved).not.toBeNull();
  foldersGate.release(); const real = page.locator('.mm-docs-folder-card:not(.mm-loading-folder-card)').first(); await expect(real).toBeVisible();
  const actual = await real.boundingBox(); expect(actual).not.toBeNull();
  expect(actual?.height).toBe(reserved?.height);
  expect(await real.evaluate(element => element.getBoundingClientRect().height)).toBe(await real.evaluate(element => {
    const style = getComputedStyle(element), control = element.querySelector('.mm-docs-folder-select')!;
    return control.getBoundingClientRect().height + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  }));
  await expect(real).not.toContainText('0 documentos');
  filesGate.release(); await expect(docs(page)).toContainText('Documento 001.pdf'); await expect(docs(page).locator('.mm-skeleton')).toHaveCount(0);
});

test("Documents: sorting refresh keeps existing rows, breadcrumb and input focus", async ({ page }, info) => {
  let hold = false; const gate = deferred();
  await setup(page, { beforeRead: async url => { if (hold && url.pathname.endsWith("/files")) await gate.promise; } });
  await open(page, "Arquivos e Documentos"); await expect(docs(page)).toContainText("Documento 001.pdf");
  await page.getByRole("button", { name: "Visualização em grade" }).click();
  const input = page.locator('.mm-docs-search input'); await input.fill("rascunho preservado"); await input.focus();
  await docs(page).evaluate(element => { element.dataset.retained = "yes"; });
  hold = true; await page.locator('.mm-docs-sort select').selectOption("name_asc");
  // Submit applies filter, so use the actual list sort after returning to list.
  await page.getByRole("button", { name: "Visualização em lista" }).click();
  await docs(page).getByRole("button", { name: /^Nome: Classificar/ }).click();
  await input.focus(); await expect(docs(page).locator('[aria-busy="true"]')).toHaveCount(1);
  await expect(docs(page)).toContainText("Documento 001.pdf"); await expect(docs(page).locator('.mm-skeleton')).toHaveCount(0);
  await expect(input).toHaveValue("rascunho preservado"); await expect(input).toBeFocused();
  await expect(docs(page)).toHaveAttribute('data-retained', 'yes');
  await page.screenshot({ path: info.outputPath('documents-partial-refresh.png'), fullPage: true });
  gate.release(); await expect(docs(page).locator('[aria-busy="true"]')).toHaveCount(0); await expect(input).toBeFocused();
  hold = false;
});

test("Documents: cursor load retains current page with expansion-only placeholders", async ({ page }) => {
  const gate = deferred(); await setup(page, { beforeRead: async url => { if (url.pathname.endsWith('/files') && url.searchParams.has('cursor')) await gate.promise; } });
  await open(page, 'Arquivos e Documentos'); await expect(docs(page)).toContainText('Documento 001.pdf');
  await docs(page).locator('.mm-docs-page-controls select').selectOption('50');
  await docs(page).getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(docs(page).locator('.mm-loading-table-row').first()).toBeVisible();
  await expect(docs(page)).toContainText('Documento 001.pdf');
  await expect(docs(page).locator('tbody tr:not(.mm-loading-table-row)')).toHaveCount(50);
  gate.release(); await expect(docs(page).locator('.mm-loading-table-row')).toHaveCount(0); await expect(docs(page)).toContainText('Documento 051.pdf');
});

for (const feature of ['documents', 'tickets'] as const) test(`${feature}: error/empty/cancelled/out-of-order reads never revive stale skeleton or content`, async ({ page }) => {
  let fail = true; const old = deferred(); const endpoint = feature === 'documents' ? '/files' : '/tickets', param = feature === 'documents' ? 'search' : 'q';
  const requests = await setup(page, { beforeRead: async url => { if (url.pathname.endsWith(endpoint) && url.searchParams.get(param) === '001') await old.promise; }, failRead: url => fail && url.pathname.endsWith(endpoint) });
  await open(page, feature === 'documents' ? 'Arquivos e Documentos' : 'Central de Chamados');
  const region = feature === 'documents' ? docs(page) : central(page);
  await expect(page.getByRole('alert').first()).toBeVisible(); await expect(region.locator('.mm-skeleton')).toHaveCount(0);
  fail = false;
  const search = feature === 'documents' ? page.locator('.mm-docs-search input') : page.locator('.ticket-filter-search input');
  const query = async (value: string) => { await search.fill(value); if (feature === 'documents') await page.getByRole('button', { name: 'Aplicar', exact: true }).click(); };
  await query('001'); await expect.poll(() => requests.filter(url => url.pathname.endsWith(endpoint) && url.searchParams.get(param) === '001').length).toBeGreaterThan(0);
  await query('002'); await expect(region).toContainText(feature === 'documents' ? 'Documento 002.pdf' : 'Chamado 002');
  old.release(); await frames(page); await expect(region).not.toContainText(feature === 'documents' ? 'Documento 001.pdf' : 'Chamado 001'); await expect(region.locator('.mm-skeleton')).toHaveCount(0);
  await query('nonexistent'); await expect(region).toContainText(feature === 'documents' ? 'Nenhum documento encontrado' : 'Nenhum chamado encontrado'); await expect(region.locator('.mm-skeleton')).toHaveCount(0);
  // Leaving a region cancels its lifecycle; re-entry starts only its own reads.
  await open(page, feature === 'documents' ? 'Central de Chamados' : 'Arquivos e Documentos');
  await expect(region).toHaveCount(0);
});

for (const mode of ['Lista', 'Kanban', 'Calendário'] as const) test(`Central ${mode}: pending values preserve known labels and matching view structure`, async ({ page }, info) => {
  const gate = deferred(); await setup(page, { beforeRead: async url => { if (url.pathname.endsWith('/tickets')) await gate.promise; } });
  await open(page, 'Central de Chamados'); if (mode !== 'Lista') await view(page, mode);
  const region = central(page); await expect(region.locator('.ticket-metric-copy > span')).toHaveText(['Abertos', 'Em andamento', 'Em revisão', 'Vencidos', 'Concluídos']);
  await expect(region).not.toContainText('0 acessíveis nesta consulta'); await expect(region).not.toContainText('Exibindo 0/0');
  if (mode === 'Lista') await expect(region.getByRole('columnheader', { name: 'Assunto', exact: true })).toBeVisible();
  if (mode === 'Kanban') { await expect(region.locator('.ticket-kanban-column')).toHaveCount(4); await expect(region).not.toContainText('0 / 0'); await expect(region.locator('.mm-loading-ticket-card').first()).toBeVisible(); }
  if (mode === 'Calendário') { await expect(region.getByRole('button', { name: 'Próximo mês' })).toBeVisible(); await expect(region.locator('.mm-loading-calendar-event').first()).toBeVisible(); }
  await page.screenshot({ path: info.outputPath(`central-${mode}-initial.png`), fullPage: true }); gate.release();
  await expect(region.locator('.mm-skeleton')).toHaveCount(0); await expect(region).toContainText('Chamado 001');
});

test('Central: list refresh preserves revealed rows and input focus', async ({ page }, info) => {
  let hold = false; const gate = deferred(); await setup(page, { beforeRead: async url => { if (hold && url.pathname.endsWith('/tickets')) await gate.promise; } });
  await open(page, 'Central de Chamados'); await expect(central(page)).toContainText('Chamado 001');
  const input = page.locator('.ticket-filter-search input'); hold = true; await refresh(page); await input.focus();
  await expect(central(page).locator('.ticket-list-scroll')).toHaveAttribute('aria-busy','true'); await expect(central(page)).toContainText('Chamado 001'); await expect(central(page).locator('.mm-skeleton')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('central-list-refresh.png'),fullPage:true}); gate.release(); await expect(central(page).locator('.ticket-list-scroll')).toHaveAttribute('aria-busy','false'); await expect(input).toBeFocused();
});

test('Central: Kanban manual refresh retains board identity and cards; more only expands one queue', async ({ page }) => {
  let hold = false; let gate = deferred(); await setup(page, { beforeRead: async url => { if (hold && url.pathname.endsWith('/tickets')) await gate.promise; } });
  await open(page,'Central de Chamados'); await view(page,'Kanban'); const board=page.locator('.ticket-kanban'), queue=board.locator('.column-open');
  await expect(queue.locator('.ticket-kanban-card:not(.mm-loading-ticket-card)')).toHaveCount(25); await board.evaluate(element=>{element.dataset.retained='yes';});
  hold=true; await refresh(page); await expect(queue.locator('.ticket-kanban-stack')).toHaveAttribute('aria-busy','true'); await expect(board).toHaveAttribute('data-retained','yes'); await expect(board.locator('.mm-loading-ticket-card')).toHaveCount(0);
  gate.release(); await expect(queue.locator('.ticket-kanban-stack')).toHaveAttribute('aria-busy','false');
  gate=deferred(); await queue.getByRole('button',{name:'Carregar mais nesta fila'}).click();
  await expect(queue.locator('.ticket-kanban-card:not(.mm-loading-ticket-card)')).toHaveCount(25); await expect(queue.locator('.mm-loading-ticket-card').first()).toBeVisible(); await expect(board.locator('.column-closed .mm-skeleton')).toHaveCount(0);
  gate.release(); await expect(queue.locator('.ticket-kanban-card:not(.mm-loading-ticket-card)')).toHaveCount(32); await expect(board.locator('.mm-skeleton')).toHaveCount(0);
});

test('Central: failed first Kanban queue settles every pending region', async ({ page }) => {
  await setup(page,{failRead:url=>url.pathname.endsWith('/tickets') && url.searchParams.get('queue')==='open'});
  await open(page,'Central de Chamados'); await view(page,'Kanban'); await expect(page.getByRole('alert').first()).toBeVisible(); await expect(page.locator('.ticket-kanban .mm-skeleton')).toHaveCount(0); await expect(page.locator('.ticket-kanban [aria-busy="true"]')).toHaveCount(0); await expect(page.locator('.ticket-kanban')).not.toContainText('0 / 0');
});

test('Documents: reduced motion keeps static pending geometry; trash has real headers', async ({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'}); let hold=false;const gate=deferred(); await setup(page,{beforeRead:async url=>{if(hold&&url.pathname.endsWith('/files'))await gate.promise;}});
  await open(page,'Arquivos e Documentos'); await expect(docs(page)).toContainText('Documento 001.pdf');hold=true;await page.getByRole('button',{name:'Lixeira',exact:true}).click();
  await expect(docs(page).getByRole('columnheader',{name:'Pasta anterior'})).toBeVisible();const block=docs(page).locator('.mm-skeleton').first();await expect(block).toBeVisible();expect(await block.evaluate(element=>getComputedStyle(element,'::after').animationName)).toBe('none');gate.release();await expect(docs(page).locator('.mm-skeleton')).toHaveCount(0);
});

for (const failSecond of [false, true]) test(`Central: first queue reveals while second is slow${failSecond ? " then errors" : ""}`, async ({page})=>{
  const second=deferred();await setup(page,{beforeRead:async url=>{if(url.searchParams.get('queue')==='in_progress')await second.promise;},failRead:url=>failSecond&&url.searchParams.get('queue')==='in_progress'});
  await open(page,'Central de Chamados');await view(page,'Kanban');const board=page.locator('.ticket-kanban');
  await expect(board.locator('.column-open')).toContainText('Chamado 001');await expect(board.locator('.column-open .mm-skeleton')).toHaveCount(0);await expect(board.locator('.column-in_progress .mm-loading-ticket-card').first()).toBeVisible();
  second.release();await expect(board.locator('.mm-skeleton')).toHaveCount(0);await expect(board.locator('.column-open')).toContainText('Chamado 001');
  if(failSecond)await expect(page.getByRole('alert').first()).toBeVisible();else await expect(board.locator('.column-in_progress .ticket-kanban-card').first()).toBeVisible();
});

for (const feature of ['documents','tickets'] as const) for(const status of [401,403]) test(`${feature}: ${status} refresh clears previously revealed access data`,async({page})=>{
  let denied=false;const endpoint=feature==='documents'?'/files':'/tickets';await setup(page,{failRead:url=>denied&&url.pathname.endsWith(endpoint)?status:false});
  await open(page,feature==='documents'?'Arquivos e Documentos':'Central de Chamados');const region=feature==='documents'?docs(page):central(page),name=feature==='documents'?'Documento 001.pdf':'Chamado 001';
  await expect(region).toContainText(name);denied=true;
  if(feature==='documents')await docs(page).getByRole('button',{name:/^Nome: Classificar/}).click();else await refresh(page);
  await expect(page.getByRole('alert').first()).toBeVisible();await expect(region).not.toContainText(name);await expect(region.locator('.mm-skeleton')).toHaveCount(0);
});

test('Central detail: real summary fields stay readable while an old closed request cannot overwrite the next ticket',async({page})=>{
  const old=deferred();await setup(page,{beforeRead:async url=>{if(url.pathname.endsWith('/tickets/1'))await old.promise;}});await open(page,'Central de Chamados');await expect(central(page)).toContainText('Chamado 001');
  await page.getByRole('button',{name:'Chamado 001',exact:true}).click();const drawer=page.locator('.ticket-detail-drawer');await expect(drawer.locator('.mm-loading-ticket-detail')).toBeVisible();await expect(drawer).toContainText('Solicitante');await expect(drawer.getByRole('button',{name:'Fechar detalhes'})).toBeVisible();
  await drawer.getByRole('button',{name:'Fechar detalhes'}).click();await page.getByRole('button',{name:'Chamado 002',exact:true}).click();await expect(drawer.getByRole('heading',{name:'Chamado 002',exact:true})).toBeVisible();old.release();await frames(page);await expect(drawer.getByRole('heading',{name:'Chamado 002',exact:true})).toBeVisible();await expect(drawer.locator('.mm-skeleton')).toHaveCount(0);
});


test('Central: expired session during retained-pin reauthorization clears the entire board', async ({page})=>{
  await setup(page,{expireRetainedPin:true});await open(page,'Central de Chamados');await view(page,'Kanban');const board=page.locator('.ticket-kanban');const card=board.locator('.ticket-kanban-card').filter({has:page.getByRole('button',{name:'Chamado 001',exact:true})});
  await expect(card).toBeVisible();await card.locator('select').selectOption('in_progress');
  await expect(page.getByRole('alert').first()).toBeVisible();await expect(board.locator('.ticket-kanban-card')).toHaveCount(0);await expect(board.locator('.mm-skeleton')).toHaveCount(0);await expect(board.locator('[aria-busy="true"]')).toHaveCount(0);
});

for(const dialog of ['rename','move-file','move-folder','create-folder'] as const) test(`Documents: denied refresh dismisses ${dialog} metadata dialog`,async({page})=>{
  let deny=false;const gate=deferred();await setup(page,{beforeRead:async url=>{if(deny&&url.pathname.endsWith('/files'))await gate.promise;},failRead:url=>deny&&url.pathname.endsWith('/files')?403:false});await open(page,'Arquivos e Documentos');await expect(docs(page)).toContainText('Documento 001.pdf');deny=true;
  await docs(page).getByRole('button',{name:/^Nome: Classificar/}).click();
  if(dialog==='create-folder')await page.getByRole('button',{name:'Nova pasta',exact:true}).click();
  else if(dialog==='move-folder'){await page.getByRole('button',{name:'Ações da pasta Pasta 1',exact:true}).click();await page.getByRole('menuitem',{name:'Mover pasta',exact:true}).click();}
  else{await page.getByRole('button',{name:'Ações de Documento 001.pdf',exact:true}).click();await page.getByRole('menuitem',{name:dialog==='rename'?'Renomear':'Mover',exact:true}).click();}
  await expect(page.getByRole('dialog')).toBeVisible();gate.release();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('alert').first()).toBeVisible();await expect(page.locator('.mm-docs')).not.toContainText('Documento 001.pdf');
});

test('Central: detail401 immediately clears list and summary cache',async({page})=>{
  await setup(page,{failRead:url=>url.pathname.endsWith('/tickets/1')?401:false});await open(page,'Central de Chamados');await expect(central(page)).toContainText('Chamado 001');await page.getByRole('button',{name:'Chamado 001',exact:true}).click();
  await expect(page.getByRole('alert').first()).toBeVisible();await expect(page.locator('.ticket-detail-drawer')).toHaveCount(0);await expect(central(page)).not.toContainText('Chamado 001');await expect(central(page).locator('.ticket-metric-copy strong')).toHaveText(['—','—','—','—','—']);await expect(central(page).locator('.mm-skeleton')).toHaveCount(0);
});

test('Central: retry reveals recovered unknown queue even while another queue still fails',async({page})=>{
  let retry=false;await setup(page,{failRead:url=>url.pathname.endsWith('/tickets')&&(url.searchParams.get('queue')==='closed'||!retry&&url.searchParams.get('queue')==='in_review')});await open(page,'Central de Chamados');await view(page,'Kanban');const board=page.locator('.ticket-kanban');
  await expect(page.getByRole('alert')).toHaveCount(2);await expect(board.locator('.column-open')).toContainText('Chamado 001');await expect(board.locator('.column-in_review .ticket-kanban-card')).toHaveCount(0);
  retry=true;await page.getByRole('button',{name:'Tentar novamente',exact:true}).first().click();await expect(board.locator('.column-in_review .ticket-kanban-card').first()).toBeVisible();await expect(board.locator('.mm-skeleton')).toHaveCount(0);await expect(page.getByRole('alert')).toHaveCount(1);await expect(board.locator('.column-open')).toContainText('Chamado 001');
});


test('Central: a mutation in query A does not delay independent first-queue reveal in query B',async({page})=>{
  const second=deferred();const requests=await setup(page,{allowStatusMove:true,beforeRead:async url=>{if(url.searchParams.get('q')==='0'&&url.searchParams.get('queue')==='in_progress')await second.promise;}});
  await open(page,'Central de Chamados');await view(page,'Kanban');let board=page.locator('.ticket-kanban');const moved=board.locator('.ticket-kanban-card').filter({has:page.getByRole('button',{name:'Chamado 001',exact:true})});
  await expect(moved).toBeVisible();await moved.locator('select').selectOption('in_progress');await expect(board.locator('.column-in_progress')).toContainText('Chamado 001');await expect(board.locator('.column-open > header > span')).toHaveText('25 / 31');await expect(board.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.locator('.ticket-filter-search input').fill('0');await expect.poll(()=>requests.filter(url=>url.searchParams.get('q')==='0'&&url.searchParams.get('queue')==='open').length).toBeGreaterThan(0);
  board=page.locator('.ticket-kanban');await expect(board.locator('.column-in_progress .mm-loading-ticket-card').first()).toBeVisible();await expect(board.locator('.column-open')).toContainText('Chamado 002');await expect(board.locator('.column-open .mm-skeleton')).toHaveCount(0);
  second.release();await expect(board.locator('.mm-skeleton')).toHaveCount(0);await expect(board.locator('.column-in_progress')).toContainText('Chamado 001');
});

// Observe actual React commits and fetch readiness, rather than adding sleeps to
// application requests or inferring timing from Playwright's polling interval.
async function traceInitialStages(page: Page, feature: 'documents' | 'tickets') {
  await page.evaluate(feature => {
    const regionSelector = feature === 'documents' ? '.mm-docs-results' : '.ticket-list-region';
    const titleSelector = feature === 'documents' ? '#mm-docs-results-title .mm-static-loading-text' : '.ticket-list-header h3 .mm-static-loading-text';
    const endpoint = feature === 'documents' ? '/files' : '/tickets';
    const trace = { firstAt: null as number | null, structureAt: null as number | null, requestAt: null as number | null, responseAt: null as number | null, readyAt: null as number | null, initiallyMasked: false, requestDuringStructure: false };
    Object.assign(window, { __ticketDocumentStages: trace });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = new URL(typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url, window.location.href);
      const matches = url.pathname.endsWith(endpoint) && !url.searchParams.has('queue');
      if (matches && trace.requestAt === null) {
        trace.requestAt = performance.now();
        trace.requestDuringStructure = document.querySelector(titleSelector)?.getAttribute('data-loading-structure') === 'pending';
      }
      const response = await originalFetch(...args);
      if (matches && trace.responseAt === null) trace.responseAt = performance.now();
      return response;
    };
    const sample = () => {
      const region = document.querySelector(regionSelector), title = document.querySelector(titleSelector);
      if (!region || !title) return;
      if (trace.firstAt === null) { trace.firstAt = performance.now(); trace.initiallyMasked = title.getAttribute('data-loading-structure') === 'pending'; }
      if (trace.structureAt === null && title.getAttribute('data-loading-structure') !== 'pending') trace.structureAt = performance.now();
      if (trace.readyAt === null && region.querySelector('tbody tr:not(.mm-loading-table-row)')) trace.readyAt = performance.now();
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-loading-structure', 'aria-busy'] });
    sample();
  }, feature);
}
async function initialStageTrace(page: Page) {
  return page.evaluate(() => (window as typeof window & { __ticketDocumentStages: { firstAt: number; structureAt: number; requestAt: number; responseAt: number; readyAt: number; initiallyMasked: boolean; requestDuringStructure: boolean } }).__ticketDocumentStages);
}

for (const feature of ['documents', 'tickets'] as const) test(`${feature}: real fast request starts during static presentation and volatile content reveals afterward`, async ({ page }) => {
  await setup(page); await traceInitialStages(page, feature);
  await open(page, feature === 'documents' ? 'Arquivos e Documentos' : 'Central de Chamados');
  const region = feature === 'documents' ? docs(page) : page.locator('.ticket-list-region');
  await expect(region.locator('tbody tr:not(.mm-loading-table-row)').first()).toBeVisible();
  const trace = await initialStageTrace(page);
  expect(trace.initiallyMasked).toBe(true);
  // MutationObserver runs after commit, so its timestamp proves order only.
  // Exact deadlines are asserted below with a frozen presentation clock.
  expect(trace.requestDuringStructure).toBe(true);
  expect(trace.requestAt).toBeLessThanOrEqual(trace.structureAt);
  expect(trace.structureAt).toBeLessThan(trace.readyAt);
  expect(trace.responseAt).toBeLessThanOrEqual(trace.readyAt);
  await expect(region.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await expect(region.locator('.mm-skeleton')).toHaveCount(0);
});

for (const feature of ['documents', 'tickets'] as const) test(`${feature}: frozen clock proves exact79/80/259/260 presentation with requests already started`, async ({ page }) => {
  const gate=deferred(),endpoint=feature==='documents'?'/files':'/tickets';
  const requests=await setup(page,{beforeRead:async url=>{if(url.pathname.endsWith(endpoint))await gate.promise;}});
  const time=new Date('2026-10-04T12:01:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+60_000));
  await traceInitialStages(page,feature);
  const response=page.waitForResponse(res=>new URL(res.url()).pathname===`/api/organizations/1${endpoint}`);
  await page.locator('.mm-sidebar-item').filter({hasText:feature==='documents'?'Arquivos e Documentos':'Central de Chamados'}).evaluate(node=>(node as HTMLElement).click());
  const region=feature==='documents'?docs(page):page.locator('.ticket-list-region');
  await expect(region).toBeVisible();await expect.poll(()=>requests.filter(url=>url.pathname.endsWith(endpoint)).length).toBeGreaterThan(0);
  await expect(region.locator('.mm-loading-table-row').first()).toBeVisible();await expect(region.locator('[data-loading-structure="pending"]').first()).toBeVisible();
  expect((await initialStageTrace(page)).requestDuringStructure).toBe(true);
  gate.release();await (await response).finished();
  await expect.poll(async()=>(await initialStageTrace(page)).responseAt).not.toBeNull();
  await page.clock.runFor(79);await expect(region.locator('[data-loading-structure="pending"]').first()).toBeVisible();await expect(region.locator('tbody tr:not(.mm-loading-table-row)')).toHaveCount(0);
  await page.clock.runFor(1);await expect(region.locator('[data-loading-structure="pending"]')).toHaveCount(0);await expect(region.locator('.mm-loading-table-row').first()).toBeVisible();
  await page.clock.runFor(179);await expect(region.locator('tbody tr:not(.mm-loading-table-row)')).toHaveCount(0);
  await page.clock.runFor(1);await expect(region.locator('tbody tr:not(.mm-loading-table-row)').first()).toBeVisible();await expect(region.locator('.mm-skeleton')).toHaveCount(0);
  const trace=await initialStageTrace(page);expect(trace.structureAt-trace.firstAt).toBe(80);expect(trace.readyAt-trace.firstAt).toBe(260);expect(trace.requestAt).toBe(trace.firstAt);expect(trace.responseAt).toBe(trace.firstAt);
});

for (const feature of ['documents', 'tickets'] as const) test(`${feature}: slow response after initial window reveals without a second hold`, async ({ page }) => {
  const gate=deferred(), endpoint=feature==='documents'?'/files':'/tickets';
  await setup(page,{beforeRead:async url=>{if(url.pathname.endsWith(endpoint))await gate.promise;}});
  await traceInitialStages(page,feature); await open(page,feature==='documents'?'Arquivos e Documentos':'Central de Chamados');
  const region=feature==='documents'?docs(page):page.locator('.ticket-list-region');
  await expect(region.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(region.locator('.mm-loading-table-row').first()).toBeVisible();
  if(feature==='documents')await expect(page.locator('.mm-docs-folder-card:not(.mm-loading-folder-card)').first()).toBeVisible();
  gate.release();await expect(region.locator('tbody tr:not(.mm-loading-table-row)').first()).toBeVisible();
  const trace=await initialStageTrace(page);
  expect(trace.readyAt-trace.firstAt).toBeGreaterThan(300);
  expect(trace.readyAt-trace.responseAt).toBeLessThan(180);
  await expect(region.locator('.mm-skeleton')).toHaveCount(0);
});

for (const feature of ['documents', 'tickets'] as const) test(`${feature}: reduced motion has no artificial initial hold`,async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await setup(page);await traceInitialStages(page,feature);
  await open(page,feature==='documents'?'Arquivos e Documentos':'Central de Chamados');
  const region=feature==='documents'?docs(page):page.locator('.ticket-list-region');await expect(region.locator('tbody tr:not(.mm-loading-table-row)').first()).toBeVisible();
  const trace=await initialStageTrace(page);expect(trace.initiallyMasked).toBe(false);expect(trace.readyAt-trace.responseAt).toBeLessThan(180);
  await expect(region.locator('[data-loading-structure="pending"]')).toHaveCount(0);await expect(region.locator('.mm-skeleton')).toHaveCount(0);
});

test('Central detail: fast held title retains dialog name and dependent subtree identity',async({page})=>{
  await setup(page);await open(page,'Central de Chamados');await expect(central(page)).toContainText('Chamado 001');
  await page.evaluate(()=>{
    const trace={heldName:null as string|null,hiddenReady:false,sameNode:false};Object.assign(window,{__heldDetail:trace});let held:Element|null=null;
    new MutationObserver(()=>{
      const drawer=document.querySelector('.ticket-detail-drawer');if(!drawer)return;
      const actual=drawer.querySelector('.ticket-detail-content:not(.mm-loading-ticket-detail)');if(!actual)return;
      if(actual.hasAttribute('hidden')){held=actual;trace.hiddenReady=true;trace.heldName=document.getElementById(drawer.getAttribute('aria-labelledby')||'')?.textContent?.trim()||null;}
      else if(held)trace.sameNode=actual===held;
    }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style']});
  });
  await page.getByRole('button',{name:'Chamado 001',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Chamado 001',exact:true})).toBeVisible();
  const trace=await page.evaluate(()=>(window as typeof window&{__heldDetail:{heldName:string|null;hiddenReady:boolean;sameNode:boolean}}).__heldDetail);
  expect(trace.hiddenReady).toBe(true);expect(trace.heldName).toBe('Carregando chamado...');expect(trace.sameNode).toBe(true);
});

test('Central: frozen-clock fast assignees preserve deep-link selection through80/260 and cached refresh',async({page})=>{
  let hold=false;const gate=deferred();await setup(page,{assignees:[{id:17,name:'Atendente sintético'}],beforeRead:async url=>{if(hold&&url.pathname.endsWith('/tickets'))await gate.promise;}});
  const time=new Date('2026-10-04T12:01:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+60_000));
  await page.evaluate(()=>{const url=new URL(window.location.href);url.searchParams.set('cc_org','1');url.searchParams.set('cc_assigneeId','17');window.history.replaceState(window.history.state,'',url);});
  const response=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/organizations/1/tickets');
  await page.locator('.mm-sidebar-item').filter({hasText:'Central de Chamados'}).evaluate(node=>(node as HTMLElement).click());await response;
  const select=page.getByRole('combobox',{name:'Atendente',exact:true}),title=page.locator('.ticket-center-heading h1 .mm-static-loading-text');
  await expect(select).toHaveValue('17');await expect(select.locator('option:checked')).toHaveText('Carregando atendente…');await expect(select).not.toContainText('Atendente sintético');await expect(title).toHaveAttribute('data-loading-structure','pending');
  await select.focus();await page.clock.runFor(79);await expect(title).toHaveAttribute('data-loading-structure','pending');await expect(select).toBeFocused();await expect(select).toHaveValue('17');
  await page.clock.runFor(1);await expect(title).not.toHaveAttribute('data-loading-structure','pending');await expect(select).not.toContainText('Atendente sintético');
  await page.clock.runFor(179);await expect(select.locator('option:checked')).toHaveText('Carregando atendente…');
  await page.clock.runFor(1);await expect(select.locator('option:checked')).toHaveText('Atendente sintético');await expect(select).toHaveValue('17');await expect(select).toBeFocused();
  hold=true;await page.getByRole('button',{name:'Mais opções dos chamados',exact:true}).evaluate(node=>(node as HTMLElement).click());await page.getByRole('menuitem',{name:'Atualizar consulta',exact:true}).evaluate(node=>(node as HTMLElement).click());
  await expect(select.locator('option:checked')).toHaveText('Atendente sintético');await expect(select).toHaveValue('17');await expect(central(page).locator('[data-loading-structure="pending"]')).toHaveCount(0);gate.release();
  await expect(central(page).locator('.ticket-list-scroll')).toHaveAttribute('aria-busy','false');await expect(select.locator('option:checked')).toHaveText('Atendente sintético');
});

test('Central: direct ticket deep-link is masked on first dialog commit without ready-then-remask',async({page})=>{
  await setup(page);const time=new Date('2026-10-04T12:01:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+60_000));
  await page.evaluate(()=>{
    const url=new URL(window.location.href);url.searchParams.set('cc_org','1');url.searchParams.set('cc_ticket','1');window.history.replaceState(window.history.state,'',url);
    const trace:{masks:boolean[];firstName:string|null}={masks:[],firstName:null};Object.assign(window,{__deepLinkDetailStages:trace});
    new MutationObserver(()=>{const drawer=document.querySelector('.ticket-detail-drawer');if(!drawer)return;const label=drawer.querySelector('.ticket-center-eyebrow .mm-static-loading-text');if(!label)return;const masked=label.getAttribute('data-loading-structure')==='pending';if(trace.firstName===null)trace.firstName=document.getElementById(drawer.getAttribute('aria-labelledby')||'')?.textContent?.trim()||'';if(trace.masks.at(-1)!==masked)trace.masks.push(masked);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-loading-structure']});
  });
  const response=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/organizations/1/tickets/1');
  await page.locator('.mm-sidebar-item').filter({hasText:'Central de Chamados'}).evaluate(node=>(node as HTMLElement).click());await response;
  const dialog=page.getByRole('dialog',{name:'Carregando chamado...',exact:true});await expect(dialog).toBeVisible();
  const states=()=>page.evaluate(()=>(window as typeof window&{__deepLinkDetailStages:{masks:boolean[];firstName:string|null}}).__deepLinkDetailStages);
  expect(await states()).toEqual({masks:[true],firstName:'Carregando chamado...'});
  await page.clock.runFor(79);expect((await states()).masks).toEqual([true]);
  await page.clock.runFor(1);expect((await states()).masks).toEqual([true,false]);
  await page.clock.runFor(180);await expect(page.getByRole('dialog',{name:'Chamado 001',exact:true})).toBeVisible();expect((await states()).masks).toEqual([true,false]);
});

for(const feature of ['documents','tickets'] as const)test(`${feature}: same-region uncached filters and out-of-order replies never replay80/260`,async({page})=>{
  const old=deferred(),endpoint=feature==='documents'?'/files':'/tickets',param=feature==='documents'?'search':'q';
  const requests=await setup(page,{beforeRead:async url=>{if(url.pathname.endsWith(endpoint)&&url.searchParams.get(param)==='001')await old.promise;}});
  await open(page,feature==='documents'?'Arquivos e Documentos':'Central de Chamados');const region=feature==='documents'?docs(page):central(page);await expect(region).toContainText(feature==='documents'?'Documento 001.pdf':'Chamado 001');
  const time=new Date('2026-10-04T12:01:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+60_000));
  const search=feature==='documents'?page.locator('.mm-docs-search input'):page.locator('.ticket-filter-search input');
  const query=async(value:string)=>{await search.fill(value);if(feature==='documents')await page.getByRole('button',{name:'Aplicar',exact:true}).evaluate(node=>(node as HTMLElement).click());else await page.clock.runFor(250);};
  await query('001');await expect.poll(()=>requests.filter(url=>url.pathname.endsWith(endpoint)&&url.searchParams.get(param)==='001').length).toBeGreaterThan(0);
  await expect(region.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await query('002');await expect(region).toContainText(feature==='documents'?'Documento 002.pdf':'Chamado 002');await expect(region.locator('.mm-skeleton')).toHaveCount(0);await expect(region.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  // No clock advancement after the fast response: a replayed260ms hold would fail.
  old.release();await expect(region).not.toContainText(feature==='documents'?'Documento 001.pdf':'Chamado 001');await expect(region.locator('.mm-skeleton')).toHaveCount(0);
});

test('Central Kanban: query-keyed remount inherits completed initial stage and releases queues independently',async({page})=>{
  const slow=deferred();await setup(page,{beforeRead:async url=>{if(url.searchParams.get('q')==='002'&&url.searchParams.get('queue')==='in_progress')await slow.promise;}});
  await open(page,'Central de Chamados');await expect(central(page)).toContainText('Chamado 001');await view(page,'Kanban');await expect(page.locator('.ticket-kanban .column-open')).toContainText('Chamado 001');await expect(page.locator('.ticket-kanban .mm-skeleton')).toHaveCount(0);
  const time=new Date('2026-10-04T12:01:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+60_000));
  await page.locator('.ticket-filter-search input').fill('002');await page.clock.runFor(250);
  const board=page.locator('.ticket-kanban');await expect(board.locator('.column-open')).toContainText('Chamado 002');await expect(board.locator('[data-loading-structure="pending"]')).toHaveCount(0);await expect(board.locator('.column-open .mm-skeleton')).toHaveCount(0);await expect(board.locator('.column-in_progress .mm-loading-ticket-card').first()).toBeVisible();
  slow.release();await expect(board.locator('.mm-skeleton')).toHaveCount(0);
});

for(const failedQueue of ['open','in_review'] as const)test(`Central Kanban: ${failedQueue}503 then fast retry cancels decorative hold permanently before260`,async({page})=>{
  let fail=true;await setup(page,{failRead:url=>fail&&url.searchParams.get('queue')===failedQueue});
  const time=new Date('2026-10-04T12:01:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+60_000));
  await page.evaluate(()=>{const url=new URL(window.location.href);url.searchParams.set('cc_org','1');url.searchParams.set('cc_view','kanban');window.history.replaceState(window.history.state,'',url);});
  await page.locator('.mm-sidebar-item').filter({hasText:'Central de Chamados'}).evaluate(node=>(node as HTMLElement).click());
  await expect(page.getByRole('alert').first()).toBeVisible();const board=page.locator('.ticket-kanban'),queue=board.locator(`.column-${failedQueue}`);
  await expect(queue.locator('[data-loading-structure="pending"]')).toHaveCount(0);await expect(queue.locator('.mm-skeleton')).toHaveCount(0);
  fail=false;await page.getByRole('button',{name:'Tentar novamente',exact:true}).first().evaluate(node=>(node as HTMLElement).click());
  // Clock is still at the first pending instant: retry must not reuse the260mshold.
  await expect(queue.locator('.ticket-kanban-card:not(.mm-loading-ticket-card)').first()).toBeVisible();await expect(queue.locator('.mm-skeleton')).toHaveCount(0);await expect(queue.locator('[data-loading-structure="pending"]')).toHaveCount(0);
  await expect(page.locator('.ticket-center-heading h1 .mm-static-loading-text')).toHaveAttribute('data-loading-structure','pending');
  if(failedQueue==='open'){
    await expect(board.locator('.mm-skeleton')).toHaveCount(0);
    await board.evaluate(node=>{(node as HTMLElement).dataset.originalBoard='yes';});
    const replacement=page.waitForResponse(res=>{const url=new URL(res.url());return url.searchParams.get('queue')==='open'&&url.searchParams.get('status')==='open';});
    await page.locator('.ticket-metrics > button').first().evaluate(node=>(node as HTMLElement).click());await page.clock.runFor(1);await replacement;
    await expect(board).not.toHaveAttribute('data-original-board','yes');await expect(board.locator('.column-open')).toContainText('Chamado 001');await expect(board.locator('[data-loading-structure="pending"]')).toHaveCount(0);await expect(board.locator('.mm-skeleton')).toHaveCount(0);
  }
});
