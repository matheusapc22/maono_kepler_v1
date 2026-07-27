import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import {
  can,
  type AccessControlOrganization,
  type AccessControlProject,
  type AccessControlUser,
  type PermissionContext,
} from "../access-control/can";
import { PERMISSION, type Permission } from "../access-control/permissions";
import {
  useSession,
  type MaonoProject,
  type MaonoUser,
} from "../auth/session";
import { ProjectsPageSkeleton } from "../components/loading/Skeleton";
import ProjectsSidebar, {
  type ProjectSidebarSection,
} from "./ProjectsSidebar";
import AdminShortcutSection from "./Projects/components/AdminShortcutSection";
import AuditShortcutSection from "./Projects/components/AuditShortcutSection";
import DocumentsSection from "./Projects/components/DocumentsSection";
import RoadmapSection from "./Projects/components/RoadmapSection";
import LimitsPlansSection from "./Projects/components/LimitsPlansSection";
import OrganizationSection from "./Projects/components/OrganizationSection";
import TicketsSection from "./Projects/components/TicketsSection";
import UsersAccessSection from "./Projects/components/UsersAccessSection";
import ProjectsSection from "./Projects/components/ProjectsSection";
import {
  fetchProjects,
  setProjectFavorite,
  type ProjectListItem,
  type ProjectSectionKey,
} from "./Projects/projects-api";
import "./Projects/projects.css";
import "./Projects/components/project-cards.css";

const SECTION_PERMISSIONS: Partial<Record<ProjectSidebarSection, Permission>> = {
  files: PERMISSION.DOCUMENT_VIEW,
  requests: PERMISSION.TICKET_VIEW,
  roadmap: PERMISSION.ROADMAP_VIEW,
  users: PERMISSION.USERS_VIEW,
  organization: PERMISSION.ORGANIZATION_VIEW,
  limits: PERMISSION.LIMITS_VIEW,
  audit: PERMISSION.AUDIT_VIEW,
  backend: PERMISSION.ADMIN_PANEL_ACCESS,
};

type ManagementSectionProps = {
  user: MaonoUser | null;
  organizationId: number | string | null;
  projects: MaonoProject[];
  projectsCount: number;
};

/**
 * Adaptadores temporários para permitir que o router já passe organizationId
 * e projects sem obrigar todos os componentes da Sprint 8 a consumirem essas
 * props imediatamente.
 */
const UsersAccessSectionWithProps =
  UsersAccessSection as React.ComponentType<
    Pick<ManagementSectionProps, "user" | "organizationId" | "projects">
  >;

const OrganizationSectionWithProps =
  OrganizationSection as React.ComponentType<
    Pick<
      ManagementSectionProps,
      "user" | "organizationId" | "projects" | "projectsCount"
    >
  >;

const LimitsPlansSectionWithProps =
  LimitsPlansSection as React.ComponentType<
    Pick<
      ManagementSectionProps,
      "user" | "organizationId" | "projects" | "projectsCount"
    >
  >;

/**
 * Adaptador temporário do Grupo 5.
 *
 * O Grupo 6 adicionará estas props diretamente ao tipo de ProjectsSection.
 * Até lá, o React encaminha as props sem impacto e o build permanece
 * compatível com a implementação anterior do componente.
 */
type ProjectsSectionMetadataProps = React.ComponentProps<
  typeof ProjectsSection
> & {
  canProjectEdit: (project: ProjectListItem) => boolean;
  onProjectUpdated: (project: ProjectListItem) => void;
};

const ProjectsSectionWithMetadata =
  ProjectsSection as React.ComponentType<ProjectsSectionMetadataProps>;

function isProjectSection(
  section: ProjectSidebarSection,
): section is ProjectSectionKey {
  return section === "all" || section === "recent" || section === "favorites";
}

