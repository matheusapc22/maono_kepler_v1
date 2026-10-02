import { expect, test, type Page } from "@playwright/test";

const organization = { id: 1, name: "Organização de demonstração", slug: "demo", active: true };
const folders = [
  { id: 1, name: "Mês de Setembro", parentId: null },
  { id: 2, name: "QA_VISUAL", parentId: null },
  { id: 3, name: "Relatórios", parentId: 1 },
  { id: 4, name: "2026", parentId: 3 },
];
const files = [
  { id: 10, name: "config_kepler.json", fileType: "json", size: 34288435, updatedAt: "2026-09-24T22:18:00Z", projectName: "Projeto de demonstração", folderId: null },
  { id: 11, name: "Relatório de mercado e oportunidades.pdf", fileType: "pdf", size: 536166, updatedAt: "2026-07-17T15:59:00Z", folderId: 1 },
];
async function setup(page: Page, options: { more?: boolean; empty?: boolean; role?: string; permissions?: string[]; failMove?: boolean; beforeRename?: () => Promise<void>; beforeList?: (url: URL) => Promise<void> } = {}) {
  const requests: { method: string; url: string; body: string | null }[] = [];
  const folderState = folders.map(folder => ({ ...folder }));
  const fileState = files.map(file => ({ ...file }));
  const deletedIds = new Set<number>();
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), url: request.url(), body: request.postData() });
    if (url.pathname === "/api/session") {
      return route.fulfill({ json: { authenticated: true, user: { id: 1, name: "Operador de demonstração", email: "qa@example.test", role: options.role ?? "super_admin", permissions: options.permissions ?? [], activeOrganizationId: 1 }, projects: [], organizations: [organization], activeOrganization: organization } });
    }
    if (request.method() === "PATCH" && /^\/api\/organizations\/1\/document-folders\/\d+$/.test(url.pathname)) {
      const folderId = Number(url.pathname.split("/").at(-1));
      const patch = JSON.parse(request.postData() || "{}");
      const folder = folderState.find(item => item.id === folderId);
      if (!folder) return route.fulfill({ status: 404, json: { ok: false } });
      if (Object.prototype.hasOwnProperty.call(patch, "parentId")) folder.parentId = patch.parentId == null ? null : Number(patch.parentId);
      if (Object.prototype.hasOwnProperty.call(patch, "name")) folder.name = String(patch.name);
      return route.fulfill({ json: { ok: true, folder } });
    }
    if (request.method() === "PATCH" && /^\/api\/organizations\/1\/files\/\d+$/.test(url.pathname)) {
      const file = fileState.find(item => item.id === Number(url.pathname.split("/").at(-1)));
      const patch = JSON.parse(request.postData() || "{}");
      if (!file) return route.fulfill({ status: 404, json: { ok: false } });
      if (Object.prototype.hasOwnProperty.call(patch, "folderId")) {
        if (options.failMove) return route.fulfill({ status: 403, json: { ok: false, error: { code: "AUTH_PERMISSION_DENIED", category: "AUTH", retryable: false } } });
        file.folderId = patch.folderId == null ? null : Number(patch.folderId);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "name")) {
        await options.beforeRename?.();
        file.name = patch.name;
      }
      return route.fulfill({ json: { ok: true, file } });
    }
    if (request.method() === "DELETE" && /^\/api\/organizations\/1\/files\/\d+$/.test(url.pathname)) {
      deletedIds.add(Number(url.pathname.split("/").at(-1)));
      return route.fulfill({ json: { ok: true, deleted: true, trashed: true } });
    }
    if (request.method() === "GET" && /\/files\/10\/download$/.test(url.pathname)) {
      return route.fulfill({ contentType: "application/json", headers: { "Content-Disposition": 'attachment; filename="config_kepler.json"' }, body: "{}" });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 403, json: { ok: false, error: { code: "AUTH_PERMISSION_DENIED", category: "AUTH", retryable: false } } });
    if (url.pathname.endsWith("/document-folders")) return route.fulfill({ json: { ok: true, folders: folderState } });
    if (url.pathname === "/api/organizations/1/files") {
      await options.beforeList?.(url);
      const trash = url.searchParams.get("state") === "trash";
      const cursor = url.searchParams.get("cursor");
      const folderId = url.searchParams.get("folderId");
      const firstBatch = options.more
        ? Array.from({ length: 10 }, (_, index) => ({ ...files[index % files.length], id: 100 + index, name: index % 2 === 0 ? `config_${index + 1}.json` : `relatorio_${index + 1}.pdf` }))
        : fileState.filter(file => !deletedIds.has(file.id));
      let resultFiles = options.empty ? [] : firstBatch;
      if (!options.empty && folderId) resultFiles = resultFiles.filter(file => folderId === "root" ? file.folderId == null : String(file.folderId) === folderId);
      if (!options.empty && trash) resultFiles = [{ ...files[0], deletedAt: "2026-09-29T12:00:00Z", purgeAfter: "2999-01-01T00:00:00Z", deletedBy: { id: 1, name: "Operador de demonstração" }, trashedFromFolderId: 1, trashedFromFolderName: "Mês de Setembro" }];
      if (!options.empty && cursor) resultFiles = [{ ...files[1], id: 12, name: "Terceiro documento.pdf" }];
      return route.fulfill({ json: { ok: true, files: resultFiles, facets: { types: ["json", "pdf"], projects: [{ id: 1, name: "Projeto de demonstração" }], rootCount: 1, folderCounts: [{ folderId: 1, count: 1 }, { folderId: 2, count: 0 }, { folderId: 3, count: 0 }, { folderId: 4, count: 0 }] }, pagination: { limit: 50, total: options.empty ? 0 : trash ? 1 : options.more && !folderId ? 11 : resultFiles.length, hasMore: Boolean(options.more && !cursor && !folderId && !trash), nextCursor: options.more && !cursor && !folderId && !trash ? "fixture-next" : null, sort: "updated_desc" }, capabilities: { permanentPurgeEnabled: false } } });
    }
    return route.fulfill({ json: { ok: true, projects: [], tickets: [], users: [], items: [], organizations: [organization], pagination: { total: 0, hasMore: false, nextCursor: null } } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  return requests;
}
async function openDocuments(page: Page, allFiles = false) {
  await page.locator(".mm-sidebar-item").filter({ hasText: "Arquivos e Documentos" }).click();
  await expect(page.locator("#mm-docs-title")).toBeVisible();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(2);
  if (allFiles) await showAllDocuments(page);
}

async function showAllDocuments(page: Page) {
  await page.locator(".mm-docs-folder select").selectOption("");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remover filtro Pasta: Todos os documentos", exact: true })).toBeVisible();
}

async function openRoot(page: Page) {
  await page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Raiz", exact: true }).click();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(2);
}

test("workspace real: referência estrutural, ações contextuais e ícones por tipo", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests = await setup(page);
  await openDocuments(page);
  await expect(page.getByRole("button", { name: "Documentos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lixeira", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Visualização em lista" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".mm-docs-file-icon.is-code")).toHaveCount(1);
  await expect(page.locator(".mm-docs-file-icon.is-pdf")).toHaveCount(0);
  await expect(page.locator(".mm-docs-row-actions button")).toHaveCount(1);
  await expect(page.locator(".mm-docs-row-actions select")).toHaveCount(0);
  await expect(page.locator(".mm-docs-row-actions .mm-docs-menu-trigger")).toHaveCount(1);
  await expect(page.locator(".mm-docs-move-control")).toHaveCount(0);
  const top = await page.locator(".mm-docs-search").boundingBox();
  const lower = await page.locator(".mm-docs-sort").boundingBox();
  expect(lower!.y).toBeGreaterThan(top!.y + top!.height);
  await page.screenshot({ path: testInfo.outputPath("documents-desktop.png"), fullPage: true, animations: "disabled" });
  expect(requests.filter(request => request.method !== "GET")).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
  test(`reflow ${width}px: formulário sem corte e tabela com rolagem própria`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page); await openDocuments(page, true);
    const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
    for (const field of await page.locator(".mm-docs-filters input, .mm-docs-filters select").all()) {
      const box = await field.boundingBox();
      expect(box!.width).toBeGreaterThan(50);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    await expect(page.locator(".mm-docs-table-scroll")).toHaveCSS("overflow-x", "auto");
    await page.locator(".mm-docs").screenshot({ path: testInfo.outputPath(`documents-${width}.png`), animations: "disabled" });
  });
}

test("filtros preservam rascunho/aplicar e parâmetros server-side", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true);
  const count = () => requests.filter(request => new URL(request.url).pathname === "/api/organizations/1/files").length;
  const initial = count();
  await page.locator(".mm-docs-search input").fill("  relatório  ");
  await page.locator(".mm-docs-type select").selectOption("pdf");
  expect(count()).toBe(initial);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect.poll(count).toBeGreaterThan(initial);
  const last = [...requests].reverse().find(request => new URL(request.url).pathname === "/api/organizations/1/files")!;
  expect(new URL(last.url).searchParams.get("search")).toBe("relatório");
  expect(new URL(last.url).searchParams.get("type")).toBe("pdf");
  await expect(page.getByRole("button", { name: "Remover filtro Tipo: PDF" })).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.locator(".mm-docs-search input")).toHaveValue("");
});

