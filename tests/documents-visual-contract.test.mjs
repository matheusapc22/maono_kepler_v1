import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/pages/Projects/components/DocumentsSection.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pages/Projects/components/DocumentsSection.css', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../src/pages/Projects/components/DocumentsUi.tsx', import.meta.url), 'utf8');
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
  for (const name of ['mm-docs-header','mm-docs-folder-grid','mm-docs-breadcrumb','mm-docs-filters','mm-docs-results','mm-docs-table-scroll','mm-docs-view-mode','mm-docs-page-controls','mm-docs-file-grid','mm-docs-dialog']) assert.ok(component.includes(name));
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
  for (const token of ['pagination.hasMore && pagination.nextCursor','permanentPurgeEnabled && canManage && canDelete','EXCLUIR PERMANENTEMENTE','canUpload && documentState === "active"','disabled={busy || expired}','limit: 50','MAX_FILE_BYTES = 50 * 1024 * 1024','Itens por página','Visualização em grade','directFolders']) assert.ok(component.includes(token), token);
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
  const actions = component.slice(component.indexOf('function ActiveDocumentActions('), component.indexOf('function DocumentFileMoveDialog('));
  assert.equal((actions.match(/<DocumentActionMenu/g) || []).length, 1);
  for (const label of ['Renomear', 'Baixar', 'Mover', 'Excluir']) assert.ok(actions.includes(`label: "${label}"`));
  assert.ok(!actions.includes('<select'));
  assert.ok(!actions.includes('<button'));
  assert.ok(component.includes('renameOrganizationFile(organizationId, file.id, name.trim())'));
  assert.ok(component.includes('dialog?.showModal()'));
});


test('file move restores focus after native modal teardown without stealing a newer focus', () => {
  const dialog = component.slice(component.indexOf('function DocumentFileMoveDialog('), component.indexOf('function ActiveDocumentsResults('));
  assert.ok(dialog.includes('useLayoutEffect(() => {'));
  assert.ok(!dialog.includes('useEffect(() => {'));
  assert.ok(dialog.includes('dialog?.close()'));
  assert.ok(dialog.includes('window.setTimeout(() => {'));
  assert.ok(dialog.includes('active !== document.body && active.isConnected'));
  assert.ok(dialog.includes('previousFocus?.isConnected'));
  assert.ok(dialog.includes('focusTarget?.focus({ preventScroll: true })'));
  assert.ok(!dialog.includes('<select autoFocus'));
  assert.ok(dialog.indexOf('dialog?.showModal()') < dialog.indexOf('dialog?.querySelector<HTMLSelectElement>("select")?.focus'));
});
