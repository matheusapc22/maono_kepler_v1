import { test, expect } from "@playwright/test";
const url = "/tests/browser/fixtures/ticket-knowledge.html";
const revision = {
  id: "rev2",
  number: 2,
  title: "Solução revisada",
  body: "Texto sanitizado <script>alert(1)</script>",
  audience: "organization",
  hash: "hash",
  authorId: 1,
};
const detail = {
  id: "article-a",
  revision,
  published: revision,
  state: "review",
  version: "token",
  canEdit: true,
  canRevise: false,
  canReview: true,
  reviewerId: 2,
  history: [revision],
  events: [],
};
const list = {
  enabled: true,
  items: [
    {
      id: "article-a",
      revisionId: "rev2",
      number: 2,
      title: revision.title,
      state: "published",
      audience: "organization",
    },
  ],
  nextCursor: null,
};
test("OFF hides feature; mobile read is plain text without overflow", async ({
  page,
}) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({ json: { enabled: false, items: [] } }),
  );
  await page.goto(url);
  await expect(
    page.getByText("Conhecimento e respostas reutilizáveis", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/**");
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json: r.request().url().includes("/article-a")
        ? { ...detail, canEdit: false, canReview: false }
        : list,
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + "?viewer");
  await page
    .getByText("Conhecimento e respostas reutilizáveis", { exact: true })
    .click();
  await page.getByRole("button", { name: /Solução revisada/ }).click();
  await expect(
    page.getByText(revision.body, { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/cc14-mobile.png", fullPage: true });
});
test("independent review requires a reason and posts exact version", async ({
  page,
}) => {
  let body: any;
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST") {
      body = r.request().postDataJSON();
      return r.fulfill({ json: { id: "article-a" } });
    }
    return r.fulfill({
      json: r.request().url().includes("/article-a") ? detail : list,
    });
  });
  await page.goto(url);
  await page
    .getByText("Conhecimento e respostas reutilizáveis", { exact: true })
    .click();
  await page.getByRole("button", { name: /Solução revisada/ }).click();
  const approve = page.getByRole("button", {
    name: "Aprovar conteúdo e audiência",
  });
  await expect(approve).toBeDisabled();
  await page.getByLabel("Justificativa da decisão").fill("Sem dados privados");
  await approve.click();
  await expect.poll(() => body?.action).toBe("approve");
  expect(body.version).toBe("token");
  expect(body.reason).toBe("Sem dados privados");
});
test("reuse inserts a draft and requires renewed human review after edits", async ({
  page,
}) => {
  const sent: any[] = [];
  await page.route("**/api/**", (r) => {
    const u = r.request().url();
    if (u.endsWith("/select"))
      return r.fulfill({
        json: {
          selectionId: "select1",
          revision,
          body: revision.body,
          kind: "response",
        },
      });
    if (u.endsWith("/send")) {
      sent.push(r.request().postDataJSON());
      return r.fulfill({ json: { message: { id: "m1" } } });
    }
    return r.fulfill({ json: list });
  });
  await page.goto(url + "?reuse");
  await page.getByText("Usar resposta revisada", { exact: true }).click();
  await page.getByRole("button", { name: /inserir no rascunho/ }).click();
  expect(sent.length).toBe(0);
  const send = page.getByRole("button", { name: "Enviar texto revisado" });
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Resposta revisável").fill("Resposta editada");
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox").check();
  await send.click();
  await expect(page.getByText("Enviadas: 1")).toBeVisible();
  expect(sent[0]).toEqual({
    selectionId: "select1",
    body: "Resposta editada",
    reviewed: true,
  });
});
test("ambiguous send retries exact payload; organization switch clears draft", async ({
  page,
}) => {
  const sent: any[] = [];
  await page.route("**/api/**", (r) => {
    const u = r.request().url();
    if (u.endsWith("/select"))
      return r.fulfill({
        json: {
          selectionId: "select1",
          revision,
          body: revision.body,
          kind: "response",
        },
      });
    if (u.endsWith("/send")) {
      sent.push(r.request().postDataJSON());
      return r.fulfill(
        sent.length === 1
          ? {
              status: 503,
              json: { error: { code: "TEMPORARY", message: "Temporário" } },
            }
          : { json: { message: { id: "m1" } } },
      );
    }
    return r.fulfill({ json: list });
  });
  await page.goto(url + "?reuse");
  await page.getByText("Usar resposta revisada", { exact: true }).click();
  await page.getByRole("button", { name: /inserir no rascunho/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enviar texto revisado" }).click();
  await page.getByRole("button", { name: "Repetir envio preservado" }).click();
  await expect(page.getByText("Enviadas: 1")).toBeVisible();
  expect(sent[0]).toEqual(sent[1]);
  await page.getByRole("button", { name: /inserir no rascunho/ }).click();
  await page.getByRole("button", { name: "Trocar organização" }).click();
  await expect(page.getByLabel("Resposta revisável")).toHaveCount(0);
});
test("denied detail clears previously visible body", async ({ page }) => {
  let denied = false;
  await page.route("**/api/**", (r) =>
    r.fulfill(
      r.request().url().includes("/article-a")
        ? denied
          ? {
              status: 404,
              json: { error: { code: "NOT_FOUND", message: "Indisponível" } },
            }
          : { json: detail }
        : { json: list },
    ),
  );
  await page.goto(url);
  await page
    .getByText("Conhecimento e respostas reutilizáveis", { exact: true })
    .click();
  await page.getByRole("button", { name: /Solução revisada/ }).click();
  await expect(page.getByLabel("Diagnóstico e solução")).toHaveValue(
    revision.body,
  );
  denied = true;
  await page.getByRole("button", { name: /Solução revisada/ }).click();
  await expect(page.getByLabel("Diagnóstico e solução")).toHaveValue("");
});
