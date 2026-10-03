import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

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
import {
  LoadingOverlay,
  useCompleteLoadingHandoff,
  useInitialBootReadiness,
} from "../components/loading";
import { ProjectsPageSkeleton } from "../components/loading/Skeleton";
import { usePreparedNavigate } from "../hooks/usePreparedNavigate";
import { normalizeUserError } from "../lib/user-error-catalog";
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
import { ProjectPagesHeader } from "./Projects/components/ProjectPagesUi";
import {
  fetchProjects,
  setProjectFavorite,
  type ProjectListItem,
  type ProjectSectionKey,
} from "./Projects/projects-api";
import "./Projects/projects.css";
import "./Projects/components/project-cards.css";
import "./Projects/components/ProjectPages.css";
import "./Projects/projects-scrollbars.css";

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
  const { prepareNavigate } = usePreparedNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSection, setSidebarSection] =
    useState<ProjectSidebarSection>("all");
  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);
  const [projectItems, setProjectItems] = useState<ProjectListItem[]>([]);
  const [loadedProjectSection, setLoadedProjectSection] = useState<ProjectSectionKey | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const currentSidebarSectionRef = useRef(sidebarSection);
  currentSidebarSectionRef.current = sidebarSection;
  const loadedProjectSectionRef = useRef(loadedProjectSection);
  loadedProjectSectionRef.current = loadedProjectSection;
  // Overlays reconcile list responses started while a favorite write is pending.
  // A fresh read after completion becomes authoritative again.
  const favoriteOverridesRef = useRef(new Map<string, { organizationKey: string; favorite: boolean; pending: boolean; project?: ProjectListItem }>());
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [organizationTransitionPending, setOrganizationTransitionPending] =
    useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsContextKey, setProjectsContextKey] = useState<string | null>(
    null,
  );
  const [favoriteBusySlugs, setFavoriteBusySlugs] = useState<
    Record<string, true>
  >({});
  const projectsRequestSequenceRef = useRef(0);
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
  const [ticketLinkRestoring, setTicketLinkRestoring] = useState(false);
  const [ticketLinkError, setTicketLinkError] = useState<string | null>(null);
  const ticketLinkInitialized = useRef(false);
  const ticketLinkEpoch = useRef(0);
  const ticketLinkMounted = useRef(true);
  useEffect(() => { ticketLinkMounted.current = true; return () => { ticketLinkMounted.current = false; }; }, []);
  useEffect(() => {
    if (loading || !authenticated) return;
    async function restoreTicketLink() {
      const href = window.location.href;
      const target = new URL(href).searchParams.get('cc_org');
      if (!target) return;
      const epoch = ++ticketLinkEpoch.current;
      if (!/^[1-9]\d*$/.test(target) || !organizations.some(org => String(org.id) === target)) {
        setTicketLinkError('A organização deste link não está disponível para seu acesso.');
        return;
      }
      setTicketLinkError(null); setTicketLinkRestoring(true);
      try {
        // Session endpoint validates membership; URL parameters never grant access.
        if (String(activeOrganizationId) !== target) await switchOrganization(target);
        if (epoch !== ticketLinkEpoch.current || !ticketLinkMounted.current) return;
        window.history.replaceState(window.history.state, '', href);
        setSidebarSection('requests');
      } catch {
        if (epoch === ticketLinkEpoch.current && ticketLinkMounted.current) setTicketLinkError('Não foi possível abrir a organização do link. Confira seu acesso e tente novamente.');
      } finally { if (epoch === ticketLinkEpoch.current && ticketLinkMounted.current) setTicketLinkRestoring(false); }
    }
    if (!ticketLinkInitialized.current) { ticketLinkInitialized.current = true; void restoreTicketLink(); }
    const listener = () => { void restoreTicketLink(); };
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, [loading, authenticated, organizations, activeOrganizationId, switchOrganization]);

  const activeOrganizationKey = String(activeOrganizationId ?? "");
  const activeOrganizationKeyRef = useRef(activeOrganizationKey);
  activeOrganizationKeyRef.current = activeOrganizationKey;
  const favoriteContextEpochRef = useRef({ organizationKey: activeOrganizationKey, value: 0 });
  if (favoriteContextEpochRef.current.organizationKey !== activeOrganizationKey) {
    favoriteContextEpochRef.current = { organizationKey: activeOrganizationKey, value: favoriteContextEpochRef.current.value + 1 };
  }
  useEffect(() => {
    // Covers sidebar switches and organization restoration through history links.
    favoriteOverridesRef.current.clear();
    setFavoriteBusySlugs({});
    setProjectActionError(null);
  }, [activeOrganizationKey]);

  const loadProjectSection = useCallback(
    async (section: ProjectSectionKey) => {
      if (!activeOrganizationId) {
        setAllProjects([]);
        setProjectItems([]);
        setProjectsContextKey(null);
        setProjectsLoading(false);
        return;
      }

      projectsRequestSequenceRef.current += 1;
      const requestSequence = projectsRequestSequenceRef.current;
      const requestOrganizationKey = String(activeOrganizationId);
      projectsRequestControllerRef.current?.abort();
      const controller = new AbortController();
      projectsRequestControllerRef.current = controller;

      for (const [slug, override] of favoriteOverridesRef.current) {
        if (!override.pending) favoriteOverridesRef.current.delete(slug);
      }
      const requestFavoriteOverrides = new Map(favoriteOverridesRef.current);
      setProjectsContextKey(requestOrganizationKey);
      setProjectsLoading(true);
      setProjectsError(null);

      try {
        const projects = await fetchProjects(section, {
          signal: controller.signal,
        });

        if (
          requestSequence !== projectsRequestSequenceRef.current ||
          requestOrganizationKey !== activeOrganizationKeyRef.current
        ) {
          return;
        }

        const overrides = new Map([...requestFavoriteOverrides, ...favoriteOverridesRef.current]);
        const reconciled = projects.map(project => {
          const override = overrides.get(project.slug);
          return override?.organizationKey === requestOrganizationKey ? { ...project, favorite: override.favorite, favorited: override.favorite } : project;
        }).filter(project => section !== "favorites" || Boolean(project.favorite || project.favorited));
        if (section === "favorites") {
          for (const override of overrides.values()) {
            if (override.organizationKey === requestOrganizationKey && override.favorite && override.project &&
                !reconciled.some(item => sameProject(item, override.project!))) {
              reconciled.push(override.project);
            }
          }
        }
        if (section === "all") {
          setAllProjects(reconciled);
        }
        setProjectItems(reconciled);
        setLoadedProjectSection(section);
      } catch (requestFailure) {
        if (
          requestFailure instanceof DOMException &&
          requestFailure.name === "AbortError"
        ) {
          return;
        }

        if (
          requestSequence !== projectsRequestSequenceRef.current ||
          requestOrganizationKey !== activeOrganizationKeyRef.current
        ) {
          return;
        }

        setProjectItems([]);
        setLoadedProjectSection(section);
        setProjectsError(normalizeUserError(requestFailure).message);
      } finally {
        if (
          requestSequence === projectsRequestSequenceRef.current &&
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
      projectsRequestSequenceRef.current += 1;
      projectsRequestControllerRef.current?.abort();
    };
  }, [authenticated, loadProjectSection, loading, sidebarSection]);

  const projectContextIsCurrent =
    projectsContextKey === activeOrganizationKey;
  const loginProjectsReady =
    !loading &&
    authenticated &&
    (
      !activeOrganizationId ||
      (
        projectContextIsCurrent &&
        !projectsLoading
      )
    );

  useCompleteLoadingHandoff(
    "login-projects",
    loginProjectsReady || (!loading && !authenticated),
  );

  useInitialBootReadiness(
    loginProjectsReady || (!loading && !authenticated),
  );

  useEffect(() => {
    if (!organizationTransitionPending) return;

    if (
      !switchingOrganization &&
      (
        Boolean(organizationSwitchError) ||
        !activeOrganizationId ||
        (projectContextIsCurrent && !projectsLoading)
      )
    ) {
      setOrganizationTransitionPending(false);
    }
  }, [
    activeOrganizationId,
    organizationSwitchError,
    organizationTransitionPending,
    projectContextIsCurrent,
    projectsLoading,
    switchingOrganization,
  ]);

  const organizationTransitionActive =
    switchingOrganization || organizationTransitionPending || ticketLinkRestoring;
  const visibleProjectItems = projectContextIsCurrent && loadedProjectSection === sidebarSection ? projectItems : [];

  const activeProjects = useMemo(() => {
    const source =
      projectContextIsCurrent && allProjects.length > 0
        ? allProjects
        : sessionProjects;

    return source.filter((project) => project.active !== false);
  }, [allProjects, projectContextIsCurrent, sessionProjects]);

  useEffect(() => {
    if (!loading && !authenticated) {
      const linked = new URLSearchParams(window.location.search).has('cc_org');
      const next = linked ? `/login?next=${encodeURIComponent(`/projects${window.location.search}${window.location.hash}`)}` : '/login?next=/projects';
      navigate(next, { replace: true });
    }
  }, [authenticated, loading, navigate]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function handleNewMapNavigation(
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();

    void prepareNavigate({
      route: "kepler",
      to: "/maps/new/create",
      handoffKey: "map:/maps/new/create",
    }).catch(() => {
      window.location.assign("/maps/new/create");
    });
  }

  async function handleOrganizationSwitch(organizationId: number | string) {
    ticketLinkEpoch.current += 1; setTicketLinkRestoring(false); setTicketLinkError(null);
    const nextUrl = new URL(window.location.href);
    for (const key of [...nextUrl.searchParams.keys()]) if (key.startsWith('cc_')) nextUrl.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', nextUrl.href);
    setOrganizationTransitionPending(true);
    await switchOrganization(organizationId);

    projectsRequestSequenceRef.current += 1;
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
    favoriteOverridesRef.current.clear();
    setLoadedProjectSection(null);
    setProjectActionError(null);
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
    if (favoriteOverridesRef.current.get(project.slug)?.pending && favoriteOverridesRef.current.get(project.slug)?.organizationKey === activeOrganizationKey) return;
    const previousFavorite = Boolean(project.favorite || project.favorited);
    const nextFavorite = !previousFavorite;
    const requestOrganizationKey = activeOrganizationKey;
    const requestContextEpoch = favoriteContextEpochRef.current.value;
    const contextIsCurrent = () => requestOrganizationKey === activeOrganizationKeyRef.current &&
      requestContextEpoch === favoriteContextEpochRef.current.value;
    favoriteOverridesRef.current.set(project.slug, { organizationKey: requestOrganizationKey, favorite: nextFavorite, pending: true });
    setProjectActionError(null);
    setFavoriteBusySlugs(current => ({ ...current, [project.slug]: true }));

    const patchFavorite = (items: ProjectListItem[], favorite: boolean) => items.map(item =>
      sameProject(item, project) ? { ...item, favorite, favorited: favorite } : item,
    );
    setAllProjects(current => patchFavorite(current, nextFavorite));
    setProjectItems(current => {
      const updated = patchFavorite(current, nextFavorite);
      return currentSidebarSectionRef.current === "favorites" && !nextFavorite
        ? updated.filter(item => !sameProject(item, project)) : updated;
    });

    try {
      const updatedProject = await setProjectFavorite(project.slug, nextFavorite);
      if (!contextIsCurrent()) return;
      const favorite = updatedProject.favorite ?? updatedProject.favorited ?? nextFavorite;
      const snapshot = mergeProjectSnapshot([project], { ...updatedProject, favorite, favorited: favorite })[0];
      favoriteOverridesRef.current.set(project.slug, { organizationKey: requestOrganizationKey, favorite, pending: false, project: snapshot });
      setAllProjects(current => mergeProjectSnapshot(current, snapshot));
      setProjectItems(current => {
        const updated = mergeProjectSnapshot(current, snapshot);
        if (currentSidebarSectionRef.current === "favorites" && loadedProjectSectionRef.current === "favorites") {
          if (!favorite) return updated.filter(item => !sameProject(item, project));
          if (!updated.some(item => sameProject(item, project))) return [...updated, snapshot];
        }
        return updated;
      });
    } catch (requestFailure) {
      if (!contextIsCurrent()) return;
      favoriteOverridesRef.current.set(project.slug, { organizationKey: requestOrganizationKey, favorite: previousFavorite, pending: false });
      setAllProjects(current => patchFavorite(current, previousFavorite));
      setProjectItems(current => {
        const updated = patchFavorite(current, previousFavorite);
        // Restore an optimistically removed favorite, even if it was the final
        // item on the final page. Pagination clamps safely in ProjectsSection.
        if (previousFavorite && currentSidebarSectionRef.current === "favorites" &&
            loadedProjectSectionRef.current === "favorites" && !updated.some(item => sameProject(item, project))) {
          return [...updated, { ...project, favorite: true, favorited: true }];
        }
        return updated;
      });
      setProjectActionError(normalizeUserError(requestFailure).message);
    } finally {
      if (contextIsCurrent()) {
        setFavoriteBusySlugs(current => {
          const next = { ...current }; delete next[project.slug]; return next;
        });
      }
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


  return (
    <main className="mm-projects-page">
      <div className="mm-projects-layout">
        <ProjectsSidebar
          user={user}
          activeOrganization={activeOrganization}
          organizations={organizations}
          switchingOrganization={organizationTransitionActive}
          organizationSwitchError={organizationSwitchError}
          activeProjectsCount={activeProjects.length}
          searchQuery={searchQuery}
          sidebarSection={sidebarSection}
          onSearchQueryChange={setSearchQuery}
          onSidebarSectionChange={next => {
            setSidebarSection(next);
            setProjectActionError(null);
            if (next !== 'requests') {
              const url = new URL(window.location.href);
              for (const key of [...url.searchParams.keys()]) if (key.startsWith('cc_')) url.searchParams.delete(key);
              window.history.pushState(window.history.state, '', url.href);
            }
          }}
          onOrganizationSwitch={handleOrganizationSwitch}
          onDismissOrganizationSwitchError={clearOrganizationSwitchError}
          onLogout={handleLogout}
        />

        <section
          className={`mm-projects-main${organizationTransitionActive ? " is-context-switching" : ""}${isProjectSection(sidebarSection) ? " mm-project-pages" : ""}`}
          aria-busy={organizationTransitionActive}
          aria-label="Conteúdo da seção"
          tabIndex={0}
        >
          <LoadingOverlay
            active={organizationTransitionActive}
            scope="container"
            loaderSize="compact"
            accessibleLabel="Trocando organização"
          />

          {isProjectSection(sidebarSection) ? <ProjectPagesHeader
            section={sidebarSection}
            canCreateMap={canCreateMap}
            onNewMap={handleNewMapNavigation}
            onHome={() => { setSidebarSection("all"); setSearchQuery(""); setProjectActionError(null); }}
          /> : null}

          <div className="mm-projects-content">
            {ticketLinkError ? <p role="alert">{ticketLinkError}</p> : null}
            {ticketLinkRestoring ? <p role="status">Abrindo contexto do chamado…</p> : !activeOrganization ? (
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
                onSearchQueryChange={setSearchQuery}
                actionError={projectActionError}
                onDismissActionError={() => setProjectActionError(null)}
                loading={projectsLoading || (loadedProjectSection !== sidebarSection && !projectsError)}
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
