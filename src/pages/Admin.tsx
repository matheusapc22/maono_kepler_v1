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

  const [projectForm, setProjectForm] = useState({
    name: "",
    slug: "",
    description: "",
    dropboxRootPath: "/projects/",
    defaultConfigFile: "config.kepler.json",
  });

  const [accessForm, setAccessForm] = useState({
    userId: "",
    projectId: "",
    accessLevel: "viewer",
  });

  const isAdmin = user?.role === "admin";

  async function refreshAdminData() {
    setError("");
    const [projectsData, accessData] = await Promise.all([
      fetch("/api/admin/projects", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
      fetch("/api/admin/access", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
    ]);

    setProjects(projectsData.projects || []);
    setUsers(accessData.users || []);
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

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProject(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...projectForm,
        slug: projectForm.slug || slugify(projectForm.name),
      };

      await fetch("/api/admin/projects", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      }).then(readJson);

      setProjectForm({
        name: "",
        slug: "",
        description: "",
        dropboxRootPath: "/projects/",
        defaultConfigFile: "config.kepler.json",
      });
      setSuccess("Projeto criado com sucesso.");
      await refreshAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar projeto.");
    } finally {
      setSavingProject(false);
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
              <p className="text-sm text-white/60">Projetos, Dropbox e acessos de usuários</p>
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
        {error && (
          <div className="mb-6 rounded-xl border border-red-300/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100">
            {success}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold">Novo Projeto</h2>
            <p className="mt-1 text-sm text-white/60">
              Cadastre um projeto apontando para uma pasta e um JSON no Dropbox.
            </p>

            <form onSubmit={handleCreateProject} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm text-white/75">Nome</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={projectForm.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setProjectForm((current) => ({
                      ...current,
                      name,
                      slug: current.slug ? current.slug : slugify(name),
                    }));
                  }}
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Slug</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={projectForm.slug}
                  onChange={(event) => setProjectForm((current) => ({ ...current, slug: slugify(event.target.value) }))}
                  required
                />
              </label>

              <label className="block md:col-span-2">
                <span className="text-sm text-white/75">Descrição</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={projectForm.description}
                  onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Pasta Dropbox</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={projectForm.dropboxRootPath}
                  onChange={(event) => setProjectForm((current) => ({ ...current, dropboxRootPath: event.target.value }))}
                  placeholder="/projects/cliente-a"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Arquivo JSON</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={projectForm.defaultConfigFile}
                  onChange={(event) => setProjectForm((current) => ({ ...current, defaultConfigFile: event.target.value }))}
                  required
                />
              </label>

              <div className="md:col-span-2">
                <button
                  className="rounded-xl bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
                  type="submit"
                  disabled={savingProject}
                >
                  {savingProject ? "Criando..." : "Criar projeto"}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold">Vincular Acesso</h2>
            <p className="mt-1 text-sm text-white/60">
              Libere um projeto para um usuário já cadastrado.
            </p>

            <form onSubmit={handleCreateAccess} className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm text-white/75">Usuário</span>
                <select
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={accessForm.userId}
                  onChange={(event) => setAccessForm((current) => ({ ...current, userId: event.target.value }))}
                  required
                >
                  <option value="">Selecione...</option>
                  {activeUsers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.email} {item.name ? `- ${item.name}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Projeto</span>
                <select
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={accessForm.projectId}
                  onChange={(event) => setAccessForm((current) => ({ ...current, projectId: event.target.value }))}
                  required
                >
                  <option value="">Selecione...</option>
                  {activeProjects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.slug})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Permissão</span>
                <select
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none"
                  value={accessForm.accessLevel}
                  onChange={(event) => setAccessForm((current) => ({ ...current, accessLevel: event.target.value }))}
                >
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="owner">owner</option>
                </select>
              </label>

              <button
                className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white hover:bg-emerald-400 disabled:opacity-60"
                type="submit"
                disabled={savingAccess}
              >
                {savingAccess ? "Salvando..." : "Vincular acesso"}
              </button>
            </form>
          </section>
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Projetos cadastrados</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="border-b border-white/10 py-3 pr-4">Projeto</th>
                  <th className="border-b border-white/10 py-3 pr-4">Slug</th>
                  <th className="border-b border-white/10 py-3 pr-4">Dropbox</th>
                  <th className="border-b border-white/10 py-3 pr-4">Arquivo</th>
                  <th className="border-b border-white/10 py-3 pr-4">Acessos</th>
                  <th className="border-b border-white/10 py-3 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b border-white/5">
                    <td className="py-3 pr-4 font-medium">{project.name}</td>
                    <td className="py-3 pr-4 text-blue-200">{project.slug}</td>
                    <td className="py-3 pr-4 text-white/70">{project.dropboxRootPath}</td>
                    <td className="py-3 pr-4 text-white/70">{project.defaultConfigFile}</td>
                    <td className="py-3 pr-4">{project.accessCount}</td>
                    <td className="py-3 pr-4">{project.active ? "Ativo" : "Inativo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Acessos vinculados</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="border-b border-white/10 py-3 pr-4">Usuário</th>
                  <th className="border-b border-white/10 py-3 pr-4">Projeto</th>
                  <th className="border-b border-white/10 py-3 pr-4">Permissão</th>
                  <th className="border-b border-white/10 py-3 pr-4">Ação</th>
                </tr>
              </thead>
              <tbody>
                {access.map((item) => (
                  <tr key={item.id} className="border-b border-white/5">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{item.user.email}</div>
                      <div className="text-xs text-white/50">{item.user.name || item.user.role}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium">{item.project.name}</div>
                      <div className="text-xs text-blue-200">{item.project.slug}</div>
                    </td>
                    <td className="py-3 pr-4">{item.accessLevel}</td>
                    <td className="py-3 pr-4">
                      <button
                        className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20"
                        type="button"
                        onClick={() => handleDeleteAccess(item.id)}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
};

export default AdminPage;
