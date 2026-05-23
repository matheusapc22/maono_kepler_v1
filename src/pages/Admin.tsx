import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";
import AdminDropboxBrowser from "./AdminDropboxBrowser";

type AdminProject = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  dropboxRootPath: string;
  defaultConfigFile: string;
  active: boolean;
  accessCount: number;
  createdAt?: string;
  updatedAt?: string;
};

type AdminUser = {
  id: number;
  email: string;
  name?: string;
  role: string;
  active: boolean;
  projectCount?: number;
};

type AdminAccess = {
  id: number;
  accessLevel: string;
  user: AdminUser;
  project: {
    id: number;
    name: string;
    slug: string;
    active: boolean;
  };
};

type AdminOrganization = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  dropboxRootPath: string;
  active: boolean;
  fileCount?: number;
  projectCount?: number;
  userCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

const EMPTY_PROJECT_FORM = {
  name: "",
  slug: "",
  description: "",
  dropboxRootPath: "/projects/",
  defaultConfigFile: "config.kepler.json",
  active: true,
};

const EMPTY_USER_FORM = {
  name: "",
  email: "",
  role: "client",
  password: "",
  active: true,
};

const fieldStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  caretColor: "#0f172a",
};

const selectStyle: React.CSSProperties = {
  ...fieldStyle,
  colorScheme: "light",
};

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Erro na requisição.");
  }
  return data;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(14);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function parseApiDate(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return new Date(`${trimmed}Z`);
  }

  return new Date(trimmed);
}

