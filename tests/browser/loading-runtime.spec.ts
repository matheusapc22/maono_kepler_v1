import { expect, test } from "@playwright/test";

async function mockUnauthenticatedSession(page: any) {
  await page.route("**/api/session", async (route: any) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "AUTH_SESSION_REQUIRED",
          category: "AUTH",
          retryable: false,
        },
      }),
    });
  });
}

async function centerHit(page: any, selector: string) {
  return page.locator(selector).evaluate((element: Element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return hit === element || Boolean(hit && element.contains(hit));
  });
}

async function activeLoadingCount(page: any) {
  return page.evaluate(() => {
    const debug = (window as any).__MAONO_LOADING_DEBUG__;
    return debug ? debug.activeCount() : -1;
  });
}

test("cold /login libera boot e controles recebem hit-test/foco real", async ({ page }) => {
  await mockUnauthenticatedSession(page);
  await page.goto("/login");

  const email = page.locator("#maono-login-email");
  const password = page.locator("#maono-login-password");
  const toggle = page.locator(".maono-login-page__password-toggle");
  const submit = page.getByRole("button", { name: "Entrar" });

  await expect(email).toBeVisible();
  await expect(page.locator("#app-boot-fallback")).toHaveCount(0);
  await expect(page.locator(".mm-loading-overlay--viewport")).toHaveCount(0);

  expect(await centerHit(page, "#maono-login-email")).toBe(true);
  await email.click();
  await expect(email).toBeFocused();

  await password.click();
  await expect(password).toBeFocused();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(email).toBeFocused();

  await expect.poll(() => activeLoadingCount(page)).toBe(0);
});

test("falha de Auth encerra token e devolve interação ao formulário", async ({ page }) => {
  await mockUnauthenticatedSession(page);
  await page.route("**/api/auth/login", async (route: any) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "INFRASTRUCTURE_NETWORK_FAILURE",
          category: "INFRASTRUCTURE",
          retryable: true,
        },
      }),
    });
  });

  await page.goto("/login");
  await page.locator("#maono-login-email").fill("qa@example.test");
  await page.locator("#maono-login-password").fill("not-a-real-password");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect.poll(() => activeLoadingCount(page)).toBe(0);
  await expect(page.locator(".mm-loading-overlay--viewport")).toHaveCount(0);

  const email = page.locator("#maono-login-email");
  await email.click();
  await expect(email).toBeFocused();
});

test("save local pendente não cria overlay viewport e stall continua cancelável", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/save-local-runtime.html");

  const unrelated = page.getByRole("button", { name: "Controle não relacionado" });
  const save = page.getByRole("button", { name: "Salvar localmente" });

  await save.click();
  await expect(page.locator(".mm-universal-loader")).toBeVisible();
  await expect(page.locator(".mm-loading-overlay--viewport")).toHaveCount(0);

  await unrelated.click();
  await expect(page.locator("#unrelated-count")).toHaveText("1");
  expect(await centerHit(page, "#unrelated-control")).toBe(true);

  await expect(page.locator("#save-state")).toHaveText("stalled");
  await page.getByRole("button", { name: "Cancelar espera" }).click();
  await expect(page.locator("#save-state")).toHaveText("cancelled");
  await expect(page.locator(".mm-loading-overlay--viewport")).toHaveCount(0);
});
