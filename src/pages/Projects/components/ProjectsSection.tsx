import { subscribePreviewStatus } from "./preview-status-polling";
import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import { ProjectGridSkeleton } from "../../../components/loading/Skeleton";
import { useSkeletonCount } from "../../../components/loading/useSkeletonCount";
import { usePreparedNavigate } from "../../../hooks/usePreparedNavigate";
import { prepareProjectMapDestination } from "../../Kepler/map-panel/prepare-project-map-destination";
import {
  type ProjectListItem,
  type ProjectSectionKey,
} from "../projects-api";
import ProjectCard from "./ProjectCard";
import {
  ProjectPageFiltersForm, ProjectPageIcon, ProjectPagePagination,
} from "./ProjectPagesUi";
import {
  PROJECT_PAGE_COPY, DEFAULT_PROJECT_FILTERS, filterAndSortProjects, projectPage,
  type ProjectPageFilters,
} from "./project-page-query";
import ProjectMetadataPanel from "./ProjectMetadataPanel";
import {
  activateProjectThumbnailCacheContext,
  normalizeProjectThumbnailStatus,
  projectCardKey,
  projectOrganizationCacheKey,
} from "./project-card-utils";

type ProjectsSectionProps = {
  section: ProjectSectionKey;
  projects: ProjectListItem[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  actionError?: string | null;
  onDismissActionError?: () => void;
  loading?: boolean;
  loaded?: boolean;
  structurePending?: boolean;
  contentPending?: boolean;
  error?: string | null;
  favoriteBusySlugs?: Record<string, true>;
  canProjectSave: (project: ProjectListItem) => boolean;
  canProjectFavorite: (project: ProjectListItem) => boolean;
  canProjectEdit: (project: ProjectListItem) => boolean;
  onFavoriteToggle: (project: ProjectListItem) => void | Promise<void>;
  onProjectUpdated: (project: ProjectListItem) => void;
  onRetry?: () => void;
};

const ProjectsSection: React.FC<ProjectsSectionProps> = ({
  section,
  projects,
  searchQuery,
  onSearchQueryChange,
  actionError = null,
  onDismissActionError,
  loading = false,
  loaded = projects.length > 0 || !loading,
  structurePending = false,
  contentPending = loading && !loaded,
  error = null,
  favoriteBusySlugs = {},
  canProjectSave,
  canProjectFavorite,
  canProjectEdit,
  onFavoriteToggle,
  onProjectUpdated,
  onRetry,
}) => {
  const [draftFilters, setDraftFilters] = useState<ProjectPageFilters>({ ...DEFAULT_PROJECT_FILTERS, search: searchQuery });
  const [appliedFilters, setAppliedFilters] = useState<ProjectPageFilters>({ ...DEFAULT_PROJECT_FILTERS, search: searchQuery });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const initialPreviewCount = useSkeletonCount({ layout: "grid", pageSize });
  // Sidebar search keeps its established immediate behavior; the page form has
  // an explicit draft/apply boundary for all three controls.
  useEffect(() => {
    setDraftFilters(current => ({ ...current, search: searchQuery }));
    setCurrentPage(1);
  }, [searchQuery]);
  const filteredProjects = useMemo(
    () => filterAndSortProjects(projects, { ...appliedFilters, search: searchQuery }),
    [projects, appliedFilters, searchQuery],
  );
  const pagination = useMemo(() => projectPage(filteredProjects, currentPage, pageSize), [filteredProjects, currentPage, pageSize]);
  useEffect(() => {
    setCurrentPage(pagination.page);
  }, [pagination.page]);
  const visibleProjects = pagination.items;
  const thumbnailOrganizationKey = useMemo(
    () =>
      projects.length > 0
        ? projectOrganizationCacheKey(projects[0])
        : null,
    [projects],
  );
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);
  const [actionsOpenSlug, setActionsOpenSlug] = useState<string | null>(null);
  const [editingProject, setEditingProject] =
    useState<ProjectListItem | null>(null);
  const { prepareNavigate } = usePreparedNavigate();

  useEffect(() => {
    if (
      openingSlug &&
      !visibleProjects.some((project) => project.slug === openingSlug)
    ) {
      setOpeningSlug(null);
    }

    if (
      actionsOpenSlug &&
      !visibleProjects.some((project) => project.slug === actionsOpenSlug)
    ) {
      setActionsOpenSlug(null);
    }

    if (
      editingProject &&
      !visibleProjects.some(
        (project) => project.slug === editingProject.slug,
      )
    ) {
      setEditingProject(null);
    }
  }, [
    actionsOpenSlug,
    editingProject,
    visibleProjects,
    openingSlug,
  ]);

  useEffect(() => {
    setActionsOpenSlug(null);
    setEditingProject(null);
  }, [section]);

  useEffect(() => {
    activateProjectThumbnailCacheContext(
      thumbnailOrganizationKey,
    );
  }, [thumbnailOrganizationKey]);

  useEffect(() => {
    const releases = projects
      .filter(project => normalizeProjectThumbnailStatus(project.thumbnailStatus) === "PENDING" && !["FAILED_FINAL", "SUPERSEDED"].includes(project.jobState || ""))
      .map(project => subscribePreviewStatus(`${projectOrganizationCacheKey(project)}:${project.id ?? project.slug}`, project.slug, state => {
        const changed = state.thumbnailStatus !== project.thumbnailStatus || state.configRevision !== Number(project.configRevision || 0) ||
          state.thumbnailRevision !== (project.thumbnailRevision ?? null) || state.thumbnailAttempts !== Number(project.thumbnailAttempts || 0) ||
          state.artifactId !== (project.artifactId ?? null) || state.jobState !== (project.jobState ?? null);
        if (changed) onProjectUpdated({ ...project, ...state });
      }, project.jobState));
    return () => { for (const release of releases) release(); };
  }, [onProjectUpdated, projects]);

  const copy = PROJECT_PAGE_COPY[section];
  const hasAppliedFilters = Boolean(searchQuery.trim()) || appliedFilters.status !== "all";
  return (
    <div className="mm-project-pages__workspace">
      {section === "all" ? <ProjectPageFiltersForm
        structurePending={structurePending}
        value={draftFilters}
        disabled={false}
        onChange={setDraftFilters}
        onApply={() => {
          setAppliedFilters({ ...draftFilters });
          onSearchQueryChange(draftFilters.search);
          setCurrentPage(1);
          setActionsOpenSlug(null);
          setEditingProject(null);
        }}
        onClear={() => {
          setDraftFilters({ ...DEFAULT_PROJECT_FILTERS });
          setAppliedFilters({ ...DEFAULT_PROJECT_FILTERS });
          onSearchQueryChange("");
          setCurrentPage(1);
        }}
      /> : null}
      {actionError ? <div className="mm-project-pages__error" role="alert"><p>{actionError}</p>{onDismissActionError ? <button type="button" className="mm-project-pages__button" onClick={onDismissActionError}>Fechar aviso</button> : null}</div> : null}
      {error ? <section className="mm-project-pages__empty" role="alert">
        <h2>Não foi possível carregar os projetos</h2><p>{error}</p>
        {onRetry ? <button type="button" className="mm-project-pages__button" onClick={onRetry}>Tentar novamente</button> : null}
      </section> : null}
      {contentPending ? <ProjectGridSkeleton pageSize={pageSize} announce={false} className="mm-project-pages__grid" /> : null}
      {/* Ready cards stay mounted so thumbnail requests never wait for presentation. */}
      {contentPending && !loaded || !loaded && error ? null : filteredProjects.length === 0 ? <section className="mm-project-pages__empty" aria-busy={loading || contentPending} style={contentPending ? { display: "none" } : undefined}>
        <ProjectPageIcon name={copy.icon} /><h2>{copy.empty}</h2>
        {hasAppliedFilters ? <p>Tente outra busca ou limpe os filtros.</p> : null}
      </section> : (
      <section
        className="mm-project-grid mm-project-pages__grid"
        style={contentPending ? { display: "none" } : undefined}
        aria-busy={loading || contentPending}
        aria-label="Projetos disponíveis"
      >
        {visibleProjects.map((project, index) => (
          <ProjectCard
            key={projectCardKey(project)}
            project={project}
            initialPresentationPending={contentPending && index < initialPreviewCount}
            canSave={canProjectSave(project)}
            canFavorite={canProjectFavorite(project)}
            canEditMetadata={canProjectEdit(project)}
            actionsOpen={actionsOpenSlug === project.slug}
            favoriteBusy={Boolean(favoriteBusySlugs[project.slug])}
            opening={openingSlug === project.slug}
            onOpen={(selectedProject) => {
              const fallbackDestination =
                `/projects/${encodeURIComponent(selectedProject.slug)}/manage`;
              let destination = fallbackDestination;

              setOpeningSlug(selectedProject.slug);
              setActionsOpenSlug(null);

              void prepareNavigate({
                route: "kepler",
                to: () => destination,
                handoffKey: (resolvedDestination) =>
                  `map:${resolvedDestination}`,
                beforeNavigate: async (signal) => {
                  const prepared = await prepareProjectMapDestination(
                    selectedProject.slug,
                    signal,
                  );
                  destination = prepared.pathname;
                },
              })
                .then((navigated) => {
                  if (!navigated) {
                    setOpeningSlug((current) =>
                      current === selectedProject.slug ? null : current,
                    );
                  }
                })
                .catch(() => {
                  window.location.assign(fallbackDestination);
                });
            }}
            onActionsOpenChange={(open) => {
              setActionsOpenSlug(open ? project.slug : null);
            }}
            onEditMetadata={(selectedProject) => {
              setActionsOpenSlug(null);
              setEditingProject(selectedProject);
            }}
            onFavoriteToggle={onFavoriteToggle}
          />
        ))}

      </section>
      )}
      <ProjectPagePagination
        structurePending={structurePending}
        loading={loading || contentPending}
        refreshing={loaded && !contentPending}
        unavailable={!loaded && Boolean(error)}
        visibleCount={visibleProjects.length}
        total={pagination.total}
        page={pagination.page}
        pageCount={pagination.pageCount}
        pageSize={pageSize}
        disabled={loading || contentPending || Boolean(error)}
        onPage={page => { setCurrentPage(page); setActionsOpenSlug(null); setEditingProject(null); }}
        onPageSize={size => { setPageSize(size); setCurrentPage(1); setActionsOpenSlug(null); setEditingProject(null); }}
      />
      <ProjectMetadataPanel
        project={editingProject}
        open={Boolean(editingProject)}
        onClose={() => setEditingProject(null)}
        onUpdated={(updatedProject) => {
          setEditingProject(updatedProject);
          onProjectUpdated(updatedProject);
        }}
      />
    </div>
  );
};

export default ProjectsSection;
export type { ProjectSectionKey };
