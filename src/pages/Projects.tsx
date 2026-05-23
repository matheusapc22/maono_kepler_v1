import React, { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";

function formatDate(value?: string) {
  if (!value) return "Não informado";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch (_error) {
    return value;
  }
}

function permissionLabel(value?: string) {
  const labels: Record<string, string> = {
    viewer: "Visualização",
    editor: "Edição",
    owner: "Proprietário",
  };
  return labels[String(value || "").toLowerCase()] || value || "Acesso";
}

const ProjectsPage: React.FC = () => {
  const { authenticated, loading, user, projects, logout } = useSession();
  const navigate = useNavigate();
  const activeProjects = useMemo(() => projects.filter((project) => project.active !== false), [projects]);

  useEffect(() => {
    if (!loading && !authenticated) navigate("/login?next=/projects", { replace: true });
  }, [authenticated, loading, navigate]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b1220] text-white">
        <p className="animate-pulse">Carregando seus projetos...</p>
      </main>
    );
  }

  if (!authenticated) return null;

  return (
    <main className="min-h-screen bg-[#0b1220] text-white">
      <header className="border-b border-slate-700 bg-[#111827]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            <img src={Logo} alt="Maono" className="h-14 w-auto object-contain" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">Maono Maps</p>
              <h1 className="text-2xl font-bold">Meus Projetos</h1>
              <p className="text-sm text-slate-300">{user?.name || user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === "admin" && (
              <Link to="/admin" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800">
                Painel Admin
              </Link>
            )}
            <button onClick={handleLogout} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800">
              Sair
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
            <p className="text-sm text-slate-400">Projetos liberados</p>
            <p className="mt-2 text-3xl font-bold">{activeProjects.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
            <p className="text-sm text-slate-400">Cliente</p>
            <p className="mt-2 truncate text-xl font-bold">{user?.name || user?.email}</p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-[#111827] p-5">
            <p className="text-sm text-slate-400">Ambiente</p>
            <p className="mt-2 text-3xl font-bold">Produção</p>
          </div>
        </div>

        <div className="mb-5">
          <h2 className="text-xl font-bold">Projetos disponíveis</h2>
          <p className="text-sm text-slate-400">Acesse os mapas liberados para sua conta.</p>
        </div>

        {activeProjects.length === 0 ? (
          <div className="rounded-3xl border border-slate-700 bg-[#111827] p-10 text-center">
            <h2 className="text-xl font-semibold">Nenhum projeto liberado</h2>
            <p className="mt-2 text-slate-400">Sua conta ainda não possui projetos vinculados.</p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {activeProjects.map((project) => (
              <article key={project.slug} className="rounded-3xl border border-slate-700 bg-[#111827] p-6 transition hover:border-blue-400/60">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold">{project.name}</h3>
                      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">Ativo</span>
                      <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-200">{permissionLabel(project.accessLevel)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{project.slug}</p>
                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-300">
                      {project.description || "Projeto geográfico disponível para consulta e análise."}
                    </p>
                  </div>
                  <Link to={`/projects/${project.slug}/map`} className="shrink-0 rounded-2xl bg-blue-500 px-5 py-3 text-center text-sm font-bold text-white hover:bg-blue-400">
                    Abrir mapa
                  </Link>
                </div>
                <div className="mt-6 grid gap-3 border-t border-slate-700 pt-5 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-slate-500">Status do projeto</p>
                    <p className="font-semibold text-slate-200">Ativo e disponível</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Última atualização</p>
                    <p className="font-semibold text-slate-200">{formatDate(project.updatedAt)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export default ProjectsPage;