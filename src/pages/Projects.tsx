import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";

const ProjectsPage: React.FC = () => {
  const { authenticated, loading, user, projects, logout } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !authenticated) {
      navigate("/login?next=/projects", { replace: true });
    }
  }, [authenticated, loading, navigate]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center">
        <p className="animate-pulse">Carregando sessão...</p>
      </main>
    );
  }

  if (!authenticated) return null;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white">
      <header className="border-b border-white/10 bg-white/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src={Logo} alt="Maõno" className="h-12 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-semibold">Meus Projetos</h1>
              <p className="text-sm text-white/60">
                {user?.name || user?.email} · {user?.role}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
          >
            Sair
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-8">
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <h2 className="text-lg font-semibold">Nenhum projeto liberado</h2>
            <p className="mt-2 text-white/65">
              Sua conta ainda não possui projetos vinculados.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.slug}
                to={`/projects/${project.slug}/map`}
                className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:-translate-y-0.5 hover:bg-white/10 hover:shadow-2xl"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold group-hover:text-blue-200">
                      {project.name}
                    </h2>
                    {project.description && (
                      <p className="mt-2 line-clamp-3 text-sm text-white/60">
                        {project.description}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs text-blue-100">
                    {project.accessLevel}
                  </span>
                </div>

                <div className="mt-6 text-sm text-blue-200">
                  Abrir mapa →
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export default ProjectsPage;