function sectionTitle(section: ProjectSidebarSection) {
  const titles: Record<ProjectSidebarSection, string> = {
    all: "Todos os Projetos",
    recent: "Recentes",
    favorites: "Favoritos",
    files: "Arquivos e Documentos",
    requests: "Central de Chamados",
    roadmap: "Roadmap",
    users: "Usuários e Acessos",
    organization: "Organização",
    limits: "Limites e Planos",
    audit: "Auditoria",
    backend: "Administração Maõno",
  };

  return titles[section];
}

function userAsAccessControlUser(user: MaonoUser | null) {
  return user as AccessControlUser | null;
}

function projectAsAccessControlProject(project: MaonoProject) {
  return project as AccessControlProject;
}

function buildOrganizationContext(user: MaonoUser | null): PermissionContext {
  if (!user) {
    return {};
  }

  const accessUser = user as AccessControlUser & {
    activeOrganization?: AccessControlOrganization | null;
    organization?: AccessControlOrganization | null;
  };

  const organization =
    accessUser.activeOrganization ?? accessUser.organization ?? undefined;

  const organizationId =
    accessUser.activeOrganizationId ??
    accessUser.organizationId ??
    accessUser.organization_id ??
    organization?.id ??
    organization?.organizationId ??
    undefined;

  return {
    organizationId,
    organization: organization ?? undefined,
    permissions: accessUser.permissions,
    scopes: accessUser.scopes,
  };
}

function getOrganizationIdFromContext(
  context: PermissionContext,
): number | string | null {
  const organizationId =
    context.organizationId ??
    context.organization?.id ??
    context.organization?.organizationId ??
    null;

  return organizationId === undefined ? null : organizationId;
}

function buildProjectContext(
  user: MaonoUser | null,
  project: MaonoProject,
): PermissionContext {
  const organizationContext = buildOrganizationContext(user);
  const accessProject = projectAsAccessControlProject(project);

  return {
    ...organizationContext,
    project: accessProject,
    projectId: project.id ?? project.slug,
    projectAccessLevel: project.accessLevel,
    organizationId:
      project.organizationId ??
      project.organization_id ??
      organizationContext.organizationId,
    permissions: [
      ...(organizationContext.permissions ?? []),
      ...(project.permissions ?? []),
    ],
  };
}

function buildSectionPermissionContext(user: MaonoUser | null) {
  return buildOrganizationContext(user);
}

function canUser(
  user: MaonoUser | null,
  permission: Permission,
  context: PermissionContext = {},
) {
  return can(userAsAccessControlUser(user), permission, context);
}

function canProject(
  user: MaonoUser | null,
  permission: Permission,
  project: MaonoProject,
) {
  return canUser(user, permission, buildProjectContext(user, project));
}

function sameProject(
  project: ProjectListItem,
  updatedProject: ProjectListItem,
) {
  if (
    project.id !== null &&
    project.id !== undefined &&
    updatedProject.id !== null &&
    updatedProject.id !== undefined
  ) {
    return String(project.id) === String(updatedProject.id);
  }

  return project.slug === updatedProject.slug;
}

export function mergeProjectSnapshot(
  projects: ProjectListItem[],
  updatedProject: ProjectListItem,
) {
  return projects.map((project) => {
    if (!sameProject(project, updatedProject)) {
      return project;
    }

    const favorite =
      updatedProject.favorite ??
      updatedProject.favorited ??
      project.favorite ??
      project.favorited;

    return {
      ...project,
      ...updatedProject,
      favorite,
      favorited: favorite,
      thumbnailUrl:
        updatedProject.thumbnailUrl ??
        updatedProject.thumbnail_url ??
        project.thumbnailUrl ??
        project.thumbnail_url,
      thumbnail_url:
        updatedProject.thumbnail_url ??
        updatedProject.thumbnailUrl ??
        project.thumbnail_url ??
        project.thumbnailUrl,
      accessLevel:
        updatedProject.accessLevel ??
        updatedProject.access_level ??
        project.accessLevel,
      access_level:
        updatedProject.access_level ??
        updatedProject.accessLevel ??
        project.access_level ??
        project.accessLevel,
      permissions: updatedProject.permissions ?? project.permissions,
      deniedPermissions:
        updatedProject.deniedPermissions ?? project.deniedPermissions,
    };
  });
}

