import React, { useCallback, useMemo, useState } from "react";

import type { MaonoUser } from "../../../auth/session";
import { ProjectGridSkeleton } from "../../../components/loading/Skeleton";
import type { ProjectListItem, ProjectSectionKey } from "../projects-api";
import ProjectCard, { projectThumbnailKey } from "./ProjectCard";

type ProjectsSectionProps = {
  section: ProjectSectionKey;
  projects: ProjectListItem[];
  searchQuery: string;
  user: MaonoUser | null;
  loading?: boolean;
  error?: string | null;
  favoriteBusySlugs?: Record<string, true>;
  canProjectSave: (project: ProjectListItem) => boolean;
  canProjectFavorite: (project: ProjectListItem) => boolean;
  onFavoriteToggle: (project: ProjectListItem) => void | Promise<void>;
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
  user,
  loading = false,
  error = null,
  favoriteBusySlugs = {},
  canProjectSave,
  canProjectFavorite,
  onFavoriteToggle,
  onRetry,
}) => {
  const filteredProjects = useMemo(
    () => projects.filter((project) => matchesSearch(project, searchQuery)),
    [projects, searchQuery],
  );
  const [settledThumbnailKeys, setSettledThumbnailKeys] = useState<
    Record<string, true>
  >({});
  const visibleThumbnailKeys = useMemo(
    () => filteredProjects.map(projectThumbnailKey),
    [filteredProjects],
  );
  const allVisibleThumbnailsSettled =
    visibleThumbnailKeys.length === 0 ||
    visibleThumbnailKeys.every((key) => settledThumbnailKeys[key]);
  const handleThumbnailSettled = useCallback((project: ProjectListItem) => {
    const thumbnailKey = projectThumbnailKey(project);

    setSettledThumbnailKeys((current) =>
      current[thumbnailKey]
        ? current
        : {
            ...current,
            [thumbnailKey]: true,
          },
    );
  }, []);

  if (loading && projects.length === 0) {
    return <ProjectGridSkeleton />;
  }

  if (error) {
    return (
      <section className="mm-empty-state">
        <div>!</div>
        <h2>Não foi possível carregar os projetos</h2>
        <p>{error}</p>
        {onRetry && (
          <button type="button" className="mm-btn" onClick={onRetry}>
            Tentar novamente
          </button>
        )}
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
    <section
      className="mm-project-grid"
      aria-busy={loading || !allVisibleThumbnailsSettled}
    >
      {filteredProjects.map((project) => (
        <ProjectCard
          key={project.slug}
          project={project}
          user={user}
          canSave={canProjectSave(project)}
          canFavorite={canProjectFavorite(project)}
          favoriteBusy={Boolean(favoriteBusySlugs[project.slug])}
          holdThumbnailShimmer={!allVisibleThumbnailsSettled}
          onFavoriteToggle={onFavoriteToggle}
          onThumbnailSettled={handleThumbnailSettled}
        />
      ))}
      {loading || !allVisibleThumbnailsSettled ? (
        <span className="mm-sr-only" role="status">
          {loading
            ? "Atualizando projetos."
            : "Carregando imagens dos projetos."}
        </span>
      ) : null}
    </section>
  );
};

export default ProjectsSection;
export type { ProjectSectionKey };
