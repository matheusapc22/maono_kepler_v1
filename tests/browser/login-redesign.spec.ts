import { expect, test, type Page } from "@playwright/test";

// All accounts/HTTP are synthetic. Real authentication and password-manager
// autofill need an authorized account in the deployed Preview and are separate.
const organization = { id: 7, name: "Organização de teste", slug: "test", active: true };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(page: Page, options: { authenticated?: boolean; fail?: boolean; wait?: Promise<void> } = {}) {
  let authenticated = options.authenticated ?? false;
  const logins: { method: string; body: unknown }[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/session") return route.fulfill({ json: authenticated ? {
      authenticated: true, user: { id: 3, name: "Pessoa de teste", email: "qa@example.test", role: "super_admin", activeOrganizationId: 7 },
      activeOrganization: organization, organizations: [organization], projects: [],
    } : { authenticated: false, user: null, projects: [], organizations: [], activeOrganization: null } });
    if (path === "/api/auth/login") {
      logins.push({ method: request.method(), body: request.postDataJSON() });
      await options.wait;
      if (options.fail) return route.fulfill({ status: 401, json: { ok: false, error: { code: "AUTH_INVALID_CREDENTIALS", category: "AUTH", retryable: false } } });
      authenticated = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true, items: [], projects: [], organizations: [organization] } });
  });
  return { logins };
}
async function open(page: Page, path = "/login") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "ACESSE SUA CONTA", exact: true })).toBeVisible();
  await expect(page.locator("#app-boot-fallback")).toHaveCount(0);
  await expect(page.locator(".mm-loading-overlay--viewport")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}
