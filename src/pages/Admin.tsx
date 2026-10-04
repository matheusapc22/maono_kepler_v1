import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useSession, type MaonoUser } from "../auth/session";
import { StaticLoadingText, useInitialLoadingPresentation } from "../components/loading";
import { AdminPageSkeleton, LoadingStatus, Skeleton } from "../components/loading/Skeleton";
import { isRegionAccessDenied, isRegionAuthenticationError } from "../components/loading/region-loading-policy";
import { useSkeletonCount } from "../components/loading/useSkeletonCount";
import { parseJsonResponse } from "../lib/api-transport";
import { normalizeUserError } from "../lib/user-error-catalog";
import "./Projects/projects.css";
import "./Admin/admin.css";
import AdminUserManager from "./Admin/components/AdminUserManager";

type AdminSection = "overview" | "organizations" | "users" | "projects" | "requests" | "audit" | "system";

type AdminProject = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  dropboxRootPath?: string;
  defaultConfigFile?: string;
  active?: boolean;
  accessCount?: number;
  updatedAt?: string;
};

type AdminOrganization = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  dropboxRootPath?: string;
  active?: boolean;
  fileCount?: number;
  projectCount?: number;
  userCount?: number;
};

type AdminUser = {
  id: number;
  email: string;
  name?: string;
  role: string;
  active?: boolean;
  projectCount?: number;
  organizations?: Array<{
    id: number;
    name: string;
    slug: string;
    accessLevel: string;
    active?: boolean;
  }>;
};

type AdminAccess = {
  id: number;
  accessLevel: string;
  user?: AdminUser;
  project?: AdminProject;
};

async function readJson(response: Response) {
  const data = await parseJsonResponse<any>(response);
  if (data?.ok === false) {
    throw new Error("Não foi possível concluir a requisição administrativa.");
  }
  return data;
}

function normalizeRole(role?: string) {
  return String(role || "").trim().toLowerCase();
}

function roleLabel(role?: string) {
  const normalized = normalizeRole(role);
  if (normalized === "super_admin") return "Super Admin";
  if (normalized === "admin") return "Admin";
  if (normalized === "owner" || normalized === "client") return "Owner";
  if (normalized === "editor") return "Editor";
  if (normalized === "viewer") return "Viewer";
  return role || "Usuário";
}

function sectionTitle(section: AdminSection) {
  return {
    overview: "Painel Admin",
    organizations: "Gestão de Organizações",
    users: "Usuários e Permissões",
    projects: "Projetos e Mapas",
    requests: "Solicitações",
    audit: "Auditoria",
    system: "Sistema",
  }[section];
}

function statusLabel(active?: boolean) {
  return active === false ? "Inativo" : "Ativo";
}

type AdminRegionKey = "projects" | "organizations" | "users" | "access";
type AdminRegionState = { pending: boolean; loaded: boolean; error: string };
const initialRegions = (): Record<AdminRegionKey, AdminRegionState> => ({
  projects: { pending: true, loaded: false, error: "" },
  organizations: { pending: true, loaded: false, error: "" },
  users: { pending: true, loaded: false, error: "" },
  access: { pending: true, loaded: false, error: "" },
});
const regionLabels: Record<string, string> = { projects: "Projetos", organizations: "Organizações", users: "Usuários", access: "Acessos" };

const AdminPage: React.FC = () => {
  const { authenticated, loading, user, logout } = useSession();
  const [params] = useSearchParams();
  if (loading) return <AdminPageSkeleton section={params.get("section") || "overview"} />;
  if (!authenticated) return <Navigate to="/login?next=/admin" replace />;
  if (normalizeRole(user?.role) !== "super_admin") return <Navigate to="/projects" replace />;
  // Only access-context changes remount the workspace; ordinary refreshes keep
  // inputs, selection and revealed content intact. No prior-context data leaks.
  const contextKey = JSON.stringify([user?.id, user?.role, user?.activeOrganizationId, user?.organizationId, user?.organization_id, user?.permissions, user?.deniedPermissions, user?.scopes]);
  return <AdminWorkspace key={contextKey} user={user} logout={logout} />;
};

