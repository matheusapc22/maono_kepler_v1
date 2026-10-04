import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(`src/pages/Projects/components/${name}`, root), 'utf8');
const directory = mkdtempSync(new URL('../.ticket-docs-loading-test-', import.meta.url).pathname);
const bundle = await build({ stdin: { contents: `
import {renderToStaticMarkup} from 'react-dom/server';
import TicketListView from './TicketListView';
import TicketKanbanView from './TicketKanbanView';
import TicketCalendarView from './TicketCalendarView';
import {ActiveDocumentsResults} from './DocumentsSection';
import {TicketDetailSkeleton,DocumentGridSkeleton} from './TicketLoadingSkeletons';
export const renderList=p=>renderToStaticMarkup(<TicketListView {...p}/>);
export const renderBoard=p=>renderToStaticMarkup(<TicketKanbanView {...p}/>);
export const renderCalendar=p=>renderToStaticMarkup(<TicketCalendarView {...p}/>);
export const renderDocuments=p=>renderToStaticMarkup(<ActiveDocumentsResults {...p}/>);
export const renderDetail=()=>renderToStaticMarkup(<TicketDetailSkeleton/>);
export const renderGrid=p=>renderToStaticMarkup(<DocumentGridSkeleton {...p}/>);
`, resolveDir: new URL('src/pages/Projects/components/',root).pathname, loader:'tsx' }, bundle:true, platform:'node', format:'esm', jsx:'automatic',write:false, loader:{'.css':'empty','.png':'dataurl'}, external:['react','react-dom','react-dom/server','react/jsx-runtime'], plugins:[{name:'test-document-results',setup(builder){builder.onLoad({filter:/\/DocumentsSection\.tsx$/},({path})=>({contents:readFileSync(path,'utf8')+'\nexport { ActiveDocumentsResults };',loader:'tsx'}));}}] });
let runtime;
try { const path=join(directory,'render.mjs'); writeFileSync(path,bundle.outputFiles[0].text); runtime=await import(path); } finally { rmSync(directory,{recursive:true}); }
const noop=()=>{};
const ticket={id:1,code:'CC-1',subject:'Chamado preservado',description:'Descrição',priority:'normal',status:'open',createdBy:{name:'Pessoa'},assignedTo:{name:'Atendente'},createdAt:'2026-10-01',updatedAt:'2026-10-01',dueAt:'2026-10-18',attachmentsCount:0};
const pagination={page:1,total:30,hasMore:true,totalPages:3,limit:10};
const listProps={tickets:[],pagination:{...pagination,total:0},busyTicketIds:new Set(),selectionScope:'one',pageSize:10,loading:true,initialLoading:true,error:false,canCreate:true,onNewTicket:noop,onOpen:noop,onPageChange:noop,onPageSizeChange:noop,onRefresh:noop,onExport:noop};
const documentProps={queryKey:'one',sort:'updated_desc',onSort:noop,files:[],pagination:{total:0,hasMore:false,sort:'updated_desc'},initialLoading:true,refreshing:false,loadingMore:false,error:null,hasActiveFilters:false,busyFileId:null,transferBusy:false,canManage:false,canDownload:false,canDelete:false,onRename:noop,onMove:noop,onDownload:noop,onDelete:noop,onLoadMore:noop};
const file={id:1,name:'Documento preservado.pdf',fileType:'pdf',size:1024,createdAt:'2026-10-01',updatedAt:'2026-10-01'};
const queues=['open','in_progress','in_review','closed'];
const boardProps={tickets:[],totals:{new:0,open:0,in_progress:0,in_review:0,closed:0},hasMore:false,loading:false,onLoadMore:noop,canManage:false,busyTicketIds:new Set(),onOpen:noop,onStatusChange:noop};

