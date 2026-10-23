import { expect, test, type Page } from "@playwright/test";

// Also applies when the repository-wide development gate discovers this suite.
test.use({ screenshot: "off", trace: "off", video: "off" });

const syntheticPassword = "synthetic-password-only";
const runtimeErrors = new WeakMap<Page, string[]>();
test.afterEach(({ page }) => { expect(runtimeErrors.get(page) ?? []).toEqual([]); });
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

async function setup(page: Page, options: {
  self?: boolean; membershipFailure?: boolean; refreshFailure?: boolean;
  beforeWrite?: () => Promise<void>; failures?: number[];
} = {}) {
  const writes: Array<{ method: string; passwordSent: boolean; roleSent: boolean }> = [];
  runtimeErrors.set(page, []);
  page.on("pageerror", error => runtimeErrors.get(page)!.push(error.message));
  let writeConfirmed = false, loggedOut = false;
  const user = { id: options.self ? 1 : 2, name: "Synthetic target", email: "target@example.test", role: options.self ? "super_admin" : "viewer", active: true };
  await page.route(url => !["127.0.0.1", "localhost"].includes(url.hostname), route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/session") return route.fulfill({ json: loggedOut ? { authenticated: false } : { authenticated: true, user: { id: 1, role: "super_admin", email: "actor@example.test" }, organizations: [], projects: [] } });
    if (["PATCH", "POST"].includes(request.method()) && /^\/api\/admin\/users(?:\/\d+)?$/.test(path)) {
      const payload = request.postDataJSON();
      writes.push({ method: request.method(), passwordSent: payload.password === syntheticPassword, roleSent: Object.prototype.hasOwnProperty.call(payload, "role") });
      await options.beforeWrite?.();
      const status = options.failures?.shift() ?? 200;
      if (status !== 200) return route.fulfill({ status, json: { ok: false, code: status === 400 ? "USER_PASSWORD_INVALID" : "UNKNOWN" } });
      writeConfirmed = true;
      if (options.self && payload.password) loggedOut = true;
      return route.fulfill({ json: { ok: true, user, passwordChanged: Boolean(payload.password), sessionsInvalidated: Boolean(payload.password) } });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 403, json: { ok: false } });
    if (/\/users\/\d+\/organizations$/.test(path) && options.membershipFailure) return route.fulfill({ status: 503, json: { ok: false } });
    if (path === "/api/admin/users") {
      // StrictMode can read twice on mount. Fail only the read after a
      // confirmed mutation, which is the behavior these cases exercise.
      if (writeConfirmed && options.refreshFailure) return route.fulfill({ status: 503, json: { ok: false } });
      return route.fulfill({ json: { ok: true, users: [user] } });
    }
    return route.fulfill({ json: { ok: true, users: [], organizations: [], access: [], projects: [], enabled: false, notifications: [], unreadCount: 0 } });
  });
  await page.goto("/admin?section=users");
  await expect(page.getByRole("button", { name: "Editar", exact: true })).toBeVisible();
  return { writes };
}

async function edit(page: Page) {
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByLabel("Nova senha", { exact: true })).toBeVisible();
}

test("success clears old errors; membership read failure does not masquerade as reset failure", async ({ page }) => {
  const fixture = await setup(page, { membershipFailure: true, failures: [400, 200] });
  await edit(page);
  await page.getByLabel("Nova senha", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "Salvar dados", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("8 caracteres");
  await page.getByRole("button", { name: "Salvar dados", exact: true }).click();
  await expect(page.locator(".admin-notice.success")).toContainText("Senha alterada");
  await expect(page.locator(".admin-notice.error")).toHaveCount(0);
  expect(fixture.writes).toHaveLength(2);
});

test("confirmed update followed by failed refresh preserves an explicit success", async ({ page }) => {
  const fixture = await setup(page, { refreshFailure: true });
  expect(await page.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(200);
  await edit(page);
  await page.getByLabel("Nova senha", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "Salvar dados", exact: true }).click();
  await expect(page.locator(".admin-notice.success")).toContainText("Senha alterada");
  await expect(page.locator(".admin-notice.success")).toContainText("Não foi possível recarregar a lista");
  expect(fixture.writes).toHaveLength(1);
});

test("repeated submit while pending emits one write and uses actual autofilled password", async ({ page }) => {
  const gate = deferred(), fixture = await setup(page, { beforeWrite: () => gate.promise }); await edit(page);
  await page.getByLabel("Nova senha", { exact: true }).evaluate((input, value) => { (input as HTMLInputElement).value = value; }, syntheticPassword);
  await page.locator(".admin-user-profile-form").evaluate(form => {
    (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit();
  });
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0].passwordSent).toBe(true); expect(fixture.writes[0].roleSent).toBe(false);
  await expect(page.getByLabel("Nova senha", { exact: true })).toBeDisabled();
  gate.release(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await edit(page); await expect(page.getByLabel("Nova senha", { exact: true })).toHaveValue("");
});

test("blank password updates profile without claiming revocation", async ({ page }) => {
  const fixture = await setup(page); await edit(page);
  await page.getByRole("button", { name: "Salvar dados", exact: true }).click();
  await expect(page.locator(".admin-notice.success")).toHaveText("Usuário atualizado.");
  expect(fixture.writes[0].passwordSent).toBe(false);
});

test("stalled reset releases the form after the deadline with an uncertain outcome", async ({ page }) => {
  const gate = deferred(), fixture = await setup(page, { beforeWrite: () => gate.promise });
  await page.clock.install(); await edit(page);
  await page.getByLabel("Nova senha", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "Salvar dados", exact: true }).click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  await page.clock.runFor(30_001);
  await expect(page.getByRole("alert")).toContainText("confirmar se a alteração");
  await expect(page.getByRole("button", { name: "Salvar dados", exact: true })).toBeEnabled();
  gate.release(); expect(fixture.writes).toHaveLength(1);
});

for (const status of [429, 503]) test(`HTTP ${status} shows one actionable error without success or retry`, async ({ page }) => {
  const fixture = await setup(page, { failures: [status] }); await edit(page);
  await page.getByLabel("Nova senha", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "Salvar dados", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(status === 429 ? "Limite de solicitações" : "confirmar se a alteração");
  await expect(page.locator(".admin-notice.success")).toHaveCount(0);
  expect(fixture.writes).toHaveLength(1);
});

test("self password reset goes directly to fresh login without refresh requests", async ({ page }) => {
  const fixture = await setup(page, { self: true }); await edit(page);
  await page.getByLabel("Nova senha", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "Salvar dados", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/);
  await expect(page.getByText("Senha alterada e sessões anteriores encerradas. Entre com a nova senha.")).toBeVisible();
  expect(fixture.writes).toHaveLength(1); expect(fixture.writes[0].roleSent).toBe(false);
});

test("creation followed by failed refresh reports created and does not resend", async ({ page }) => {
  const fixture = await setup(page, { refreshFailure: true });
  expect(await page.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(200);
  await page.getByRole("button", { name: /Novo usuário$/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("New synthetic user");
  await dialog.getByLabel("E-mail", { exact: true }).fill("new@example.test");
  await dialog.getByLabel("Senha inicial", { exact: true }).fill(syntheticPassword);
  await dialog.getByRole("button", { name: "Criar usuário", exact: true }).click();
  await expect(page.locator(".admin-notice.success")).toContainText("Usuário criado");
  await expect(page.locator(".admin-notice.success")).toContainText("Não foi possível recarregar a lista");
  expect(fixture.writes).toHaveLength(1); expect(fixture.writes[0].method).toBe("POST");
});
