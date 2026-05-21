import React, { useMemo } from "react";
import { useNavigate } from "react-router";
import { logout } from "../../lib/api";
import { useSession } from "../../hooks/useSession";

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const session = useSession();

  const sortedProjects = useMemo(() => {
    return [...session.projects].sort((a, b) => a.name.localeCompare(b.name));
  }, [session.projects]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  if (session.loading) {
    return (
      <main className="min-h-screen bg-[#111827] text-white flex items-center justify-center">
        <p>Carregando projetos...</p>
      </main>
    );
  }

  if (!session.authenticated) {
    navigate("/login", { replace: true });
    return null;
  }

  return (
    <main className="min-h-screen bg-[#111827] text-white p-6">
      <section className="max-w-6xl mx-auto">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-yellow-400">Maõno Maps</p>
            <h1 className="text-3xl font-semibold mt-2">Meus Projetos</h1>
            <p className="text-gray-300 mt-2">
              Olá, {session.user?.name || session.user?.email}. Abaixo estão os projetos liberados para sua conta.
            </p>
          </div>

          <button
            className="rounded-lg border border-white/20 px-4 py-2 hover:bg-white/10"
            type="button"
            onClick={handleLogout}
          >
            Sair
          </button>
        </header>

        {session.error && (
          <div className="mb-6 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {session.error}
          </div>
        )}

        {sortedProjects.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#1f2937] p-8">
            <h2 className="text-xl font-semibold">Nenhum projeto liberado</h2>
            <p className="text-gray-300 mt-2">
              Sua conta está ativa, mas ainda não há projetos vinculados a ela.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {sortedProjects.map((project) => (
              <article
                key={project.slug}
                className="rounded-2xl border border-white/10 bg-[#1f2937] p-6 shadow-lg"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{project.name}</h2>
                    <p className="text-sm text-gray-400 mt-1">/{project.slug}</p>
                  </div>
                  <span className="rounded-full bg-yellow-500/10 text-yellow-300 text-xs px-3 py-1 border border-yellow-500/20">
                    {project.accessLevel}
                  </span>
                </div>

                {project.description && (
                  <p className="text-gray-300 mt-4">{project.description}</p>
                )}

                <button
                  className="mt-6 w-full rounded-lg bg-yellow-500 text-[#111827] font-semibold px-4 py-3 hover:bg-yellow-400"
                  type="button"
                  onClick={() => navigate(`/projects/${project.slug}/map`)}
                >
                  Abrir mapa
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export default ProjectsPage;
