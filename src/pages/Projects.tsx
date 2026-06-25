import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import ProjectsSidebar, {
  type ProjectSidebarSection,
} from "./ProjectsSidebar";
import AdminShortcutSection from "./Projects/components/AdminShortcutSection";
import AuditShortcutSection from "./Projects/components/AuditShortcutSection";
import DocumentsSection from "./Projects/components/DocumentsSection";
import ExportsSection from "./Projects/components/ExportsSection";
import LimitsPlansSection from "./Projects/components/LimitsPlansSection";
import OrganizationSection from "./Projects/components/OrganizationSection";
import TicketsSection from "./Projects/components/TicketsSection";
import UsersAccessSection from "./Projects/components/UsersAccessSection";
import WorkspaceSection from "./Projects/components/WorkspaceSection";
import {
  fetchWorkspaceProjects,
  setProjectFavorite,
  type WorkspaceProject,
  type WorkspaceSectionKey,
} from "./Projects/workspace-api";
import "./Projects/projects.css";

const SECTION_PERMISSIONS: Partial<Record<ProjectSidebarSection, Permission>> = {
  files: PERMISSION.DOCUMENT_VIEW,
  requests: PERMISSION.TICKET_VIEW,
  exports: PERMISSION.EXPORT_VIEW,
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

function isWorkspaceSection(
  section: ProjectSidebarSection,
): section is WorkspaceSectionKey {
  return section === "all" || section === "recent" || section === "favorites";
}

function sectionTitle(section: ProjectSidebarSection) {
  const titles: Record<ProjectSidebarSection, string> = {
    all: "Todos os Projetos",
    recent: "Recentes",
    favorites: "Favoritos",
    files: "Arquivos e Documentos",
    requests: "Central de Chamados",
    exports: "Exportações",
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

function canViewSection(user: MaonoUser | null, section: ProjectSidebarSection) {
  if (isWorkspaceSection(section)) {
    return true;
  }

  const permission = SECTION_PERMISSIONS[section];

  if (!permission) {
    return false;
  }

  return canUser(user, permission, buildOrganizationContext(user));
}

function mergeProjectIntoList(
  projects: WorkspaceProject[],
  updatedProject: WorkspaceProject,
) {
  return projects.map((project) =>
    project.slug === updatedProject.slug
      ? {
          ...project,
          favorite: updatedProject.favorite,
          favorited: updatedProject.favorite,
        }
      : project,
  );
}

const ProjectsPage: React.FC = () => {
  const {
    authenticated,
    loading,
    user,
    projects: sessionProjects,
    logout,
  } = useSession();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSection, setSidebarSection] =
    useState<ProjectSidebarSection>("all");
  const [allProjects, setAllProjects] = useState<WorkspaceProject[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProject[]>(
    [],
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [favoriteBusySlugs, setFavoriteBusySlugs] = useState<
    Record<string, true>
  >({});

  const organizationContext = useMemo(
    () => buildOrganizationContext(user),
    [user],
  );

  const activeOrganizationId = useMemo(
    () => getOrganizationIdFromContext(organizationContext),
    [organizationContext],
  );

  const loadAllProjects = useCallback(async () => {
    const projects = await fetchWorkspaceProjects("all");
    setAllProjects(projects);

    if (sidebarSection === "all") {
      setWorkspaceProjects(projects);
    }

    return projects;
  }, [sidebarSection]);

  const loadWorkspaceSection = useCallback(
    async (section: WorkspaceSectionKey) => {
      setWorkspaceLoading(true);
      setWorkspaceError(null);

      try {
        if (section === "all") {
          const projects = await loadAllProjects();
          setWorkspaceProjects(projects);
          return;
        }

        const projects = await fetchWorkspaceProjects(section);
        setWorkspaceProjects(projects);
      } catch (error) {
        setWorkspaceError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o workspace.",
        );
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [loadAllProjects],
  );

  useEffect(() => {
    if (!loading && authenticated) {
      void loadAllProjects().catch((error) => {
        setWorkspaceError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar projetos.",
        );
      });
    }
  }, [authenticated, loadAllProjects, loading]);

  useEffect(() => {
    if (!loading && authenticated && isWorkspaceSection(sidebarSection)) {
      void loadWorkspaceSection(sidebarSection);
    }
  }, [authenticated, loadWorkspaceSection, loading, sidebarSection]);

  const activeProjects = useMemo(() => {
    const source = allProjects.length > 0 ? allProjects : sessionProjects;

    return source.filter((project) => project.active !== false);
  }, [allProjects, sessionProjects]);

  const editableProjectsCount = useMemo(
    () =>
      activeProjects.filter((project) =>
        canProject(user, PERMISSION.PROJECT_SAVE, project),
      ).length,
    [activeProjects, user],
  );

  const readOnlyProjectsCount = useMemo(
    () =>
      activeProjects.filter(
        (project) => !canProject(user, PERMISSION.PROJECT_SAVE, project),
      ).length,
    [activeProjects, user],
  );

  useEffect(() => {
    if (!loading && !authenticated) {
      navigate("/login?next=/projects", { replace: true });
    }
  }, [authenticated, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && !canViewSection(user, sidebarSection)) {
      setSidebarSection("all");
    }
  }, [authenticated, loading, sidebarSection, user]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  async function handleFavoriteToggle(project: WorkspaceProject) {
    const nextFavorite = !Boolean(project.favorite || project.favorited);

    setFavoriteBusySlugs((current) => ({
      ...current,
      [project.slug]: true,
    }));

    try {
      const updatedProject = await setProjectFavorite(
        project.slug,
        nextFavorite,
      );

      setAllProjects((current) => mergeProjectIntoList(current, updatedProject));

      setWorkspaceProjects((current) => {
        const updated = mergeProjectIntoList(current, updatedProject);

        if (sidebarSection === "favorites" && !updatedProject.favorite) {
          return updated.filter((item) => item.slug !== updatedProject.slug);
        }

        return updated;
      });
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar favorito.",
      );
    } finally {
      setFavoriteBusySlugs((current) => {
        const next = { ...current };
        delete next[project.slug];
        return next;
      });
    }
  }

  if (loading) {
    return (
      <main className="mm-loading-screen">
        <p>Carregando seus projetos...</p>
      </main>
    );
  }

  if (!authenticated) {
    return null;
  }

  const canCreateMap = canUser(
    user,
    PERMISSION.PROJECT_CREATE,
    organizationContext,
  );
  const showWorkspaceTopbar = isWorkspaceSection(sidebarSection);

  return (
    <main className="mm-projects-page">
      <div className="mm-projects-layout">
        <ProjectsSidebar
          user={user}
          activeProjectsCount={activeProjects.length}
          searchQuery={searchQuery}
          sidebarSection={sidebarSection}
          onSearchQueryChange={setSearchQuery}
          onSidebarSectionChange={setSidebarSection}
          onLogout={handleLogout}
        />

        <section className="mm-projects-main">
          {showWorkspaceTopbar && (
            <header className="mm-projects-topbar">
              <div>
                <h1>{sectionTitle(sidebarSection)}</h1>
              </div>

              <div className="mm-topbar-actions">
                {canCreateMap && (
                  <Link to="/map" className="mm-btn primary mm-new-map-btn">
                    Novo mapa
                  </Link>
                )}
              </div>
            </header>
          )}

          <div className="mm-projects-content">
            {isWorkspaceSection(sidebarSection) ? (
              <WorkspaceSection
                section={sidebarSection}
                projects={workspaceProjects}
                searchQuery={searchQuery}
                user={user}
                loading={workspaceLoading}
                error={workspaceError}
                favoriteBusySlugs={favoriteBusySlugs}
                canProjectSave={(project) =>
                  canProject(user, PERMISSION.PROJECT_SAVE, project)
                }
                canProjectFavorite={(project) =>
                  canProject(user, PERMISSION.PROJECT_FAVORITE, project)
                }
                onFavoriteToggle={handleFavoriteToggle}
                onRetry={() => loadWorkspaceSection(sidebarSection)}
              />
            ) : (
              <ProjectsSectionRouter
                section={sidebarSection}
                projects={activeProjects}
                user={user}
                organizationId={activeOrganizationId}
                editableProjectsCount={editableProjectsCount}
                readOnlyProjectsCount={readOnlyProjectsCount}
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
  editableProjectsCount,
  readOnlyProjectsCount,
}: {
  section: ProjectSidebarSection;
  projects: MaonoProject[];
  user: MaonoUser | null;
  organizationId: number | string | null;
  editableProjectsCount: number;
  readOnlyProjectsCount: number;
}) {
  const accessControlUser = userAsAccessControlUser(user);
  const requiredPermission = SECTION_PERMISSIONS[section];

  if (
    requiredPermission &&
    !canUser(user, requiredPermission, buildOrganizationContext(user))
  ) {
    return (
      <section className="mm-empty-state">
        <div>▧</div>
        <h2>Acesso restrito</h2>
        <p>
          Você não possui permissão para acessar esta seção da organização.
        </p>
      </section>
    );
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
        />
      );

    case "exports":
      return (
        <ExportsSection
          user={accessControlUser}
          organizationId={organizationId}
          editableProjectsCount={editableProjectsCount}
          readOnlyProjectsCount={readOnlyProjectsCount}
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