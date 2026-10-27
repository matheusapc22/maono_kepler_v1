import assert from 'node:assert/strict';

// Exact inverse of the scoped functional extraction; historical hash is unchanged.
const changes = [
  {
    "before": "",
    "after": "import AdminAudit from \"./Admin/components/AdminAudit\";\n"
  },
  {
    "before": "  function renderAudit() {\n    return (\n      <section className=\"mm-card mm-section-card\">\n        <h2><StaticLoadingText pending={structurePending}>Auditoria</StaticLoadingText></h2>\n        <p><StaticLoadingText pending={structurePending}>Eventos e ações administrativas.</StaticLoadingText></p>\n        <div className=\"mm-audit-list\">\n          <div><strong><StaticLoadingText pending={structurePending}>admin.open</StaticLoadingText></strong><span><StaticLoadingText pending={structurePending}>{`Painel acessado por ${roleLabel(user?.role)}.`}</StaticLoadingText></span></div>\n          <div><strong><StaticLoadingText pending={structurePending}>admin.files.redirect</StaticLoadingText></strong><span><StaticLoadingText pending={structurePending}>/admin/files redireciona para Gestão de Organizações.</StaticLoadingText></span></div>\n          <div><strong><StaticLoadingText pending={structurePending}>projects.thumbnail</StaticLoadingText></strong><span><StaticLoadingText pending={structurePending}>Preview vinculado ao projeto.</StaticLoadingText></span></div>\n        </div>\n      </section>\n    );\n  }\n\n",
    "after": "  function renderAudit() {\n    return <AdminAudit sessionAvailable={!error} />;\n  }\n\n"
  }
];

export function restoreAdminAudit(source) {
  for (const { before, after } of changes) {
    assert.equal(source.split(after).length - 1, 1, 'exact Admin audit extraction');
    source = source.replace(after, before);
  }
  return source;
}
