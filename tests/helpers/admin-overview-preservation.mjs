import assert from 'node:assert/strict';

// Exact inverse of validation/availability additions. Historical calculations stay pinned.
const changes = [
  {
    "before": "const denied = isRegionAccessDenied(err);",
    "after": "const denied = isRegionAccessDenied(err) || Number((err as { status?: unknown })?.status) === 404;"
  },
  {
    "before": "data => setProjects(data.projects || [])",
    "after": "data => {\n        if (!Array.isArray(data.projects) || data.projects.some((item: unknown) => !item || typeof item !== \"object\")) throw Object.assign(new Error(\"Resposta administrativa inválida.\"), { status: 502 });\n        setProjects(data.projects);\n      }"
  },
  {
    "before": "data => setOrganizations(data.organizations || [])",
    "after": "data => {\n        if (!Array.isArray(data.organizations) || data.organizations.some((item: unknown) => !item || typeof item !== \"object\")) throw Object.assign(new Error(\"Resposta administrativa inválida.\"), { status: 502 });\n        setOrganizations(data.organizations);\n      }"
  },
  {
    "before": "usersRead.then(async usersData => usersData.users || (await accessRead).users || [])",
    "after": "usersRead.then(async usersData => {\n        const collection = usersData.users === undefined ? (await accessRead).users : usersData.users;\n        if (!Array.isArray(collection) || collection.some((item: unknown) => !item || typeof item !== \"object\")) throw Object.assign(new Error(\"Resposta administrativa inválida.\"), { status: 502 });\n        return collection;\n      })"
  },
  {
    "before": "{ label: \"Organizações\", value:",
    "after": "{ label: \"Organizações\", available: organizations.every(item => typeof item.active === \"boolean\"), value:"
  },
  {
    "before": "{ label: \"Projetos\", value:",
    "after": "{ label: \"Projetos\", available: projects.every(item => typeof item.active === \"boolean\"), value:"
  },
  {
    "before": "{ label: \"Usuários\", value:",
    "after": "{ label: \"Usuários\", available: users.every(item => typeof item.active === \"boolean\"), value:"
  },
  {
    "before": "{ label: \"Arquivos\", value:",
    "after": "{ label: \"Arquivos\", available: organizations.every(org => typeof org.fileCount === \"number\" && Number.isSafeInteger(org.fileCount) && org.fileCount >= 0), value:"
  }
];

export function restoreAdminOverview(source) {
  for (const { before, after } of changes) {
    assert.equal(source.split(after).length - 1, 1, 'exact Admin overview provenance change');
    source = source.replace(after, before);
  }
  return source;
}
