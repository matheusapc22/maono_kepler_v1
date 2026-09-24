import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/fixtures/reliability-ux.html";
const technicalMessage = "Dropbox D1 provider-token=secret /private/storage trace=internal-123";

function storageFailure(code: string, retryable: boolean) {
  return {
    ok: false,
    error: {
      code,
      category: "STORAGE",
      retryable,
      correlationId: "internal-storage-incident-123",
      message: technicalMessage,
      details: { token: "secret", root: "/private/storage" },
    },
  };
}

async function mockSession(page: Page) {
  await page.route("**/api/session", (route) => route.fulfill({
    json: {
      authenticated: true,
      user: { id: 1, email: "qa@example.test", role: "super_admin", activeOrganizationId: 1 },
      projects: [],
      organizations: [{ id: 1, name: "Test", slug: "test", active: true }],
      activeOrganization: { id: 1, name: "Test", slug: "test", active: true },
    },
  }));
}

async function expectSafeCopy(page: Page) {
  await expect(page.locator("body")).not.toContainText(/Dropbox|provider-token|\/private\/storage|internal-storage-incident|D1/);
  await expect(page.getByRole("button", { name: /reparar|sincronizar armazenamento/i })).toHaveCount(0);
}

for (const scenario of [
  { code: "ORGANIZATION_STORAGE_IN_PROGRESS", retryable: true, message: "está sendo preparado" },
  { code: "ORGANIZATION_STORAGE_NOT_READY", retryable: false, message: "precisa de verificação" },
]) {
  test(`documentos: ${scenario.code} mostra estado seguro sem falso vazio`, async ({ page }) => {
    let requests = 0;
    await page.route("**/api/organizations/1/files*", async (route) => {
      requests += 1;
      await route.fulfill({ status: 503, json: storageFailure(scenario.code, scenario.retryable) });
    });
    await page.goto(fixture);
    await expect(page.getByRole("alert")).toContainText(scenario.message);
    await expect(page.getByText("Nenhum documento.")).toHaveCount(0);
    await expect(page.locator("input[type=file]")).toBeEnabled();
    expect(requests).toBe(1);
    await expectSafeCopy(page);
    await expect(page.locator(".mm-loading-overlay--viewport")).toHaveCount(0);
  });
}

