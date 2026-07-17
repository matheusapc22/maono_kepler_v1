import React from "react";
import { Link } from "react-router";

import type { MaonoUser } from "../../../auth/session";
import { Skeleton } from "../../../components/loading/Skeleton";
import type { WorkspaceProject } from "../workspace-api";

type ProjectCardProps = {
  project: WorkspaceProject;
  user: MaonoUser | null;
  canSave: boolean;
  canFavorite: boolean;
  favoriteBusy?: boolean;
  holdThumbnailShimmer?: boolean;
  onFavoriteToggle?: (project: WorkspaceProject) => void | Promise<void>;
  onThumbnailSettled?: (project: WorkspaceProject) => void;
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function parseApiDate(value?: string) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return new Date(`${trimmed}Z`);
  }

  return new Date(trimmed);
}

function formatDate(value?: string) {
  if (!value) {
    return "Não informado";
  }

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
  } catch {
    return value;
  }
}

function relativeUpdateLabel(value?: string) {
  if (!value) {
    return "Atualização não informada";
  }

  const date = parseApiDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return `Atualizado em ${value}`;
  }

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

function permissionLabel(value?: string) {
  const labels: Record<string, string> = {
    viewer: "Visualização",
    editor: "Edição",
    owner: "Proprietário",
    client: "Proprietário",
  };

  return labels[normalize(value)] || value || "Acesso";
}

export function projectThumbnailUrl(project: WorkspaceProject) {
  if (project.thumbnailUrl) {
    return project.thumbnailUrl;
  }

  const stableVersion = project.updatedAt || project.createdAt || project.slug;
  const cacheKey = encodeURIComponent(stableVersion);
  return `/api/projects/${encodeURIComponent(project.slug)}/thumbnail?v=${cacheKey}`;
}

export function projectThumbnailKey(project: WorkspaceProject) {
  return `${project.slug}::${projectThumbnailUrl(project)}`;
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  user,
  canSave,
  canFavorite,
  favoriteBusy = false,
  holdThumbnailShimmer = false,
  onFavoriteToggle,
  onThumbnailSettled,
}) => {
  const thumbnailUrl = projectThumbnailUrl(project);
  const [thumbnailLoaded, setThumbnailLoaded] = React.useState(false);
  const [thumbnailMissing, setThumbnailMissing] = React.useState(false);
  const isFavorite = Boolean(project.favorite || project.favorited);

  React.useEffect(() => {
    setThumbnailLoaded(false);
    setThumbnailMissing(false);
  }, [thumbnailUrl]);

  const handleThumbnailLoad = React.useCallback(
    async (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const loadedSource = image.currentSrc || image.src;

      try {
        await image.decode();
      } catch {
        // onLoad já confirma bytes válidos; decode pode rejeitar em alguns browsers.
      }

      if ((image.currentSrc || image.src) !== loadedSource) {
        return;
      }

      setThumbnailMissing(false);
      setThumbnailLoaded(true);
      onThumbnailSettled?.(project);
    },
    [onThumbnailSettled, project],
  );

  const handleThumbnailError = React.useCallback(() => {
    setThumbnailLoaded(false);
    setThumbnailMissing(true);
    onThumbnailSettled?.(project);
  }, [onThumbnailSettled, project]);

  const showThumbnailShimmer =
    holdThumbnailShimmer || (!thumbnailLoaded && !thumbnailMissing);
  const revealThumbnail = thumbnailLoaded && !holdThumbnailShimmer;

  return (
    <article
      className={
        holdThumbnailShimmer
          ? "mm-project-card is-media-pending"
          : "mm-project-card"
      }
      aria-busy={holdThumbnailShimmer}
    >
      {canFavorite && (
        <button
          type="button"
          className={isFavorite ? "mm-project-favorite active" : "mm-project-favorite"}
          aria-label={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          title={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          disabled={favoriteBusy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void onFavoriteToggle?.(project);
          }}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      )}

      <Link
        to={`/projects/${encodeURIComponent(project.slug)}/map`}
        className="mm-project-card-link"
      >
        <div className="mm-project-thumb">
          {showThumbnailShimmer ? (
            <Skeleton className="mm-project-thumb-loading" radius={0} />
          ) : null}

          {!thumbnailMissing && (
            <img
              src={thumbnailUrl}
              alt={`Preview do projeto ${project.name}`}
              loading="eager"
              decoding="async"
              className={revealThumbnail ? "is-loaded" : "is-loading"}
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
            />
          )}

          {thumbnailMissing && (
            <div className="mm-project-thumb-fallback" aria-hidden="true" />
          )}

          <span className="mm-thumb-badge left">
            {permissionLabel(project.accessLevel)}
          </span>

          {!thumbnailMissing && (
            <span className="mm-thumb-badge right">Preview salvo</span>
          )}
        </div>

        <div className="mm-project-card-body">
          <div className="mm-project-title-row">
            <div>
              <h2>{project.name}</h2>
              <p>{user?.name || user?.email}</p>
            </div>

            <span className={canSave ? "mm-tag green" : "mm-tag red"}>
              {canSave ? "Pode salvar" : "Não salva"}
            </span>
          </div>

          <p className="mm-project-desc">
            {project.description ||
              "Projeto geográfico disponível para consulta e análise."}
          </p>

          <div className="mm-project-meta">
            <span>{relativeUpdateLabel(project.updatedAt || project.createdAt)}</span>
            <span>•</span>
            <span>{project.slug}</span>
          </div>

          <div className="mm-card-action">Abrir mapa</div>
        </div>
      </Link>
    </article>
  );
};

export default ProjectCard;