function RestrictedSection({
  section,
}: {
  section: ProjectSidebarSection;
}) {
  return (
    <section className="mm-empty-state">
      <div>▧</div>
      <h2>Acesso restrito</h2>
      <p>
        Você não possui permissão para acessar {sectionTitle(section)} neste
        contexto.
      </p>
    </section>
  );
}

const ProjectsPage: React.FC = () => {
  const {
    authenticated,
    loading,
    user,
    projects: sessionProjects,
    activeOrganization,
    organizations,
    switchingOrganization,
    organizationSwitchError,
    switchOrganization,
    clearOrganizationSwitchError,
    logout,
  } = useSession();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSection, setSidebarSection] =
    useState<ProjectSidebarSection>("all");
  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);
  const [projectItems, setProjectItems] = useState<ProjectListItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsContextKey, setProjectsContextKey] = useState<string | null>(
    null,
  );
  const [favoriteBusySlugs, setFavoriteBusySlugs] = useState<
    Record<string, true>
  >({});
  const projectsRequestIdRef = useRef(0);
  const projectsRequestControllerRef = useRef<AbortController | null>(null);

  const organizationContext = useMemo(
    () => buildOrganizationContext(user),
    [user],
  );

  const activeOrganizationId = useMemo(
    () =>
      activeOrganization?.id ??
      getOrganizationIdFromContext(organizationContext),
    [activeOrganization?.id, organizationContext],
  );
  const activeOrganizationKey = String(activeOrganizationId ?? "");
  const activeOrganizationKeyRef = useRef(activeOrganizationKey);
  activeOrganizationKeyRef.current = activeOrganizationKey;

  const loadProjectSection = useCallback(
    async (section: ProjectSectionKey) => {
      if (!activeOrganizationId) {
        setAllProjects([]);
        setProjectItems([]);
        setProjectsContextKey(null);
        setProjectsLoading(false);
        return;
      }

      projectsRequestIdRef.current += 1;
      const requestId = projectsRequestIdRef.current;
      const requestOrganizationKey = String(activeOrganizationId);
      projectsRequestControllerRef.current?.abort();
      const controller = new AbortController();
      projectsRequestControllerRef.current = controller;

      setProjectsContextKey(requestOrganizationKey);
      setProjectsLoading(true);
      setProjectsError(null);

      try {
        const projects = await fetchProjects(section, {
          signal: controller.signal,
        });

        if (
          requestId !== projectsRequestIdRef.current ||
          requestOrganizationKey !== activeOrganizationKeyRef.current
        ) {
          return;
        }

        if (section === "all") {
          setAllProjects(projects);
        }

        setProjectItems(projects);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (
          requestId !== projectsRequestIdRef.current ||
          requestOrganizationKey !== activeOrganizationKeyRef.current
        ) {
          return;
        }

        setProjectsError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os projetos.",
        );
      } finally {
        if (
          requestId === projectsRequestIdRef.current &&
          requestOrganizationKey === activeOrganizationKeyRef.current
        ) {
          setProjectsLoading(false);
          projectsRequestControllerRef.current = null;
        }
      }
    },
    [activeOrganizationId],
  );

  useEffect(() => {
    if (!loading && authenticated && isProjectSection(sidebarSection)) {
      void loadProjectSection(sidebarSection);
    }

    return () => {
      projectsRequestIdRef.current += 1;
      projectsRequestControllerRef.current?.abort();
    };
  }, [authenticated, loadProjectSection, loading, sidebarSection]);

  const projectContextIsCurrent =
    projectsContextKey === activeOrganizationKey;
  const visibleProjectItems = projectContextIsCurrent ? projectItems : [];

  const activeProjects = useMemo(() => {
    const source =
      projectContextIsCurrent && allProjects.length > 0
        ? allProjects
        : sessionProjects;

    return source.filter((project) => project.active !== false);
  }, [allProjects, projectContextIsCurrent, sessionProjects]);

  useEffect(() => {
    if (!loading && !authenticated) {
      navigate("/login?next=/projects", { replace: true });
    }
  }, [authenticated, loading, navigate]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  async function handleOrganizationSwitch(organizationId: number | string) {
    await switchOrganization(organizationId);

    projectsRequestIdRef.current += 1;
    projectsRequestControllerRef.current?.abort();
    projectsRequestControllerRef.current = null;
    setSearchQuery("");
    setSidebarSection("all");
    setAllProjects([]);
    setProjectItems([]);
    setProjectsContextKey(null);
    setProjectsError(null);
    setProjectsLoading(false);
    setFavoriteBusySlugs({});
  }

  const handleProjectUpdated = useCallback(
    (updatedProject: ProjectListItem) => {
      setAllProjects((current) =>
        mergeProjectSnapshot(current, updatedProject),
      );
      setProjectItems((current) =>
        mergeProjectSnapshot(current, updatedProject),
      );
    },
    [],
  );

  async function handleFavoriteToggle(project: ProjectListItem) {
    const nextFavorite = !Boolean(project.favorite || project.favorited);
    const requestOrganizationKey = activeOrganizationKey;

    setFavoriteBusySlugs((current) => ({
      ...current,
      [project.slug]: true,
    }));

    try {
      const updatedProject = await setProjectFavorite(
        project.slug,
        nextFavorite,
      );

      if (requestOrganizationKey !== activeOrganizationKeyRef.current) {
        return;
      }

      setAllProjects((current) => mergeProjectSnapshot(current, updatedProject));

      setProjectItems((current) => {
        const updated = mergeProjectSnapshot(current, updatedProject);

        if (sidebarSection === "favorites" && !updatedProject.favorite) {
          return updated.filter((item) => item.slug !== updatedProject.slug);
        }

        return updated;
      });
    } catch (error) {
      if (requestOrganizationKey !== activeOrganizationKeyRef.current) {
        return;
      }

      setProjectsError(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar favorito.",
      );
    } finally {
      if (requestOrganizationKey !== activeOrganizationKeyRef.current) {
        return;
      }

      setFavoriteBusySlugs((current) => {
        const next = { ...current };
        delete next[project.slug];
        return next;
      });
    }
  }

  if (loading) {
    return <ProjectsPageSkeleton />;
  }

  if (!authenticated) {
    return null;
  }

  const canCreateMap = canUser(
    user,
    PERMISSION.PROJECT_CREATE,
    organizationContext,
  );
  const showProjectsTopbar = isProjectSection(sidebarSection);

  return (
    <main className="mm-projects-page">
      <div className="mm-projects-layout">
        <ProjectsSidebar
          user={user}
          activeOrganization={activeOrganization}
          organizations={organizations}
          switchingOrganization={switchingOrganization}
          organizationSwitchError={organizationSwitchError}
          activeProjectsCount={activeProjects.length}
          searchQuery={searchQuery}
          sidebarSection={sidebarSection}
          onSearchQueryChange={setSearchQuery}
          onSidebarSectionChange={setSidebarSection}
          onOrganizationSwitch={handleOrganizationSwitch}
          onDismissOrganizationSwitchError={clearOrganizationSwitchError}
          onLogout={handleLogout}
        />

        <section
          className={
            switchingOrganization
              ? "mm-projects-main is-context-switching"
              : "mm-projects-main"
          }
          aria-busy={switchingOrganization}
        >
          {switchingOrganization ? (
            <div className="mm-context-switch-status" role="status">
              Trocando organização e atualizando permissões…
            </div>
          ) : null}

          {showProjectsTopbar && (
            <header className="mm-projects-topbar">
              <div>
                <h1>{sectionTitle(sidebarSection)}</h1>
              </div>

              <div className="mm-topbar-actions">
                {canCreateMap && (
                  <Link
                    to="/maps/new/edit"
                    className="mm-btn primary mm-new-map-btn"
                  >
                    Novo mapa
                  </Link>
                )}
              </div>
            </header>
          )}

          <div className="mm-projects-content">
            {!activeOrganization ? (
              <section className="mm-empty-state">
                <div>◇</div>
                <h2>Nenhuma organização disponível</h2>
                <p>
                  Sua conta não possui uma organização ativa autorizada.
                  Solicite acesso a um administrador para visualizar projetos.
                </p>
              </section>
            ) : isProjectSection(sidebarSection) ? (
              <ProjectsSectionWithMetadata
                key={`${activeOrganizationKey}:${sidebarSection}`}
                section={sidebarSection}
                projects={visibleProjectItems}
                searchQuery={searchQuery}
                loading={projectsLoading}
                error={projectsError}
                favoriteBusySlugs={favoriteBusySlugs}
                canProjectSave={(project) =>
                  canProject(user, PERMISSION.PROJECT_SAVE, project)
                }
                canProjectFavorite={(project) =>
                  canProject(user, PERMISSION.PROJECT_FAVORITE, project)
                }
                canProjectEdit={(project) =>
                  canProject(user, PERMISSION.PROJECT_EDIT, project)
                }
                onFavoriteToggle={handleFavoriteToggle}
                onProjectUpdated={handleProjectUpdated}
                onRetry={() => loadProjectSection(sidebarSection)}
              />
            ) : (
              <ProjectsSectionRouter
                key={`${activeOrganizationKey}:${sidebarSection}`}
                section={sidebarSection}
                projects={activeProjects}
                user={user}
                organizationId={activeOrganizationId}
                organizationName={activeOrganization?.name}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

function ProjectsSectionRouter({
  section,
  projects,
  user,
  organizationId,
  organizationName,
}: {
  section: ProjectSidebarSection;
  projects: MaonoProject[];
  user: MaonoUser | null;
  organizationId: number | string | null;
  organizationName?: string | null;
}) {
  const accessControlUser = userAsAccessControlUser(user);
  const requiredPermission = SECTION_PERMISSIONS[section];
  const sectionPermissionContext = buildSectionPermissionContext(user);

  /**
   * Defesa visual do router interno:
   * se uma seção administrativa ou organizacional for forçada manualmente,
   * o conteúdo não é renderizado sem a permissão correspondente.
   *
   * Segurança real permanece no backend e nas rotas protegidas.
   */
  if (
    requiredPermission &&
    !canUser(user, requiredPermission, sectionPermissionContext)
  ) {
    return <RestrictedSection section={section} />;
  }

  switch (section) {
    case "files":
      return (
        <DocumentsSection
          user={accessControlUser}
          organizationId={organizationId}
        />
      );

    case "requests":
      return (
        <TicketsSection
          user={accessControlUser}
          organizationId={organizationId}
          organizationName={organizationName}
        />
      );

    case "roadmap":
      return (
        <RoadmapSection
          user={accessControlUser}
          organizationId={organizationId}
          organizationName={organizationName}
        />
      );

    case "users":
      return (
        <UsersAccessSectionWithProps
          user={user}
          organizationId={organizationId}
          projects={projects}
        />
      );

    case "organization":
      return (
        <OrganizationSectionWithProps
          user={user}
          organizationId={organizationId}
          projects={projects}
          projectsCount={projects.length}
        />
      );

    case "limits":
      return (
        <LimitsPlansSectionWithProps
          user={user}
          organizationId={organizationId}
          projects={projects}
          projectsCount={projects.length}
        />
      );

    case "audit":
      return <AuditShortcutSection />;

    case "backend":
      return <AdminShortcutSection />;

    default:
      return (
        <section className="mm-empty-state">
          <div>▧</div>
          <h2>Seção indisponível</h2>
          <p>
            Esta seção não está disponível para o seu perfil ou ainda não foi
            liberada.
          </p>
        </section>
      );
  }
}

export default ProjectsPage;
