import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const toolbar = read('src/pages/Projects/components/TicketsToolbar.tsx');
const list = read('src/pages/Projects/components/TicketListView.tsx');
const section = read('src/pages/Projects/components/TicketsSection.tsx');
const css = read('src/pages/Projects/components/ticket-center-visual.css');
const pagination = read('src/pages/Projects/components/DocumentsPagination.tsx');

test('flat page heading has a working neutral breadcrumb and no decorative hero content', () => {
  for (const removed of ['HeadsetIcon', 'ticket-center-headset', 'ticket-center-eyebrow', 'Atendimento operacional', 'Consulte, priorize', 'ticket-filter-help']) assert.ok(!toolbar.includes(removed), removed);
  for (const text of ['<h1>Central de Chamados</h1>', 'aria-label="Caminho da página"', 'onHome()', 'to="/projects"', 'Novo chamado', '<option value="list">Lista</option>', '<option value="kanban">Kanban</option>', '<option value="calendar">Calendário</option>']) assert.ok(toolbar.includes(text), text);
  assert.match(css, /ticket-center-breadcrumb a \{ color: inherit/);
});
test('filters retain canonical field values, one period legend and semantic controls', () => {
  for (const name of ['Buscar', 'Situação', 'Prioridade', 'Atendente', 'Período', 'De', 'Até', 'Ordenar por']) assert.ok(toolbar.includes('>' + name + '<'));
  for (const name of ['q', 'status', 'priority', 'assigneeId', 'from', 'to', 'sort']) assert.ok(toolbar.includes('"' + name + '"'));
  assert.equal((toolbar.match(/<legend/g) || []).length, 1);
  assert.ok(toolbar.includes('sort: filters.sort'));
});
test('list actions reuse existing workflows and selection has no bulk write/export semantics', () => {
  for (const text of ['onSelect: onRefresh', 'onClick={onExport}', 'disabled={!exportAvailable}', 'onClick={() => onOpen(ticket)}', 'new Set(visibleIds)', 'selectAllRef.current.indeterminate', 'allowed.has(id)']) assert.ok(list.includes(text), text);
  assert.ok(!/\bfetch\(|requestJson|runTicketCommand/.test(list));
  assert.ok(section.includes('onAvailabilityChange={setExportAvailable}'));
  assert.ok(section.includes('PERMISSION.EXPORT_VIEW'));
  const exports = read('src/pages/Projects/components/TicketExportsPanel.tsx');
  assert.ok(exports.includes('panelRef.current.open = true'));
  assert.ok(exports.includes('onAvailabilityChange?.(data?.enabled === true)'));
});
test('shared footer uses real visible count and backend page metadata, never loaded-array total', () => {
  assert.ok(list.includes('`Exibindo ${tickets.length}/${pagination.total}.`'));
  assert.ok(list.includes('canGoNext={pagination.hasMore}'));
  assert.ok(list.includes('page={pagination.page}'));
  assert.ok(!list.includes('Página {pagination.page} de'));
  assert.ok(section.includes('limit: viewModeRef.current === "list" ? pageSize : 50'));
  assert.ok(section.includes('!response.pagination.snapshot && response.pagination.page > response.pagination.totalPages'));
  assert.ok(section.includes('requestSequence !== listRequestSequenceRef.current'));
  for (const option of [10, 25, 50]) assert.ok(pagination.includes(`value={${option}}`));
});
test('new styles cannot reach another page or reset global density/tokens', () => {
  const parsed = postcss.parse(css);
  parsed.walkRules(rule => rule.selectors.forEach(selector => assert.match(selector, /^body \.ticket-center-(?:shell|final)/)));
  parsed.walkDecls(decl => {
    assert.notEqual(decl.prop, 'zoom'); assert.ok(!decl.important);
    assert.ok(!decl.prop.startsWith('--maono-'));
  });
  assert.ok(css.includes('@container (max-width: 900px)'));
  assert.ok(css.includes('@container (max-width: 560px)'));
  assert.ok(css.includes('@media (pointer: coarse)'));
});


test('shared pagination renders the exact existing Documents footer for every state', async () => {
  const { build } = await import('esbuild');
  const source = `import { renderToStaticMarkup } from 'react-dom/server';
import DocumentsPagination from './src/pages/Projects/components/DocumentsPagination';
import { DocumentIcon } from './src/pages/Projects/components/DocumentsUi';
function Previous(props) {
  const { refreshing, pendingNext, loadingMore, visibleFiles, pagination, pageSize, safePageIndex, canGoPrevious, canGoNext } = props;
  const setPageSize = () => {}, setPageIndex = () => {}, setPendingNext = () => {}, goNext = () => {};
  return (<div className="mm-docs-pagination"><span role="status">{refreshing || pendingNext ? "Atualizando documentos." : \`Exibindo \${visibleFiles.length}/\${pagination.total}.\`}</span><div className="mm-docs-page-controls"><label>Itens por página <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPageIndex(0); setPendingNext(false); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><button type="button" className="mm-docs-page-arrow is-previous" aria-label="Página anterior" disabled={!canGoPrevious || refreshing || loadingMore || pendingNext} onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}><DocumentIcon name="chevron" /></button><span className="mm-docs-page-number" aria-current="page">{safePageIndex + 1}</span><button type="button" className="mm-docs-page-arrow" aria-label="Próxima página" disabled={!canGoNext || refreshing || loadingMore || pendingNext} onClick={goNext}><DocumentIcon name="chevron" /></button></div></div>);
}
export function compare(props) {
  return [renderToStaticMarkup(<Previous {...props} />), renderToStaticMarkup(<DocumentsPagination status={props.refreshing || props.pendingNext ? 'Atualizando documentos.' : 'Exibindo ' + props.visibleFiles.length + '/' + props.pagination.total + '.'} page={props.safePageIndex + 1} pageSize={props.pageSize} canGoPrevious={props.canGoPrevious} canGoNext={props.canGoNext} disabled={props.refreshing || props.loadingMore || props.pendingNext} onPageSize={() => {}} onPrevious={() => {}} onNext={() => {}} />)];
}`;
  const result = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false, loader: { '.css': 'empty' }, external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'] });
  // A local temporary module resolves the same installed React version as the app.
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const directory = mkdtempSync(new URL('../.ticket-pagination-test-', import.meta.url).pathname);
  try {
    const modulePath = join(directory, 'compare.mjs'); writeFileSync(modulePath, result.outputFiles[0].text);
    const { compare } = await import(modulePath);
    for (const patch of [{}, { safePageIndex: 2, canGoPrevious: true }, { refreshing: true }, { pendingNext: true }, { loadingMore: true }, { pageSize: 25 }, { pageSize: 50, canGoNext: false }]) {
      const [oldHtml, sharedHtml] = compare({ refreshing: false, pendingNext: false, loadingMore: false, visibleFiles: Array(10), pagination: { total: 73 }, pageSize: 10, safePageIndex: 0, canGoPrevious: false, canGoNext: true, ...patch });
      assert.equal(sharedHtml, oldHtml);
    }
  } finally { rmSync(directory, { recursive: true }); }
});
