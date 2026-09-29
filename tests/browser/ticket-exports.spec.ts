import { test, expect } from "@playwright/test";
const url = "/tests/browser/fixtures/ticket-exports.html";
const job = {
  id: "export-fixture",
  state: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-12-31T00:00:00Z",
  capturedRows: 250,
  expectedRows: 250,
  errorCode: null,
  report: "all",
  bytes: 100,
};
test("OFF hides panel; authorized history and manifest actions are accessible on mobile", async ({
  page,
}) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({ json: { enabled: false, jobs: [] } }),
  );
  await page.goto(url);
  await expect(
    page.getByText("Relatórios e exportações", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/**");
  await page.route("**/api/**", (r) =>
    r.fulfill({ json: { enabled: true, jobs: [job], nextCursor: null } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.getByText("Relatórios e exportações", { exact: true }).click();
  await expect(page.getByText(/250 de 250/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Baixar CSV" })).toHaveAttribute(
    "href",
    /\/tickets\/exports\/export-fixture\/download$/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("ambiguous create retries identical idempotency key and filter payload", async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST") {
      requests.push(r.request().postDataJSON());
      return r.fulfill(
        requests.length === 1
          ? {
              status: 503,
              json: {
                ok: false,
                error: { code: "UNAVAILABLE", message: "Temporário" },
              },
            }
          : { status: 202, json: { ok: true, job } },
      );
    }
    return r.fulfill({ json: { enabled: true, jobs: [], nextCursor: null } });
  });
  await page.goto(url);
  await page.getByText("Relatórios e exportações", { exact: true }).click();
  await page.getByLabel("Domínio").selectOption("database");
  await page.getByRole("button", { name: "Solicitar exportação" }).click();
  await page
    .getByRole("button", { name: "Verificar tentativa anterior" })
    .click();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({ domain: "database" });
});
test("revocation clears history; organization switch clears prior history", async ({
  page,
}) => {
  let denied = false;
  await page.route("**/api/**", (r) =>
    r.fulfill(
      denied
        ? {
            status: 403,
            json: { ok: false, error: { code: "DENIED", message: "Negado" } },
          }
        : { json: { enabled: true, jobs: [job], nextCursor: null } },
    ),
  );
  await page.goto(url + "?viewer");
  await page.getByText("Relatórios e exportações", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Solicitar exportação" }),
  ).toHaveCount(0);
  denied = true;
  await page.getByRole("button", { name: "Atualizar exportações" }).click();
  await expect(page.getByRole("link", { name: "Baixar CSV" })).toHaveCount(0);
  await page.getByRole("button", { name: "Trocar organização" }).click();
  await expect(page.getByText(/250 de 250/)).toHaveCount(0);
});
test("active job polls and transitions to ready without a fake completion percentage", async ({
  page,
}) => {
  let ready = false;
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        jobs: [
          {
            ...job,
            state: ready ? "ready" : "capturing",
            capturedRows: ready ? 250 : 5,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto(url);
  await page.getByText("Relatórios e exportações", { exact: true }).click();
  await expect(
    page.getByText("Capturando dados", { exact: true }),
  ).toBeVisible();
  ready = true;
  await expect(page.getByText("Disponível", { exact: true })).toBeVisible({
    timeout: 10000,
  });
});
