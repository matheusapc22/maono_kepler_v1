import { test, expect, type Page } from "@playwright/test";
const url = "/tests/browser/fixtures/ticket-accessibility.html";
const baseDraft = {
  id: "draft-1",
  organizationId: 1,
  ticketId: 17,
  kind: "response",
  audience: "ticket",
  body: "Texto salvo",
  version: 1,
  state: "active",
  createdAt: "2026-09-29T12:00:00Z",
  updatedAt: "2026-09-29T12:00:00Z",
  attachments: [],
  etag: '"d1"',
};
async function setup(
  page: Page,
  options: { conflict?: boolean; ambiguous?: boolean; pending?: boolean } = {},
) {
  const state = {
    draft: { ...baseDraft },
    permissions: { comment: true, noteView: true, noteCreate: true },
    patches: [] as any[],
    sends: [] as any[],
    messages: [] as any[],
  };
  await page.route("**/api/**", async (r) => {
    const req = r.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/fixture-bundle")
      return r.fulfill({
        json: {
          enabled: true,
          schemaReady: true,
          permissions: state.permissions,
          drafts: state.messages.length ? [] : [state.draft],
          messages: state.messages,
          hasMore: false,
        },
      });
    if (path.endsWith("/drafts/draft-1") && req.method() === "PATCH") {
      state.patches.push({ headers: req.headers(), body: req.postDataJSON() });
      if (options.conflict && state.patches.length === 1) {
        state.draft = {
          ...state.draft,
          body: "Alteração de outra sessão",
          version: 2,
          etag: '"d2"',
        };
        return r.fulfill({ status: 412, json: { error: "Versão mudou" } });
      }
      state.draft = {
        ...state.draft,
        ...req.postDataJSON(),
        version: state.draft.version + 1,
        etag: '"d3"',
      };
      return r.fulfill({ json: { draft: state.draft } });
    }
    if (path.endsWith("/messages") && req.method() === "POST") {
      state.sends.push({ headers: req.headers(), body: req.postDataJSON() });
      state.messages = [
        {
          ...state.draft,
          ...req.postDataJSON(),
          id: "msg-1",
          author: { id: 1, name: "Pessoa" },
          attachments: [],
          version: 1,
        },
      ];
      if (options.ambiguous && state.sends.length === 1)
        return r.fulfill({ status: 502, json: { error: "Resposta perdida" } });
      return r.fulfill({ json: { message: state.messages[0] } });
    }
    if (path.endsWith("/uploads"))
      return r.fulfill({
        json: {
          sessions: options.pending
            ? [
                {
                  id: "upload-1",
                  name: "evidencia.txt",
                  size: 20,
                  offset: 10,
                  draftId: "draft-1",
                  state: "UPLOADING",
                  expiresAt: "2099-01-01T00:00:00Z",
                },
              ]
            : [],
        },
      });
    return r.fulfill({ json: { enabled: false, items: [], sessions: [] } });
  });
  await page.goto(url);
  await expect(
    page.getByRole("textbox", { name: "Texto da resposta", exact: true }),
  ).toHaveValue("Texto salvo");
  return state;
}
test("refresh retains unsaved text and later persists it", async ({ page }) => {
  const state = await setup(page);
  await page
    .getByRole("textbox", { name: "Texto da resposta", exact: true })
    .fill("Texto ainda não salvo");
  await page.getByRole("button", { name: "Atualizar conversa" }).click();
  await expect(
    page.getByRole("textbox", { name: "Texto da resposta", exact: true }),
  ).toHaveValue("Texto ainda não salvo");
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].body.body).toBe("Texto ainda não salvo");
});
test("412 retains local text, requires review and adopts only the refreshed CAS", async ({
  page,
}) => {
  const state = await setup(page, { conflict: true });
  const textbox = page.getByRole("textbox", {
    name: "Texto da resposta",
    exact: true,
  });
  await textbox.fill("Minha versão");
  await expect(page.getByRole("alert")).toContainText(
    "Seu texto foi preservado",
  );
  await expect(textbox).toHaveValue("Minha versão");
  await expect(
    page.getByText("Versão atual do rascunho:", { exact: false }),
  ).toContainText("Alteração de outra sessão");
  expect(state.patches).toHaveLength(1);
  await page
    .getByRole("button", { name: "Revisei a versão atual; salvar meu texto" })
    .click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1].headers["if-match"]).toBe('"d2"');
  expect(state.patches[1].body.body).toBe("Minha versão");
});
test("lost send response replays exact key and payload even after consumed draft refresh", async ({
  page,
}) => {
  const state = await setup(page, { ambiguous: true });
  await page
    .getByRole("button", { name: "Enviar resposta", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Verificar envio anterior" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Texto da resposta", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Atualizar conversa" }).click();
  await page.getByRole("button", { name: "Verificar envio anterior" }).click();
  await expect.poll(() => state.sends.length).toBe(2);
  expect(state.sends[1].headers["idempotency-key"]).toBe(
    state.sends[0].headers["idempotency-key"],
  );
  expect(state.sends[1].body).toEqual(state.sends[0].body);
  await expect(
    page.getByRole("textbox", { name: "Texto da resposta", exact: true }),
  ).toHaveValue("");
});
test("changing audience saves unsaved response first; revocation removes composer", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByRole("textbox", { name: "Texto da resposta", exact: true })
    .fill("Resposta preservada");
  await page.getByRole("button", { name: "Nota interna", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Texto da nota interna" }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Resposta", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Texto da resposta", exact: true }),
  ).toHaveValue("Resposta preservada");
  state.permissions = { comment: false, noteView: false, noteCreate: false };
  await page.getByRole("button", { name: "Atualizar conversa" }).click();
  await expect(
    page.getByRole("textbox", { name: "Texto da resposta", exact: true }),
  ).toHaveCount(0);
});
test("pending draft upload is reachable without editing a sent message", async ({
  page,
}) => {
  await setup(page, { pending: true });
  await expect(page.getByText("evidencia.txt", { exact: false })).toBeVisible();
  const input = page.locator(
    ".ticket-conversation-pending-uploads input[type=file]",
  );
  await input.focus();
  await expect(input).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await chooser;
  await expect(
    page.getByRole("button", { name: "Enviar resposta", exact: true }),
  ).toBeDisabled();
});
test("dialog retains focus across parent render, traps Tab and restores trigger; local creation draft survives closing", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Abrir criação" }).click();
  const dialog = page.getByRole("dialog");
  const subject = dialog.getByLabel("Assunto", { exact: false });
  await subject.fill("Rascunho de criação");
  // Cause a parent update without moving focus with a pointer click.
  await page
    .getByRole("button", { name: "Renderizar pai" })
    .evaluate((el: HTMLButtonElement) => el.click());
  await expect(subject).toBeFocused();
  const fileInput = dialog.locator("input[type=file]");
  await fileInput.focus();
  await expect(fileInput).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await chooser;
  await dialog.getByRole("button", { name: "Fechar painel" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Criar chamado", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Fechar painel" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Abrir criação" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Abrir criação" }).click();
  await expect(subject).toHaveValue("Rascunho de criação");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
});

test("dirty detail close asks before discarding and restores the trigger", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Abrir detalhes" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Prioridade", { exact: false }).selectOption("high");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Prioridade", { exact: false })).toHaveValue(
    "high",
  );
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Abrir detalhes" }),
  ).toBeFocused();
});

