import React from "react";
import { Link } from "react-router";

import { Skeleton } from "../../../components/loading/Skeleton";
import type { ProjectListItem } from "../projects-api";
import {
  formatProjectRelativeDate,
  normalizeProjectAccessLevel,
  projectThumbnailUrl,
} from "./project-card-utils";

type ProjectCardProps = {
  project: ProjectListItem;
  canSave: boolean;
  canFavorite: boolean;
  favoriteBusy?: boolean;
  holdThumbnailShimmer?: boolean;
  opening?: boolean;
  onOpen?: (project: ProjectListItem) => void;
  onFavoriteToggle?: (project: ProjectListItem) => void | Promise<void>;
  onThumbnailSettled?: (project: ProjectListItem) => void;
};

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  canSave,
  canFavorite,
  favoriteBusy = false,
  holdThumbnailShimmer = false,
  opening = false,
  onOpen,
  onFavoriteToggle,
  onThumbnailSettled,
}) => {
  const thumbnailUrl = projectThumbnailUrl(project);
  const sourceVersionRef = React.useRef(0);
  const [thumbnailLoaded, setThumbnailLoaded] = React.useState(false);
  const [thumbnailMissing, setThumbnailMissing] = React.useState(false);
  const isFavorite = Boolean(project.favorite || project.favorited);
  const accessLevel = normalizeProjectAccessLevel(project.accessLevel);
  const isOwner = accessLevel === "owner";

  React.useEffect(() => {
    sourceVersionRef.current += 1;
    setThumbnailLoaded(false);
    setThumbnailMissing(false);
  }, [thumbnailUrl]);

  const handleThumbnailLoad = React.useCallback(
    async (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const loadedSource = image.currentSrc || image.src;
      const sourceVersion = sourceVersionRef.current;

      if (typeof image.decode === "function") {
        try {
          await image.decode();
        } catch {
          // onLoad já confirmou a leitura dos bytes.
        }
      }

      if (
        sourceVersion !== sourceVersionRef.current ||
        (image.currentSrc || image.src) !== loadedSource
      ) {
        return;
      }

      setThumbnailMissing(false);
      setThumbnailLoaded(true);
      onThumbnailSettled?.(project);
    },
    [onThumbnailSettled, project],
  );

  const handleThumbnailError = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const failedSource = image.getAttribute("src");

      if (failedSource !== thumbnailUrl) {
        return;
      }

      setThumbnailLoaded(false);
      setThumbnailMissing(true);
      onThumbnailSettled?.(project);
    },
    [onThumbnailSettled, project, thumbnailUrl],
  );

  const showThumbnailShimmer =
    holdThumbnailShimmer || (!thumbnailLoaded && !thumbnailMissing);
  const revealThumbnail = thumbnailLoaded && !holdThumbnailShimmer;
  const cardClassName = [
    "mm-project-card",
    holdThumbnailShimmer ? "is-media-pending" : "",
    opening ? "is-opening" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClassName} aria-busy={holdThumbnailShimmer}>
      <div className="mm-project-card__preview">
        {showThumbnailShimmer ? (
          <Skeleton
            className="mm-project-card__preview-loading"
            radius={0}
          />
        ) : null}

        {!thumbnailMissing ? (
          <img
            src={thumbnailUrl}
            alt={`Prévia do projeto ${project.name}`}
            loading="eager"
            decoding="async"
            className={revealThumbnail ? "is-loaded" : "is-loading"}
            onLoad={handleThumbnailLoad}
            onError={handleThumbnailError}
          />
        ) : (
          <div
            className="mm-project-card__preview-fallback"
            role="img"
            aria-label={`Prévia indisponível para o projeto ${project.name}`}
          >
            <span aria-hidden="true">◇</span>
            <strong>Prévia indisponível</strong>
          </div>
        )}

        {canFavorite ? (
          <button
            type="button"
            className={
              isFavorite
                ? "mm-project-card__favorite is-active"
                : "mm-project-card__favorite"
            }
            aria-label={
              isFavorite
                ? "Remover projeto dos favoritos"
                : "Adicionar projeto aos favoritos"
            }
            aria-pressed={isFavorite}
            title={
              isFavorite
                ? "Remover dos favoritos"
                : "Adicionar aos favoritos"
            }
            disabled={favoriteBusy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onFavoriteToggle?.(project);
            }}
          >
            <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
            {favoriteBusy ? (
              <span className="mm-sr-only" role="status">
                Atualizando favorito.
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      <div className="mm-project-card__content">
        <div className="mm-project-card__status" aria-label="Acesso ao projeto">
          {isOwner ? (
            <span className="mm-project-card__chip is-owner">
              Proprietário
            </span>
          ) : null}

          {canSave ? (
            <span className="mm-project-card__chip is-save">
              Pode salvar
            </span>
          ) : (
            <span className="mm-project-card__chip is-read-only">
              Somente leitura
            </span>
          )}
        </div>

        <header className="mm-project-card__header">
          <h2 title={project.name}>{project.name}</h2>
        </header>

        <p className="mm-project-card__description">
          {project.description ||
            "Projeto geográfico disponível para consulta e análise."}
        </p>

        <footer className="mm-project-card__footer">
          <div className="mm-project-card__metadata">
            <span>
              {formatProjectRelativeDate(
                project.updatedAt || project.createdAt,
              )}
            </span>
            <span
              className="mm-project-card__slug"
              title={project.slug}
            >
              {project.slug}
            </span>
          </div>

          <Link
            to={`/projects/${encodeURIComponent(project.slug)}/map`}
            className="mm-project-card__open"
            aria-disabled={opening}
            tabIndex={opening ? -1 : 0}
            onClick={(event) => {
              if (opening) {
                event.preventDefault();
                return;
              }

              onOpen?.(project);
            }}
          >
            {opening ? "Abrindo..." : "Abrir projeto"}
          </Link>
        </footer>
      </div>
    </article>
  );
};

export default ProjectCard;
