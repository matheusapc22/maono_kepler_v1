import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";

type AdminProject = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  dropboxRootPath: string;
  defaultConfigFile: string;
  active: boolean;
  accessCount: number;
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

const AdminPage: React.FC = () => {
  const { authenticated, loading, user, logout } = useSession();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [access, setAccess] = useState<AdminAccess[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);

  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT_FORM);
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
    const [projectsData, accessData, usersData] = await Promise.all([
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
    ]);

    setProjects(projectsData.projects || []);
    setUsers(usersData.users || accessData.users || []);
    setAccess(accessData.access || []);
  }

  useEffect(() => {
    if (!loading && !authenticated) {
      navigate("/login?next=/admin", { replace: true });
    }
  }, [authenticated, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && !isAdmin) {
      navigate("/projects", { replace: true });
    }
  }, [authenticated, isAdmin, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && isAdmin) {
      refreshAdminData().catch((err) => setError(err.message));
    }
  }, [authenticated, isAdmin, loading]);

  const activeUsers = useMemo(
    () => users.filter((item) => item.active),
    [users]
  );

  const activeProjects = useMemo(
    () => projects.filter((item) => item.active),
    [projects]
  );

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function resetProjectForm() {
    setEditingProjectId(null);
    setProjectForm(EMPTY_PROJECT_FORM);
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserForm(EMPTY_USER_FORM);
    setLastGeneratedPassword("");
  }

  function handleEditProject(project: AdminProject) {
    setEditingProjectId(project.id);
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

  async function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProject(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...projectForm,
        slug: projectForm.slug || slugify(projectForm.name),
      };

      const url = isEditingProject
        ? `/api/admin/projects/${editingProjectId}`
        : "/api/admin/projects";
      const method = isEditingProject ? "PUT" : "POST";

      await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      }).then(readJson);

      setSuccess(isEditingProject ? "Projeto atualizado com sucesso." : "Projeto criado com sucesso.");
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
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
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
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          userId: Number(accessForm.userId),
          projectId: Number(accessForm.projectId),
          accessLevel: accessForm.accessLevel,
        }),
      }).then(readJson);

      setSuccess("Acesso vinculado com sucesso.");
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
      <main className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center">
        <p className="animate-pulse">Carregando painel administrativo...</p>
      </main>
    );
  }

  if (!authenticated || !isAdmin) return null;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white">
      <header className="border-b border-white/10 bg-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src={Logo} alt="Maõno" className="h-12 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-semibold">Painel Administrativo</h1>
              <p className="text-sm text-white/60">Usuários, projetos, Dropbox e acessos</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10" to="/projects">
              Meus Projetos
            </Link>
            <button onClick={handleLogout} className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10">
              Sair
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        {error && <div className="mb-6 rounded-xl border border-red-300/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">{error}</div>}
        {success && <div className="mb-6 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100">{success}</div>}

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{isEditingUser ? "Editar Usuário" : "Novo Usuário"}</h2>
                <p className="mt-1 text-sm text-white/60">
                  Cadastre clientes e defina uma senha inicial de acesso.
                </p>
              </div>
              {isEditingUser && (
                <button className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10" type="button" onClick={resetUserForm}>
                  Cancelar edição
                </button>
              )}
            </div>

            <form onSubmit={handleSaveUser} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm text-white/75">Nome</span>
                <input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={userForm.name} onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="block">
                <span className="text-sm text-white/75">E-mail</span>
                <input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} type="email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} required />
              </label>
              <label className="block">
                <span className="text-sm text-white/75">Perfil</span>
                <select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}>
                  <option value="client">client</option>
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-white/75">Status</span>
                <select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={userForm.active ? "active" : "inactive"} onChange={(event) => setUserForm((current) => ({ ...current, active: event.target.value === "active" }))}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm text-white/75">{isEditingUser ? "Nova senha opcional" : "Senha inicial"}</span>
                <div className="mt-1 flex gap-2">
                  <input className="w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} type="text" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} required={!isEditingUser} />
                  <button className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10" type="button" onClick={handleGeneratePassword}>
                    Gerar
                  </button>
                </div>
                {lastGeneratedPassword && (
                  <p className="mt-2 rounded-lg border border-yellow-300/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
                    Senha gerada: <strong>{lastGeneratedPassword}</strong>. Copie agora para enviar ao cliente.
                  </p>
                )}
              </label>
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <button className="rounded-xl bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400 disabled:opacity-60" type="submit" disabled={savingUser}>
                  {savingUser ? "Salvando..." : isEditingUser ? "Salvar usuário" : "Criar usuário"}
                </button>
                {isEditingUser && <button className="rounded-xl border border-white/20 px-5 py-3 font-semibold text-white hover:bg-white/10" type="button" onClick={resetUserForm}>Limpar usuário</button>}
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{isEditingProject ? "Editar Projeto" : "Novo Projeto"}</h2>
                <p className="mt-1 text-sm text-white/60">
                  Cadastre um projeto apontando para uma pasta e um JSON no Dropbox.
                </p>
              </div>
              {isEditingProject && <button className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10" type="button" onClick={resetProjectForm}>Cancelar edição</button>}
            </div>

            <form onSubmit={handleSaveProject} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block"><span className="text-sm text-white/75">Nome</span><input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.name} onChange={(event) => { const name = event.target.value; setProjectForm((current) => ({ ...current, name, slug: current.slug ? current.slug : slugify(name) })); }} required /></label>
              <label className="block"><span className="text-sm text-white/75">Identificador do projeto</span><input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.slug} onChange={(event) => setProjectForm((current) => ({ ...current, slug: slugify(event.target.value) }))} required /></label>
              <label className="block md:col-span-2"><span className="text-sm text-white/75">Descrição</span><input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className="block"><span className="text-sm text-white/75">Pasta Dropbox</span><input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.dropboxRootPath} onChange={(event) => setProjectForm((current) => ({ ...current, dropboxRootPath: event.target.value }))} placeholder="/projects/cliente-a" required /></label>
              <label className="block"><span className="text-sm text-white/75">Arquivo JSON</span><input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={projectForm.defaultConfigFile} onChange={(event) => setProjectForm((current) => ({ ...current, defaultConfigFile: event.target.value }))} required /></label>
              <label className="block md:col-span-2"><span className="text-sm text-white/75">Status</span><select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={projectForm.active ? "active" : "inactive"} onChange={(event) => setProjectForm((current) => ({ ...current, active: event.target.value === "active" }))}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
              <div className="flex flex-wrap gap-3 md:col-span-2"><button className="rounded-xl bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400 disabled:opacity-60" type="submit" disabled={savingProject}>{savingProject ? "Salvando..." : isEditingProject ? "Salvar alterações" : "Criar projeto"}</button>{isEditingProject && <button className="rounded-xl border border-white/20 px-5 py-3 font-semibold text-white hover:bg-white/10" type="button" onClick={resetProjectForm}>Limpar formulário</button>}</div>
            </form>
          </section>
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Vincular Acesso</h2>
          <form onSubmit={handleCreateAccess} className="mt-5 grid gap-4 md:grid-cols-4">
            <label className="block"><span className="text-sm text-white/75">Usuário</span><select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={accessForm.userId} onChange={(event) => setAccessForm((current) => ({ ...current, userId: event.target.value }))} required><option value="">Selecione...</option>{activeUsers.map((item) => <option key={item.id} value={item.id}>{item.email} {item.name ? `- ${item.name}` : ""}</option>)}</select></label>
            <label className="block"><span className="text-sm text-white/75">Projeto</span><select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={accessForm.projectId} onChange={(event) => setAccessForm((current) => ({ ...current, projectId: event.target.value }))} required><option value="">Selecione...</option>{activeProjects.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.slug})</option>)}</select></label>
            <label className="block"><span className="text-sm text-white/75">Permissão</span><select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={accessForm.accessLevel} onChange={(event) => setAccessForm((current) => ({ ...current, accessLevel: event.target.value }))}><option value="viewer">viewer</option><option value="editor">editor</option><option value="owner">owner</option></select></label>
            <div className="flex items-end"><button className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white hover:bg-emerald-400 disabled:opacity-60" type="submit" disabled={savingAccess}>{savingAccess ? "Salvando..." : "Vincular acesso"}</button></div>
          </form>
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Usuários cadastrados</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-white/60"><tr><th className="border-b border-white/10 py-3 pr-4">Usuário</th><th className="border-b border-white/10 py-3 pr-4">Perfil</th><th className="border-b border-white/10 py-3 pr-4">Projetos</th><th className="border-b border-white/10 py-3 pr-4">Status</th><th className="border-b border-white/10 py-3 pr-4">Ações</th></tr></thead>
              <tbody>{users.map((item) => <tr key={item.id} className="border-b border-white/5"><td className="py-3 pr-4"><div className="font-medium">{item.email}</div><div className="text-xs text-white/50">{item.name || "Sem nome"}</div></td><td className="py-3 pr-4">{item.role}</td><td className="py-3 pr-4">{item.projectCount || 0}</td><td className="py-3 pr-4">{item.active ? "Ativo" : "Inativo"}</td><td className="py-3 pr-4"><div className="flex flex-wrap gap-2"><button className="rounded-lg border border-blue-300/30 px-3 py-1 text-blue-100 hover:bg-blue-500/20" type="button" onClick={() => handleEditUser(item)}>Editar</button><button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteUser(item)}>Excluir</button></div></td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Projetos cadastrados</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="text-white/60"><tr><th className="border-b border-white/10 py-3 pr-4">Projeto</th><th className="border-b border-white/10 py-3 pr-4">Identificador</th><th className="border-b border-white/10 py-3 pr-4">Dropbox</th><th className="border-b border-white/10 py-3 pr-4">Arquivo</th><th className="border-b border-white/10 py-3 pr-4">Acessos</th><th className="border-b border-white/10 py-3 pr-4">Status</th><th className="border-b border-white/10 py-3 pr-4">Ações</th></tr></thead>
              <tbody>{projects.map((project) => <tr key={project.id} className="border-b border-white/5"><td className="py-3 pr-4 font-medium">{project.name}</td><td className="py-3 pr-4 text-blue-200">{project.slug}</td><td className="py-3 pr-4 text-white/70">{project.dropboxRootPath}</td><td className="py-3 pr-4 text-white/70">{project.defaultConfigFile}</td><td className="py-3 pr-4">{project.accessCount}</td><td className="py-3 pr-4">{project.active ? "Ativo" : "Inativo"}</td><td className="py-3 pr-4"><div className="flex flex-wrap gap-2"><button className="rounded-lg border border-blue-300/30 px-3 py-1 text-blue-100 hover:bg-blue-500/20" type="button" onClick={() => handleEditProject(project)}>Editar</button><button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteProject(project)}>Excluir</button></div></td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Acessos vinculados</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="text-white/60"><tr><th className="border-b border-white/10 py-3 pr-4">Usuário</th><th className="border-b border-white/10 py-3 pr-4">Projeto</th><th className="border-b border-white/10 py-3 pr-4">Permissão</th><th className="border-b border-white/10 py-3 pr-4">Ação</th></tr></thead>
              <tbody>{access.map((item) => <tr key={item.id} className="border-b border-white/5"><td className="py-3 pr-4"><div className="font-medium">{item.user.email}</div><div className="text-xs text-white/50">{item.user.name || item.user.role}</div></td><td className="py-3 pr-4"><div className="font-medium">{item.project.name}</div><div className="text-xs text-blue-200">{item.project.slug}</div></td><td className="py-3 pr-4">{item.accessLevel}</td><td className="py-3 pr-4"><button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteAccess(item.id)}>Remover</button></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
};

export default AdminPage;
