import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/maono-select.html");
  await expect(page.getByRole("heading", { name: "Controles Maõno" })).toBeVisible();
});

test("pointer opens a branded DOM listbox and commits one real change", async ({ page }) => {
  const field = page.getByLabel("Perfil controlado", { exact: true });
  await field.click();
  await expect(field).toHaveAttribute("aria-expanded", "true");
  const menu = page.locator(".maono-select-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("background-color", "rgb(16, 23, 32)");
  await expect(menu.getByRole("option", { name: "Alpha", exact: true })).toHaveAttribute("aria-selected", "true");
  await menu.getByRole("option", { name: "Beta", exact: true }).click();
  await expect(field).toHaveValue("beta");
  await expect(page.getByLabel("Alterações")).toHaveText("1");
  await expect(field).toBeFocused();
  await expect(menu).toHaveCount(0);
  await page.getByRole("button", { name: "Atualização externa" }).click();
  await expect(field).toHaveValue("gamma");
});

test("keyboard, cancel, disabled choices, stable chevron and typeahead", async ({ page }) => {
  const field = page.getByLabel("Perfil controlado", { exact: true });
  await field.focus();
  const chevron = field.locator("..").locator("svg").first();
  const path = await chevron.locator("path").getAttribute("d");
  await field.press("Space");
  await expect(field).toHaveAttribute("aria-expanded", "true");
  await expect(chevron).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
  await field.press("ArrowDown"); await field.press("ArrowDown"); await field.press("Enter");
  await expect(field).toHaveValue("gamma");
  await field.press("Home"); await field.press("Escape");
  await expect(field).toHaveValue("gamma");
  await expect(field).toBeFocused();
  await expect(chevron.locator("path")).toHaveAttribute("d", path!);
  await expect(chevron).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await field.press("b"); await field.press("Enter");
  await expect(field).toHaveValue("beta");
  await field.press("End"); await field.press("Tab");
  await expect(page.locator(".maono-select-menu")).toHaveCount(0);
  await expect(field).toHaveValue("beta");
  await page.getByRole("button", { name: "Alternar desabilitado" }).click();
  await expect(field).toBeDisabled();
});

test("native form names, required validation, external form ownership and uncontrolled reset remain", async ({ page }) => {
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Obrigatório", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Formulário", { exact: true })).toBeEmpty();
  await page.getByLabel("Obrigatório", { exact: true }).click();
  await page.locator(".maono-select-menu").getByRole("option", { name: "Confirmado" }).click();
  await page.getByLabel("Não controlado", { exact: true }).click();
  await page.locator(".maono-select-menu").getByRole("option", { name: "Três", exact: true }).click();
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByLabel("Formulário", { exact: true })).toContainText('"plain":"three"');
  await expect(page.getByLabel("Formulário", { exact: true })).toContainText('"group":"choice-3"');
  await page.getByRole("button", { name: "Redefinir" }).click();
  await expect(page.getByLabel("Não controlado", { exact: true })).toHaveValue("two");
  await page.getByRole("button", { name: "Focar via ref" }).click();
  await expect(page.getByLabel("Perfil controlado", { exact: true })).toBeFocused();
});

test("empty choices, long labels, optgroups, scroll, viewport and outside dismissal", async ({ page }) => {
  await page.getByLabel("Vazio", { exact: true }).click();
  await expect(page.getByText("Nenhuma opção disponível")).toBeVisible();
  await page.getByRole("heading").click();
  await expect(page.locator(".maono-select-menu")).toHaveCount(0);
  const field = page.getByLabel("Grupos e nomes longos", { exact: true });
  await field.click();
  await expect(page.locator(".maono-select-menu").getByRole("option", { name: "Não permitido" })).toHaveAttribute("aria-disabled", "true");
  await field.press("End");
  const option = page.locator(".maono-select-menu .is-active");
  await expect(option).toContainText("59 Organização");
  await expect(option).toBeInViewport();
  const menuBox = await page.locator(".maono-select-menu").boundingBox();
  const viewport = page.viewportSize()!;
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
  await field.press("Enter");
  await expect(field).toHaveValue("choice-59");
  await expect(page.locator(".maono-select--native select")).toHaveValues(["a", "b"]);
});

test("menu stays inside modal focus boundary and escapes its clipping", async ({ page }) => {
  await page.getByRole("button", { name: "Abrir modal" }).click();
  const dialog = page.getByRole("dialog");
  const field = page.getByLabel("Perfil no modal", { exact: true });
  await field.click();
  await expect(dialog.locator(".maono-select-menu")).toBeVisible();
  await field.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(field).toBeFocused();
  await field.press("Space");
  await dialog.locator(".maono-select-menu").getByRole("option", { name: "Beta", exact: true }).click();
  await expect(field).toHaveValue("beta");
  await expect(dialog).toBeVisible();
  await field.press("Escape");
  await expect(dialog).not.toBeVisible();
});


test("interrupted fieldset disable closes the popup and does not reopen on enable", async ({ page }) => {
  const field = page.getByRole("combobox", { name: "Grupo bloqueável", exact: true });
  await page.getByRole("button", { name: "Agendar bloqueio" }).click();
  await field.click();
  await expect(field).toHaveAttribute("aria-expanded", "true");
  await expect(field).toBeDisabled();
  await expect(page.locator(".maono-select-menu")).toHaveCount(0);
  await expect(field).toHaveValue("a");
  await page.getByRole("button", { name: "Liberar grupo" }).click();
  await expect(field).toBeEnabled();
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".maono-select-menu")).toHaveCount(0);
});


test("changed options, unmount and repeated activation never commit stale choices", async ({ page }) => {
  const dynamic = page.getByRole("combobox", { name: "Opções dinâmicas", exact: true });
  await page.getByRole("button", { name: "Atualizar opções depois" }).click();
  await dynamic.click();
  await expect(dynamic).toHaveAttribute("aria-expanded", "true");
  await expect(dynamic.locator('option[value="new"]')).toHaveCount(1);
  await expect(page.locator(".maono-select-menu")).toHaveCount(0);
  await dynamic.click();
  await expect(page.locator(".maono-select-menu").getByRole("option", { name: "Original" })).toHaveAttribute("aria-disabled", "true");
  await dynamic.press("Escape");
  const removable = page.getByRole("combobox", { name: "Controle removível", exact: true });
  await page.getByRole("button", { name: "Remover controle depois" }).click();
  await removable.click();
  await expect(page.locator(".maono-select-menu")).toBeVisible();
  await expect(removable).toHaveCount(0);
  await expect(page.locator(".maono-select-menu")).toHaveCount(0);
  const controlled = page.getByRole("combobox", { name: "Perfil controlado", exact: true });
  await controlled.dblclick();
  await expect(controlled).toHaveValue("alpha");
  await expect(page.getByLabel("Alterações")).toHaveText("0");
});