async function fill(page: Page) {
  await page.getByLabel("E-mail", { exact: true }).fill("QA@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("synthetic-only-value");
}

test("minimal identity, hidden semantic labels, local title font and preserved assets", async ({ page }) => {
  await setup(page); await open(page);
  await expect(page.getByText("Entre para continuar na Maõno Maps.", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Maõno", exact: true })).toBeVisible();
  expect(await page.getByRole("img", { name: "Maõno", exact: true }).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByPlaceholder("seu e-mail")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByPlaceholder("sua senha")).toHaveAttribute("autocomplete", "current-password");
  for (const name of ["mail", "lock", "eye-off", "arrow-right"]) await expect(page.locator(`[data-login-icon="${name}"]`)).toBeVisible();
  await expect(page.locator(".maono-login-page__separator")).toHaveText("ou");
  expect(await page.locator(".maono-login-page__field-label").evaluateAll(labels => labels.every(label => {
    const style = getComputedStyle(label); return style.position === "absolute" && style.clipPath === "inset(50%)" && label.getBoundingClientRect().width <= 1;
  }))).toBe(true);
  await expect(page.locator("h1")).toHaveCSS("color", "rgb(169, 173, 179)");
  await expect(page.locator(".maono-login-page__intro")).toHaveCSS("font-weight", "400");
  expect(await page.evaluate(() => Array.from(document.fonts).some(font => font.family.includes("Maono Login Oxanium") && font.status === "loaded"))).toBe(true);
  // Firefox omits optional quotes when serializing a multi-word font family.
  await expect(page.locator("h1")).toHaveCSS("font-family", /^"?Maono Login Oxanium"?, sans-serif$/);
  expect(await page.getByLabel("E-mail", { exact: true }).evaluate(element => getComputedStyle(element).fontFamily)).not.toContain("Oxanium");
  expect(await page.locator(".maono-login-page").evaluate(element => getComputedStyle(element, "::before").backgroundImage)).toContain("Piramides_Maono.png");
  await expect(page.getByRole("button", { name: /^(ver|ocultar)$/i })).toHaveCount(0);
});

test("password toggle keeps value/caret, updates vector/color and never submits", async ({ page }) => {
  const { logins } = await setup(page); await open(page); await fill(page);
  const password = page.getByLabel("Senha", { exact: true });
  await password.evaluate((input: HTMLInputElement) => { input.focus(); input.setSelectionRange(3, 7); });
  const toggle = page.getByRole("button", { name: "Mostrar senha", exact: true });
  await expect(toggle).toHaveAttribute("type", "button");
  await expect(toggle).toHaveCSS("opacity", "0.68");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("synthetic-only-value");
  expect(await password.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([3, 7]);
  await expect(page.locator('[data-login-icon="eye"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Ocultar senha" })).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Ocultar senha" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.locator('[data-login-icon="eye-off"]')).toBeVisible();
  expect(logins).toHaveLength(0);
});

for (const field of ["E-mail", "Senha"]) test(`Enter in ${field} preserves POST payload, organization and next redirect`, async ({ page }) => {
  const { logins } = await setup(page); await open(page, "/login?next=/projects?section=all"); await fill(page);
  await page.getByLabel(field, { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/projects\?section=all$/);
  expect(logins).toEqual([{ method: "POST", body: { email: "qa@example.test", password: "synthetic-only-value" } }]);
  await expect(page.getByRole("button", { name: /Organização de teste Workspace/ })).toBeVisible();
});

test("pending login stays disabled and repeated Enter does not send a second request", async ({ page }) => {
  const gate = deferred(); const { logins } = await setup(page, { wait: gate.promise });
  await open(page); await fill(page);
  await page.getByLabel("Senha", { exact: true }).press("Enter");
  await expect.poll(() => logins.length).toBe(1);
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeDisabled();
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  expect(logins).toHaveLength(1);
  gate.resolve();
  await expect(page).toHaveURL(/\/projects$/);
});

test("credential errors use the existing message and restore interaction", async ({ page }) => {
  const { logins } = await setup(page, { fail: true }); await open(page); await fill(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha incorretos.");
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("aria-describedby", "maono-login-error");
  await expect(page.locator(".mm-loading-overlay--viewport")).toHaveCount(0);
  await page.getByLabel("Senha", { exact: true }).press("Enter");
  await expect.poll(() => logins.length).toBe(2);
});

test("native required/email validation blocks invalid submits", async ({ page }) => {
  const { logins } = await setup(page); await open(page);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeFocused();
  await page.getByLabel("E-mail", { exact: true }).fill("invalid-email");
  await page.getByLabel("Senha", { exact: true }).fill("synthetic-only-value");
  await page.getByLabel("Senha", { exact: true }).press("Enter");
  expect(logins).toHaveLength(0);
});

test("DOM-populated credentials preserve manager-compatible FormData semantics", async ({ page }) => {
  const { logins } = await setup(page); await open(page);
  // This verifies uncontrolled DOM values, NOT actual native password-manager autofill.
  await page.getByLabel("E-mail", { exact: true }).evaluate((input: HTMLInputElement) => { input.value = "manager@example.test"; });
  await page.getByLabel("Senha", { exact: true }).evaluate((input: HTMLInputElement) => { input.value = "synthetic-manager-value"; });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(logins[0].body).toEqual({ email: "manager@example.test", password: "synthetic-manager-value" });
});

test("keyboard order and focus ring remain usable; existing inert account links do not submit", async ({ page }) => {
  const { logins } = await setup(page); await open(page);
  const email = page.getByLabel("E-mail", { exact: true }); await email.focus();
  for (const locator of [page.getByLabel("Senha", { exact: true }), page.getByRole("button", { name: "Mostrar senha" }), page.getByRole("button", { name: "Esqueci minha senha" }), page.getByRole("button", { name: "Entrar", exact: true }), page.getByRole("button", { name: "Ainda não tenho uma conta" })]) {
    await page.keyboard.press("Tab"); await expect(locator).toBeFocused();
  }
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toHaveCSS("outline-style", "solid");
  for (const label of ["Esqueci minha senha", "Ainda não tenho uma conta"]) {
    const link = page.getByRole("button", { name: label });
    await expect(link).toHaveAttribute("type", "button"); await link.click();
  }
  await expect(page).toHaveURL(/\/login$/); expect(logins).toHaveLength(0);
});

for (const next of ["//example.test", "https://example.test"]) test(`unsafe next ${next} uses existing /projects fallback`, async ({ page }) => {
  await setup(page, { authenticated: true });
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(/\/projects$/);
});

for (const viewport of [{ width: 1672, height: 941 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 820, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`responsive login keeps all controls reachable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await setup(page); await open(page);
    const panel = await page.locator(".maono-login-page__card").boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(15); expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width - 15);
    // Layout-unit rounding can yield 500.00003px in Firefox.
    if (viewport.width > 768) expect(panel!.width).toBeCloseTo(500, 1);
    for (const locator of [page.getByLabel("E-mail", { exact: true }), page.getByLabel("Senha", { exact: true }), page.getByRole("button", { name: "Ainda não tenho uma conta" })]) {
      await locator.scrollIntoViewIfNeeded(); await locator.click();
      await expect(locator).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator(".maono-login-page").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
  });
}

test("200 percent text at 320px and short height can scroll without clipping actions", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 420 }); await setup(page); await open(page);
  await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveCSS("font-size", "32px");
  for (const name of ["Mostrar senha", "Entrar", "Ainda não tenho uma conta"]) {
    const control = page.getByRole("button", { name, exact: true });
    await control.scrollIntoViewIfNeeded(); await control.click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