test("creation in flight skips disabled fields, explains waiting and does not abort on Escape", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/organizations/1/tickets", async (r) => {
    await wait;
    await r.fulfill({ status: 503, json: { error: "Falha temporária" } });
  });
  await page.getByRole("button", { name: "Abrir criação" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Assunto", { exact: false }).fill("Teste de espera");
  await dialog
    .getByLabel("Descrição", { exact: false })
    .fill("Contexto da solicitação");
  await dialog
    .getByRole("button", { name: "Criar chamado", exact: true })
    .click();
  await expect(dialog.getByLabel("Assunto", { exact: false })).toBeDisabled();
  await dialog.getByRole("button", { name: "Fechar painel" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Cancelar", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Aguarde");
  release();
  await expect(
    dialog.getByRole("button", { name: "Criando...", exact: false }),
  ).toHaveCount(0);
});

test("organization remount clears local creation content and mobile has no horizontal overflow", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Abrir criação" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Assunto", { exact: false })
    .fill("Conteúdo privado da organização anterior");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Trocar organização" }).click();
  await page.getByRole("button", { name: "Abrir criação" }).click();
  await expect(dialog.getByLabel("Assunto", { exact: false })).toHaveValue("");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.screenshot({ path: "/tmp/cc16-mobile.png", fullPage: true });
});
