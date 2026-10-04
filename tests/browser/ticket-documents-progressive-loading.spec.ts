import { expect, test, type Page } from "@playwright/test";

// Real compiled React routes; controlled synthetic HTTP only. These tests do not
// claim integrated production/API/storage acceptance or authorize any writes.
const organizations = [{ id: 1, name: "Organização sintética", slug: "synthetic", active: true }, { id: 2, name: "Outra organização", slug: "other", active: true }];
const attachmentLimits = { maxFiles: 5, maxFileBytes: 83886080, maxTicketBytes: 157286400, chunkBytes: 8388608 };
const tickets = Array.from({ length: 63 }, (_, index) => ({ id: index + 1, organizationId: 1, code: `CH-${String(index + 1).padStart(4, "0")}`, subject: `Chamado ${String(index + 1).padStart(3, "0")}`, description: "Descrição sintética.", status: index < 32 ? "open" : ["in_progress", "in_review", "closed"][index % 3], priority: "normal", category: "map", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-02T12:00:00Z", dueAt: index % 4 ? "2026-10-15T12:00:00Z" : null, createdBy: { id: 1, name: "Pessoa sintética" }, assignedTo: null, attachmentsCount: 0, version: 1, etag: `"ticket-${index + 1}-v1"`, visibility: "organization" }));
const files = Array.from({ length: 62 }, (_, index) => ({ id: index + 1, name: `Documento ${String(index + 1).padStart(3, "0")}.pdf`, fileType: "pdf", size: 1024, updatedAt: "2026-10-01T12:00:00Z", folderId: null }));
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
type Fixture = { allowStatusMove?: boolean; expireRetainedPin?: boolean; beforeRead?: (url: URL) => Promise<void>; failRead?: (url: URL) => boolean | number };
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
      } else if (match[3]) response = { ok: true, ticket: { ...tickets[Number(match[3]) - 1], organizationId: id }, attachments: [], events: [], assignees: [], attachmentLimits, lifecycleEnabled: false, triageEnabled: false, conversation: { enabled: false, schemaReady: true, permissions: { comment: false, noteView: false, noteCreate: false }, messages: [], drafts: [], hasMore: false } };
      else {
        const query = (params.get("q") || "").toLowerCase(), queue = params.get("queue"), pageNumber = Number(params.get("page") || 1), limit = Number(params.get("limit") || 50);
        const all = ticketState.filter(ticket => (!retainedPinExpired || ticket.id !== 1) && ticket.subject.toLowerCase().includes(query) && (!queue || ticket.status === queue) && (!params.get("status") || ticket.status === params.get("status"))).map(ticket => ({ ...ticket, organizationId: id, subject: id === 1 ? ticket.subject : `Outro ${ticket.subject}` }));
        response = { ok: true, tickets: all.slice((pageNumber - 1) * limit, pageNumber * limit), facets: { byStatus: Object.fromEntries(["new", "open", "in_progress", "in_review", "closed"].map(status => [status, all.filter(ticket => ticket.status === status).length])), overdue: 0 }, pagination: { total: all.length, page: pageNumber, limit, totalPages: Math.max(1, Math.ceil(all.length / limit)), hasMore: pageNumber * limit < all.length, snapshot: `snapshot-${id}-${query}`, snapshotAt: "2026-10-04T12:00:00Z" }, range: { from: params.get("from"), to: params.get("to") }, assignees: [], attachmentLimits, flowEnabled: false, lifecycleEnabled: false, triageEnabled: false };
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
  if (mode === "grid") await page.getByRole("button", { name: "Visualização em grade" }).click();
  const results = docs(page); await expect(results.locator(".mm-skeleton").first()).toBeVisible();
  await expect(page.locator(".mm-docs-folder-card").first()).not.toContainText("0 documentos");
  await expect(results).not.toContainText("Exibindo 0/0"); await expect(results.getByText("Itens por página")).toBeVisible();
  await expect(results.locator(mode === "list" ? ".mm-loading-table-row" : ".mm-loading-document-card").first()).toBeVisible();
  expect(await results.getByRole('status').evaluateAll(nodes => nodes.length === 1 && nodes.every(node => !node.closest('[aria-busy="true"]')))).toBe(true);
  const heading = await results.getByRole("heading").boundingBox();
  await page.screenshot({ path: info.outputPath(`documents-${mode}-${width}-initial.png`), fullPage: true });
  gate.release(); await expect(results.locator(".mm-skeleton")).toHaveCount(0); await expect(results).toContainText("Documento 001.pdf");
  expect((await results.getByRole("heading").boundingBox())?.y).toBe(heading?.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
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
