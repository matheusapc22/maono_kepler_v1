import assert from 'node:assert/strict';
// Reverse only the approved Central breadcrumb wiring / unchanged Documents
// footer extraction before independently pinned, original-byte guards run.
const oldFooter = "      <div className=\"mm-docs-pagination\"><span role=\"status\">{refreshing || pendingNext ? \"Atualizando documentos.\" : `Exibindo ${visibleFiles.length}/${pagination.total}.`}</span><div className=\"mm-docs-page-controls\"><label>Itens por p\u00e1gina <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPageIndex(0); setPendingNext(false); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><button type=\"button\" className=\"mm-docs-page-arrow is-previous\" aria-label=\"P\u00e1gina anterior\" disabled={!canGoPrevious || refreshing || loadingMore || pendingNext} onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}><DocumentIcon name=\"chevron\" /></button><span className=\"mm-docs-page-number\" aria-current=\"page\">{safePageIndex + 1}</span><button type=\"button\" className=\"mm-docs-page-arrow\" aria-label=\"Pr\u00f3xima p\u00e1gina\" disabled={!canGoNext || refreshing || loadingMore || pendingNext} onClick={goNext}><DocumentIcon name=\"chevron\" /></button></div></div>";
const extractedFooter = "      <DocumentsPagination status={refreshing || pendingNext ? \"Atualizando documentos.\" : `Exibindo ${visibleFiles.length}/${pagination.total}.`} page={safePageIndex + 1} pageSize={pageSize} canGoPrevious={canGoPrevious} canGoNext={canGoNext} disabled={refreshing || loadingMore || pendingNext} onPageSize={size => { setPageSize(size); setPageIndex(0); setPendingNext(false); }} onPrevious={() => setPageIndex(Math.max(0, safePageIndex - 1))} onNext={goNext} />";
const homeCallback = "                onHome={() => {\n                  setSidebarSection(\"all\"); setSearchQuery(\"\"); setProjectActionError(null);\n                }}\n";
export function restoreTicketVisualExtraction(path, source) {
  if (path.endsWith('/DocumentsSection.css')) {
    return source.replaceAll(':is(.mm-docs, .ticket-center-shell) .mm-docs-page', '.mm-docs .mm-docs-page').replaceAll(':is(.mm-docs, .ticket-center-shell) .mm-docs-pagination', '.mm-docs .mm-docs-pagination');
  }
  if (path.endsWith('/DocumentsSection.tsx')) {
    assert.equal(source.split(extractedFooter).length - 1, 1, 'only the exact presentation extraction is authorized');
    return source.replace('import DocumentsPagination from "./DocumentsPagination";\n', '').replace(extractedFooter, oldFooter);
  }
  if (path === 'src/pages/Projects.tsx') {
    assert.equal(source.split(homeCallback).length - 1, 1);
    source = source.replace(homeCallback, '').replace("      if (!target) {\n        ticketLinkEpoch.current += 1;\n        setTicketLinkRestoring(false); setTicketLinkError(null);\n        if (currentSidebarSectionRef.current === \"requests\") {\n          setSidebarSection(\"all\"); setSearchQuery(\"\"); setProjectActionError(null);\n        }\n        return;\n      }", "      if (!target) return;");
    const split = source.indexOf('function ProjectsSectionRouter(');
    return source.slice(0, split) + source.slice(split)
      .replace('  organizationName,\n  onHome,\n', '  organizationName,\n')
      .replace('  organizationName?: string | null;\n  onHome: () => void;\n', '  organizationName?: string | null;\n')
      .replace('          organizationName={organizationName}\n          onHome={onHome}\n', '          organizationName={organizationName}\n');
  }
  return source;
}
