import assert from 'node:assert/strict';

// Exact inverse of the scoped functional extraction; historical hash is unchanged.
const changes = [
  {
    "before": "",
    "after": "import AdminSystem from \"./Admin/components/AdminSystem\";\n"
  },
  {
    "before": "  function renderSystem() {\n    return (\n      <section className=\"mm-card mm-section-card\">\n        <h2><StaticLoadingText pending={structurePending}>Sistema</StaticLoadingText></h2>\n        <p><StaticLoadingText pending={structurePending}>React, Vite, Cloudflare Pages Functions, D1 e Kepler.gl.</StaticLoadingText></p>\n        <div className=\"mm-code-panel\">\n          <StaticLoadingText pending={structurePending}>/ = /projects</StaticLoadingText><br />\n          <StaticLoadingText pending={structurePending}>/admin = painel administrativo</StaticLoadingText><br />\n          <StaticLoadingText pending={structurePending}>/admin/files = /admin?section=organizations</StaticLoadingText><br />\n          <StaticLoadingText pending={structurePending}>/api/projects/:slug/thumbnail = preview do projeto</StaticLoadingText>\n        </div>\n      </section>\n    );\n  }\n\n",
    "after": "  function renderSystem() {\n    return <AdminSystem sessionAvailable={!error} />;\n  }\n\n"
  }
];

export function restoreAdminSystem(source) {
  for (const { before, after } of changes) {
    assert.equal(source.split(after).length - 1, 1, 'exact Admin system extraction');
    source = source.replace(after, before);
  }
  return source;
}
