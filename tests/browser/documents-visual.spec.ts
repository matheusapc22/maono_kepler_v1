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
async function setup(page: Page, options: { more?: boolean; empty?: boolean; role?: string } = {}) {
  const requests: { method: string; url: string; body: string | null }[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), url: request.url(), body: request.postData() });
    if (url.pathname === "/api/session") {
      return route.fulfill({ json: { authenticated: true, user: { id: 1, name: "Operador de demonstração", email: "qa@example.test", role: options.role ?? "super_admin", activeOrganizationId: 1 }, projects: [], organizations: [organization], activeOrganization: organization } });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 403, json: { ok: false, error: { code: "AUTH_PERMISSION_DENIED", category: "AUTH", retryable: false } } });
    if (url.pathname.endsWith("/document-folders")) return route.fulfill({ json: { ok: true, folders } });
    if (url.pathname === "/api/organizations/1/files") {
      const trash = url.searchParams.get("state") === "trash";
      const cursor = url.searchParams.get("cursor");
      const folderId = url.searchParams.get("folderId");
      const firstBatch = options.more
        ? Array.from({ length: 10 }, (_, index) => ({ ...files[index % files.length], id: 100 + index, name: index % 2 === 0 ? `config_${index + 1}.json` : `relatorio_${index + 1}.pdf` }))
        : files;
      let resultFiles = options.empty ? [] : firstBatch;
      if (!options.empty && folderId === "root") resultFiles = [files[0]];
      if (!options.empty && folderId === "1") resultFiles = [files[1]];
      if (!options.empty && folderId === "3") resultFiles = [];
      if (!options.empty && trash) resultFiles = [{ ...files[0], deletedAt: "2026-09-29T12:00:00Z", purgeAfter: "2999-01-01T00:00:00Z", deletedBy: { id: 1, name: "Operador de demonstração" }, trashedFromFolderId: 1, trashedFromFolderName: "Mês de Setembro" }];
      if (!options.empty && cursor) resultFiles = [{ ...files[1], id: 12, name: "Terceiro documento.pdf" }];
      return route.fulfill({ json: { ok: true, files: resultFiles, facets: { types: ["json", "pdf"], projects: [{ id: 1, name: "Projeto de demonstração" }], rootCount: 1, folderCounts: [{ folderId: 1, count: 1 }, { folderId: 2, count: 0 }, { folderId: 3, count: 0 }, { folderId: 4, count: 0 }] }, pagination: { limit: 50, total: options.empty ? 0 : trash ? 1 : folderId === "root" || folderId === "1" ? 1 : folderId === "3" ? 0 : options.more ? 11 : 2, hasMore: Boolean(options.more && !cursor && !folderId && !trash), nextCursor: options.more && !cursor && !folderId && !trash ? "fixture-next" : null, sort: "updated_desc" }, capabilities: { permanentPurgeEnabled: false } } });
    }
    return route.fulfill({ json: { ok: true, projects: [], tickets: [], users: [], items: [], organizations: [organization], pagination: { total: 0, hasMore: false, nextCursor: null } } });
  });
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.goto("/projects");
  return requests;
}
async function openDocuments(page: Page) {
  await page.locator(".mm-sidebar-item").filter({ hasText: "Arquivos e Documentos" }).click();
  await expect(page.locator("#mm-docs-title")).toBeVisible();
  await expect(page.locator(".mm-docs-folder-card")).toHaveCount(4);
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
  await expect(page.locator(".mm-docs-file-icon.is-pdf")).toHaveCount(1);
  await expect(page.locator(".mm-docs-move-control")).toHaveCount(2);
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
    await setup(page); await openDocuments(page);
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
  const requests = await setup(page); await openDocuments(page);
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

test("navegação real mostra apenas subpastas do nível atual e consulta os arquivos da pasta", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page);
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
});

test("modo lista/grade alterna conteúdo sem trocar a consulta", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page);
  const before = requests.filter(request => new URL(request.url).pathname === "/api/organizations/1/files").length;
  await page.getByRole("button", { name: "Visualização em grade" }).click();
  await expect(page.locator(".mm-docs-file-grid")).toBeVisible();
  await expect(page.locator(".mm-docs-table-scroll")).toHaveCount(0);
  await page.getByRole("button", { name: "Visualização em lista" }).click();
  await expect(page.locator(".mm-docs-table-scroll")).toBeVisible();
  expect(requests.filter(request => new URL(request.url).pathname === "/api/organizations/1/files").length).toBe(before);
});

test("menu secundário: teclado, Escape, Tab, clique externo; excluir exige confirmação", async ({ page }) => {
  const requests = await setup(page); await openDocuments(page);
  const trigger = page.getByRole("button", { name: "Ações de config_kepler.json", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Excluir", exact: true })).toBeFocused();
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

test("botões contextuais alternam Documentos/Lixeira sem repetir a visão atual", async ({ page }) => {
  await setup(page); await openDocuments(page);
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
  await setup(page); await openDocuments(page);
  await page.getByRole("button", { name: "Lixeira", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Pasta anterior" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Excluído por" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Exclusão definitiva em" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restaurar", exact: true })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: "Excluir permanentemente" })).toHaveCount(0);
  await expect(page.locator(".mm-docs-folder-grid")).toHaveCount(0);
});

test("paginação da referência usa itens por página, página atual e cursor existente", async ({ page }) => {
  await setup(page, { more: true }); await openDocuments(page);
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
  await setup(page); await openDocuments(page);
  const toggle = page.locator(".mm-sidebar-toggle");
  await toggle.click(); await expect(page.locator(".mm-projects-sidebar")).toHaveClass(/collapsed/);
  await toggle.click(); await expect(page.locator(".mm-projects-sidebar")).not.toHaveClass(/collapsed/);
  await page.locator(".mm-sidebar-item").filter({ hasText: "Todos os Projetos" }).click();
  await expect(page.locator(".mm-docs")).toHaveCount(0);
  await openDocuments(page);
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
