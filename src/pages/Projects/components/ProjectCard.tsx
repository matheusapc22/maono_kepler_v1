import React from "react";
import { Link } from "react-router";

import type { MaonoUser } from "../../../auth/session";
import { Skeleton } from "../../../components/loading/Skeleton";
import {
  projectThumbnailUrl,
  type ProjectThumbnailState,
} from "../project-thumbnail";
import type { WorkspaceProject } from "../workspace-api";

type ProjectCardProps = {
  project: WorkspaceProject;
  user: MaonoUser | null;
  canSave: boolean;
  canFavorite: boolean;
  favoriteBusy?: boolean;
  onFavoriteToggle?: (project: WorkspaceProject) => void | Promise<void>;
  onThumbnailReady?: (
    project: WorkspaceProject,
    state: ProjectThumbnailState,
  ) => void;
};

type InternalThumbnailState = "loading" | ProjectThumbnailState;

const THUMBNAIL_RENDER_TIMEOUT_MS = 15000;

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

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  user,
  canSave,
  canFavorite,
  favoriteBusy = false,
  onFavoriteToggle,
  onThumbnailReady,
}) => {
  const thumbnailUrl = projectThumbnailUrl(project);
  const [thumbnailState, setThumbnailState] =
    React.useState<InternalThumbnailState>("loading");
  const isFavorite = Boolean(project.favorite || project.favorited);
  const description =
    project.description ||
    "Projeto geográfico disponível para consulta e análise.";

  React.useEffect(() => {
    setThumbnailState("loading");
  }, [thumbnailUrl]);

  React.useEffect(() => {
    if (thumbnailState !== "loading") return;

    const timeoutId = window.setTimeout(() => {
      setThumbnailState("missing");
    }, THUMBNAIL_RENDER_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [thumbnailState, thumbnailUrl]);

  React.useEffect(() => {
    if (thumbnailState === "loading") return;
    onThumbnailReady?.(project, thumbnailState);
  }, [onThumbnailReady, project, thumbnailState]);

  const handleThumbnailLoad = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const loadedSource = image.currentSrc || image.src;

      const reveal = () => {
        const currentSource = image.currentSrc || image.src;
        if (currentSource !== loadedSource) return;
        setThumbnailState("loaded");
      };

      if (typeof image.decode === "function") {
        void image
          .decode()
          .catch(() => undefined)
          .then(() => window.requestAnimationFrame(reveal));
        return;
      }

      window.requestAnimationFrame(reveal);
    },
    [],
  );

  return (
    <article className="mm-project-card">
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
          {thumbnailState === "loading" ? (
            <Skeleton className="mm-project-thumb-loading" radius={0} />
          ) : null}

          {thumbnailState !== "missing" && (
            <img
              src={thumbnailUrl}
              alt={`Preview do projeto ${project.name}`}
              loading="eager"
              decoding="async"
              className={thumbnailState === "loaded" ? "is-loaded" : "is-loading"}
              onLoad={handleThumbnailLoad}
              onError={() => setThumbnailState("missing")}
            />
          )}

          {thumbnailState === "missing" && (
            <div className="mm-project-thumb-fallback" aria-hidden="true" />
          )}

          <span className="mm-thumb-badge left">
            {permissionLabel(project.accessLevel)}
          </span>

          {thumbnailState === "loaded" && (
            <span className="mm-thumb-badge right">Preview salvo</span>
          )}
        </div>

        <div className="mm-project-card-body">
          <div className="mm-project-title-row">
            <div>
              <h2 title={project.name}>{project.name}</h2>
              <p title={user?.name || user?.email}>
                {user?.name || user?.email}
              </p>
            </div>

            <span className={canSave ? "mm-tag green" : "mm-tag red"}>
              {canSave ? "Pode salvar" : "Não salva"}
            </span>
          </div>

          <p className="mm-project-desc" title={description}>
            {description}
          </p>

          <div className="mm-project-meta">
            <span>{relativeUpdateLabel(project.updatedAt || project.createdAt)}</span>
            <span>•</span>
            <span title={project.slug}>{project.slug}</span>
          </div>

          <div className="mm-card-action">Abrir mapa</div>
        </div>
      </Link>
    </article>
  );
};

export default ProjectCard;