test("navegação real mostra apenas subpastas do nível atual e consulta os arquivos da pasta", async ({ page }, testInfo) => {
  const requests = await setup(page); await openDocuments(page, true); await openRoot(page);
  await page.screenshot({ path: testInfo.outputPath("documents-root.png"), fullPage: true });
  await expect(page.locator(".mm-docs-folder-card").filter({ hasText: "Relatórios" })).toHaveCount(0);
  await page.locator(".mm-docs-folder-card").filter({ hasText: "Mês de Setembro" }).locator(".mm-docs-folder-select").click();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(1);
  await expect(page.locator(".mm-docs-folder-card")).toContainText("Relatórios");
  await expect(page.locator(".mm-docs-folder-card").filter({ hasText: "QA_VISUAL" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Caminho da pasta" })).toContainText("Mês de Setembro");
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
  await page.locator(".mm-docs-folder-card").filter({ hasText: "Relatórios" }).locator(".mm-docs-folder-select").click();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(1);
  await expect(page.locator(".mm-docs-folder-card")).toContainText("2026");
  await expect.poll(() => requests.some(request => new URL(request.url).searchParams.get("folderId") === "3")).toBe(true);
  const breadcrumb = page.getByRole("navigation", { name: "Caminho da pasta" });
  await expect(breadcrumb.getByRole("button")).toHaveText(["Raiz", "Mês de Setembro", "Relatórios"]);
  await page.screenshot({ path: testInfo.outputPath("documents-nested-folder.png"), fullPage: true });
  await breadcrumb.getByRole("button", { name: "Mês de Setembro", exact: true }).click();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(1);
  await expect(page.locator(".mm-docs-folder-card")).toContainText("Relatórios");
  await breadcrumb.getByRole("button", { name: "Raiz", exact: true }).click();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(2);
});

test("entrada abre Raiz com filhos diretos e arquivos próprios, sem cards virtuais", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page);
  const breadcrumb = page.getByRole("navigation", { name: "Caminho da pasta" });
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb.getByRole("button")).toHaveText(["Raiz"]);
  await expect(breadcrumb.getByRole("button", { name: "Raiz", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".mm-docs-folder-card strong")).toHaveText(["Mês de Setembro", "QA_VISUAL"]);
  await expect(page.locator(".mm-docs-folder-card").filter({ hasText: /Todos os documentos|^Raiz$/ })).toHaveCount(0);
  await expect(page.locator(".mm-docs-folder select")).toHaveValue("root");
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".documents-file-name")).toHaveText("config_kepler.json");
  await expect(page.locator(".documents-file-origin")).toHaveCount(0);
  const fileQueries = requests.filter(request => new URL(request.url).pathname === "/api/organizations/1/files");
  expect(new URL(fileQueries.at(-1)!.url).searchParams.get("folderId")).toBe("root");
});

