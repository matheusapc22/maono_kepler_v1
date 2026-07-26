import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import { ProjectGridSkeleton } from "../../../components/loading/Skeleton";
import {
  fetchProjectThumbnailStatus,
  type ProjectListItem,
  type ProjectSectionKey,
} from "../projects-api";
import ProjectCard from "./ProjectCard";
import ProjectMetadataPanel from "./ProjectMetadataPanel";

type ProjectsSectionProps = {
  section: ProjectSectionKey;
  projects: ProjectListItem[];
  searchQuery: string;
  loading?: boolean;
  error?: string | null;
  favoriteBusySlugs?: Record<string, true>;
  canProjectSave: (project: ProjectListItem) => boolean;
  canProjectFavorite: (project: ProjectListItem) => boolean;
  canProjectEdit: (project: ProjectListItem) => boolean;
  onFavoriteToggle: (project: ProjectListItem) => void | Promise<void>;
  onProjectUpdated: (project: ProjectListItem) => void;
  onRetry?: () => void;
};

function sectionCopy(section: ProjectSectionKey) {
  if (section === "recent") {
    return {
      emptyTitle: "Nenhum projeto recente",
      emptyDescription:
        "Projetos criados ou atualizados recentemente aparecerão aqui.",
    };
  }

  if (section === "favorites") {
    return {
      emptyTitle: "Nenhum favorito ainda",
      emptyDescription:
        "Marque projetos com estrela para acessá-los rapidamente.",
    };
  }

  return {
    emptyTitle: "Nenhum projeto liberado",
    emptyDescription:
      "Sua conta ainda não possui projetos vinculados ou autorizados.",
  };
}

function matchesSearch(project: ProjectListItem, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();

  if (!query) {
    return true;
  }

  const searchable = [
    project.name,
    project.slug,
    project.description,
    project.accessLevel,
    project.organizationId,
    project.organization_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchable.includes(query);
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="mm-empty-state">
      <div>▧</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

const ProjectsSection: React.FC<ProjectsSectionProps> = ({
  section,
  projects,
  searchQuery,
  loading = false,
  error = null,
  favoriteBusySlugs = {},
  canProjectSave,
  canProjectFavorite,
  canProjectEdit,
  onFavoriteToggle,
  onProjectUpdated,
  onRetry,
}) => {
  const filteredProjects = useMemo(
    () => projects.filter((project) => matchesSearch(project, searchQuery)),
    [projects, searchQuery],
  );
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);
  const [actionsOpenSlug, setActionsOpenSlug] = useState<string | null>(null);
  const [editingProject, setEditingProject] =
    useState<ProjectListItem | null>(null);

  useEffect(() => {
    if (
      openingSlug &&
      !filteredProjects.some((project) => project.slug === openingSlug)
    ) {
      setOpeningSlug(null);
    }

    if (
      actionsOpenSlug &&
      !filteredProjects.some((project) => project.slug === actionsOpenSlug)
    ) {
      setActionsOpenSlug(null);
    }

    if (
      editingProject &&
      !filteredProjects.some(
        (project) => project.slug === editingProject.slug,
      )
    ) {
      setEditingProject(null);
    }
  }, [
    actionsOpenSlug,
    editingProject,
    filteredProjects,
    openingSlug,
  ]);

  useEffect(() => {
    setActionsOpenSlug(null);
    setEditingProject(null);
  }, [section]);

  useEffect(() => {
    const pendingProjects = projects.filter(
      (project) => project.thumbnailStatus === "PENDING",
    );

    if (pendingProjects.length === 0) {
      return undefined;
    }

    const controller = new AbortController();
    const delays = [2000, 4000, 8000, 15000];
    let attempt = 0;
    let timer = 0;

    const schedule = () => {
      const delay = delays[Math.min(attempt, delays.length - 1)];
      timer = window.setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async () => {
      const results = await Promise.allSettled(
        pendingProjects.map(async (project) => ({
          project,
          state: await fetchProjectThumbnailStatus(project.slug, {
            signal: controller.signal,
          }),
        })),
      );

      if (controller.signal.aborted) {
        return;
      }

      let stillPending = false;

      results.forEach((result) => {
        if (result.status !== "fulfilled") {
          stillPending = true;
          return;
        }

        const { project, state } = result.value;

        if (state.thumbnailStatus === "PENDING") {
          stillPending = true;
        }

        const changed =
          state.thumbnailStatus !== project.thumbnailStatus ||
          state.configRevision !== Number(project.configRevision || 0) ||
          state.thumbnailRevision !==
            (project.thumbnailRevision ?? null) ||
          state.thumbnailAttempts !==
            Number(project.thumbnailAttempts || 0);

        if (changed) {
          onProjectUpdated({
            ...project,
            ...state,
          });
        }
      });

      attempt += 1;

      if (stillPending) {
        schedule();
      }
    };

    schedule();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [onProjectUpdated, projects]);

  if (loading && projects.length === 0) {
    return <ProjectGridSkeleton />;
  }

  if (error) {
    return (
      <section className="mm-empty-state" role="alert">
        <div>!</div>
        <h2>Não foi possível carregar os projetos</h2>
        <p>{error}</p>
        {onRetry ? (
          <button type="button" className="mm-btn" onClick={onRetry}>
            Tentar novamente
          </button>
        ) : null}
      </section>
    );
  }

  if (projects.length === 0) {
    const copy = sectionCopy(section);

    return (
      <EmptyState
        title={copy.emptyTitle}
        description={copy.emptyDescription}
      />
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <EmptyState
        title="Nenhum projeto encontrado"
        description="Tente buscar pelo nome, identificador ou tipo de acesso."
      />
    );
  }

  return (
    <>
      <section
        className="mm-project-grid"
        aria-busy={loading}
        aria-label="Projetos disponíveis"
      >
        {filteredProjects.map((project) => (
          <ProjectCard
            key={project.slug}
            project={project}
            canSave={canProjectSave(project)}
            canFavorite={canProjectFavorite(project)}
            canEditMetadata={canProjectEdit(project)}
            actionsOpen={actionsOpenSlug === project.slug}
            favoriteBusy={Boolean(favoriteBusySlugs[project.slug])}
            opening={openingSlug === project.slug}
            onOpen={(selectedProject) => {
              setOpeningSlug(selectedProject.slug);
              setActionsOpenSlug(null);
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

        {loading ? (
          <span className="mm-sr-only" role="status" aria-live="polite">
            Atualizando projetos.
          </span>
        ) : null}
      </section>

      <ProjectMetadataPanel
        project={editingProject}
        open={Boolean(editingProject)}
        onClose={() => setEditingProject(null)}
        onUpdated={(updatedProject) => {
          setEditingProject(updatedProject);
          onProjectUpdated(updatedProject);
        }}
      />
    </>
  );
};

export default ProjectsSection;
export type { ProjectSectionKey };