function AdminWorkspace({ user, logout }: { user: MaonoUser | null; logout: () => Promise<void> }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section = (params.get("section") || "overview") as AdminSection;
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [, setAccess] = useState<AdminAccess[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [regions, setRegions] = useState(initialRegions);
  const [usersAccessEpoch, setUsersAccessEpoch] = useState(0);
  const handleMessage = useCallback((kind: "error" | "success", text: string) => {
    if (kind === "error") setError(text);
    else setSuccess(text);
  }, []);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const isSuperAdmin = normalizeRole(user?.role) === "super_admin";
  const isRefreshing = Object.values(regions).some(region => region.pending);
  const { structurePending } = useInitialLoadingPresentation({
    pending: isRefreshing, hasData: Object.values(regions).some(region => region.loaded),
    scopeKey: "admin-structure", failed: Boolean(error) || Object.values(regions).some(region => Boolean(region.error)),
  });
  const projectPresentation = useInitialLoadingPresentation({ pending: regions.projects.pending, hasData: regions.projects.loaded, scopeKey: "admin-projects", failed: Boolean(error || regions.projects.error) });
  const organizationPresentation = useInitialLoadingPresentation({ pending: regions.organizations.pending, hasData: regions.organizations.loaded, scopeKey: "admin-organizations", failed: Boolean(error || regions.organizations.error) });
  const userPresentation = useInitialLoadingPresentation({ pending: regions.users.pending, hasData: regions.users.loaded, scopeKey: "admin-users", failed: Boolean(error || regions.users.error) });
  const presentationPending = projectPresentation.contentPending || organizationPresentation.contentPending || userPresentation.contentPending;

  const refreshAdminData = useCallback(async () => {
    const revision = ++requestRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => revision === requestRef.current && !controller.signal.aborted;
    setError("");
    setRegions(current => Object.fromEntries(Object.entries(current).map(([key, state]) => [key, { ...state, pending: true, error: "" }])) as Record<AdminRegionKey, AdminRegionState>);

    const read = (path: string) => fetch(path, {
      credentials: "include", headers: { Accept: "application/json" }, signal: controller.signal,
    }).then(readJson);
    // Start every independently authorized request before awaiting any result.
    const projectsRead = read("/api/admin/projects");
    const accessRead = read("/api/admin/access");
    const usersRead = read("/api/admin/users");
    const organizationsRead = read("/api/admin/organizations");
    const loadRegion = async (key: AdminRegionKey, request: Promise<any>, commit: (data: any) => void) => {
      try {
        const data = await request;
        if (!isCurrent()) return;
        commit(data);
        setRegions(current => ({ ...current, [key]: { pending: false, loaded: true, error: "" } }));
      } catch (err) {
        if (!isCurrent()) return;
        const denied = isRegionAccessDenied(err);
        const sessionLost = isRegionAuthenticationError(err);
        if (sessionLost) {
          // Session loss invalidates the entire batch, including companions
          // that may resolve successfully after this response.
          requestRef.current += 1;
          controller.abort();
          controllerRef.current = null;
          setProjects([]); setOrganizations([]); setUsers([]); setAccess([]);
          setUsersAccessEpoch(current => current + 1);
          setError(normalizeUserError(err).message);
          setRegions(current => Object.fromEntries(Object.keys(current).map(region => [region, { pending: false, loaded: false, error: "" }])) as Record<AdminRegionKey, AdminRegionState>);
          return;
        }
        if (denied) {
          // A denied read is not valid cached content for this authorization.
          if (key === "projects") setProjects([]);
          if (key === "organizations") setOrganizations([]);
          if (key === "users") { setUsers([]); setUsersAccessEpoch(current => current + 1); }
          if (key === "access") setAccess([]);
        }
        setRegions(current => ({ ...current, [key]: { ...current[key], pending: false, loaded: denied ? false : current[key].loaded, error: normalizeUserError(err).message } }));
      }
    };
    await Promise.allSettled([
      loadRegion("projects", projectsRead, data => setProjects(data.projects || [])),
      loadRegion("access", accessRead, data => setAccess(data.access || [])),
      // Preserve the existing users endpoint precedence, including [] being
      // authoritative. Access users are only a successful-response fallback.
      loadRegion("users", usersRead.then(async usersData => usersData.users || (await accessRead).users || []), setUsers),
      loadRegion("organizations", organizationsRead, data => setOrganizations(data.organizations || [])),
    ]);
    if (isCurrent()) controllerRef.current = null;
  }, []);

  useEffect(() => {
    void refreshAdminData();
    return () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [refreshAdminData]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const activeProjects = useMemo(() => projects.filter((item) => item.active !== false), [projects]);
  const activeOrganizations = useMemo(() => organizations.filter((item) => item.active !== false), [organizations]);
  const activeUsers = useMemo(() => users.filter((item) => item.active !== false), [users]);
  const totalFiles = useMemo(() => organizations.reduce((sum, org) => sum + Number(org.fileCount || 0), 0), [organizations]);

  const navItems = [
    { section: "overview", label: "Painel", icon: "◎" },
    { section: "organizations", label: "Gestão de Organizações", icon: "▥" },
    { section: "users", label: "Usuários e Permissões", icon: "☷" },
    { section: "projects", label: "Projetos e Mapas", icon: "▦" },
    { section: "requests", label: "Solicitações", icon: "◇" },
    { section: "audit", label: "Auditoria", icon: "◌" },
    { section: "system", label: "Sistema", icon: "⚙" },
  ];

  function setSection(value: AdminSection) {
    setParams({ section: value });
  }

  function renderOverview() {
    return (
      <>
        <section className="mm-metrics-grid">
          <AdminMetric label="Organizações" value={activeOrganizations.length} state={regions.organizations} structurePending={structurePending} contentPending={organizationPresentation.contentPending} />
          <AdminMetric label="Projetos" value={activeProjects.length} state={regions.projects} structurePending={structurePending} contentPending={projectPresentation.contentPending} />
          <AdminMetric label="Usuários" value={activeUsers.length} state={regions.users} structurePending={structurePending} contentPending={userPresentation.contentPending} />
          <AdminMetric label="Arquivos" value={totalFiles} state={regions.organizations} structurePending={structurePending} contentPending={organizationPresentation.contentPending} />
        </section>

        <section className="admin-command-grid">
          <article className="mm-card mm-section-card">
            <h2><StaticLoadingText pending={structurePending}>Gestão de Organizações</StaticLoadingText></h2>
            <p><StaticLoadingText pending={structurePending}>Organizações, documentos, projetos e limites.</StaticLoadingText></p>
            <button className="mm-btn primary" type="button" onClick={() => setSection("organizations")}><StaticLoadingText pending={structurePending}>Abrir organizações</StaticLoadingText></button>
          </article>
          <article className="mm-card mm-section-card">
            <h2><StaticLoadingText pending={structurePending}>Projetos e Mapas</StaticLoadingText></h2>
            <p><StaticLoadingText pending={structurePending}>Mapas, vínculos, previews e configurações.</StaticLoadingText></p>
            <button className="mm-btn" type="button" onClick={() => setSection("projects")}><StaticLoadingText pending={structurePending}>Abrir projetos</StaticLoadingText></button>
          </article>
          <article className="mm-card mm-section-card">
            <h2><StaticLoadingText pending={structurePending}>Auditoria</StaticLoadingText></h2>
            <p><StaticLoadingText pending={structurePending}>Eventos, bloqueios e ações administrativas.</StaticLoadingText></p>
            <button className="mm-btn" type="button" onClick={() => setSection("audit")}><StaticLoadingText pending={structurePending}>Abrir auditoria</StaticLoadingText></button>
          </article>
        </section>
      </>
    );
  }

  function renderOrganizations() {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending={structurePending}>Gestão de Organizações</StaticLoadingText></h2>
        <p><StaticLoadingText pending={structurePending}>Arquivos e documentos por organização.</StaticLoadingText></p>
        <Table state={regions.organizations} structurePending={structurePending} contentPending={organizationPresentation.contentPending}
          headers={["Organização", "Slug", "Pasta", "Projetos", "Usuários", "Arquivos", "Status"]}
          rows={organizations.map((org) => [
            org.name,
            org.slug,
            org.dropboxRootPath || "/projects",
            String(org.projectCount || 0),
            String(org.userCount || 0),
            String(org.fileCount || 0),
            statusLabel(org.active),
          ])}
        />
      </section>
    );
  }

  function renderUsers() {
    return (
      <AdminUserManager
        key={usersAccessEpoch}
        users={users}
        organizations={organizations}
        loading={regions.users.pending}
        usersLoaded={regions.users.loaded}
        organizationsLoaded={regions.organizations.loaded}
        structurePending={structurePending}
        usersContentPending={userPresentation.contentPending}
        organizationsContentPending={organizationPresentation.contentPending}
        initialOrganizationId={params.get("organization")}
        currentUserId={user?.id}
        isSuperAdmin={isSuperAdmin}
        onRefresh={refreshAdminData}
        onMessage={handleMessage}
      />
    );
  }

  function renderProjects() {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending={structurePending}>Projetos e Mapas</StaticLoadingText></h2>
        <p><StaticLoadingText pending={structurePending}>Mapas, configurações, previews e vínculos.</StaticLoadingText></p>
        <Table state={regions.projects} structurePending={structurePending} contentPending={projectPresentation.contentPending}
          headers={["Projeto", "Slug", "JSON", "Pasta", "Acessos", "Status"]}
          rows={projects.map((project) => [
            project.name,
            project.slug,
            project.defaultConfigFile || "config.kepler.json",
            project.dropboxRootPath || "/projects",
            String(project.accessCount || 0),
            statusLabel(project.active),
          ])}
        />
      </section>
    );
  }

  function renderRequests() {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending={structurePending}>Solicitações</StaticLoadingText></h2>
        <p><StaticLoadingText pending={structurePending}>Criação, revisão e suporte.</StaticLoadingText></p>
        <section className="mm-metrics-grid compact">
          <article className="mm-card metric"><span><StaticLoadingText pending={structurePending}>Abertas</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong></article>
          <article className="mm-card metric"><span><StaticLoadingText pending={structurePending}>Em análise</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong></article>
          <article className="mm-card metric"><span><StaticLoadingText pending={structurePending}>Concluídas</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong></article>
        </section>
      </section>
    );
  }

  function renderAudit() {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending={structurePending}>Auditoria</StaticLoadingText></h2>
        <p><StaticLoadingText pending={structurePending}>Eventos e ações administrativas.</StaticLoadingText></p>
        <div className="mm-audit-list">
          <div><strong><StaticLoadingText pending={structurePending}>admin.open</StaticLoadingText></strong><span><StaticLoadingText pending={structurePending}>{`Painel acessado por ${roleLabel(user?.role)}.`}</StaticLoadingText></span></div>
          <div><strong><StaticLoadingText pending={structurePending}>admin.files.redirect</StaticLoadingText></strong><span><StaticLoadingText pending={structurePending}>/admin/files redireciona para Gestão de Organizações.</StaticLoadingText></span></div>
          <div><strong><StaticLoadingText pending={structurePending}>projects.thumbnail</StaticLoadingText></strong><span><StaticLoadingText pending={structurePending}>Preview vinculado ao projeto.</StaticLoadingText></span></div>
        </div>
      </section>
    );
  }

  function renderSystem() {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending={structurePending}>Sistema</StaticLoadingText></h2>
        <p><StaticLoadingText pending={structurePending}>React, Vite, Cloudflare Pages Functions, D1 e Kepler.gl.</StaticLoadingText></p>
        <div className="mm-code-panel">
          <StaticLoadingText pending={structurePending}>/ = /projects</StaticLoadingText><br />
          <StaticLoadingText pending={structurePending}>/admin = painel administrativo</StaticLoadingText><br />
          <StaticLoadingText pending={structurePending}>/admin/files = /admin?section=organizations</StaticLoadingText><br />
          <StaticLoadingText pending={structurePending}>/api/projects/:slug/thumbnail = preview do projeto</StaticLoadingText>
        </div>
      </section>
    );
  }

  function renderActiveSection() {
    if (section === "organizations") return renderOrganizations();
    if (section === "users") return renderUsers();
    if (section === "projects") return renderProjects();
    if (section === "requests") return renderRequests();
    if (section === "audit") return renderAudit();
    if (section === "system") return renderSystem();
    return renderOverview();
  }

  return (
    <main className="maono-admin-page admin-page">
      <aside className="admin-rail">
        <div className="admin-brand">
          <span className="admin-brand-mark">M</span>
          <div>
            <strong><StaticLoadingText pending={structurePending}>Maõno Admin</StaticLoadingText></strong>
            <span><StaticLoadingText pending={structurePending}>{roleLabel(user?.role)}</StaticLoadingText></span>
          </div>
        </div>

        <nav className="admin-nav">
          {navItems.map((item) => (
            <button
              key={item.section}
              type="button"
              className={section === item.section ? "active" : ""}
              onClick={() => setSection(item.section as AdminSection)}
            >
              <span>{item.icon}</span>
              <StaticLoadingText pending={structurePending}>{item.label}</StaticLoadingText>
            </button>
          ))}
        </nav>

        <div className="admin-rail-footer">
          <Link to="/projects" className="mm-btn"><StaticLoadingText pending={structurePending}>Voltar para Projects</StaticLoadingText></Link>
          <button type="button" className="mm-btn" onClick={handleLogout}><StaticLoadingText pending={structurePending}>Sair</StaticLoadingText></button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="mm-projects-topbar admin-topbar">
          <div>
            <p className="mm-eyebrow"><StaticLoadingText pending={structurePending}>Administração Maõno</StaticLoadingText></p>
            <h1><StaticLoadingText pending={structurePending}>{sectionTitle(section)}</StaticLoadingText></h1>
            <p><StaticLoadingText pending={structurePending}>Acesso administrativo.</StaticLoadingText></p>
          </div>
          <div className="mm-topbar-actions">
            <span className="mm-user-chip gold"><StaticLoadingText pending={structurePending}>{roleLabel(user?.role)}</StaticLoadingText></span>
            <button type="button" className="mm-btn" onClick={refreshAdminData} disabled={isRefreshing}>
              <StaticLoadingText pending={structurePending}>{isRefreshing ? "Atualizando..." : "Atualizar"}</StaticLoadingText>
            </button>
          </div>
        </header>

        <div className="admin-content">
          {error && <div className="admin-notice error">{error}</div>}
          {success && <div className="admin-notice success">{success}</div>}
          {Object.entries(regions).filter(([, state]) => state.error).map(([key, state]) => (
            <div className="admin-notice error" role="alert" key={key}>
              <strong>{regionLabels[key]}: </strong>{state.error}
            </div>
          ))}
          <LoadingStatus loading={isRefreshing || presentationPending} refreshing={(regions.projects.pending && regions.projects.loaded && !projectPresentation.contentPending) || (regions.organizations.pending && regions.organizations.loaded && !organizationPresentation.contentPending) || (regions.users.pending && regions.users.loaded && !userPresentation.contentPending)} label="Carregando dados administrativos." refreshingLabel="Atualizando dados administrativos." />
          {renderActiveSection()}
        </div>
      </section>
    </main>
  );
}

