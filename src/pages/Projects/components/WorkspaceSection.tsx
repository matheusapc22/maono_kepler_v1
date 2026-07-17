import React, { useCallback, useMemo, useState } from "react";

import type { MaonoUser } from "../../../auth/session";
import { ProjectGridSkeleton } from "../../../components/loading/Skeleton";
import {
  projectThumbnailUrl,
  type ProjectThumbnailState,
} from "../project-thumbnail";
import type { WorkspaceProject, WorkspaceSectionKey } from "../workspace-api";
import ProjectCard from "./ProjectCard";

type WorkspaceSectionProps = {
  section: WorkspaceSectionKey;
  projects: WorkspaceProject[];
  searchQuery: string;
  user: MaonoUser | null;
  loading?: boolean;
  error?: string | null;
  favoriteBusySlugs?: Record<string, true>;
  canProjectSave: (project: WorkspaceProject) => boolean;
  canProjectFavorite: (project: WorkspaceProject) => boolean;
  onFavoriteToggle: (project: WorkspaceProject) => void | Promise<void>;
  onRetry?: () => void;
};

function sectionCopy(section: WorkspaceSectionKey) {
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

function matchesSearch(project: WorkspaceProject, searchQuery: string) {
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

function projectMediaKey(project: WorkspaceProject) {
  return `${project.slug}:${projectThumbnailUrl(project)}`;
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

const WorkspaceSection: React.FC<WorkspaceSectionProps> = ({
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

  const mediaKeys = useMemo(
    () => filteredProjects.map(projectMediaKey),
    [filteredProjects],
  );
  const [readyMediaKeys, setReadyMediaKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const handleThumbnailReady = useCallback(
    (project: WorkspaceProject, _state: ProjectThumbnailState) => {
      const mediaKey = projectMediaKey(project);

      setReadyMediaKeys((current) => {
        if (current.has(mediaKey)) return current;
        const next = new Set(current);
        next.add(mediaKey);
        return next;
      });
    },
    [],
  );

  if (loading && projects.length === 0) {
    return <ProjectGridSkeleton />;
  }

  if (error) {
    return (
      <section className="mm-empty-state">
        <div>!</div>
        <h2>Não foi possível carregar o workspace</h2>
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

  const readyMediaCount = mediaKeys.reduce(
    (count, mediaKey) => count + (readyMediaKeys.has(mediaKey) ? 1 : 0),
    0,
  );
  const waitingForMedia = readyMediaCount < mediaKeys.length;
  const skeletonCount = Math.min(6, Math.max(1, filteredProjects.length));

  return (
    <div
      className="mm-project-grid-stage"
      aria-busy={loading || waitingForMedia}
    >
      {waitingForMedia ? (
        <div className="mm-project-grid-overlay">
          <ProjectGridSkeleton count={skeletonCount} />
        </div>
      ) : null}

      <section
        className={`mm-project-grid mm-project-grid-content${
          waitingForMedia ? " is-preparing-media" : ""
        }`}
        aria-hidden={waitingForMedia}
      >
        {filteredProjects.map((project) => (
          <ProjectCard
            key={project.slug}
            project={project}
            user={user}
            canSave={canProjectSave(project)}
            canFavorite={canProjectFavorite(project)}
            favoriteBusy={Boolean(favoriteBusySlugs[project.slug])}
            onFavoriteToggle={onFavoriteToggle}
            onThumbnailReady={handleThumbnailReady}
          />
        ))}
      </section>

      {loading ? (
        <span className="mm-sr-only" role="status">
          Atualizando projetos.
        </span>
      ) : waitingForMedia ? (
        <span className="mm-sr-only" role="status">
          Preparando imagens dos projetos.
        </span>
      ) : null}
    </div>
  );
};

export default WorkspaceSection;
export type { WorkspaceSectionKey };
