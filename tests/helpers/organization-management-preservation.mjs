import assert from 'node:assert/strict';
import { restoreAdminOwnerError } from './admin-owner-error-preservation.mjs';
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
// Exact inverse of ADM-UX-20261124: retain the authenticated global workspace
// through a session refresh without removing actor/permission invalidation.
// The pre-existing pinned Admin hash remains unchanged.
const persistentFlowEdits = [
  {
    before: 'import { Link, Navigate, useNavigate, useSearchParams } from "react-router";',
    after: 'import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";',
  },
  {
    before: '  const [params] = useSearchParams();\n  if (loading)',
    after: `  const [params] = useSearchParams();
  const location = useLocation();
  const accessKey = authenticated ? JSON.stringify([user?.id, user?.role, user?.permissions, user?.deniedPermissions, user?.scopes]) : null;
  const previousAccess = useRef<string | null>(null);
  const accessChanged = previousAccess.current !== null && previousAccess.current !== accessKey;
  useEffect(() => { previousAccess.current = accessKey; }, [accessKey]);
  if (loading)`,
  },
  {
    before: '  if (loading) return <AdminPageSkeleton section={params.get("section") || "overview"} />;',
    after: '  if (loading && !authenticated) return <AdminPageSkeleton section={params.get("section") || "overview"} />;',
  },
  {
    before: '',
    after: `  if (accessChanged && ["org_id", "org_mode", "org_operation", "org_deletion", "org_delete_key"].some(name => params.has(name))) {
    // Remounting alone would reopen the prior actor's operation from its URL.
    const next = new URLSearchParams(params);
    for (const name of ["org_id", "org_tab", "org_mode", "org_operation", "org_deletion", "org_delete_key"]) next.delete(name);
    const state = { ...location.state };
    delete state.organizationDeletionReceipt;
    return <Navigate to={\`\${location.pathname}?\${next}\`} replace state={state} />;
  }
`,
  },
  {
    before: '  const contextKey = JSON.stringify([user?.id, user?.role, user?.activeOrganizationId, user?.organizationId, user?.organization_id, user?.permissions, user?.deniedPermissions, user?.scopes]);',
    after: `  // Global organization management does not change scope when deletion selects
  // another active organization. Still discard state on actor/authorization changes.
  const globalOrganizations = import.meta.env.VITE_ORGANIZATION_MANAGEMENT_V1 === "true" && params.get("section") === "organizations";
  const organizationContext = globalOrganizations ? null : [user?.activeOrganizationId, user?.organizationId, user?.organization_id];
  const contextKey = JSON.stringify([user?.id, user?.role, organizationContext, user?.permissions, user?.deniedPermissions, user?.scopes]);`,
  },
];
export function restoreOrganizationManagement(path, source) {
  if (path !== 'src/pages/Admin.tsx' || !source.includes('import AdminOrganizationsSection')) return source;
  for (const {before, after} of [...persistentFlowEdits].reverse()) {
    assert.equal(source.split(after).length - 1, 1, 'Exact persistent organization flow integration');
    source = source.replace(after,before);
  }
  for (const {before, after} of [...edits].reverse()) {
    assert.equal(source.split(after).length - 1, 1, 'Exact organization workspace integration');
    source = source.replace(after,before);
  }
  return source;
}

const domain = JSON.parse(readFileSync(new URL('../fixtures/organization-management-domain-preservation.json', import.meta.url),'utf8'));
assert.equal(domain.base,'381c93256d985b0ae39722128fc4ad54f17f025f');
export function restoreOrganizationManagementDomain(path, source) {
  source = restoreAdminOwnerError(path, source);
  for(const {before,after} of [...(domain.changes[path]||[])].reverse()) {
    assert.equal(source.split(after).length-1,1,`Exact management domain integration: ${path}`);
    source=source.replace(after,before);
  }
  return source;
}
