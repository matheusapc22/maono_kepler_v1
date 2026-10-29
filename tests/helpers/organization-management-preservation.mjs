import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Exact inverse of the newly approved organizations integration. Historical
// baselines stay unchanged; unrelated Admin edits still fail preservation.
const edits = [
  {
    "before": "import \"./Admin/admin-workspace.css\";",
    "after": "import \"./Admin/admin-workspace.css\";\nimport AdminOrganizationsSection from \"./Admin/organizations/AdminOrganizationsSection\";"
  },
  {
    "before": "  const section = (params.get(\"section\") || \"overview\") as AdminSection;",
    "after": "  const section = (params.get(\"section\") || \"overview\") as AdminSection;\n  const organizationsWorkspace = import.meta.env.VITE_ORGANIZATION_MANAGEMENT_V1 === \"true\" && section === \"organizations\";"
  },
  {
    "before": "  const refreshAdminData = useCallback(async () => {\n    const revision",
    "after": "  const refreshAdminData = useCallback(async () => {\n    if (organizationsWorkspace) {\n      controllerRef.current?.abort();\n      requestRef.current += 1;\n      setRegions(current => Object.fromEntries(Object.keys(current).map(key => [key, { pending: false, loaded: false, error: \"\" }])) as Record<AdminRegionKey, AdminRegionState>);\n      return true;\n    }\n    const revision"
  },
  {
    "before": "    return results.every(result => result.status === \"fulfilled\" && result.value === true);\n  }, []);",
    "after": "    return results.every(result => result.status === \"fulfilled\" && result.value === true);\n  }, [organizationsWorkspace]);"
  },
  {
    "before": "  function renderActiveSection() {\n    if (section === \"organizations\")",
    "after": "  function renderActiveSection() {\n    if (organizationsWorkspace) return <AdminOrganizationsSection />;\n    if (section === \"organizations\")"
  },
  {
    "before": "          </div>\n        </header>\n\n        <div className=\"admin-content admin-workspace-content\">",
    "after": "          </div>\n          {organizationsWorkspace ? <div id=\"admin-organizations-actions\" /> : null}\n          {section === \"users\" && params.get(\"org_return\") === \"organizations\" ? <Link className=\"mm-btn\" to={`/admin?${(() => { const next = new URLSearchParams(params); next.set(\"section\", \"organizations\"); next.delete(\"org_return\"); next.delete(\"organization\"); return next.toString(); })()}`}>Voltar às organizações</Link> : null}\n        </header>\n\n        <div className=\"admin-content admin-workspace-content\">"
  }
];
export function restoreOrganizationManagement(path, source) {
  if (path !== 'src/pages/Admin.tsx' || !source.includes('import AdminOrganizationsSection')) return source;
  for (const {before, after} of [...edits].reverse()) {
    assert.equal(source.split(after).length - 1, 1, 'Exact organization workspace integration');
    source = source.replace(after,before);
  }
  return source;
}

const domain = JSON.parse(readFileSync(new URL('../fixtures/organization-management-domain-preservation.json', import.meta.url),'utf8'));
assert.equal(domain.base,'381c93256d985b0ae39722128fc4ad54f17f025f');
export function restoreOrganizationManagementDomain(path, source) {
  for(const {before,after} of [...(domain.changes[path]||[])].reverse()) {
    assert.equal(source.split(after).length-1,1,`Exact management domain integration: ${path}`);
    source=source.replace(after,before);
  }
  return source;
}