function formatDate(value?: string) {
  if (!value) return "Não informado";
  try {
    const date = parseApiDate(value);
    if (!date || Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (_error) {
    return value;
  }
}

function statusPill(active: boolean) {
  return active ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200";
}

const AdminPage: React.FC = () => {
  const { authenticated, loading, user, logout } = useSession();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [access, setAccess] = useState<AdminAccess[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [savingProject, setSavingProject] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [syncingDropbox, setSyncingDropbox] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);

  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT_FORM);
  const [projectUploadFile, setProjectUploadFile] = useState<File | null>(null);
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM);
  const [lastGeneratedPassword, setLastGeneratedPassword] = useState("");

  const [accessForm, setAccessForm] = useState({
    userId: "",
    projectId: "",
    accessLevel: "viewer",
  });

  const isAdmin = user?.role === "admin";
  const isEditingProject = editingProjectId !== null;
  const isEditingUser = editingUserId !== null;

  async function refreshAdminData() {
    setError("");
    const [projectsData, accessData, usersData, organizationsData] = await Promise.all([
      fetch("/api/admin/projects", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
      fetch("/api/admin/access", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
      fetch("/api/admin/users", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
      fetch("/api/admin/organizations", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
    ]);

    setProjects(projectsData.projects || []);
    setUsers(usersData.users || accessData.users || []);
    setAccess(accessData.access || []);
    setOrganizations(organizationsData.organizations || []);
  }

  useEffect(() => {
    if (!loading && !authenticated) navigate("/login?next=/admin", { replace: true });
  }, [authenticated, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && !isAdmin) navigate("/projects", { replace: true });
  }, [authenticated, isAdmin, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && isAdmin) {
      refreshAdminData().catch((err) => setError(err.message));
    }
  }, [authenticated, isAdmin, loading]);

  const activeUsers = useMemo(() => users.filter((item) => item.active), [users]);
  const activeProjects = useMemo(() => projects.filter((item) => item.active), [projects]);
  const activeOrganizations = useMemo(() => organizations.filter((item) => item.active), [organizations]);
  const totalOrganizationFiles = useMemo(
    () => organizations.reduce((total, item) => total + Number(item.fileCount || 0), 0),
    [organizations]
  );

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function resetProjectForm() {
    setEditingProjectId(null);
    setProjectForm(EMPTY_PROJECT_FORM);
    setProjectUploadFile(null);
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserForm(EMPTY_USER_FORM);
    setLastGeneratedPassword("");
  }

  function handleEditProject(project: AdminProject) {
    setEditingProjectId(project.id);
    setProjectUploadFile(null);
    setProjectForm({
      name: project.name,
      slug: project.slug,
      description: project.description || "",
      dropboxRootPath: project.dropboxRootPath,
      defaultConfigFile: project.defaultConfigFile,
      active: project.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleEditUser(targetUser: AdminUser) {
    setEditingUserId(targetUser.id);
    setUserForm({
      name: targetUser.name || "",
      email: targetUser.email,
      role: targetUser.role || "client",
      password: "",
      active: targetUser.active,
    });
    setLastGeneratedPassword("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSelectDropboxFile(selection: { folderPath: string; fileName: string }) {
    setProjectUploadFile(null);
    setProjectForm((current) => ({
      ...current,
      dropboxRootPath: selection.folderPath,
      defaultConfigFile: selection.fileName,
    }));
    setSuccess(`Arquivo Dropbox selecionado: ${selection.folderPath}/${selection.fileName}`);
  }

  function handleProjectUploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setProjectUploadFile(file);
    if (!file) return;

    const nextSlug = projectForm.slug || slugify(projectForm.name || file.name.replace(/\.json$/i, ""));
    const nextFileName = file.name.toLowerCase().endsWith(".json") ? file.name : "config.kepler.json";

    setProjectForm((current) => ({
      ...current,
      slug: current.slug || nextSlug,
      dropboxRootPath:
        current.dropboxRootPath && current.dropboxRootPath !== "/projects/"
          ? current.dropboxRootPath
          : nextSlug
          ? `/projects/${nextSlug}`
          : current.dropboxRootPath,
      defaultConfigFile: nextFileName,
    }));
  }

  async function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProject(true);
    setError("");
    setSuccess("");

    try {
      const payload = { ...projectForm, slug: projectForm.slug || slugify(projectForm.name) };

      if (!isEditingProject && projectUploadFile) {
        const formData = new FormData();
        formData.set("name", payload.name);
        formData.set("slug", payload.slug);
        formData.set("description", payload.description || "");
        formData.set("dropboxRootPath", payload.dropboxRootPath || `/projects/${payload.slug}`);
        formData.set("defaultConfigFile", payload.defaultConfigFile || projectUploadFile.name || "config.kepler.json");
        formData.set("active", String(payload.active));
        formData.set("file", projectUploadFile);

        await fetch("/api/admin/projects/upload", {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
          body: formData,
        }).then(readJson);

        setSuccess("Projeto criado e JSON enviado ao Dropbox com sucesso.");
      } else {
        const url = isEditingProject ? `/api/admin/projects/${editingProjectId}` : "/api/admin/projects";
        const method = isEditingProject ? "PUT" : "POST";

        await fetch(url, {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        }).then(readJson);

        setSuccess(isEditingProject ? "Projeto atualizado com sucesso." : "Projeto criado com sucesso.");
      }

      resetProjectForm();
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar projeto.");
    } finally {
      setSavingProject(false);
    }
  }

  async function handleSaveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingUser(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...userForm,
        email: userForm.email.trim().toLowerCase(),
        password: userForm.password.trim(),
      };
      const url = isEditingUser ? `/api/admin/users/${editingUserId}` : "/api/admin/users";
      const method = isEditingUser ? "PUT" : "POST";

      await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      }).then(readJson);

      setSuccess(isEditingUser ? "Usuário atualizado com sucesso." : "Usuário criado com sucesso.");
      resetUserForm();
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar usuário.");
    } finally {
      setSavingUser(false);
    }
  }

  function handleGeneratePassword() {
    const password = generateTemporaryPassword();
    setUserForm((current) => ({ ...current, password }));
    setLastGeneratedPassword(password);
  }

  async function handleSyncDropbox() {
    setSyncingDropbox(true);
    setError("");
    setSuccess("");

    try {
      const data = await fetch("/api/admin/organizations/sync-dropbox?rootPath=/projects", {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);

      setSuccess(
        `Dropbox sincronizado: ${data.organizationsSynced || 0} organização(ões), ${data.filesSynced || 0} arquivo(s), ${data.projectsLinked || 0} projeto(s) vinculados.`
      );
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar Dropbox.");
    } finally {
      setSyncingDropbox(false);
    }
  }

  async function handleDeleteProject(project: AdminProject) {
    const confirmed = window.confirm(
      `Excluir o projeto \"${project.name}\"? Isso remove o cadastro e os vínculos de acesso, mas não apaga o arquivo no Dropbox.`
    );
    if (!confirmed) return;

    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/projects/${project.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);
      if (editingProjectId === project.id) resetProjectForm();
      setSuccess("Projeto excluído com sucesso.");
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir projeto.");
    }
  }

  async function handleDeleteUser(targetUser: AdminUser) {
    const confirmed = window.confirm(
      `Excluir o usuário \"${targetUser.email}\"? Isso remove a conta, sessões e vínculos de acesso.`
    );
    if (!confirmed) return;

    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/users/${targetUser.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);
      if (editingUserId === targetUser.id) resetUserForm();
      setSuccess("Usuário excluído com sucesso.");
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir usuário.");
    }
  }

  async function handleCreateAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingAccess(true);
    setError("");
    setSuccess("");

    try {
      await fetch("/api/admin/access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          userId: Number(accessForm.userId),
          projectId: Number(accessForm.projectId),
          accessLevel: accessForm.accessLevel,
        }),
      }).then(readJson);

      setSuccess("Acesso vinculado com sucesso.");
      setAccessForm({ userId: "", projectId: "", accessLevel: "viewer" });
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao vincular acesso.");
    } finally {
      setSavingAccess(false);
    }
  }

  async function handleDeleteAccess(accessId: number) {
    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/access/${accessId}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);
      setSuccess("Acesso removido com sucesso.");
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover acesso.");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b1220] text-white">
        <p className="animate-pulse">Carregando painel administrativo...</p>
      </main>
    );
  }

  if (!authenticated || !isAdmin) return null;

  const sidebarItems = [
    { href: "#overview", label: "Visão geral" },
    { href: "#organizations", label: "Organizações" },
    { href: "#users", label: "Pessoas" },
    { href: "#projects", label: "Projetos" },
    { href: "#access", label: "Acessos" },
    { href: "#dropbox", label: "Dropbox" },
  ];

  return (
    <main className="min-h-screen bg-[#0b1220] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-slate-800 bg-[#080d18] lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="border-b border-slate-800 px-6 py-5">
              <div className="flex items-center gap-3">
                <img src={Logo} alt="Maõno" className="h-12 w-auto object-contain" />
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-blue-300">Maõno</p>
                  <h1 className="text-base font-bold">Admin Console</h1>
                </div>
              </div>
            </div>

            <nav className="flex-1 space-y-1 px-4 py-5 text-sm">
              {sidebarItems.map((item) => (
                <a key={item.href} href={item.href} className="block rounded-xl px-4 py-3 text-slate-300 transition hover:bg-slate-800 hover:text-white">
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="border-t border-slate-800 p-4 text-sm">
              <Link to="/projects" className="mb-2 block rounded-xl border border-slate-700 px-4 py-3 text-center font-semibold hover:bg-slate-800">
                Meus Projetos
              </Link>
              <button onClick={handleLogout} className="block w-full rounded-xl border border-slate-700 px-4 py-3 font-semibold hover:bg-slate-800">
                Sair
              </button>
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="border-b border-slate-800 bg-[#0f172a]/95 px-6 py-5 backdrop-blur">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm text-slate-400">Workers e Pages / Maõno Maps</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight">Painel Administrativo</h1>
                <p className="mt-1 text-sm text-slate-400">Gestão integrada de organizações, pessoas, projetos, arquivos e acessos.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={refreshAdminData} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-800">
                  Atualizar
                </button>
                <Link to="/admin/files" className="rounded-xl border border-blue-400/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-100 hover:bg-blue-500/20">
                  Gestão Dropbox
                </Link>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-7xl px-6 py-8">
            {error && <div className="mb-6 rounded-2xl border border-red-300/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">{error}</div>}
            {success && <div className="mb-6 rounded-2xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100">{success}</div>}

            <section id="overview" className="scroll-mt-8">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
                  <p className="text-sm text-slate-400">Organizações</p>
                  <p className="mt-2 text-3xl font-bold">{activeOrganizations.length}</p>
                  <p className="mt-1 text-xs text-slate-500">pastas ativas</p>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
                  <p className="text-sm text-slate-400">Projetos</p>
                  <p className="mt-2 text-3xl font-bold">{activeProjects.length}</p>
                  <p className="mt-1 text-xs text-slate-500">mapas ativos</p>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
                  <p className="text-sm text-slate-400">Pessoas</p>
                  <p className="mt-2 text-3xl font-bold">{activeUsers.length}</p>
                  <p className="mt-1 text-xs text-slate-500">usuários ativos</p>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
                  <p className="text-sm text-slate-400">Acessos</p>
                  <p className="mt-2 text-3xl font-bold">{access.length}</p>
                  <p className="mt-1 text-xs text-slate-500">vínculos projeto-usuário</p>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
                  <p className="text-sm text-slate-400">Arquivos</p>
                  <p className="mt-2 text-3xl font-bold">{totalOrganizationFiles}</p>
                  <p className="mt-1 text-xs text-slate-500">itens gerenciados</p>
                </div>
              </div>
            </section>

            <section id="organizations" className="mt-8 scroll-mt-8 rounded-2xl border border-slate-700 bg-[#111827] p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-bold">Organizações</h2>
                  <p className="mt-1 text-sm text-slate-400">Cada organização representa uma pasta principal no Dropbox.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleSyncDropbox} disabled={syncingDropbox} className="rounded-xl border border-orange-300/40 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-500/20 disabled:opacity-60">
                    {syncingDropbox ? "Sincronizando..." : "Sincronizar Dropbox"}
                  </button>
                  <Link to="/admin/files" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800">
                    Gerenciar organizações
                  </Link>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {organizations.length === 0 ? (
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/30 p-5 text-sm text-slate-400">Nenhuma organização cadastrada. Use a sincronização do Dropbox ou crie em Gestão Dropbox.</div>
                ) : organizations.map((organization) => (
                  <article key={organization.id} className="rounded-2xl border border-slate-700 bg-slate-950/25 p-5 transition hover:border-blue-400/40">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold">{organization.name}</h3>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusPill(organization.active)}`}>{organization.active ? "Ativa" : "Inativa"}</span>
                        </div>
                        <p className="mt-1 text-sm text-blue-200">{organization.slug}</p>
                        <p className="mt-2 break-all text-sm text-slate-400">{organization.dropboxRootPath}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          {organization.fileCount || 0} arquivo(s) · {organization.projectCount || 0} projeto(s) · {organization.userCount || 0} usuário(s)
                        </p>
                      </div>
                      <Link to="/admin/files" className="shrink-0 rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold hover:bg-slate-800">
                        Abrir gestão
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <div className="mt-8 grid gap-6 xl:grid-cols-2">
              <section id="users" className="scroll-mt-8 rounded-2xl border border-slate-700 bg-[#111827] p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold">{isEditingUser ? "Editar pessoa" : "Nova pessoa"}</h2>
                    <p className="mt-1 text-sm text-slate-400">Cadastre clientes e defina uma senha inicial de acesso.</p>
                  </div>
                  {isEditingUser && <button className="rounded-xl border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800" type="button" onClick={resetUserForm}>Cancelar</button>}
                </div>

                <form onSubmit={handleSaveUser} className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block"><span className="text-sm text-slate-300">Nome</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={userForm.name} onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label className="block"><span className="text-sm text-slate-300">E-mail</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} type="email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} required /></label>
                  <label className="block"><span className="text-sm text-slate-300">Perfil</span><select className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}><option value="client">client</option><option value="viewer">viewer</option><option value="editor">editor</option><option value="admin">admin</option></select></label>
                  <label className="block"><span className="text-sm text-slate-300">Status</span><select className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={userForm.active ? "active" : "inactive"} onChange={(event) => setUserForm((current) => ({ ...current, active: event.target.value === "active" }))}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
                  <label className="block md:col-span-2"><span className="text-sm text-slate-300">{isEditingUser ? "Nova senha opcional" : "Senha inicial"}</span><div className="mt-1 flex gap-2"><input className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} type="text" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} required={!isEditingUser} /><button className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800" type="button" onClick={handleGeneratePassword}>Gerar</button></div>{lastGeneratedPassword && <p className="mt-2 rounded-xl border border-yellow-300/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">Senha gerada: <strong>{lastGeneratedPassword}</strong>. Copie agora para enviar ao cliente.</p>}</label>
                  <div className="flex flex-wrap gap-3 md:col-span-2"><button className="rounded-xl bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400 disabled:opacity-60" type="submit" disabled={savingUser}>{savingUser ? "Salvando..." : isEditingUser ? "Salvar pessoa" : "Criar pessoa"}</button>{isEditingUser && <button className="rounded-xl border border-slate-600 px-5 py-3 font-semibold hover:bg-slate-800" type="button" onClick={resetUserForm}>Limpar</button>}</div>
                </form>
              </section>

              <section id="projects" className="scroll-mt-8 rounded-2xl border border-slate-700 bg-[#111827] p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold">{isEditingProject ? "Editar projeto" : "Novo projeto"}</h2>
                    <p className="mt-1 text-sm text-slate-400">Cadastre um mapa apontando para uma pasta e um JSON no Dropbox.</p>
                  </div>
                  {isEditingProject && <button className="rounded-xl border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800" type="button" onClick={resetProjectForm}>Cancelar</button>}
                </div>

                <form onSubmit={handleSaveProject} className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block"><span className="text-sm text-slate-300">Nome</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.name} onChange={(event) => { const name = event.target.value; setProjectForm((current) => ({ ...current, name, slug: current.slug ? current.slug : slugify(name) })); }} required /></label>
                  <label className="block"><span className="text-sm text-slate-300">Identificador</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.slug} onChange={(event) => setProjectForm((current) => ({ ...current, slug: slugify(event.target.value) }))} required /></label>
                  <label className="block md:col-span-2"><span className="text-sm text-slate-300">Descrição</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /></label>
                  {!isEditingProject && <label className="block md:col-span-2"><span className="text-sm text-slate-300">Upload do JSON do Kepler</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} type="file" accept=".json,application/json" onChange={handleProjectUploadFile} /><p className="mt-2 text-xs text-slate-400">Ao enviar o JSON aqui, o backend cria a pasta no Dropbox, salva o arquivo e cadastra o projeto.</p>{projectUploadFile && <p className="mt-2 rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">Arquivo selecionado: <strong>{projectUploadFile.name}</strong></p>}</label>}
                  <label className="block"><span className="text-sm text-slate-300">Pasta Dropbox</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.dropboxRootPath} onChange={(event) => setProjectForm((current) => ({ ...current, dropboxRootPath: event.target.value }))} placeholder="/projects/cliente-a" required /></label>
                  <label className="block"><span className="text-sm text-slate-300">Arquivo JSON</span><input className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.defaultConfigFile} onChange={(event) => setProjectForm((current) => ({ ...current, defaultConfigFile: event.target.value }))} required /></label>
                  <label className="block md:col-span-2"><span className="text-sm text-slate-300">Status</span><select className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={projectForm.active ? "active" : "inactive"} onChange={(event) => setProjectForm((current) => ({ ...current, active: event.target.value === "active" }))}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
                  <div className="flex flex-wrap gap-3 md:col-span-2"><button className="rounded-xl bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400 disabled:opacity-60" type="submit" disabled={savingProject}>{savingProject ? "Salvando..." : isEditingProject ? "Salvar projeto" : projectUploadFile ? "Criar projeto e enviar JSON" : "Criar projeto"}</button>{isEditingProject && <button className="rounded-xl border border-slate-600 px-5 py-3 font-semibold hover:bg-slate-800" type="button" onClick={resetProjectForm}>Limpar</button>}</div>
                </form>
              </section>
            </div>

            <section id="dropbox" className="mt-8 scroll-mt-8 rounded-2xl border border-slate-700 bg-[#111827] p-6">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-bold">Seletor Dropbox do projeto</h2>
                  <p className="text-sm text-slate-400">Selecione rapidamente um JSON existente para preencher o cadastro do projeto.</p>
                </div>
                <Link to="/admin/files" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800">
                  Gestão completa de arquivos
                </Link>
              </div>
              <AdminDropboxBrowser currentRootPath={projectForm.dropboxRootPath} currentConfigFile={projectForm.defaultConfigFile} onSelectFile={handleSelectDropboxFile} />
            </section>

            <section id="access" className="mt-8 scroll-mt-8 rounded-2xl border border-slate-700 bg-[#111827] p-6">
              <h2 className="text-lg font-bold">Vincular acesso</h2>
              <p className="mt-1 text-sm text-slate-400">Defina quem pode visualizar, editar ou administrar cada projeto.</p>
              <form onSubmit={handleCreateAccess} className="mt-5 grid gap-4 md:grid-cols-4">
                <label className="block"><span className="text-sm text-slate-300">Pessoa</span><select className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={accessForm.userId} onChange={(event) => setAccessForm((current) => ({ ...current, userId: event.target.value }))} required><option value="">Selecione...</option>{activeUsers.map((item) => <option key={item.id} value={item.id}>{item.email} {item.name ? `- ${item.name}` : ""}</option>)}</select></label>
                <label className="block"><span className="text-sm text-slate-300">Projeto</span><select className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={accessForm.projectId} onChange={(event) => setAccessForm((current) => ({ ...current, projectId: event.target.value }))} required><option value="">Selecione...</option>{activeProjects.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.slug})</option>)}</select></label>
                <label className="block"><span className="text-sm text-slate-300">Permissão</span><select className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={accessForm.accessLevel} onChange={(event) => setAccessForm((current) => ({ ...current, accessLevel: event.target.value }))}><option value="viewer">viewer</option><option value="editor">editor</option><option value="owner">owner</option></select></label>
                <div className="flex items-end"><button className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white hover:bg-emerald-400 disabled:opacity-60" type="submit" disabled={savingAccess}>{savingAccess ? "Salvando..." : "Vincular acesso"}</button></div>
              </form>
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-700 bg-[#111827] p-6">
                <h2 className="text-lg font-bold">Pessoas cadastradas</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="text-slate-400"><tr><th className="border-b border-slate-700 py-3 pr-4">Pessoa</th><th className="border-b border-slate-700 py-3 pr-4">Perfil</th><th className="border-b border-slate-700 py-3 pr-4">Projetos</th><th className="border-b border-slate-700 py-3 pr-4">Status</th><th className="border-b border-slate-700 py-3 pr-4">Ações</th></tr></thead>
                    <tbody>{users.map((item) => <tr key={item.id} className="border-b border-slate-800"><td className="py-3 pr-4"><div className="font-medium">{item.email}</div><div className="text-xs text-slate-500">{item.name || "Sem nome"}</div></td><td className="py-3 pr-4">{item.role}</td><td className="py-3 pr-4">{item.projectCount || 0}</td><td className="py-3 pr-4"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusPill(item.active)}`}>{item.active ? "Ativo" : "Inativo"}</span></td><td className="py-3 pr-4"><div className="flex flex-wrap gap-2"><button className="rounded-lg border border-blue-300/30 px-3 py-1 text-blue-100 hover:bg-blue-500/20" type="button" onClick={() => handleEditUser(item)}>Editar</button><button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteUser(item)}>Excluir</button></div></td></tr>)}</tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-[#111827] p-6">
                <h2 className="text-lg font-bold">Projetos cadastrados</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="text-slate-400"><tr><th className="border-b border-slate-700 py-3 pr-4">Projeto</th><th className="border-b border-slate-700 py-3 pr-4">Dropbox</th><th className="border-b border-slate-700 py-3 pr-4">Acessos</th><th className="border-b border-slate-700 py-3 pr-4">Atualizado</th><th className="border-b border-slate-700 py-3 pr-4">Ações</th></tr></thead>
                    <tbody>{projects.map((project) => <tr key={project.id} className="border-b border-slate-800"><td className="py-3 pr-4"><div className="font-medium">{project.name}</div><div className="text-xs text-blue-200">{project.slug}</div><div className="text-xs text-slate-500">{project.defaultConfigFile}</div></td><td className="py-3 pr-4 break-all text-slate-300">{project.dropboxRootPath}</td><td className="py-3 pr-4">{project.accessCount}</td><td className="py-3 pr-4 text-slate-300">{formatDate(project.updatedAt)}</td><td className="py-3 pr-4"><div className="flex flex-wrap gap-2"><Link className="rounded-lg border border-emerald-300/30 px-3 py-1 text-emerald-100 hover:bg-emerald-500/20" to={`/projects/${project.slug}/map`}>Abrir mapa</Link><button className="rounded-lg border border-blue-300/30 px-3 py-1 text-blue-100 hover:bg-blue-500/20" type="button" onClick={() => handleEditProject(project)}>Editar</button><button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteProject(project)}>Excluir</button></div></td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="mt-8 rounded-2xl border border-slate-700 bg-[#111827] p-6">
              <h2 className="text-lg font-bold">Acessos vinculados</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead className="text-slate-400"><tr><th className="border-b border-slate-700 py-3 pr-4">Pessoa</th><th className="border-b border-slate-700 py-3 pr-4">Projeto</th><th className="border-b border-slate-700 py-3 pr-4">Permissão</th><th className="border-b border-slate-700 py-3 pr-4">Ação</th></tr></thead>
                  <tbody>{access.map((item) => <tr key={item.id} className="border-b border-slate-800"><td className="py-3 pr-4"><div className="font-medium">{item.user.email}</div><div className="text-xs text-slate-500">{item.user.name || item.user.role}</div></td><td className="py-3 pr-4"><div className="font-medium">{item.project.name}</div><div className="text-xs text-blue-200">{item.project.slug}</div></td><td className="py-3 pr-4">{item.accessLevel}</td><td className="py-3 pr-4"><button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteAccess(item.id)}>Remover</button></td></tr>)}</tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
};

export default AdminPage;