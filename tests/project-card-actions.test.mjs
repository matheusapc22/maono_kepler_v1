import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const base = "../src/pages/Projects/components/";

const [
  cardSource,
  sectionSource,
  menuSource,
  panelSource,
  cardsCssSource,
  panelCssSource,
] = await Promise.all([
  readFile(new URL(`${base}ProjectCard.tsx`, import.meta.url), "utf8"),
  readFile(new URL(`${base}ProjectsSection.tsx`, import.meta.url), "utf8"),
  readFile(new URL(`${base}ProjectActionsMenu.tsx`, import.meta.url), "utf8"),
  readFile(new URL(`${base}ProjectMetadataPanel.tsx`, import.meta.url), "utf8"),
  readFile(new URL(`${base}project-cards.css`, import.meta.url), "utf8"),
  readFile(
    new URL(`${base}project-metadata-panel.css`, import.meta.url),
    "utf8",
  ),
]);

test("menu possui atributos ARIA e item de edição", () => {
  assert.match(menuSource, /aria-label=\{`Mais ações do projeto/);
  assert.match(menuSource, /aria-haspopup="menu"/);
  assert.match(menuSource, /aria-expanded=\{open\}/);
  assert.match(menuSource, /role="menu"/);
  assert.match(menuSource, /role="menuitem"/);
  assert.match(menuSource, />Editar informações</);
});

test("menu usa portal, teclado e retorno de foco", () => {
  assert.match(menuSource, /createPortal\(/);
  assert.match(menuSource, /document\.body/);
  assert.match(menuSource, /event\.key === "Enter"/);
  assert.match(menuSource, /event\.key === " "/);
  assert.match(menuSource, /event\.key === "Escape"/);
  assert.match(menuSource, /buttonRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(menuSource, /\bfetch\s*\(/);
});

test("card separa menu, favorito e CTA", () => {
  const actionsIndex = cardSource.indexOf("mm-project-card__actions");
  const favoriteIndex = cardSource.indexOf(
    "mm-project-card__favorite",
    actionsIndex,
  );
  const linkIndex = cardSource.indexOf("<Link");

  assert.ok(actionsIndex >= 0);
  assert.ok(favoriteIndex > actionsIndex);
  assert.ok(linkIndex > favoriteIndex);

  const linkBlock = cardSource.slice(
    linkIndex,
    cardSource.indexOf("</Link>", linkIndex),
  );

  assert.doesNotMatch(linkBlock, /ProjectActionsMenu/);
  assert.doesNotMatch(linkBlock, /mm-project-card__favorite/);
  assert.doesNotMatch(linkBlock, /<button/);
});

test("menu depende de canEditMetadata e autor vem do projeto", () => {
  assert.match(cardSource, /canEditMetadata\?: boolean/);
  assert.match(cardSource, /\{canEditMetadata \? \(/);
  assert.match(cardSource, /project\.createdBy\?\.name/);
  assert.doesNotMatch(cardSource, /\buser\.name\b/);
  assert.doesNotMatch(cardSource, /useSession\(/);
});

test("ProjectsSection controla um menu e integra o drawer fora do map", () => {
  assert.match(sectionSource, /actionsOpenSlug/);
  assert.match(
    sectionSource,
    /setActionsOpenSlug\(open \? project\.slug : null\)/,
  );
  assert.match(sectionSource, /<ProjectMetadataPanel/);
  assert.match(sectionSource, /open=\{Boolean\(editingProject\)\}/);
  assert.match(sectionSource, /onProjectUpdated\(updatedProject\)/);

  const panelIndex = sectionSource.indexOf("<ProjectMetadataPanel");
  const mapIndex = sectionSource.indexOf("filteredProjects.map");
  assert.ok(panelIndex > mapIndex);
});

test("seção fecha menu e painel ao trocar seção ou ocultar projeto", () => {
  assert.match(
    sectionSource,
    /setActionsOpenSlug\(null\);\s*setEditingProject\(null\);\s*\}, \[section\]\)/,
  );
  assert.match(sectionSource, /!filteredProjects\.some\(/);
  assert.match(sectionSource, /setEditingProject\(null\)/);
});

test("gate de thumbnails permanece preservado", () => {
  assert.match(sectionSource, /settledThumbnailKeys/);
  assert.match(sectionSource, /visibleThumbnailKeys/);
  assert.match(sectionSource, /allVisibleThumbnailsSettled/);
  assert.match(sectionSource, /holdThumbnailShimmer=\{thumbnailsPending\}/);
  assert.match(sectionSource, /onThumbnailSettled=\{handleThumbnailSettled\}/);
});

test("drawer consulta metadados atuais e edita somente título e descrição", () => {
  assert.match(panelSource, /fetchProjectMetadata\(project\.slug/);
  assert.match(panelSource, /updateProjectMetadata\(metadata\.slug/);
  assert.match(panelSource, /name="name"/);
  assert.match(panelSource, /name="description"/);
  assert.match(panelSource, /metadataVersion:\s*metadata\.metadataVersion/);
  assert.doesNotMatch(panelSource, /name="slug"/);
  assert.doesNotMatch(panelSource, /name="organization/);
  assert.doesNotMatch(panelSource, /name="createdBy"/);
});

test("drawer possui estados, dialog modal e trap de foco", () => {
  for (const state of [
    "closed",
    "loading",
    "ready",
    "saving",
    "success",
    "conflict",
    "error",
  ]) {
    assert.match(panelSource, new RegExp(`"${state}"`));
  }

  assert.match(panelSource, /role="dialog"/);
  assert.match(panelSource, /aria-modal="true"/);
  assert.match(panelSource, /FOCUSABLE_SELECTOR/);
  assert.match(panelSource, /event\.key !== "Tab"/);
  assert.match(panelSource, /event\.key === "Escape"/);
  assert.match(panelSource, /returnFocusRef/);
});

test("drawer protege alterações não salvas", () => {
  assert.match(panelSource, /Descartar as alterações não salvas/);
  assert.match(panelSource, /window\.confirm/);
  assert.match(panelSource, /dirty/);
});

test("conflito não sobrescreve e oferece carregar versão atual", () => {
  assert.match(panelSource, /error\.status === 409/);
  assert.match(panelSource, /setConflictProject\(error\.currentProject\)/);
  assert.match(panelSource, />\s*Carregar versão atual\s*</);
  assert.match(panelSource, /loadConflictVersion/);
});

test("salvar atualiza o card e fecha após sucesso", () => {
  assert.match(panelSource, /onUpdated\(updated\)/);
  assert.match(panelSource, /setStatus\("success"\)/);
  assert.match(panelSource, /window\.setTimeout/);
  assert.match(panelSource, /onClose\(\)/);
});

test("CSS posiciona ações e mantém contraste", () => {
  assert.match(cardsCssSource, /\.mm-project-card__actions/);
  assert.match(cardsCssSource, /\.mm-project-card__more/);
  assert.match(cardsCssSource, /\.mm-project-card__creator/);
  assert.match(cardsCssSource, /min-width:\s*48px/);
  assert.match(cardsCssSource, /background:\s*#09111a/);
  assert.match(cardsCssSource, /focus-visible/);
});

test("CSS do drawer é responsivo e evita overflow horizontal", () => {
  assert.match(panelCssSource, /z-index:\s*12000/);
  assert.match(panelCssSource, /width:\s*min\(480px,\s*92vw\)/);
  assert.match(panelCssSource, /height:\s*100dvh/);
  assert.match(panelCssSource, /overflow-x:\s*hidden/);
  assert.match(panelCssSource, /overflow-y:\s*auto/);
  assert.match(panelCssSource, /@media \(max-width:\s*767px\)/);
  assert.match(panelCssSource, /width:\s*100%/);
  assert.match(panelCssSource, /prefers-reduced-motion/);
});
