import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";
import ProjectsSidebar, { type ProjectSidebarSection } from "./ProjectsSidebar";

function parseApiDate(value: string) {
  const trimmed = String(value || "").trim();

  if (!trimmed) return null;

  // Cloudflare D1/SQLite CURRENT_TIMESTAMP retorna UTC no formato:
  // YYYY-MM-DD HH:mm:ss, sem o sufixo Z.
  // Sem essa normalização, o navegador interpreta como horário local
  // e mostra 20:27 em vez de converter UTC para 17:27 no Brasil.
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

    if (!date || Number.isNaN(date.getTime())) {
      return value;
    }

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

function permissionLabel(value?: string) {
  const labels: Record<string, string> = {
    viewer: "Visualização",
    editor: "Edição",
    owner: "Proprietário",
  };
  return labels[String(value || "").toLowerCase()] || value || "Acesso";
}

function getInitials(nameOrEmail?: string) {
  const value = String(nameOrEmail || "M").trim();
  const [first = "M", second = ""] = value.replace(/@.*/, "").split(/[\s._-]+/);
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function relativeUpdateLabel(value?: string) {
  if (!value) return "Atualização não informada";

  const date = parseApiDate(value);
  if (!date || Number.isNaN(date.getTime())) return `Atualizado em ${value}`;

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMinutes < 1) return "Atualizado agora";
  if (diffMinutes < 60) return `Atualizado há ${diffMinutes} min`;
  if (diffHours < 24) return `Atualizado há ${diffHours} h`;
  if (diffDays < 30) return `Atualizado há ${diffDays} dia${diffDays > 1 ? "s" : ""}`;
  if (diffMonths < 12) return `Atualizado há ${diffMonths} mês${diffMonths > 1 ? "es" : ""}`;

  return `Atualizado em ${formatDate(value)}`;
}

function thumbnailClass(index: number) {
  const options = [
    "from-sky-100 via-emerald-50 to-blue-200",
    "from-slate-900 via-blue-950 to-emerald-800",
    "from-orange-100 via-rose-50 to-sky-100",
    "from-emerald-50 via-lime-50 to-slate-100",
    "from-blue-100 via-cyan-50 to-orange-100",
    "from-slate-100 via-white to-blue-100",
  ];

  return options[index % options.length];
}

function permissionBadgeClass(accessLevel?: string) {
  const normalized = String(accessLevel || "").toLowerCase();

  if (normalized === "editor") return "border-blue-200 bg-blue-50 text-blue-700";
  if (normalized === "owner") return "border-purple-200 bg-purple-50 text-purple-700";

  return "border-slate-200 bg-slate-50 text-slate-600";
}

const ProjectsPage: React.FC = () => {
  const { authenticated, loading, user, projects, logout } = useSession();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSection, setSidebarSection] = useState<ProjectSidebarSection>("recent");

  const activeProjects = useMemo(
    () => projects.filter((project) => project.active !== false),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) return activeProjects;

    return activeProjects.filter((project) => {
      const searchable = [
        project.name,
        project.slug,
        project.description,
        project.accessLevel,
        project.defaultConfigFile,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [activeProjects, searchQuery]);

  useEffect(() => {
    if (!loading && !authenticated) navigate("/login?next=/projects", { replace: true });
  }, [authenticated, loading, navigate]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-slate-900">
        <p className="animate-pulse">Carregando seus projetos...</p>
      </main>
    );
  }

  if (!authenticated) return null;

  const sectionTitle = sidebarSection === "recent" ? "Recentes" : "Todos os projetos";

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <div className="flex min-h-screen">
        <ProjectsSidebar
          user={user}
          activeProjectsCount={activeProjects.length}
          searchQuery={searchQuery}
          sidebarSection={sidebarSection}
          onSearchQueryChange={setSearchQuery}
          onSidebarSectionChange={setSidebarSection}
          onLogout={handleLogout}
        />

        <section className="min-w-0 flex-1">
          <header className="flex min-h-20 items-center justify-between border-b border-slate-100 px-6 py-4 lg:px-10">
            <div className="min-w-0">
              <div className="flex items-center gap-3 lg:hidden">
                <img src={Logo} alt="Maõno" className="h-10 w-auto object-contain" />
                <div>
                  <p className="text-xs text-slate-500">Maõno Maps</p>
                  <h1 className="text-xl font-semibold">{sectionTitle}</h1>
                </div>
              </div>
              <h1 className="hidden text-2xl font-semibold tracking-tight lg:block">{sectionTitle}</h1>
              <p className="mt-1 hidden text-sm text-slate-500 lg:block">
                {filteredProjects.length} de {activeProjects.length} projeto(s) disponível(is)
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm md:flex">
                <span>Workspace maps</span>
                <span>⌄</span>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm md:flex">
                <span>Grade</span>
                <span>⌄</span>
              </div>
              {user?.role === "admin" && (
                <Link to="/admin#projects" className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-rose-400">
                  Novo mapa
                </Link>
              )}
            </div>
          </header>

          <div className="px-6 py-7 lg:px-10">
            <div className="mb-8 rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">Projetos liberados pela Maõno</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Cada card abre um mapa Kepler vinculado ao JSON original salvo no Dropbox.
                  </p>
                </div>
                <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                  {activeProjects.length} projeto(s)
                </div>
              </div>
            </div>

            <div className="mb-6 lg:hidden">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <span className="text-slate-500">⌕</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Buscar projeto"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
                />
              </label>
            </div>

            {activeProjects.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-12 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm">▧</div>
                <h2 className="mt-5 text-xl font-semibold text-slate-950">Nenhum projeto liberado</h2>
                <p className="mt-2 text-slate-500">Sua conta ainda não possui projetos vinculados.</p>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-12 text-center">
                <h2 className="text-xl font-semibold text-slate-950">Nenhum projeto encontrado</h2>
                <p className="mt-2 text-slate-500">Tente buscar pelo nome, identificador ou tipo de acesso.</p>
              </div>
            ) : (
              <div className="grid gap-x-7 gap-y-10 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredProjects.map((project, index) => (
                  <Link key={project.slug} to={`/projects/${project.slug}/map`} className="group block">
                    <article>
                      <div className={`relative h-48 overflow-hidden rounded-lg bg-gradient-to-br ${thumbnailClass(index)} shadow-sm ring-1 ring-slate-200 transition group-hover:shadow-lg group-hover:ring-slate-300`}>
                        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(90deg,rgba(15,23,42,.12)_1px,transparent_1px),linear-gradient(rgba(15,23,42,.12)_1px,transparent_1px)] [background-size:28px_28px]" />
                        <div className="absolute left-8 top-8 h-20 w-28 rounded-full border-2 border-sky-400/60 bg-sky-200/20" />
                        <div className="absolute bottom-7 right-8 h-24 w-36 rounded-[999px] border-2 border-emerald-400/60 bg-emerald-200/20" />
                        <div className="absolute left-[18%] top-[54%] h-2.5 w-2.5 rounded-full bg-emerald-500 shadow" />
                        <div className="absolute left-[28%] top-[48%] h-2 w-2 rounded-full bg-blue-500 shadow" />
                        <div className="absolute left-[38%] top-[58%] h-3 w-3 rounded-full bg-rose-500 shadow" />
                        <div className="absolute left-[48%] top-[45%] h-2.5 w-2.5 rounded-full bg-orange-500 shadow" />
                        <div className="absolute bottom-3 left-3 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
                          {permissionLabel(project.accessLevel)}
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold text-slate-950 group-hover:text-blue-700">{project.name}</h2>
                            <p className="mt-1 truncate text-sm text-slate-500">{user?.name || user?.email}</p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${permissionBadgeClass(project.accessLevel)}`}>
                            {permissionLabel(project.accessLevel)}
                          </span>
                        </div>

                        <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-500">
                          {project.description || "Projeto geográfico disponível para consulta e análise."}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                          <span>{relativeUpdateLabel(project.updatedAt)}</span>
                          <span className="text-slate-300">•</span>
                          <span className="truncate">{project.slug}</span>
                        </div>
                      </div>
                    </article>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

export default ProjectsPage;
