import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useSession, type MaonoUser } from "../auth/session";
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
          <AdminMetric label="Organizações" value={activeOrganizations.length} state={regions.organizations} />
          <AdminMetric label="Projetos" value={activeProjects.length} state={regions.projects} />
          <AdminMetric label="Usuários" value={activeUsers.length} state={regions.users} />
          <AdminMetric label="Arquivos" value={totalFiles} state={regions.organizations} />
        </section>

        <section className="admin-command-grid">
          <article className="mm-card mm-section-card">
            <h2>Gestão de Organizações</h2>
            <p>Organizações, documentos, projetos e limites.</p>
            <button className="mm-btn primary" type="button" onClick={() => setSection("organizations")}>Abrir organizações</button>
          </article>
          <article className="mm-card mm-section-card">
            <h2>Projetos e Mapas</h2>
            <p>Mapas, vínculos, previews e configurações.</p>
            <button className="mm-btn" type="button" onClick={() => setSection("projects")}>Abrir projetos</button>
          </article>
          <article className="mm-card mm-section-card">
            <h2>Auditoria</h2>
            <p>Eventos, bloqueios e ações administrativas.</p>
            <button className="mm-btn" type="button" onClick={() => setSection("audit")}>Abrir auditoria</button>
          </article>
        </section>
      </>
    );
  }

  function renderOrganizations() {
    return (
      <section className="mm-card mm-section-card">
        <h2>Gestão de Organizações</h2>
        <p>Arquivos e documentos por organização.</p>
        <Table state={regions.organizations}
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
        <h2>Projetos e Mapas</h2>
        <p>Mapas, configurações, previews e vínculos.</p>
        <Table state={regions.projects}
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
        <h2>Solicitações</h2>
        <p>Criação, revisão e suporte.</p>
        <section className="mm-metrics-grid compact">
          <article className="mm-card metric"><span>Abertas</span><strong>0</strong></article>
          <article className="mm-card metric"><span>Em análise</span><strong>0</strong></article>
          <article className="mm-card metric"><span>Concluídas</span><strong>0</strong></article>
        </section>
      </section>
    );
  }

  function renderAudit() {
    return (
      <section className="mm-card mm-section-card">
        <h2>Auditoria</h2>
        <p>Eventos e ações administrativas.</p>
        <div className="mm-audit-list">
          <div><strong>admin.open</strong><span>Painel acessado por {roleLabel(user?.role)}.</span></div>
          <div><strong>admin.files.redirect</strong><span>/admin/files redireciona para Gestão de Organizações.</span></div>
          <div><strong>projects.thumbnail</strong><span>Preview vinculado ao projeto.</span></div>
        </div>
      </section>
    );
  }

  function renderSystem() {
    return (
      <section className="mm-card mm-section-card">
        <h2>Sistema</h2>
        <p>React, Vite, Cloudflare Pages Functions, D1 e Kepler.gl.</p>
        <div className="mm-code-panel">
          / = /projects<br />
          /admin = painel administrativo<br />
          /admin/files = /admin?section=organizations<br />
          /api/projects/:slug/thumbnail = preview do projeto
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
            <strong>Maõno Admin</strong>
            <span>{roleLabel(user?.role)}</span>
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
              {item.label}
            </button>
          ))}
        </nav>

        <div className="admin-rail-footer">
          <Link to="/projects" className="mm-btn">Voltar para Projects</Link>
          <button type="button" className="mm-btn" onClick={handleLogout}>Sair</button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="mm-projects-topbar admin-topbar">
          <div>
            <p className="mm-eyebrow">Administração Maõno</p>
            <h1>{sectionTitle(section)}</h1>
            <p>Acesso administrativo.</p>
          </div>
          <div className="mm-topbar-actions">
            <span className="mm-user-chip gold">{roleLabel(user?.role)}</span>
            <button type="button" className="mm-btn" onClick={refreshAdminData} disabled={isRefreshing}>
              {isRefreshing ? "Atualizando..." : "Atualizar"}
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
          <LoadingStatus loading={isRefreshing} refreshing={Object.values(regions).some(region => region.loaded)} label="Carregando dados administrativos." refreshingLabel="Atualizando dados administrativos." />
          {renderActiveSection()}
        </div>
      </section>
    </main>
  );
}

function AdminMetric({ label, value, state }: { label: string; value: number; state: AdminRegionState }) {
  return <article className="mm-card metric" aria-busy={state.pending}>
    <span>{label}</span>
    {state.loaded ? <strong>{value}</strong> : state.pending ? <Skeleton width={54} height={30} /> : <strong aria-label="Indisponível">—</strong>}
  </article>;
}

function Table({ headers, rows, state }: { headers: string[]; rows: string[][]; state: AdminRegionState }) {
  const skeletonRows = useSkeletonCount({ layout: "table", itemHeight: 45, reservedHeight: 260, maxCount: 10 });
  return (
    <div className="mm-table-wrap" aria-busy={state.pending}>
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr>
        </thead>
        <tbody>
          {state.pending && !state.loaded ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
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
