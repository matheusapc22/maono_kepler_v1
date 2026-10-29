import assert from 'node:assert/strict';

// Exact inverse of the Projects inventory extraction. Historical hashes stay pinned.
const changes = [
  {
    "before": "import \"./Admin/admin-workspace.css\";\n",
    "after": "import \"./Admin/admin-workspace.css\";\nimport AdminProjects from \"./Admin/components/AdminProjects\";\nimport type { AdminProject } from \"./Admin/components/admin-projects-model\";\n"
  },
  {
    "before": "type AdminProject = {\n  id: number;\n  name: string;\n  slug: string;\n  description?: string;\n  dropboxRootPath?: string;\n  defaultConfigFile?: string;\n  active?: boolean;\n  accessCount?: number;\n  updatedAt?: string;\n};\n\n",
    "after": ""
  },
  {
    "before": "  function renderProjects() {\n    return (\n      <section className=\"mm-card mm-section-card\">\n        <h2><StaticLoadingText pending={structurePending}>Projetos e Mapas</StaticLoadingText></h2>\n        <p><StaticLoadingText pending={structurePending}>Mapas, configurações, previews e vínculos.</StaticLoadingText></p>\n        <Table state={regions.projects} structurePending={structurePending} contentPending={projectPresentation.contentPending}\n          headers={[\"Projeto\", \"Slug\", \"JSON\", \"Pasta\", \"Acessos\", \"Status\"]}\n          rows={projects.map((project) => [\n            project.name,\n            project.slug,\n            project.defaultConfigFile || \"config.kepler.json\",\n            project.dropboxRootPath || \"/projects\",\n            String(project.accessCount || 0),\n            statusLabel(project.active),\n          ])}\n        />\n      </section>\n    );\n  }\n\n",
    "after": "  function renderProjects() {\n    return <AdminProjects projects={projects} organizations={organizations} state={regions.projects} organizationsState={regions.organizations} user={user} structurePending={structurePending} contentPending={projectPresentation.contentPending} />;\n  }\n\n"
  }
];

export function restoreAdminProjectsInventory(path, source) {
  if (path !== 'src/pages/Admin.tsx') return source;
  for (const { before, after } of [...changes].reverse()) {
    if (!after) {
      const anchor = 'type AdminOrganization = {';
      assert.equal(source.split(anchor).length - 1, 1);
      source = source.replace(anchor, before + anchor);
    } else {
      assert.equal(source.split(after).length - 1, 1, 'exact Admin Projects inventory delta');
      source = source.replace(after, before);
    }
  }
  return source;
}
