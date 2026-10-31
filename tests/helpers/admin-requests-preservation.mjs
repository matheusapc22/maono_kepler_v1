import assert from 'node:assert/strict';

// Exact inverse of this functional extraction. Historical hash stays pinned.
const changes = [
  {
    "before": "",
    "after": "import AdminRequests from \"./Admin/components/AdminRequests\";\n"
  },
  {
    "before": "  function renderRequests() {\n    return (\n      <section className=\"mm-card mm-section-card\">\n        <h2><StaticLoadingText pending={structurePending}>Solicitações</StaticLoadingText></h2>\n        <p><StaticLoadingText pending={structurePending}>Criação, revisão e suporte.</StaticLoadingText></p>\n        <section className=\"mm-metrics-grid compact\">\n          <article className=\"mm-card metric\"><span><StaticLoadingText pending={structurePending}>Abertas</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong></article>\n          <article className=\"mm-card metric\"><span><StaticLoadingText pending={structurePending}>Em análise</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong></article>\n          <article className=\"mm-card metric\"><span><StaticLoadingText pending={structurePending}>Concluídas</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong></article>\n        </section>\n      </section>\n    );\n  }\n\n",
    "after": "  function renderRequests() {\n    return <AdminRequests sessionAvailable={!error} />;\n  }\n\n"
  }
];

export function restoreAdminRequests(source) {
  for (const { before, after } of changes) {
    assert.equal(source.split(after).length - 1, 1, 'exact Admin requests extraction');
    source = source.replace(after, before);
  }
  return source;
}