test("upload com falha preserva arquivo e chave; repetição explícita termina uma única vez", async ({ page }) => {
  const keys: string[] = [];
  let completed = false;
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/api/organizations/1/files*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { ok: true, files: completed ? [{ id: 10, name: "relatorio.txt", size: 4 }] : [] } });
      return;
    }
    const body = route.request().postDataBuffer()?.toString("utf8") || "";
    keys.push(body.match(/name="idempotencyKey"\r\n\r\n([^\r]+)/)?.[1] || "");
    if (keys.length === 1) {
      await firstHeld;
      await route.fulfill({ status: 503, json: storageFailure("ORGANIZATION_STORAGE_IN_PROGRESS", true) });
    } else {
      completed = true;
      await route.fulfill({ json: { ok: true, file: { id: 10, name: "relatorio.txt", size: 4 } } });
    }
  });
  await page.goto(fixture);
  const input = page.locator("input[type=file]");
  await input.setInputFiles({ name: "relatorio.txt", mimeType: "text/plain", buffer: Buffer.from("test") });
  await expect(input).toBeDisabled();
  await expect.poll(() => keys.length).toBe(1);
  releaseFirst();
  const retry = page.getByRole("button", { name: "Tentar enviar novamente" });
  await expect(retry).toBeVisible();
  expect(await input.evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe("relatorio.txt");
  await expectSafeCopy(page);
  await retry.click();
  await expect(page.getByRole("cell", { name: "relatorio.txt", exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(input).toBeEnabled();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[a-f0-9-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
});

test("troca de organização ignora resposta tardia da anterior", async ({ page }) => {
  let releaseOld!: () => void;
  const oldHeld = new Promise<void>((resolve) => { releaseOld = resolve; });
  let oldRequested = false;
  await page.route("**/api/organizations/*/files*", async (route) => {
    if (route.request().url().includes("/1/")) {
      oldRequested = true;
      await oldHeld;
      await route.fulfill({ json: { ok: true, files: [{ id: 1, name: "arquivo-outra-organizacao.txt" }] } });
    } else {
      await route.fulfill({ json: { ok: true, files: [{ id: 2, name: "arquivo-atual.txt" }] } });
    }
  });
  await page.goto(fixture);
  await expect.poll(() => oldRequested).toBe(true);
  await page.getByRole("button", { name: "Trocar organização" }).click();
  await expect(page.getByRole("cell", { name: "arquivo-atual.txt", exact: true })).toBeVisible();
  const oldResponse = page.waitForResponse((response) => response.url().includes("/organizations/1/files"));
  releaseOld();
  await oldResponse;
  await expect(page.getByText("arquivo-outra-organizacao.txt")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "arquivo-atual.txt", exact: true })).toBeVisible();
});

test("gate real de mapa não repete falha terminal nem expõe mensagem remota", async ({ page }) => {
  await mockSession(page);
  let requests = 0;
  await page.route("**/api/maps/new/context", async (route) => {
    requests += 1;
    await route.fulfill({ status: 503, json: storageFailure("ORGANIZATION_STORAGE_NOT_READY", false) });
  });
  await page.goto(`${fixture}?view=map`);
  await expect(page.getByRole("alert")).toContainText("precisa de verificação");
  await expect(page.getByRole("link", { name: "Voltar aos projetos" })).toBeVisible();
  expect(requests).toBe(1);
  await expectSafeCopy(page);
  await expect.poll(() => page.evaluate(() => (window as any).__MAONO_LOADING_DEBUG__?.activeCount())).toBe(0);
});

test("gate real de mapa limita tentativas transitórias e encerra loading", async ({ page }) => {
  await mockSession(page);
  let requests = 0;
  await page.route("**/api/maps/new/context", async (route) => {
    requests += 1;
    await route.fulfill({ status: 503, json: storageFailure("ORGANIZATION_STORAGE_IN_PROGRESS", true) });
  });
  await page.goto(`${fixture}?view=map`);
  await expect(page.getByRole("alert")).toContainText("está sendo preparado");
  expect(requests).toBe(3);
  await expectSafeCopy(page);
  await expect.poll(() => page.evaluate(() => (window as any).__MAONO_LOADING_DEBUG__?.activeCount())).toBe(0);
});

test("criação de organização conserva confirmação se apenas a atualização da lista falhar", async ({ page }) => {
  await mockSession(page);
  let createRequests = 0;
  let created = false;
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: { ok: true, users: [] } }));
  await page.route("**/api/admin/organizations", async (route) => {
    if (route.request().method() === "POST") {
      createRequests += 1;
      created = true;
      await route.fulfill({ json: { ok: true, organization: { id: 20, name: "Cliente novo" } } });
    } else if (created) {
      await route.fulfill({ status: 503, json: storageFailure("ORGANIZATION_STORAGE_NOT_READY", true) });
    } else {
      await route.fulfill({ json: { ok: true, organizations: [] } });
    }
  });
  await page.goto(`${fixture}?view=admin`);
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Cliente novo");
  await page.getByRole("button", { name: "Criar organização/pasta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Organização criada com sucesso." })).toContainText("Organização criada com sucesso.");
  await expect(page.getByRole("status").filter({ hasText: "Organização criada com sucesso." })).toContainText("A lista não pôde ser atualizada");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Nome", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Criar organização/pasta" })).toBeEnabled();
  expect(createRequests).toBe(1);
});

test("criação com resposta perdida preserva rascunho e não reenvia automaticamente", async ({ page }) => {
  await mockSession(page);
  let createRequests = 0;
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: { ok: true, users: [] } }));
  await page.route("**/api/admin/organizations", async (route) => {
    if (route.request().method() === "POST") {
      createRequests += 1;
      await route.abort("failed");
    } else {
      await route.fulfill({ json: { ok: true, organizations: [] } });
    }
  });
  await page.goto(`${fixture}?view=admin`);
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Cliente em preparação");
  await page.getByRole("textbox", { name: "Descrição", exact: true }).fill("Descrição preservada");
  await page.getByRole("button", { name: "Criar organização/pasta" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Consulte a lista de organizações antes de tentar novamente");
  await expect(page.getByRole("alert")).not.toContainText(/Failed to fetch|TypeError|Dropbox|D1/);
  await expect(page.getByRole("textbox", { name: "Nome", exact: true })).toHaveValue("Cliente em preparação");
  await expect(page.getByRole("textbox", { name: "Descrição", exact: true })).toHaveValue("Descrição preservada");
  await expect(page.getByRole("button", { name: "Criar organização/pasta" })).toBeEnabled();
  expect(createRequests).toBe(1);
});
