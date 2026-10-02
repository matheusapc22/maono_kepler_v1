import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const component = readFileSync(new URL('../src/pages/Projects/components/DocumentsSection.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pages/Projects/components/DocumentsSection.css', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../src/pages/Projects/components/DocumentsUi.tsx', import.meta.url), 'utf8');
const transfer = readFileSync(new URL('../src/pages/Projects/components/DocumentsTransferPanel.css', import.meta.url), 'utf8');

test('business prefix is unchanged; only presentation imports are added', () => {
  const end = component.indexOf('  if (!organizationId || !canView) {\n    return <section');
  assert.ok(end > 0);
  const prefix = component.slice(0, end).replace('import "./DocumentsSection.css";\n', '').replace('import { DocumentActionMenu, DocumentIcon } from "./DocumentsUi";\n', '');
  assert.equal(createHash('sha256').update(prefix).digest('hex'), '126eb4eddd554717f51acc5fe1ff9cf1b7f48a6b00d8a84f2b77851f8cc9ea58');
});
test('workspace includes real structural blocks, not generated-content headings', () => {
  for (const name of ['mm-docs-header','mm-docs-folder-grid','mm-docs-filters','mm-docs-results','mm-docs-table-scroll','mm-docs-view-mode','mm-docs-page-controls','mm-docs-file-grid']) assert.ok(component.includes(name));
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
test('virtual folders do not receive action menus and lineage stays explicit', () => {
  const first = component.slice(component.indexOf('<nav className="mm-docs-folder-grid"'), component.indexOf('{foldersLoading ?'));
  assert.ok(!first.includes('DocumentActionMenu'));
  assert.match(component, /const folderPath = \(id: string\) =>/);
  assert.match(component, /documentFolderBreadcrumb\(folders,\s*id\)/);
  assert.ok(component.includes('aria-pressed='));
});
test('menu supports portal, keyboard, focus return and outside dismissal', () => {
  for (const token of ['createPortal','aria-haspopup="menu"','role="menuitem"','ArrowDown','ArrowUp','Escape','Tab','Home','End','pointerdown','trigger.current?.focus()']) assert.ok(menu.includes(token), token);
});
test('transfer file owns only transfer/feedback presentation', () => {
  assert.ok(!transfer.includes('.documents-filter'));
  assert.ok(!transfer.includes('.documents-table'));
  for (const token of ['mm-transfer-panel','mm-document-feedback','mm-transfer-progress','prefers-reduced-motion']) assert.ok(transfer.includes(token));
});