test("Todos os documentos é filtro da lista e mostra origem sem mudar a pasta navegada", async ({ page }, testInfo) => {
  const requests = await setup(page); await openDocuments(page);
  const breadcrumb = page.getByRole("navigation", { name: "Caminho da pasta" });
  await page.locator(".mm-docs-folder-card").filter({ hasText: "Mês de Setembro" }).locator(".mm-docs-folder-select").click();
  await expect(page.locator(".documents-file-name")).toHaveText("Relatório de mercado e oportunidades.pdf");
  for (let repeat = 0; repeat < 2; repeat += 1) {
    await showAllDocuments(page);
    await expect(breadcrumb.getByRole("button")).toHaveText(["Raiz", "Mês de Setembro"]);
    await expect(page.locator(".mm-docs-folder-card strong")).toHaveText(["Relatórios"]);
    await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(2);
    await expect(page.locator(".documents-file-origin")).toHaveText(["Pasta: Raiz", "Pasta: Raiz / Mês de Setembro"]);
    const query = [...requests].reverse().find(request => new URL(request.url).pathname === "/api/organizations/1/files")!;
    expect(new URL(query.url).searchParams.has("folderId")).toBe(false);
    if (repeat === 0) {
      await page.locator(".mm-docs-folder select").selectOption("1");
      await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
    }
  }
  await page.getByRole("button", { name: "Visualização em grade" }).click();
  await expect(page.locator(".mm-docs-file-card .documents-file-origin")).toHaveText(["Pasta: Raiz", "Pasta: Raiz / Mês de Setembro"]);
  await page.screenshot({ path: testInfo.outputPath("documents-all-files-origins.png"), fullPage: true });
  await page.getByRole("button", { name: "Remover filtro Pasta: Todos os documentos", exact: true }).click();
  await expect(breadcrumb.getByRole("button")).toHaveText(["Raiz"]);
  await expect(page.locator(".mm-docs-folder-card strong")).toHaveText(["Mês de Setembro", "QA_VISUAL"]);
  await expect(page.locator(".mm-docs-folder select")).toHaveValue("root");
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
});

