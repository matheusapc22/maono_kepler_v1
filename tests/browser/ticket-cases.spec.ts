import { test, expect } from "@playwright/test";
const url = "/tests/browser/fixtures/ticket-cases.html";
const record = {
  id: "case-a",
  kind: "incident",
  title: "Indisponibilidade",
  state: "open",
  visibility: "private",
  version: "opaque-v1",
  coordinatorId: 1,
  data: {
    causeStatus: "unknown",
    impact: "Mapa indisponível",
    postMortem: "Revisão preservada",
  },
};
const detail = {
  record,
  canManage: true,
  links: [],
  history: [
    {
      action: "create",
      at: "2026-09-29T12:00:00Z",
      data: { title: record.title, data: record.data },
    },
  ],
};
test("OFF hides panel; mobile reads human history without JSON or overflow", async ({
  page,
}) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({ json: { enabled: false, items: [] } }),
  );
  await page.goto(url);
  await expect(
    page.getByText("Incidentes e problemas", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/**");
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json: r.request().url().includes("/case-a")
        ? detail
        : { enabled: true, items: [record], nextCursor: null },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.getByText("Incidentes e problemas", { exact: true }).click();
  await page.getByRole("button", { name: record.title }).click();
  await page.getByText("Histórico de revisões", { exact: true }).click();
  await expect(
    page.locator("dl").getByText("Revisão preservada"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("pre")).toHaveCount(0);
});
test("ambiguous create retries same key and immutable original body", async ({
  page,
}) => {
  const sent: unknown[] = [];
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST") {
      sent.push(r.request().postDataJSON());
      return r.fulfill(
        sent.length === 1
          ? {
              status: 503,
              json: {
                ok: false,
                error: { code: "UNAVAILABLE", message: "Temporário" },
              },
            }
          : { json: { id: "case-a" } },
      );
    }
    return r.fulfill({
      json: r.request().url().includes("/case-a")
        ? detail
        : { enabled: true, items: [], nextCursor: null },
    });
  });
  await page.goto(url);
  await page.getByText("Incidentes e problemas", { exact: true }).click();
  await page.getByLabel("Título", { exact: true }).fill("Falha revisada");
  await page.getByRole("button", { name: "Criar registro" }).click();
  await page.getByRole("button", { name: "Repetir tentativa" }).click();
  await expect(page.getByRole("heading", { name: record.title })).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[0]).toEqual(sent[1]);
  expect(sent[0]).toMatchObject({ action: "create", title: "Falha revisada" });
});
test("transition carries current version, cause remains explicitly unknown", async ({
  page,
}) => {
  let sent: any;
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST") {
      sent = r.request().postDataJSON();
      return r.fulfill({ json: { id: "case-a" } });
    }
    return r.fulfill({
      json: r.request().url().includes("/case-a")
        ? detail
        : { enabled: true, items: [record], nextCursor: null },
    });
  });
  await page.goto(url);
  await page.getByText("Incidentes e problemas", { exact: true }).click();
  await page.getByRole("button", { name: record.title }).click();
  await page.getByLabel("Próximo estado").selectOption("restored");
  await page.getByLabel("Restauração verificada").fill("Mapa verificado");
  await page
    .getByLabel("Motivo da revisão/transição")
    .fill("Contorno verificado");
  await page.getByRole("button", { name: "Salvar revisão" }).click();
  await expect.poll(() => sent?.action).toBe("transition");
  expect(sent).toMatchObject({
    version: "opaque-v1",
    state: "restored",
    data: { causeStatus: "unknown", restoration: "Mapa verificado" },
  });
});
test("viewer cannot mutate; organization switch discards old detail", async ({
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
        : {
            json: r.request().url().includes("/case-a")
              ? { ...detail, canManage: false }
              : { enabled: true, items: [record], nextCursor: null },
          },
    ),
  );
  await page.goto(url + "?viewer");
  await page.getByText("Incidentes e problemas", { exact: true }).click();
  await page.getByRole("button", { name: record.title }).click();
  await expect(
    page.getByRole("button", { name: "Criar registro" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Salvar revisão" }),
  ).toBeDisabled();
  denied = true;
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(page.getByRole("heading", { name: record.title })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Trocar organização" }).click();
  await expect(
    page.getByText("Mapa indisponível", { exact: true }),
  ).toHaveCount(0);
});
