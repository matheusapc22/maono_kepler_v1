import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";
import ProjectsSidebar, { type ProjectSidebarSection } from "./ProjectsSidebar";

type PanelProfile = {
  eyebrow: string;
  title: string;
  description: string;
  roleLabel: string;
  primaryMetricLabel: string;
  secondaryMetricLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  projectActionLabel: string;
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
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
  return labels[normalize(value)] || value || "Acesso";
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

function permissionBadgeClass(accessLevel?: string) {
  const normalized = normalize(accessLevel);

  if (normalized === "editor") return "border-blue-200 bg-blue-50 text-blue-700";
  if (normalized === "owner") return "border-purple-200 bg-purple-50 text-purple-700";

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function canEditProject(accessLevel?: string) {
  return ["editor", "owner"].includes(normalize(accessLevel));
}

function getPanelProfile(role?: string): PanelProfile {
  const normalizedRole = normalize(role);

  if (normalizedRole === "admin") {
    return {
      eyebrow: "Console administrativo",
      title: "Gestão de projetos",
      description: "Visão geral de todos os mapas ativos, com acesso ao painel administrativo, cadastro de usuários, vínculos e arquivos.",
      roleLabel: "Administrador",
      primaryMetricLabel: "Projetos administrados",
      secondaryMetricLabel: "Projetos editáveis",
      emptyTitle: "Nenhum projeto cadastrado",
      emptyDescription: "Crie o primeiro mapa pelo painel administrativo para liberar acesso aos usuários.",
      projectActionLabel: "Administrar mapa",
    };
  }

  if (normalizedRole === "editor") {
    return {
      eyebrow: "Área de edição",
      title: "Projetos para edição",
      description: "Acesse os mapas liberados para editar camadas, estilos, filtros e salvar alterações no arquivo do projeto.",
      roleLabel: "Editor",
      primaryMetricLabel: "Projetos liberados",
      secondaryMetricLabel: "Com permissão de edição",
      emptyTitle: "Nenhum projeto para edição",
      emptyDescription: "Sua conta ainda não possui projetos com permissão de edição.",
      projectActionLabel: "Abrir para editar",
    };
  }

  if (normalizedRole === "viewer") {
    return {
      eyebrow: "Área de consulta",
      title: "Projetos para visualização",
      description: "Consulte mapas e análises liberados para sua conta, sem alterar os arquivos originais do projeto.",
      roleLabel: "Visualizador",
      primaryMetricLabel: "Projetos disponíveis",
      secondaryMetricLabel: "Somente leitura",
      emptyTitle: "Nenhum projeto para visualização",
      emptyDescription: "Sua conta ainda não possui mapas liberados para consulta.",
      projectActionLabel: "Abrir mapa",
    };
  }

  return {
    eyebrow: "Área do cliente",
    title: "Meus projetos",
    description: "Acompanhe os mapas e análises geográficas disponibilizados pela Maõno para sua organização.",
    roleLabel: "Cliente",
    primaryMetricLabel: "Projetos liberados",
    secondaryMetricLabel: "Projetos editáveis",
    emptyTitle: "Nenhum projeto liberado",
    emptyDescription: "Sua conta ainda não possui projetos vinculados.",
    projectActionLabel: "Abrir mapa",
  };
}

function projectActionLabel(defaultLabel: string, userRole?: string, accessLevel?: string) {
  if (normalize(userRole) === "admin") return "Administrar mapa";
  if (canEditProject(accessLevel)) return "Abrir para editar";
  return defaultLabel;
}

function projectThumbnailUrl(slug: string, updatedAt?: string) {
  const cacheKey = encodeURIComponent(updatedAt || String(Date.now()));
  return `/api/projects/${encodeURIComponent(slug)}/thumbnail?v=${cacheKey}`;
}

const ProjectsPage: React.FC = () => {
  const { authenticated, loading, user, projects, logout } = useSession();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSection, setSidebarSection] = useState<ProjectSidebarSection>("recent");
  const [missingThumbnailSlugs, setMissingThumbnailSlugs] = useState<Record<string, true>>({});

  const activeProjects = useMemo(
    () => projects.filter((project) => project.active !== false),
    [projects]
  );

  const editableProjectsCount = useMemo(() => {
    if (normalize(user?.role) === "admin") return activeProjects.length;
    return activeProjects.filter((project) => canEditProject(project.accessLevel)).length;
  }, [activeProjects, user?.role]);

  const readOnlyProjectsCount = useMemo(
    () => activeProjects.filter((project) => !canEditProject(project.accessLevel)).length,
    [activeProjects]
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

  function markThumbnailMissing(slug: string) {
    setMissingThumbnailSlugs((current) => ({ ...current, [slug]: true }));
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f172a] text-white">
        <p className="animate-pulse">Carregando seus projetos...</p>
      </main>
    );
  }

  if (!authenticated) return null;

  const panelProfile = getPanelProfile(user?.role);
  const sectionTitle = sidebarSection === "recent" ? "Recentes" : "Todos os projetos";

  return (
    <main className="min-h-screen bg-[#0f172a] text-slate-100">
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
          <header className="flex min-h-20 items-center justify-between border-b border-slate-700 bg-[#1f2937] px-6 py-4 lg:px-10">
            <div className="min-w-0">
              <div className="flex items-center gap-3 lg:hidden">
                <img src={Logo} alt="Maõno" className="h-10 w-auto object-contain" />
                <div>
                  <p className="text-xs text-slate-300">Maõno Maps</p>
                  <h1 className="text-xl font-semibold text-white">{sectionTitle}</h1>
                </div>
              </div>
              <p className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-blue-200 lg:block">{panelProfile.eyebrow}</p>
              <h1 className="hidden text-2xl font-semibold tracking-tight text-white lg:block">{sectionTitle}</h1>
              <p className="mt-1 hidden text-sm text-slate-400 lg:block">
                {filteredProjects.length} de {activeProjects.length} projeto(s) disponível(is)
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-100 md:inline-flex">
                {panelProfile.roleLabel}
              </span>
              <div className="hidden items-center gap-2 rounded-full border border-slate-600 bg-[#111827] px-4 py-2 text-sm text-slate-300 shadow-sm md:flex">
                <span>Workspace maps</span>
                <span>⌄</span>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-slate-600 bg-[#111827] px-4 py-2 text-sm text-slate-300 shadow-sm md:flex">
                <span>Grade</span>
                <span>⌄</span>
              </div>
              {user?.role === "admin" && (
                <Link to="/admin#projects" className="rounded-xl border border-slate-600 bg-[#111827] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800">
                  Novo mapa
                </Link>
              )}
            </div>
          </header>

          <div className="px-6 py-7 lg:px-10">
            <div className="mb-8 rounded-3xl border border-slate-700 bg-[#111827] px-6 py-6 shadow-2xl shadow-black/10">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-yellow-400/30 bg-yellow-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-yellow-100">
                      {panelProfile.roleLabel}
                    </span>
                    <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-100">
                      Painel inicial da plataforma
                    </span>
                  </div>
                  <h2 className="mt-4 text-2xl font-bold text-white">{panelProfile.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{panelProfile.description}</p>
                </div>

                <div className="grid min-w-[260px] gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <div className="rounded-2xl border border-slate-700 bg-[#0f172a] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{panelProfile.primaryMetricLabel}</p>
                    <p className="mt-2 text-3xl font-bold text-white">{activeProjects.length}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-[#0f172a] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{panelProfile.secondaryMetricLabel}</p>
                    <p className="mt-2 text-3xl font-bold text-white">{editableProjectsCount}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-[#0f172a] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Somente leitura</p>
                    <p className="mt-2 text-3xl font-bold text-white">{readOnlyProjectsCount}</p>
                  </div>
                </div>
              </div>

              {user?.role === "admin" && (
                <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-700 pt-5">
                  <Link to="/admin" className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-400">
                    Abrir painel admin
                  </Link>
                  <Link to="/admin/files" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800">
                    Gerenciar Dropbox
                  </Link>
                </div>
              )}
            </div>

            <div className="mb-6 lg:hidden">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-[#111827] px-4 py-3 shadow-sm">
                <span className="text-slate-400">⌕</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Buscar projeto"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                />
              </label>
            </div>

            {activeProjects.length === 0 ? (
              <div className="rounded-3xl border border-slate-700 bg-[#111827] p-12 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700 bg-[#0f172a] text-3xl shadow-sm">▧</div>
                <h2 className="mt-5 text-xl font-semibold text-white">{panelProfile.emptyTitle}</h2>
                <p className="mt-2 text-slate-400">{panelProfile.emptyDescription}</p>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-3xl border border-slate-700 bg-[#111827] p-12 text-center">
                <h2 className="text-xl font-semibold text-white">Nenhum projeto encontrado</h2>
                <p className="mt-2 text-slate-400">Tente buscar pelo nome, identificador ou tipo de acesso.</p>
              </div>
            ) : (
              <div className="grid gap-x-7 gap-y-10 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredProjects.map((project) => {
                  const actionLabel = projectActionLabel(panelProfile.projectActionLabel, user?.role, project.accessLevel);
                  const hasMissingThumbnail = Boolean(missingThumbnailSlugs[project.slug]);
                  const thumbnailUrl = projectThumbnailUrl(project.slug, project.updatedAt);

                  return (
                    <Link key={project.slug} to={`/projects/${project.slug}/map`} className="group block">
                      <article className="rounded-3xl border border-slate-700 bg-[#111827] p-4 transition hover:border-blue-400/60 hover:bg-[#121c2f]">
                        <div className="relative h-48 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-emerald-900 shadow-sm ring-1 ring-slate-700 transition group-hover:shadow-lg group-hover:ring-blue-400/50">
                          {!hasMissingThumbnail && (
                            <img
                              src={thumbnailUrl}
                              alt={`Preview do projeto ${project.name}`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              onError={() => markThumbnailMissing(project.slug)}
                            />
                          )}
                          {hasMissingThumbnail && (
                            <>
                              <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(90deg,rgba(244,241,232,.12)_1px,transparent_1px),linear-gradient(rgba(244,241,232,.12)_1px,transparent_1px)] [background-size:28px_28px]" />
                              <div className="absolute left-8 top-8 h-20 w-28 rounded-md border-2 border-yellow-400/60 bg-yellow-200/10" />
                              <div className="absolute bottom-7 right-8 h-24 w-36 rounded-md border-2 border-emerald-400/60 bg-emerald-200/10" />
                              <div className="absolute left-[18%] top-[54%] h-2.5 w-2.5 rounded-sm bg-emerald-500 shadow" />
                              <div className="absolute left-[28%] top-[48%] h-2 w-2 rounded-sm bg-blue-500 shadow" />
                              <div className="absolute left-[38%] top-[58%] h-3 w-3 rounded-sm bg-rose-500 shadow" />
                              <div className="absolute left-[48%] top-[45%] h-2.5 w-2.5 rounded-sm bg-orange-500 shadow" />
                            </>
                          )}
                          <div className="absolute bottom-3 left-3 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
                            {permissionLabel(project.accessLevel)}
                          </div>
                          {!hasMissingThumbnail && (
                            <div className="absolute bottom-3 right-3 rounded-full border border-emerald-200/50 bg-emerald-900/80 px-3 py-1 text-xs font-bold text-emerald-50 backdrop-blur">
                              Preview salvo
                            </div>
                          )}
                        </div>

                        <div className="mt-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h2 className="truncate text-base font-semibold text-white group-hover:text-blue-200">{project.name}</h2>
                              <p className="mt-1 truncate text-sm font-semibold text-slate-300">{user?.name || user?.email}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${permissionBadgeClass(project.accessLevel)}`}>
                              {permissionLabel(project.accessLevel)}
                            </span>
                          </div>

                          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-slate-300">
                            {project.description || "Projeto geográfico disponível para consulta e análise."}
                          </p>

                          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
                            <span>{relativeUpdateLabel(project.updatedAt)}</span>
                            <span className="text-slate-600">•</span>
                            <span className="truncate">{project.slug}</span>
                          </div>

                          <div className="mt-4 rounded-2xl border border-slate-700 bg-[#0f172a] px-4 py-3 text-sm font-bold text-blue-100 transition group-hover:border-blue-400/40 group-hover:text-white">
                            {actionLabel}
                          </div>
                        </div>
                      </article>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

export default ProjectsPage;