test("mover pasta usa PATCH parentId e a pasta só reaparece dentro do novo pai", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true); await openRoot(page);
  const september = page.locator(".mm-docs-folder-card").filter({ hasText: "Mês de Setembro" });
  await september.getByRole("button", { name: /Ações da pasta/ }).click();
  await page.getByRole("menuitem", { name: "Mover pasta", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Mover pasta" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Nova pasta pai" }).selectOption("2");
  await dialog.getByRole("button", { name: "Mover pasta", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".mm-docs-folder-card").filter({ hasText: "Mês de Setembro" })).toHaveCount(0);
  const moveRequest = [...requests].reverse().find(request =>
    request.method === "PATCH" &&
    /\/document-folders\/1$/.test(new URL(request.url).pathname)
  );
  expect(moveRequest).toBeTruthy();
  expect(JSON.parse(moveRequest!.body || "{}")).toEqual({ parentId: "2" });

  await page.locator(".mm-docs-folder-card").filter({ hasText: "QA_VISUAL" }).locator(".mm-docs-folder-select").click();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(1);
  await expect(page.locator(".mm-docs-folder-card")).toContainText("Mês de Setembro");
  await expect(page.locator(".mm-docs-folder-card").filter({ hasText: "Relatórios" })).toHaveCount(0);
});

test("modo lista/grade alterna conteúdo sem trocar a consulta", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true);
  const before = requests.filter(request => new URL(request.url).pathname === "/api/organizations/1/files").length;
  await page.getByRole("button", { name: "Visualização em grade" }).click();
  await expect(page.locator(".mm-docs-file-grid")).toBeVisible();
  await expect(page.locator(".mm-docs-table-scroll")).toHaveCount(0);
  await page.getByRole("button", { name: "Visualização em lista" }).click();
  await expect(page.locator(".mm-docs-table-scroll")).toBeVisible();
  expect(requests.filter(request => new URL(request.url).pathname === "/api/organizations/1/files").length).toBe(before);
});

test("menu secundário: teclado, Escape, Tab, clique externo; excluir exige confirmação", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true);
  const trigger = page.getByRole("button", { name: "Ações de config_kepler.json", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Renomear", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click(); await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click(); await page.locator("#mm-docs-title").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  let confirmation = "";
  page.once("dialog", async dialog => { confirmation = dialog.message(); await dialog.dismiss(); });
  await trigger.click(); await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
  expect(confirmation).toContain("Lixeira");
  expect(requests.filter(request => request.method !== "GET")).toEqual([]);
});