test('ticket initial table retains genuine headers and footer without fabricating an empty result',()=>{
  const html=runtime.renderList(listProps);
  for(const label of ['Lista de chamados','Código','Assunto','Prioridade','Situação','Atendente','Última atualização','Itens por página']) assert.ok(html.includes(label),label);
  assert.match(html,/aria-busy="true"/); assert.match(html,/mm-loading-table-row is-ticket/);
  assert.doesNotMatch(html,/Exibindo 0\/0|Nenhum chamado encontrado/);
  assert.equal((html.match(/Carregando chamados\./g)||[]).length,1);
  assert.ok(html.indexOf('Carregando chamados.')>html.indexOf('</table>'));
  const few=runtime.renderList({...listProps,pageSize:2});
  assert.equal((few.match(/mm-loading-table-row is-ticket/g)||[]).length,2);
});
test('ticket cached refresh retains rows and errors/empty results have no residual skeleton',()=>{
  const refreshing=runtime.renderList({...listProps,tickets:[ticket],pagination,initialLoading:false});
  assert.ok(refreshing.includes(ticket.subject)); assert.doesNotMatch(refreshing,/mm-skeleton/);
  const error=runtime.renderList({...listProps,loading:false,initialLoading:false,error:true});
  assert.doesNotMatch(error,/mm-skeleton|Nenhum chamado encontrado|Exibindo 0\/0/);
  assert.ok(runtime.renderList({...listProps,loading:false,initialLoading:false}).includes('Nenhum chamado encontrado'));
});
test('document pending list reserves real columns and pagination, and expansion retains settled rows',()=>{
  const pending=runtime.renderDocuments(documentProps);
  for(const label of ['Documentos encontrados','Nome','Tipo','Tamanho','Atualizado em','Ações','Itens por página']) assert.ok(pending.includes(label),label);
  assert.doesNotMatch(pending,/Exibindo 0\/0|Nenhum documento\./);
  const cached=runtime.renderDocuments({...documentProps,initialLoading:false,refreshing:true,files:[file],pagination:{...documentProps.pagination,total:12}});
  assert.ok(cached.includes(file.name)); assert.doesNotMatch(cached,/mm-skeleton/);
  const more=runtime.renderDocuments({...documentProps,initialLoading:false,loadingMore:true,files:[file],pagination:{...documentProps.pagination,total:12}});
  assert.ok(more.indexOf(file.name)<more.indexOf('mm-loading-table-row'));
  const failed=runtime.renderDocuments({...documentProps,initialLoading:false,error:'Falha'});
  assert.doesNotMatch(failed,/mm-skeleton|Nenhum documento\.|Exibindo 0\/0/);
});
test('document grid uses file identities and metadata cards, never a generic table',()=>{
  const html=runtime.renderGrid({count:3});
  assert.equal((html.match(/mm-loading-document-card/g)||[]).length,3);
  assert.match(html,/mm-loading-file-identity/);assert.match(html,/Atualizado em/);assert.doesNotMatch(html,/<table|<button|<input/);
  assert.match(read('DocumentsSection.tsx'),/viewMode === "grid" \? "grid" : "table"/);
});
test('queue initial counts stay unknown, settled refresh preserves cards, and load more expands only',()=>{
  const columns=Object.fromEntries(queues.map(q=>[q,{tickets:[],total:0,hasMore:false,loading:true}]));
  const pending=runtime.renderBoard({...boardProps,columnPages:columns});
  for(const label of ['Novo / Aberto','Em andamento','Em revisão','Concluído'])assert.ok(pending.includes(label));
  assert.doesNotMatch(pending,/0 \/ 0|Nenhum chamado acessível/); assert.match(pending,/mm-loading-ticket-card/);
  const settled=Object.fromEntries(queues.map(q=>[q,{tickets:q==='open'?[ticket]:[],total:q==='open'?3:0,pagination,hasMore:q==='open',loading:true}]));
  const refresh=runtime.renderBoard({...boardProps,tickets:[ticket],columnPages:settled});
  assert.ok(refresh.includes(ticket.subject));assert.doesNotMatch(refresh,/mm-loading-ticket-card/);
  const more=runtime.renderBoard({...boardProps,tickets:[ticket],columnPages:{...settled,open:{...settled.open,loadingMore:true}}});
  assert.ok(more.indexOf(ticket.subject)<more.indexOf('mm-loading-ticket-card'));
  const failed=runtime.renderBoard({...boardProps,columnPages:Object.fromEntries(queues.map(q=>[q,{tickets:[],total:0,hasMore:false,loading:false,error:{message:'Falha'}}]))});
  assert.doesNotMatch(failed,/mm-skeleton|0 \/ 0|Nenhum chamado acessível/);
});
test('calendar keeps month navigation and weekday/date geometry while only events wait',()=>{
  const pending=runtime.renderCalendar({tickets:[],from:'2026-10-01',loading:true,initialLoading:true,onOpen:noop,onRangeChange:noop});
  for(const label of ['Outubro','Mês anterior','Próximo mês','Hoje','Dom','Seg','Sem data'])assert.ok(pending.includes(label));
  assert.match(pending,/mm-loading-calendar-event/);assert.doesNotMatch(pending,/Nenhum chamado com prazo|Todos os chamados exibidos possuem prazo/);
  const refresh=runtime.renderCalendar({tickets:[ticket],from:'2026-10-01',loading:true,onOpen:noop,onRangeChange:noop});
  assert.ok(refresh.includes(ticket.subject));assert.doesNotMatch(refresh,/mm-skeleton/);
});
test('detail placeholders expose stable summary labels without interactive fake fields',()=>{
  const html=runtime.renderDetail();
  for(const label of ['Solicitante','Atendente','Criado em','Atualizado em','Prazo','Categoria'])assert.ok(html.includes(label));
  assert.match(html,/aria-busy="true"/);assert.doesNotMatch(html,/<button|<input|<select|role="status"/);
});
test('request guards, query reset and in-place queue refresh are independent of animation',()=>{
  const docs=read('DocumentsSection.tsx'),section=read('TicketsSection.tsx'),board=read('TicketKanbanBoard.tsx');
  assert.ok(docs.indexOf('const refresh = loadFiles({ background: true });')<docs.indexOf('await completeTransfer("upload", file.name)'));
  assert.match(docs,/sequence !== loadSequenceRef\.current/);assert.match(docs,/sequence !== folderSequenceRef\.current/);
  assert.match(docs,/setHasLoadedFiles\(false\);\s*setInitialLoading\(true\)/);
  assert.match(section,/key=\{`\$\{organizationId\}:\$\{ticketQueryKey\(debouncedFilters\)\}`\}/);
  assert.match(board,/\[revision, busyTicketIds\.size, refreshKey\]/);
  assert.match(board,/if \(!first\) \{[\s\S]*loading: false/);
  assert.match(board,/revealPendingQueue = \(queue: string\) => !hasQueryChanges && !current.current\[queue\]\?\.pagination/);
  assert.match(board,/load\(queue, false, first.snapshot, revealPendingQueue\(queue\)\)/);
  assert.match(docs,/isRegionAccessDenied\(requestError\)\) clearDeniedDocuments\(\)/);
  assert.match(section,/queryAccessRevokedRef.current = true/);
  assert.match(section,/if \(isRegionAuthenticationError\(detailFailure\)\) \{\s*invalidateQueryAccess\(\)/);
  for (const draft of ["FileRenameDraft", "FileMoveDraft", "FolderMoveDraft", "CreateFolderDraft"]) assert.ok(docs.includes(`set${draft}(null)`));
  assert.match(board,/if \(isRegionAuthenticationError\(failure\)\) \{\s*invalidateAccess\(failure,[\s\S]*?return;/);
  assert.match(section,/requestSequence !== listRequestSequenceRef\.current/);
  for(const file of ['TicketDetailDrawer.tsx','TicketsSection.tsx'])assert.doesNotMatch(read(file),/ticket-detail-loading|ticket-view-skeleton/);
});


test('queue reveal predicate ignores unrelated mutation history but preserves current-query atomicity',()=>{
  const board=read('TicketKanbanBoard.tsx');
  const predicate=board.match(/const hasQueryChanges = changes\.some\(change => change\.queryKey === ticketQueryKey\(filters\)\);\s*const revealPendingQueue = \(queue: string\) => !hasQueryChanges && !current\.current\[queue\]\?\.pagination;/)?.[0];
  assert.ok(predicate,'exact query-scoped predicate is present');
  const evaluate=new Function('changes','filters','ticketQueryKey','current',predicate.replace('(queue: string)','(queue)')+'; return revealPendingQueue;');
  const queryKey=filters=>JSON.stringify(filters), filters={q:'B'}, current={current:{open:{pagination:{page:1}},in_progress:{}}};
  const unrelated=evaluate([{revision:99,queryKey:queryKey({q:'A'})}],filters,queryKey,current);
  assert.equal(unrelated('in_progress'),true); assert.equal(unrelated('open'),false);
  const overlay=evaluate([{revision:99,queryKey:queryKey(filters)}],filters,queryKey,current);
  assert.equal(overlay('in_progress'),false);
  assert.match(board,/requestRevision !== latestRevision.current/);
  assert.match(board,/requestRevision === 0 && !forceFresh \? snapshot : null/);
});
