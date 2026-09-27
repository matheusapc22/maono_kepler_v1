import { test, expect } from "@playwright/test";
const url = "/tests/browser/fixtures/ticket-changes.html";
const item = {
  id: "cr:one",
  title: "Proposta de mapa",
  proposal: "Justificativa",
  domain: "map_project",
  status: "submitted",
  version: 1,
  linkVersion: 1,
  active: true,
  canReview: false,
  reviewUrl: null,
  appliedRevision: null,
  divergence: null,
  feedback: "",
  history: [],
  crHistory: [],
};
test("CC08 OFF hides surface", async ({ page }) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({ json: { ok: true, enabled: false, items: [] } }),
  );
  await page.goto(url);
  await expect(
    page.getByRole("region", { name: "Mudanças vinculadas" }),
  ).toHaveCount(0);
});
test("CC08 link alone offers no Review or Apply and revocation clears content", async ({
  page,
}) => {
  let revoked = false;
  await page.route("**/api/**", (r) =>
    r.fulfill(
      revoked
        ? {
            status: 404,
            json: {
              ok: false,
              error: { code: "TICKET_NOT_FOUND", message: "Não encontrado" },
            },
          }
        : { json: { ok: true, enabled: true, items: [item] } },
    ),
  );
  await page.goto(url);
  await expect(page.getByText("Proposta de mapa · submitted")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir revisão" })).toHaveCount(
    0,
  );
  revoked = true;
  await page.getByRole("button", { name: "Atualizar mudanças" }).click();
  await expect(page.getByText("Proposta de mapa · submitted")).toHaveCount(0);
});
test("CC08 unlink sends expected version and reuses idempotency key on ambiguous failure", async ({
  page,
}) => {
  const keys: string[] = [];
  let success = false;
  await page.route("**/api/**", async (r) => {
    if (r.request().method() === "POST") {
      keys.push(r.request().headers()["idempotency-key"]);
      expect(r.request().postDataJSON()).toMatchObject({
        action: "unlink",
        linkVersion: 1,
      });
      return r.fulfill({
        status: 503,
        json: { ok: false, error: { code: "UNAVAILABLE" } },
      });
    }
    return r.fulfill({
      json: { ok: true, enabled: true, items: [{ ...item, active: !success }] },
    });
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Desvincular" }).click();
  await page.getByRole("button", { name: "Atualizar mudanças" }).click();
  await page.getByRole("button", { name: "Desvincular" }).click();
  expect(keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});
