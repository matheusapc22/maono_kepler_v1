// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useSession } from "../auth/session";
import "./Projects/projects.css";
import "./Admin/admin.css";

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
};

type AdminAccess = {
  id: number;
  accessLevel: string;
  user?: AdminUser;
  project?: AdminProject;
};

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Erro na requisição.");
  }
  return data;
}

function normalizeRole(role?: string) {
  return String(role || "").trim().toLowerCase();
}

function isAdminLike(role?: string) {
  const normalized = normalizeRole(role);
  return normalized === "admin" || normalized === "super_admin";
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

function statusClass(active?: boolean) {
  return active === false ? "no" : "yes";
}

const AdminPage: React.FC = () => {
  const { authenticated, loading, user, logout } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section = (params.get("section") || "overview") as AdminSection;

  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [access, setAccess] = useState<AdminAccess[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const adminLike = isAdminLike(user?.role);

  async function refreshAdminData() {
    setIsRefreshing(true);
    setError("");

    try {
      const [projectsData, accessData, usersData, organizationsData] = await Promise.all([
        fetch("/api/admin/projects", { credentials: "include", headers: { Accept: "application/json" } }).then(readJson),
        fetch("/api/admin/access", { credentials: "include", headers: { Accept: "application/json" } }).then(readJson),
        fetch("/api/admin/users", { credentials: "include", headers: { Accept: "application/json" } }).then(readJson),
        fetch("/api/admin/organizations", { credentials: "include", headers: { Accept: "application/json" } }).then(readJson),
      ]);

      setProjects(projectsData.projects || []);
      setUsers(usersData.users || accessData.users || []);
      setAccess(accessData.access || []);
      setOrganizations(organizationsData.organizations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar painel administrativo.");
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (!loading && !authenticated) navigate("/login?next=/admin", { replace: true });
  }, [authenticated, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && !adminLike) navigate("/projects", { replace: true });
  }, [authenticated, adminLike, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && adminLike) {
      refreshAdminData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, adminLike, loading]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const activeProjects = useMemo(() => projects.filter((item) => item.active !== false), [projects]);
  const activeOrganizations = useMemo(() => organizations.filter((item) => item.active !== false), [organizations]);
  const activeUsers = useMemo(() => users.filter((item) => item.active !== false), [users]);
  const totalFiles = useMemo(() => organizations.reduce((sum, org) => sum + Number(org.fileCount || 0), 0), [organizations]);

  if (loading) {
    return (
      <main className="mm-loading-screen">
        <p>Carregando painel administrativo...</p>
      </main>
    );
  }

  if (!authenticated) return null;
  if (!adminLike) return <Navigate to="/projects" replace />;

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
          <article className="mm-card metric"><span>Organizações</span><strong>{activeOrganizations.length}</strong></article>
          <article className="mm-card metric"><span>Projetos</span><strong>{activeProjects.length}</strong></article>
          <article className="mm-card metric"><span>Usuários</span><strong>{activeUsers.length}</strong></article>
          <article className="mm-card metric"><span>Arquivos</span><strong>{totalFiles}</strong></article>
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
        <Table
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
      <section className="mm-card mm-section-card">
        <h2>Usuários e Permissões</h2>
        <p>Super Admin, Admin, Owner, Editor e Viewer.</p>
        <Table
          headers={["Nome", "E-mail", "Perfil", "Projetos", "Status"]}
          rows={users.map((item) => [
            item.name || "—",
            item.email,
            roleLabel(item.role),
            String(item.projectCount || 0),
            statusLabel(item.active),
          ])}
        />
      </section>
    );
  }

  function renderProjects() {
    return (
      <section className="mm-card mm-section-card">
        <h2>Projetos e Mapas</h2>
        <p>Mapas, configurações, previews e vínculos.</p>
        <Table
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
          {renderActiveSection()}
        </div>
      </section>
    </main>
  );
};

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mm-table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
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
