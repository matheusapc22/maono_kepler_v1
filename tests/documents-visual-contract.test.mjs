import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/pages/Projects/components/DocumentsSection.tsx', import.meta.url), 'utf8');
const pagination = readFileSync(new URL('../src/pages/Projects/components/DocumentsPagination.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pages/Projects/components/DocumentsSection.css', import.meta.url), 'utf8');
const densityCss = readFileSync(new URL('../src/platform-density.css', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../src/pages/Projects/components/DocumentsUi.tsx', import.meta.url), 'utf8');
const dialogs = readFileSync(new URL('../src/pages/Projects/components/DocumentActionDialogs.tsx', import.meta.url), 'utf8');
const dialogCss = readFileSync(new URL('../src/pages/Projects/components/DocumentActionDialogs.css', import.meta.url), 'utf8');
const transfer = readFileSync(new URL('../src/pages/Projects/components/DocumentsTransferPanel.css', import.meta.url), 'utf8');

test('controller preserves existing document lifecycles and declares folder move explicitly', () => {
  for (const token of [
    'async function handleUpload(',
    'uploadOrganizationFileWithProgress(',
    'async function handleDownload(',
    'downloadOrganizationFileWithProgress(',
    'async function handleDelete(',
    'deleteOrganizationFile(',
    'async function handlePermanentPurge(',
    'purgeOrganizationFilePermanently(',
    'async function handleRestore(',
    'restoreOrganizationFile(',
    'async function handleMoveFile(',
    'moveOrganizationFileToFolder(',
    'function applyDocumentFilters(',
    'function clearDocumentFilters(',
    'function removeDocumentFilter(',
    'function loadMoreDocuments(',
    'pagination.hasMore && pagination.nextCursor',
  ]) assert.ok(component.includes(token), token);

  assert.ok(component.includes('function beginMoveFolder('));
  assert.ok(component.includes('async function handleMoveFolder('));
  assert.ok(component.includes('updateOrganizationDocumentFolder(organizationId, folder.id'));
  assert.ok(component.includes('parentId: targetParentId === "root" ? null : targetParentId'));
});
test('workspace includes real structural blocks, not generated-content headings', () => {
  for (const name of ['mm-docs-header','mm-docs-folder-grid','mm-docs-breadcrumb','mm-docs-filters','mm-docs-results','mm-docs-table-scroll','mm-docs-view-mode','mm-docs-file-grid']) assert.ok(component.includes(name));
  assert.ok(component.includes('Buscar e filtrar'));
  assert.ok(component.includes('Documentos encontrados'));
  assert.ok(!component.includes('role="tree"'));
});
test('stylesheet is scoped and adds no important, universal field sizing or zoom', () => {
  assert.ok(!css.includes('!important'));
  assert.ok(!/\bzoom\s*:/.test(css));
  assert.ok(!/^\s*(?:body|html|:root|input|select|button)\b/m.test(css));
  assert.ok(css.includes('@container'));
  assert.ok(css.includes('forced-colors'));
  assert.ok(css.includes('prefers-reduced-motion'));
});
test('cursor, permission and purge contracts remain in the real component', () => {
  for (const token of ['pagination.hasMore && pagination.nextCursor','permanentPurgeEnabled && canManage && canDelete','EXCLUIR PERMANENTEMENTE','canUpload && documentState === "active"','disabled={busy || expired}','limit: 50','MAX_FILE_BYTES = 50 * 1024 * 1024','Visualização em grade','directFolders']) assert.ok(component.includes(token), token);
  assert.ok(!component.includes('type="checkbox"'));
});
test('folder navigation omits virtual cards and lineage stays explicit', () => {
  const first = component.slice(component.indexOf('<nav className="mm-docs-folder-grid documents-folder-tree"'), component.indexOf('{foldersLoading ?'));
  assert.ok(!first.includes('DocumentActionMenu'));
  assert.match(component, /const folderPath = \(id: string\) =>/);
  assert.match(component, /documentFolderBreadcrumb\(folders,\s*id\)/);
  assert.ok(component.includes('aria-pressed='));
  assert.ok(component.includes('{ label: "Mover pasta"'));
  assert.ok(component.includes('aria-current={browsedFolderId === "root" ? "page" : undefined}'));
  assert.ok(!first.includes('Todos os documentos'));
  assert.ok(!first.includes('mm-docs-folder-select'));
});
test('menu supports portal, keyboard, focus return and outside dismissal', () => {
  for (const token of ['createPortal','aria-haspopup="menu"','role="menuitem"','ArrowDown','ArrowUp','Escape','Tab','Home','End','pointerdown']) assert.ok(menu.includes(token), token);
  assert.match(menu, /scheduleFocus\(trigger\.current\)/);
  assert.match(menu, /target\?\.isConnected\) target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(menu, /window\.clearTimeout\(focusTimer\.current\)/);
});
test('transfer file owns only transfer/feedback presentation', () => {
  assert.ok(!transfer.includes('.documents-filter'));
  assert.ok(!transfer.includes('.documents-table'));
  for (const token of ['mm-transfer-panel','mm-document-feedback','mm-transfer-progress','prefers-reduced-motion']) assert.ok(transfer.includes(token));
});


test('root is default, all documents is a list filter, and file actions live only in the menu', () => {
  assert.ok(component.includes('const [browsedFolderId, setBrowsedFolderId] = useState("root")'));
  assert.ok(component.includes('<option value="">Todos os documentos</option>'));
  assert.ok(component.includes('documents-file-origin'));
  assert.ok(component.includes('folderOrigin={props.folderOrigin?.(file)}'));
  assert.ok(component.includes('if (next.folderId) setBrowsedFolderId(next.folderId)'));
  assert.ok(component.includes('folderId: state === "active" ? filters.folderId || undefined : undefined'));
  const actions = component.slice(component.indexOf('function ActiveDocumentActions('), component.indexOf('function ActiveDocumentsResults('));
  assert.equal((actions.match(/<DocumentActionMenu/g) || []).length, 1);
  for (const label of ['Renomear', 'Baixar', 'Mover', 'Excluir']) assert.ok(actions.includes(`label: "${label}"`));
  assert.ok(!actions.includes('<select'));
  assert.ok(!actions.includes('<button'));
  assert.ok(component.includes('renameOrganizationFile(organizationId, file.id,'));
  assert.ok(component.includes('<DocumentNameDialog'));
  assert.ok(component.includes('<DocumentMoveDialog'));
  assert.ok(!component.includes('function DocumentFileMoveDialog('));
});


test('all document action modals share a native top-layer lifecycle and safe focus restoration', () => {
  for (const token of ['<dialog ref={dialogRef}', 'dialog?.showModal()', 'useLayoutEffect(() => {', 'dialog?.close()', 'window.setTimeout(() => {', 'active !== document.body && active.isConnected', 'previousFocus?.isConnected', 'focusTarget?.focus({ preventScroll: true })', 'onCancel=', 'event.key !== "Tab"', 'event.shiftKey']) assert.ok(dialogs.includes(token), token);
  assert.ok(!dialogs.includes('autoFocus='));
  assert.ok(dialogs.indexOf('dialog?.showModal()') < dialogs.indexOf('input?.focus({ preventScroll: true })'));
  assert.ok(!component.includes('role="dialog"'));
  assert.ok(!component.includes('Novo nome do documento (mantenha a extensão)'));
  assert.ok(!component.includes('Nome da nova pasta:'));
});

test('rename isolates the immutable extension and dialog mutation state prevents double-submit', () => {
  for (const token of ['name.lastIndexOf(".")', 'dot > 0 && dot < name.length - 1', 'trimmed + original.extension', 'Nome do documento', 'Nome da pasta', 'mm-docs-name-extension', 'Extensão fixa:', 'Sem extensão', 'input.select()', 'inFlight.current', 'role="alert"', 'disabled={busy}', 'pendingLabel', 'await onSubmit(']) assert.ok(dialogs.includes(token), token);
  assert.ok(dialogs.includes('document.activeElement'));
  assert.ok(dialogs.includes('error ?'));
  assert.ok(dialogs.includes('aria-invalid={Boolean(error)}'));
});

test('move browser uses real organization-owned folders, ancestry and session-scoped recents', () => {
  for (const token of ['String(folder.organizationId) === organizationId', 'seen.has(id)', 'if (!current) return []', 'node.path.some(', 'selectedId !== currentParentId', 'eligibleIds.has(selectedId)', 'node.parentId === browsedId', 'Sugestões', 'Recentes', 'Todas as pastas', 'Buscar pastas', 'Caminho do destino', 'Destino:', 'role="tablist"', 'role="tabpanel"', 'sessionStorage.getItem', 'sessionStorage.setItem', 'encodeURIComponent(String(userId))', 'encodeURIComponent(String(organizationId))']) assert.ok(dialogs.includes(token), token);
  assert.ok(!dialogs.includes('<select'));
  assert.ok(!dialogs.includes('Todos os documentos'));
  assert.ok(dialogs.includes('Nenhuma pasta encontrada.'));
  const enter = dialogs.slice(dialogs.indexOf('function enter('), dialogs.indexOf('function changeTab('));
  assert.ok(enter.includes('document.getElementById(searchId)?.focus({ preventScroll: true })'));
  assert.ok(enter.indexOf('?.focus(') < enter.indexOf('setBrowsedId('), 'focus stable search before replacing destination rows');
});

test('modal geometry is viewport centered, responsive and independent of the content panel', () => {
  for (const token of ['position: fixed', 'inset: 0', 'margin: auto', 'calc(100vw - 32px)', 'calc(100dvh - 32px)', '::backdrop', 'prefers-reduced-motion', 'forced-colors']) assert.ok(dialogCss.includes(token), token);
  assert.ok(!dialogCss.includes('!important'));
  assert.ok(!/\bzoom\s*:/.test(dialogCss));
  assert.ok(!/^\s*(?:body|html|:root|input|select|button)\b/m.test(dialogCss));
  assert.ok(!dialogCss.includes('translate('));
});

test('sortable headings keep accessible next actions and show visual tooltips only on mouse hover', () => {
  const heading = menu.slice(menu.indexOf('export function DocumentSortHeading('));
  for (const token of ['<th scope="col"', 'aria-sort=', '<button ref={trigger} type="button"', 'aria-label={`${label}: ${nextLabel}`}', 'aria-describedby=', 'role="tooltip"', 'createPortal', 'aria-hidden="true"', 'onClick={() => onSort(nextSort)}']) assert.ok(heading.includes(token), token);
  for (const text of ['Classificar de A a Z', 'Classificar de Z a A', 'Classificar de menores para maiores', 'Classificar de maiores para menores', 'Classificar de mais antigas primeiro', 'Classificar de mais recentes primeiro']) assert.ok(heading.includes(text), text);
  assert.ok(!/\btitle=/.test(heading));
  assert.ok(heading.includes('column !== "updated"'));
  assert.ok(heading.includes('window.visualViewport'));
  assert.ok(heading.includes('Math.max(leftEdge, Math.min('));
  assert.ok(heading.includes('event.key === "Escape"'));
  assert.ok(heading.includes('const open = hovered && !dismissed'));
  assert.ok(heading.includes('setHovered(event.pointerType === "mouse")'));
  assert.ok(heading.includes('onPointerLeave={() => setHovered(false)}'));
  assert.ok(heading.includes('onPointerCancel={() => setHovered(false)}'));
  assert.ok(!heading.includes('onFocus='));
  assert.ok(!heading.includes('hoverTimer'));
  assert.ok(css.includes('.mm-docs-sort-button.is-active { color: var(--maono-accent-bright); }'));
  assert.ok(css.includes('th.mm-docs-sort-heading.is-name { text-align: center; }'));
  assert.ok(css.includes('max-width: calc(100vw - 16px)'));
});

test('sort changes use the full server query and reset pages without remounting the view', () => {
  const handler = component.slice(component.indexOf('function sortDocuments('), component.indexOf('function loadMoreDocuments('));
  assert.ok(handler.includes('setFilterDraft(current => ({ ...current, sort }))'));
  assert.ok(handler.includes('setAppliedFilters(current => ({ ...current, sort }))'));
  assert.ok(!handler.includes('.sort('));
  assert.ok(!handler.includes('setFiles([])'));
  assert.match(component, /<ActiveDocumentsResults\s+queryKey=\{resultsKey\}/);
  const results = component.slice(component.indexOf('function ActiveDocumentsResults('), component.indexOf('function documentFolderDescendantIds('));
  assert.match(results, /useLayoutEffect\(\(\) => \{\s*setPageIndex\(0\);\s*setPendingNext\(false\);\s*\}, \[queryKey\]\)/);
  assert.ok(results.includes('Documentos encontrados</h3>'));
  assert.ok(!results.includes('${pagination.total} documento'));
  assert.ok(results.includes('`Exibindo ${visibleFiles.length}/${pagination.total}.`'));
  assert.ok(results.includes('files.slice(start, start + pageSize)'));
  assert.ok(results.includes('DOCUMENT_SORT_COLUMNS.map('));
  assert.ok(results.includes('<th scope="col">Ações</th>'));
  assert.ok(results.includes('if (error && !loadingMore) setPendingNext(false)'));
  assert.ok(results.includes('const displayedSort = sortFailed ? pagination.sort : sort'));
  assert.ok(results.includes('pagination.sort === sort'));
  assert.ok(results.includes('Tentar ordenar novamente'));
});


test('document titles omit the duplicate folder icon in normal and unavailable-access views', () => {
  const headings = [...component.matchAll(/<div className="mm-docs-heading">([\s\S]*?)<\/div><\/div>/g)];
  assert.equal(headings.length, 2, 'normal and no-organization/denied-access titles');
  for (const [, heading] of headings) {
    assert.ok(heading.includes('Arquivos e Documentos'));
    assert.ok(!heading.includes('DocumentIcon'), 'no decorative duplicate before the title');
  }
  assert.match(component, /<div className="mm-docs-panel-title"><DocumentIcon name="folder" \/><div><h3 id="mm-docs-folders-title">Pastas<\/h3>/);
  assert.match(component, /className="mm-docs-folder-select"[^>]*onClick=\{\(\) => selectFolder\(String\(folder.id\)\)\}><DocumentIcon name="folder" \/>/);
  assert.ok(!css.includes('.mm-docs-heading > .mm-docs-icon'), 'no obsolete desktop/mobile icon slot');
  assert.ok(!densityCss.includes('.mm-docs-heading'), 'density overrides do not reserve space for the removed icon');
  assert.match(css, /\.mm-docs \.mm-docs-heading \{ min-width: 0; \}/);
});


test('Documents, Central and Roadmap use one unchanged pagination presentation with the real count supplied by each controller', () => {
  assert.ok(component.includes('<DocumentsPagination status={'));
  for (const token of ['mm-docs-page-controls', 'Itens por página', 'value={10}', 'value={25}', 'value={50}', 'Página anterior', 'Próxima página', 'aria-current="page"']) assert.ok(pagination.includes(token), token);
  assert.ok(css.includes(':is(.mm-docs, .ticket-center-shell, .roadmap-workspace, .users-access-workspace) .mm-docs-pagination'));
  const roadmap = readFileSync(new URL('../src/pages/Projects/components/RoadmapSection.tsx', import.meta.url), 'utf8');
  assert.ok(roadmap.includes('<DocumentsPagination'));
  assert.ok(roadmap.includes('Exibindo ${page.tasks.length}/${page.total}.'));
});

test('only screenshot-marked helper paragraphs disappear; headings and state guidance stay', () => {
  for (const helper of [
    'Organize, armazene e compartilhe os documentos do seu projeto em um só lugar.',
    'Organize seus documentos em pastas para facilitar o acesso e a gestão.',
    'Encontre documentos rapidamente usando os filtros abaixo.',
  ]) assert.ok(!component.includes(helper), helper);
  for (const heading of [
    '<h2 id="mm-docs-title">Arquivos e Documentos</h2></div>',
    '<h3 id="mm-docs-folders-title">Pastas</h3></div>',
    '<h3 id="mm-docs-filter-title">Buscar e filtrar</h3></div>',
  ]) assert.ok(component.includes(heading), 'no empty helper element or spacer after the retained heading');
  assert.ok(component.includes('<DocumentIcon name="folder" /><div><h3 id="mm-docs-folders-title">'));
  for (const guidance of ['Selecione uma organização.', 'Acesso não permitido.', 'Carregando documentos...', 'A consulta precisa de atenção.', 'itens na Lixeira']) assert.ok(component.includes(guidance), guidance);
});