test("menu ignora scroll atrasado da abertura e fecha quando a âncora realmente se move", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setup(page); await openDocuments(page, true);
  const trigger = page.getByRole("button", { name: "Ações de config_kepler.json", exact: true });
  const item = page.getByRole("menuitem", { name: "Renomear", exact: true });

  // Focusing an offscreen row can queue a document/table scroll before Enter.
  // Deliver that event after opening without changing the anchor's geometry.
  for (const key of ["Enter", "Space", "ArrowDown"]) {
    await trigger.focus(); await page.keyboard.press(key);
    await expect(item).toBeFocused();
    await page.locator(".mm-docs-table-scroll").dispatchEvent("scroll");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect(item).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }

  await trigger.click();
  await expect(item).toBeFocused();
  const top = (await trigger.boundingBox())!.y;
  await page.evaluate(() => window.scrollBy(0, window.scrollY > 0 ? -32 : 32));
  await expect.poll(async () => (await trigger.boundingBox())!.y).not.toBe(top);
  await expect(page.getByRole("menu")).toHaveCount(0);

  await trigger.click(); await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".mm-docs-table-scroll")).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Ações de Relatório de mercado e oportunidades.pdf", exact: true })).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("menu de pasta preserva a seleção por teclado depois do frame de abertura", async ({ page }) => {
  await setup(page); await openDocuments(page, true); await openRoot(page);
  const trigger = page.getByRole("button", { name: "Ações da pasta Mês de Setembro", exact: true });
  await trigger.focus();
  await trigger.evaluate(async element => {
    // Let React commit, then navigate before the opening animation frame.
    element.click();
    await Promise.resolve();
    if (document.activeElement?.getAttribute("role") !== "menuitem") {
      throw new Error("Opening must focus a menu item before keyboard navigation");
    }
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole("menuitem", { name: "Excluir pasta vazia", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitem", { name: "Mover pasta", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Renomear pasta", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("botões contextuais alternam Documentos/Lixeira sem repetir a visão atual", async ({ page }) => {
  await setup(page); await openDocuments(page, true);
  await page.getByRole("button", { name: "Lixeira", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lixeira", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Documentos", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar documento", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Documentos na Lixeira" })).toBeVisible();
  await page.getByRole("button", { name: "Documentos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Documentos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lixeira", exact: true })).toBeVisible();
});

test("Lixeira preserva metadados de retenção; purge desligado não aparece", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true);
  await page.getByRole("button", { name: "Lixeira", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Pasta anterior" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Excluído por" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Exclusão definitiva em" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restaurar", exact: true })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: "Excluir permanentemente" })).toHaveCount(0);
  await expect(page.locator(".mm-docs-folder-grid")).toHaveCount(0);
  const query = [...requests].reverse().find(request => new URL(request.url).pathname === "/api/organizations/1/files")!;
  expect(new URL(query.url).searchParams.get("state")).toBe("trash");
  expect(new URL(query.url).searchParams.has("folderId")).toBe(false);
});

test("paginação da referência usa itens por página, página atual e cursor existente", async ({ page }) => {
  await setup(page, { more: true }); await openDocuments(page, true);
  await expect(page.getByText("Itens por página")).toBeVisible();
  await expect(page.locator(".mm-docs-page-number")).toHaveText("1");
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page.locator(".mm-docs-page-number")).toHaveText("2");
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Página anterior" }).click();
  await expect(page.locator(".mm-docs-page-number")).toHaveText("1");
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(10);
});

test("sidebar recolhida/aberta e navegação SPA mantêm tema próprio", async ({ page }) => {
  await setup(page); await openDocuments(page, true);
  const toggle = page.locator(".mm-sidebar-toggle");
  await toggle.click(); await expect(page.locator(".mm-projects-sidebar")).toHaveClass(/collapsed/);
  await toggle.click(); await expect(page.locator(".mm-projects-sidebar")).not.toHaveClass(/collapsed/);
  await page.locator(".mm-sidebar-item").filter({ hasText: "Todos os Projetos" }).click();
  await expect(page.locator(".mm-docs")).toHaveCount(0);
  await openDocuments(page, true);
});

test("viewer sem grants não recebe a subaba documental", async ({ page }) => {
  await setup(page, { role: "viewer" });
  await expect(page.locator(".mm-sidebar-item").filter({ hasText: "Arquivos e Documentos" })).toHaveCount(0);
  await expect(page.locator(".mm-docs")).toHaveCount(0);
});

test("vazio e preferências de acessibilidade mantêm controles operáveis", async ({ page }) => {
  await setup(page, { empty: true }); await openDocuments(page);
  await expect(page.getByText("Nenhum documento.", { exact: true })).toBeVisible();
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.locator(".mm-docs-search input").focus();
  await expect(page.locator(".mm-docs-search input")).toBeFocused();
  await expect(page.getByRole("button", { name: "Enviar documento", exact: true })).toBeEnabled();
});


