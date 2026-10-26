import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMaonoSelect} from './helpers/maono-select-preservation.mjs';
import {restoreTicketKanbanSnapshot} from './helpers/ticket-kanban-snapshot-preservation.mjs';
import {restoreTicketRefreshFocus,restoreTicketRefreshFocusStyles} from './helpers/ticket-refresh-focus-preservation.mjs';
import {restoreDocumentProgressiveLoading,restoreTicketDetailProgressiveLoading,restoreTicketDocumentInitialPresentation} from './helpers/ticket-docs-progressive-preservation.mjs';
const cases=[
  {file:'DocumentsSection',restore:restoreDocumentProgressiveLoading,hash:'736bc1aba68b30ffd0250ccea8f69e70b3a488e6e4e12d4f0b2d4b276814b627',canaries:[['PERMISSION.DOCUMENT_VIEW','PERMISSION.DOCUMENT_UPLOAD'],['listOrganizationFiles(','listAllOrganizationFiles('],['limit: 50','limit: 500'],['formData,','new FormData(),'],['<option value="root">Raiz</option>','<option value="">Raiz</option>']]},
  {file:'TicketDetailDrawer',restore:restoreTicketDetailProgressiveLoading,hash:'a0c19fa754c8891256c7e1d6cd39260636949016211ac79bc799c66f0a3c4778',canaries:[['{canManage ? (','{true ? ('],['onUpdate,','onDelete,'],['ticket.status','ticket.priority'],['attachmentLimits={attachmentLimits}','attachmentLimits={{}}']]},
];
test('Kanban scheduling inverse rejects token/guard drift and preserves unrelated ACL changes',()=>{
 const source=readFileSync(new URL('../src/pages/Projects/components/TicketKanbanBoard.tsx',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 for(const [from,to] of [['if (sharedSnapshot)', 'if (true)'],['if (epoch !== generation.current || requestRevision !== latestRevision.current || pending.current) return;','if (pending.current) return;'],['load(queue, false, sharedSnapshot,','load(queue, false, null,']]){
  assert.ok(source.includes(from));assert.throws(()=>restoreTicketKanbanSnapshot(source.replace(from,to)));
 }
 assert.throws(()=>restoreTicketKanbanSnapshot(source+source));
 assert.notEqual(restoreTicketKanbanSnapshot(source.replace('failure.status === 404','failure.status === 500')),restoreTicketKanbanSnapshot(source));
});
test('refresh focus inverse rejects an altered activation guard and retains unrelated drift',()=>{
 const source=readFileSync(new URL('../src/pages/Projects/components/TicketDetailDrawer.tsx',import.meta.url),'utf8');
 assert.throws(()=>restoreTicketRefreshFocus(source.replace('if (!loading && !saving) onReload();','onReload();')));
 assert.throws(()=>restoreTicketRefreshFocus(source+source));
 const changed=source.replace('{canManage ? (','{true ? (');
 assert.notEqual(restoreTicketRefreshFocus(changed),restoreTicketRefreshFocus(source));
 const styles=readFileSync(new URL('../src/pages/Projects/projects.css',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 assert.throws(()=>restoreTicketRefreshFocusStyles(styles.replace('.ticket-secondary-action[aria-disabled="true"],','.ticket-secondary-action[aria-disabled="false"],')));
 assert.notEqual(restoreTicketRefreshFocusStyles(styles.replace('opacity: 0.48;','opacity: 1;')),restoreTicketRefreshFocusStyles(styles));
});
for(const {file,restore,hash,canaries} of cases){
 const source=readFileSync(new URL(`../src/pages/Projects/components/${file}.tsx`,import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const check=input=>assert.equal(createHash('sha256').update(restoreMaonoSelect(restore(input))).digest('hex'),hash);
 test(`${file}: exact inverse keeps independent original full-source hash`,()=>check(source));
 test(`${file}: permission/API/payload/options mutation canaries are rejected`,()=>{
  for(const [from,to] of canaries){ assert.ok(source.includes(from),`canary present: ${from}`); assert.throws(()=>check(source.replace(from,to)),`must reject ${from}`); }
 });
 test(`${file}: duplicate approved loading source is rejected rather than excluded`,()=>assert.throws(()=>restore(source+source)));
}

// Full files captured from baf3637 before the authorized staged-presentation edits.
const initialBaselines = {
  "DocumentsPagination": "6e510e16442de14eab763c1ce3876f1b6c660318e7905024227df63f54845dc4",
  "DocumentsSection": "d88883339a85ee163322993e6750232b04549c534f5b321234a3261cdc370926",
  "DocumentsUi": "4c798d99d75a8078f21d5ff2c7e032b40c314068d9bc36c870311e13846a773a",
  "TicketCalendarView": "ab9d45bfa8ae7bc6a7a83c9f3a9a64b5844aa42cfaad297bce014fdd1836be9e",
  "TicketDetailDrawer": "19fe24f54bbb82d3f06eacc20e0d905f9033d2c3b14add8f67623b8fe6860d25",
  "TicketKanbanBoard": "5c66ebfdb3cf7e12fa0aa6c7e98e7e5e36708f2f2e5a4fa4aca4f7693bd5cc8b",
  "TicketKanbanView": "d0daa2afaa757ae992c8133460b9f40fbd761247aad84e0bbc0f847dec221515",
  "TicketListView": "e9f1e580ea6c2acf42ab5a650e3ec4ccc4bdd76075f457ef8a4bcf51155edce4",
  "TicketLoadingSkeletons": "2bef7272b7dbc6c0d852ae22f93abb6d5ccaf0042c3e42b32f833daa9e2e96e8",
  "TicketsSection": "0d588a5adf753a39cb3269478ceba91cab74b4a66864f51fcad3c4dc9fafae7c",
  "TicketsToolbar": "d3162e59800a2d7d7fc0806cfa824e1aca6504f2bdd6f5e52d9e504f543d3194"
};
const stageCanaries = {
 DocumentsPagination: ['onPageSize(Number(event.target.value))', 'onPageSize(500)'],
 DocumentsSection: ['PERMISSION.DOCUMENT_VIEW', 'PERMISSION.DOCUMENT_UPLOAD'],
 DocumentsUi: ['onClick={() => onSort(nextSort)}', 'onClick={() => onSort("name_desc")}'],
 TicketCalendarView: ['onRangeChange(nextRange.from,nextRange.to)', 'onRangeChange(nextRange.to,nextRange.from)'],
 TicketDetailDrawer: ['{canManage ? (', '{true ? ('],
 TicketKanbanBoard: ['limit: 25', 'limit: 500'],
 TicketKanbanView: ['if (!canManage) return;', 'if (false) return;'],
 TicketListView: ['onClick={() => onOpen(ticket)}', 'onClick={() => onOpen(null)}'],
 TicketLoadingSkeletons: ['triageEnabled ? "Domínio afetado" : "Categoria"', 'triageEnabled ? "Categoria" : "Domínio afetado"'],
 TicketsSection: ['PERMISSION.TICKET_VIEW', 'PERMISSION.TICKET_CREATE'],
 TicketsToolbar: ['onFiltersChange({ ...filters, [key]: value })', 'onFiltersChange({ ...filters })'],
};
for (const [name, hash] of Object.entries(initialBaselines)) {
 const source = readFileSync(new URL(`../src/pages/Projects/components/${name}.tsx`,import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const check = input => assert.equal(createHash('sha256').update(restoreTicketDocumentInitialPresentation(input,name)).digest('hex'),hash);
 test(`${name}: staged presentation reverses to its exact independent pre-change baseline`, () => check(source));
 test(`${name}: initial presentation inverse rejects domain mutations and duplicate source`, () => {
  const [from,to] = stageCanaries[name]; assert.ok(source.includes(from),from);
  assert.throws(() => check(source.replace(from,to)));
  assert.throws(() => check(source + source));
 });
}