function AdminMetric({ label, value, state, structurePending, contentPending }: { label: string; value: number; state: AdminRegionState; structurePending: boolean; contentPending: boolean }) {
  return <article className="mm-card metric" aria-busy={state.pending || contentPending}>
    <span><StaticLoadingText pending={structurePending}>{label}</StaticLoadingText></span>
    {contentPending ? <Skeleton width={54} height={30} /> : state.loaded ? <strong>{value}</strong> : <strong aria-label="Indisponível">—</strong>}
  </article>;
}

function Table({ headers, rows, state, structurePending, contentPending }: { headers: string[]; rows: string[][]; state: AdminRegionState; structurePending: boolean; contentPending: boolean }) {
  const skeletonRows = useSkeletonCount({ layout: "table", itemHeight: 45, reservedHeight: 260, maxCount: 10 });
  return (
    <div className="mm-table-wrap" aria-busy={state.pending || contentPending}>
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header} scope="col"><StaticLoadingText pending={structurePending}>{header}</StaticLoadingText></th>)}</tr>
        </thead>
        <tbody>
          {contentPending ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
            <tr key={`pending-${rowIndex}`} aria-hidden="true">{headers.map((header, columnIndex) => <td key={header}><Skeleton width={`${52 + ((rowIndex + columnIndex) % 4) * 11}%`} height={12} /></td>)}</tr>
          )) : !state.loaded ? (
            <tr><td colSpan={headers.length}>Dados indisponíveis.</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={headers.length}>Nenhum registro encontrado.</td></tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default AdminPage;