test("menu único oferece renomear, baixar, mover e excluir na ordem solicitada", async ({ page }, testInfo) => {
  await setup(page); await openDocuments(page, true);
  const row = page.locator(".mm-docs-table tbody tr").first();
  await expect(row.locator("td").last().getByRole("button")).toHaveCount(1);
  await row.getByRole("button", { name: "Ações de config_kepler.json" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Renomear", "Baixar", "Mover", "Excluir"]);
  await page.screenshot({ path: testInfo.outputPath("documents-file-menu.png"), fullPage: false });
  await page.keyboard.press("End"); await expect(page.getByRole("menuitem", { name: "Excluir", exact: true })).toBeFocused();
  await page.keyboard.press("Home"); await expect(page.getByRole("menuitem", { name: "Renomear", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(page.getByRole("menuitem", { name: "Baixar", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Visualização em grade" }).click();
  await expect(page.locator(".mm-docs-file-card .mm-docs-row-actions button")).toHaveCount(2);
  await expect(page.locator(".mm-docs-file-card .mm-docs-row-actions select")).toHaveCount(0);
});

test("renomear usa PATCH name e atualiza a lista; cancelar não envia mutação", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true);
  const trigger = page.getByRole("button", { name: "Ações de config_kepler.json", exact: true });
  page.once("dialog", dialog => dialog.dismiss());
  await trigger.click(); await page.getByRole("menuitem", { name: "Renomear", exact: true }).click();
  expect(requests.filter(request => request.method === "PATCH")).toEqual([]);
  await expect(trigger).toBeFocused();
  page.once("dialog", dialog => dialog.accept("Configuração revisada.json"));
  await trigger.click(); await page.getByRole("menuitem", { name: "Renomear", exact: true }).click();
  await expect(page.locator(".documents-file-name").filter({ hasText: "Configuração revisada.json" })).toBeVisible();
  expect(requests.filter(request => request.method === "PATCH").map(request => JSON.parse(request.body!))).toEqual([{ name: "Configuração revisada.json" }]);
});

test("mover arquivo abre diálogo, conserva foco, cancela e usa PATCH folderId", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true);
  await page.evaluate(() => {
    const nativeClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = function (...args) {
      (window as Window & { documentDialogClosedWhileConnected?: boolean }).documentDialogClosedWhileConnected = this.isConnected;
      return nativeClose.apply(this, args);
    };
  });
  const trigger = page.getByRole("button", { name: "Ações de config_kepler.json", exact: true });
  const dialog = page.getByRole("dialog", { name: "Mover documento" });
  await trigger.click(); await page.getByRole("menuitem", { name: "Mover", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Pasta de destino" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Mover documento", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { documentDialogClosedWhileConnected?: boolean }).documentDialogClosedWhileConnected)).toBe(true);
  await expect(trigger).toBeFocused();
  await trigger.click(); await page.getByRole("menuitem", { name: "Mover", exact: true }).click();
  await dialog.getByRole("combobox").selectOption("3");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(requests.filter(request => request.method === "PATCH")).toEqual([]);
  await trigger.click(); await page.getByRole("menuitem", { name: "Mover", exact: true }).click();
  await dialog.getByRole("combobox").selectOption("3");
  await dialog.getByRole("button", { name: "Mover documento", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests.filter(request => request.method === "PATCH").map(request => JSON.parse(request.body!))).toEqual([{ folderId: "3" }]);
  await page.locator(".mm-docs-folder select").selectOption("3");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".documents-file-name")).toHaveText("config_kepler.json");
  await showAllDocuments(page);
  await expect(page.locator(".mm-docs-table tbody tr").filter({ hasText: "config_kepler.json" }).locator(".documents-file-origin")).toHaveText("Pasta: Raiz / Mês de Setembro / Relatórios");
});

test("mover negado permanece no diálogo com erro e permite cancelar", async ({ page }) => {
  await setup(page, { failMove: true }); await openDocuments(page, true);
  await page.getByRole("button", { name: "Ações de config_kepler.json" }).click();
  await page.getByRole("menuitem", { name: "Mover", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mover documento" });
  await dialog.getByRole("combobox").selectOption("1");
  await dialog.getByRole("button", { name: "Mover documento", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(2);
});

test("baixar usa endpoint existente e excluir envia documento para Lixeira", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page, true);
  const trigger = page.getByRole("button", { name: "Ações de config_kepler.json" });
  await trigger.click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Baixar", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("config_kepler.json");
  await expect(trigger).toBeEnabled();
  page.once("dialog", dialog => dialog.accept());
  await trigger.click(); await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
  await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
  expect(requests.filter(request => request.method === "DELETE").map(request => new URL(request.url).pathname)).toEqual(["/api/organizations/1/files/10"]);
  expect(requests.some(request => new URL(request.url).pathname.endsWith("/purge"))).toBe(false);
});

test("menu respeita grants: somente download sem gestão ou exclusão", async ({ page }) => {
  const requests = await setup(page, { role: "viewer", permissions: ["document.view", "document.download"] }); await openDocuments(page, true);
  await page.getByRole("button", { name: "Ações de config_kepler.json" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Baixar"]);
  await expect(page.getByRole("button", { name: "Nova pasta", exact: true })).toHaveCount(0);
  expect(requests.filter(request => request.method !== "GET")).toEqual([]);
});


for (const destination of ["root", "trash"] as const) {
  test(`rename atrasado respeita navegação posterior para ${destination}`, async ({ page }) => {
    let finishRename!: () => void;
    const renameGate = new Promise<void>(resolve => { finishRename = resolve; });
    const requests = await setup(page, { beforeRename: () => renameGate }); await openDocuments(page, true);
    page.once("dialog", dialog => dialog.accept("Atualizado.json"));
    await page.getByRole("button", { name: "Ações de config_kepler.json" }).click();
    await page.getByRole("menuitem", { name: "Renomear", exact: true }).click();
    await expect.poll(() => requests.some(request => request.method === "PATCH")).toBe(true);
    if (destination === "root") {
      await openRoot(page);
    } else {
      await page.getByRole("button", { name: "Lixeira", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Documentos na Lixeira" })).toBeVisible();
    }
    const fileQueries = () => requests.filter(request => new URL(request.url).pathname === "/api/organizations/1/files");
    const beforeFinish = fileQueries().length;
    finishRename();
    await expect.poll(() => fileQueries().length).toBeGreaterThan(beforeFinish);
    const latest = new URL(fileQueries().at(-1)!.url);
    expect(latest.searchParams.get("state")).toBe(destination === "trash" ? "trash" : "active");
    expect(latest.searchParams.get("folderId")).toBe(destination === "root" ? "root" : null);
    await expect(page.locator(".mm-docs-table tbody tr")).toHaveCount(1);
    if (destination === "root") {
      await expect(page.locator(".documents-file-name")).toHaveText("Atualizado.json");
      await expect(page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button")).toHaveText(["Raiz"]);
    } else {
      await expect(page.getByRole("button", { name: "Restaurar", exact: true })).toBeVisible();
    }
  });
}


test("refresh de rename vence consulta anterior sem deixar pasta vazia carregando", async ({ page }) => {
  let finishRename!: () => void;
  let finishInitialFolder!: () => void;
  const renameGate = new Promise<void>(resolve => { finishRename = resolve; });
  const folderGate = new Promise<void>(resolve => { finishInitialFolder = resolve; });
  let folderReads = 0;
  const requests = await setup(page, {
    beforeRename: () => renameGate,
    beforeList: async url => { if (url.searchParams.get("folderId") === "3" && ++folderReads === 1) await folderGate; },
  });
  await openDocuments(page, true);
  page.once("dialog", dialog => dialog.accept("Atualizado.json"));
  await page.getByRole("button", { name: "Ações de config_kepler.json" }).click();
  await page.getByRole("menuitem", { name: "Renomear", exact: true }).click();
  await expect.poll(() => requests.some(request => request.method === "PATCH")).toBe(true);
  await page.locator(".mm-docs-folder select").selectOption("3");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect.poll(() => folderReads).toBe(1);
  finishRename();
  await expect.poll(() => folderReads).toBe(2);
  await expect(page.getByText("Nenhum documento encontrado com os filtros atuais.", { exact: true })).toBeVisible();
  finishInitialFolder();
  await expect(page.locator(".mm-docs-table-skeleton")).toHaveCount(0);
});

test("mover para fora da pasta atual devolve foco ao breadcrumb persistente", async ({ page }) => {
  await setup(page); await openDocuments(page, true); await openRoot(page);
  await page.getByRole("button", { name: "Ações de config_kepler.json" }).click();
  await page.getByRole("menuitem", { name: "Mover", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mover documento" });
  await dialog.getByRole("combobox").selectOption("1");
  await dialog.getByRole("button", { name: "Mover documento", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Raiz", exact: true })).toBeFocused();
  await expect(page.getByText("Nenhum documento.", { exact: true })).toBeVisible();
});
