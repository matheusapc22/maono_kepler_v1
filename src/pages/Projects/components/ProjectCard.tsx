import React from "react";
import { Link } from "react-router";

import { Skeleton } from "../../../components/loading/Skeleton";
import type { ProjectListItem } from "../projects-api";
import ProjectActionsMenu from "./ProjectActionsMenu";
import {
  formatProjectRelativeDate,
  normalizeProjectAccessLevel,
  projectThumbnailUrl,
} from "./project-card-utils";

type ProjectCardProps = {
  project: ProjectListItem;
  canSave: boolean;
  canFavorite: boolean;
  canEditMetadata?: boolean;
  actionsOpen?: boolean;
  favoriteBusy?: boolean;
  holdThumbnailShimmer?: boolean;
  opening?: boolean;
  onOpen?: (project: ProjectListItem) => void;
  onActionsOpenChange?: (open: boolean) => void;
  onEditMetadata?: (project: ProjectListItem) => void;
  onFavoriteToggle?: (project: ProjectListItem) => void | Promise<void>;
  onThumbnailSettled?: (project: ProjectListItem) => void;
};

function OwnerIcon() {
  return (
    <svg
      className="mm-project-card__chip-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      className="mm-project-card__metadata-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 7v5l3 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      className="mm-project-card__metadata-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 5h7.6a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.8l-4.6 4.6a2 2 0 0 1-2.8 0L5.6 13A2 2 0 0 1 5 11.6V5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="mm-project-card__open-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 12h13m-5-5 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function FavoriteIcon({ active }: { active: boolean }) {
  return (
    <svg
      className="mm-project-card__favorite-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  canSave,
  canFavorite,
  canEditMetadata = false,
  actionsOpen = false,
  favoriteBusy = false,
  holdThumbnailShimmer = false,
  opening = false,
  onOpen,
  onActionsOpenChange,
  onEditMetadata,
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

        {canEditMetadata || canFavorite ? (
          <div
            className="mm-project-card__actions"
            aria-label="Ações do projeto"
            style={{
              position: "absolute",
              zIndex: 5,
              top: 12,
              right: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {canEditMetadata ? (
              <ProjectActionsMenu
                projectName={project.name}
                open={actionsOpen}
                onOpenChange={(open) => onActionsOpenChange?.(open)}
                onEdit={() => onEditMetadata?.(project)}
              />
            ) : null}

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
                          aria-busy={favoriteBusy}
                          title={
                            isFavorite
                              ? "Remover dos favoritos"
                              : "Adicionar aos favoritos"
                          }
                          disabled={favoriteBusy}
                          style={{ position: "static", flex: "0 0 auto" }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void onFavoriteToggle?.(project);
                          }}
                        >
                          <FavoriteIcon active={isFavorite} />
                          {favoriteBusy ? (
                            <span className="mm-sr-only" role="status">
                              Atualizando favorito.
                            </span>
                          ) : null}
                        </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mm-project-card__content">
        <div className="mm-project-card__status" aria-label="Acesso ao projeto">
          {isOwner ? (
            <span className="mm-project-card__chip is-owner">
              <OwnerIcon />
              <span>Proprietário</span>
            </span>
          ) : null}

          {canSave ? (
            <span className="mm-project-card__chip is-save">
              <span className="mm-project-card__status-dot" aria-hidden="true" />
              <span>Pode salvar</span>
            </span>
          ) : (
            <span className="mm-project-card__chip is-read-only">
              <span className="mm-project-card__status-dot" aria-hidden="true" />
              <span>Somente leitura</span>
            </span>
          )}
        </div>

        <header className="mm-project-card__header">
          <h2 title={project.name}>{project.name}</h2>
          {project.createdBy?.name ? (
            <p
              className="mm-project-card__creator"
              title={`Criado por ${project.createdBy.name}`}
            >
              {project.createdBy.name}
            </p>
          ) : null}
        </header>

        <p className="mm-project-card__description">
          {project.description ||
            "Projeto geográfico disponível para consulta e análise."}
        </p>

        <footer className="mm-project-card__footer">
          <div className="mm-project-card__metadata">
            <span className="mm-project-card__metadata-item">
              <ClockIcon />
              <span>
                {formatProjectRelativeDate(
                  project.updatedAt || project.createdAt,
                )}
              </span>
            </span>

            <span
              className="mm-project-card__metadata-divider"
              aria-hidden="true"
            />

            <span
              className="mm-project-card__metadata-item mm-project-card__metadata-slug"
              title={project.slug}
            >
              <TagIcon />
              <span className="mm-project-card__slug">{project.slug}</span>
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
            <span>{opening ? "Abrindo..." : "Abrir projeto"}</span>
            <ArrowIcon />
          </Link>
        </footer>
      </div>
    </article>
  );
};

export default ProjectCard;
