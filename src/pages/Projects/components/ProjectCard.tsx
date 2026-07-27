import React from "react";
import { Link } from "react-router";

import type { ProjectListItem } from "../projects-api";
import ProjectActionsMenu from "./ProjectActionsMenu";
import ProjectMapPlaceholder from "./ProjectMapPlaceholder";
import {
  formatProjectRelativeDate,
  isProjectThumbnailDecoded,
  normalizeProjectAccessLevel,
  normalizeProjectThumbnailStatus,
  projectPreviousReadyThumbnailUrl,
  rememberProjectThumbnailDecoded,
  resolvePreviewPresentation,
  type PreviewPresentation,
  projectThumbnailRevision,
  projectThumbnailUrl,
} from "./project-card-utils";

type ProjectCardProps = {
  project: ProjectListItem;
  canSave: boolean;
  canFavorite: boolean;
  canEditMetadata?: boolean;
  actionsOpen?: boolean;
  favoriteBusy?: boolean;
  opening?: boolean;
  onOpen?: (project: ProjectListItem) => void;
  onActionsOpenChange?: (open: boolean) => void;
  onEditMetadata?: (project: ProjectListItem) => void;
  onFavoriteToggle?: (project: ProjectListItem) => void | Promise<void>;
};

type PreviewTransitionState = {
  generationRevision: number | null;
  loadingRevision: number | null;
  decodedRevision: number | null;
  decodedUrl: string | null;
  previousReadyUrl: string | null;
  imageError: boolean;
  imageErrorUrl: string | null;
};

const PROJECT_PREVIEW_TRANSITION_V2_ENABLED =
  String(
    import.meta.env.VITE_PROJECT_PREVIEW_TRANSITION_V2 ?? "true",
  )
    .trim()
    .toLowerCase() !== "false";

function normalizedRevision(value?: number | null) {
  const revision = Number(value);

  return Number.isInteger(revision) && revision >= 0
    ? revision
    : null;
}

function logPreviewTransition(
  event: "PENDING" | "READY-decode" | "image-error",
  projectSlug: string,
  revision: number | null,
) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.debug("[Maono project preview]", event, {
    project: projectSlug,
    revision,
  });
}

function ProjectPreviewNeutralState({
  presentation,
  projectName,
}: {
  presentation:
    | "loading-neutral"
    | "missing-neutral"
    | "failed-neutral";
  projectName: string;
}) {
  const copy = {
    "loading-neutral": {
      icon: "▧",
      title: "Carregando prévia",
      description: "Preparando a imagem existente.",
    },
    "missing-neutral": {
      icon: "◇",
      title: "Sem prévia",
      description: "Este projeto ainda não possui uma imagem.",
    },
    "failed-neutral": {
      icon: "!",
      title: "Prévia indisponível",
      description: "Não foi possível exibir a imagem deste projeto.",
    },
  }[presentation];

  return (
    <div
      className={`mm-project-card__preview-fallback is-${presentation}`}
      role={presentation === "loading-neutral" ? "status" : "img"}
      aria-label={`${copy.title} do projeto ${projectName}. ${copy.description}`}
      data-preview-state={presentation}
    >
      <span aria-hidden="true">{copy.icon}</span>
      <strong>{copy.title}</strong>
      <small>{copy.description}</small>
    </div>
  );
}

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
  opening = false,
  onOpen,
  onActionsOpenChange,
  onEditMetadata,
  onFavoriteToggle,
}) => {
  const thumbnailStatus = normalizeProjectThumbnailStatus(
    project.thumbnailStatus,
  );
  const thumbnailUrl = projectThumbnailUrl(project);
  const thumbnailRevision = projectThumbnailRevision(project);
  const configRevision = normalizedRevision(project.configRevision);
  const previousReadyCandidate =
    projectPreviousReadyThumbnailUrl(project);
  const previousReadyRevision = normalizedRevision(
    project.thumbnailRevision,
  );
  const thumbnailDecodedInSession = isProjectThumbnailDecoded(
    project,
    thumbnailUrl,
  );
  const previousDecodedInSession = isProjectThumbnailDecoded(
    project,
    previousReadyCandidate,
  );
  const displayedSourceRef = React.useRef<string | null>(null);
  const [previewState, setPreviewState] =
    React.useState<PreviewTransitionState>(() => {
      const initialDecodedUrl = thumbnailDecodedInSession
        ? thumbnailUrl
        : previousDecodedInSession
          ? previousReadyCandidate
          : null;

      return {
        generationRevision:
          thumbnailStatus === "PENDING" ? configRevision : null,
        loadingRevision:
          thumbnailUrl && !thumbnailDecodedInSession
            ? thumbnailRevision
            : null,
        decodedRevision: initialDecodedUrl
          ? normalizedRevision(project.thumbnailRevision) ??
            thumbnailRevision
          : null,
        decodedUrl: initialDecodedUrl,
        previousReadyUrl: previousReadyCandidate,
        imageError: false,
        imageErrorUrl: null,
      };
    });
  const isFavorite = Boolean(project.favorite || project.favorited);
  const accessLevel = normalizeProjectAccessLevel(project.accessLevel);
  const isOwner = accessLevel === "owner";

  React.useEffect(() => {
    if (thumbnailStatus === "PENDING") {
      logPreviewTransition(
        "PENDING",
        project.slug,
        configRevision,
      );
    }

    setPreviewState((current) => {
      const decodedPreviousUrl =
        current.decodedUrl &&
        current.decodedUrl !== thumbnailUrl
          ? current.decodedUrl
          : null;
      const retainedPreviousUrl =
        [
          decodedPreviousUrl,
          current.previousReadyUrl,
          previousReadyCandidate,
        ].find(
          (candidate) =>
            Boolean(candidate) &&
            candidate !== thumbnailUrl &&
            candidate !== current.imageErrorUrl,
        ) || null;

      if (thumbnailStatus === "PENDING") {
        return {
          ...current,
          generationRevision: configRevision,
          loadingRevision: null,
          previousReadyUrl:
            decodedPreviousUrl ||
            current.previousReadyUrl ||
            previousReadyCandidate,
          imageError: false,
          imageErrorUrl: null,
        };
      }

      if (
        thumbnailStatus === "READY" ||
        thumbnailStatus === "UNKNOWN"
      ) {
        const decodedCurrentUrl =
          thumbnailDecodedInSession ||
          current.decodedUrl === thumbnailUrl
            ? thumbnailUrl
            : null;
        const generationRevision =
          thumbnailStatus === "READY" &&
          current.generationRevision === thumbnailRevision
            ? current.generationRevision
            : null;
        const currentImageStillFailed =
          current.imageError &&
          current.imageErrorUrl === thumbnailUrl;

        return {
          generationRevision:
            decodedCurrentUrl ? null : generationRevision,
          loadingRevision:
            thumbnailUrl && !decodedCurrentUrl
              ? thumbnailRevision
              : null,
          decodedRevision: decodedCurrentUrl
            ? thumbnailRevision
            : null,
          decodedUrl: decodedCurrentUrl,
          previousReadyUrl:
            retainedPreviousUrl || previousReadyCandidate,
          imageError: currentImageStillFailed,
          imageErrorUrl: currentImageStillFailed
            ? current.imageErrorUrl
            : null,
        };
      }

      if (thumbnailStatus === "FAILED") {
        const failedFallbackUrl =
          decodedPreviousUrl ||
          [
            current.previousReadyUrl,
            previousReadyCandidate,
          ].find(
            (candidate) =>
              Boolean(candidate) &&
              candidate !== current.imageErrorUrl,
          ) ||
          null;
        const fallbackDecoded =
          Boolean(failedFallbackUrl) &&
          (current.decodedUrl === failedFallbackUrl ||
            previousDecodedInSession);

        return {
          generationRevision: null,
          loadingRevision:
            failedFallbackUrl && !fallbackDecoded
              ? previousReadyRevision
              : null,
          decodedRevision: fallbackDecoded
            ? previousReadyRevision
            : null,
          decodedUrl: fallbackDecoded ? failedFallbackUrl : null,
          previousReadyUrl: failedFallbackUrl,
          imageError:
            current.imageError && !failedFallbackUrl,
          imageErrorUrl:
            current.imageError && !failedFallbackUrl
              ? current.imageErrorUrl
              : null,
        };
      }

      return {
        ...current,
        generationRevision: null,
        loadingRevision: null,
        decodedRevision: null,
        decodedUrl: null,
        imageError: false,
        imageErrorUrl: null,
      };
    });
  }, [
    configRevision,
    previousDecodedInSession,
    previousReadyCandidate,
    previousReadyRevision,
    project.slug,
    thumbnailDecodedInSession,
    thumbnailRevision,
    thumbnailStatus,
    thumbnailUrl,
  ]);

  const previousReadyUrl =
    previewState.previousReadyUrl ||
    (previewState.imageErrorUrl === previousReadyCandidate
      ? null
      : previousReadyCandidate);
  const currentImageFailed =
    previewState.imageError &&
    previewState.imageErrorUrl === thumbnailUrl;
  const resolvedPresentation = resolvePreviewPresentation({
    status: thumbnailStatus,
    currentUrl: thumbnailUrl,
    currentRevision: thumbnailRevision,
    generationRevision: previewState.generationRevision,
    decodedUrl: previewState.decodedUrl,
    imageError: currentImageFailed,
    previousReadyUrl,
  });
  const legacyPresentation: PreviewPresentation =
    thumbnailUrl &&
    previewState.decodedUrl === thumbnailUrl &&
    !currentImageFailed
      ? "current-image"
      : "generation-svg";
  const previewPresentation =
    PROJECT_PREVIEW_TRANSITION_V2_ENABLED
      ? resolvedPresentation
      : legacyPresentation;
  const displayImageUrl =
    previewPresentation === "failed-previous-image"
      ? previousReadyUrl
      : thumbnailStatus === "READY" ||
          thumbnailStatus === "UNKNOWN"
        ? currentImageFailed
          ? null
          : thumbnailUrl
        : null;
  const displayImageDecoded =
    Boolean(displayImageUrl) &&
    (previewState.decodedUrl === displayImageUrl ||
      isProjectThumbnailDecoded(project, displayImageUrl));
  displayedSourceRef.current = displayImageUrl;
  const showGenerationSvg =
    previewPresentation === "generation-svg";
  const neutralPresentation:
    | "loading-neutral"
    | "missing-neutral"
    | "failed-neutral"
    | null =
    previewPresentation === "loading-neutral" ||
    previewPresentation === "missing-neutral" ||
    previewPresentation === "failed-neutral"
      ? previewPresentation
      : previewPresentation === "failed-previous-image" &&
          !displayImageDecoded
        ? "loading-neutral"
        : null;
  const previewBusy =
    thumbnailStatus === "PENDING" ||
    (PROJECT_PREVIEW_TRANSITION_V2_ENABLED &&
      thumbnailStatus === "READY" &&
      showGenerationSvg);

  const markDisplayedImageFailed = React.useCallback(
    (failedUrl: string) => {
      logPreviewTransition(
        "image-error",
        project.slug,
        thumbnailRevision,
      );
      setPreviewState((current) => ({
        ...current,
        generationRevision: null,
        loadingRevision: null,
        decodedRevision:
          current.decodedUrl === failedUrl
            ? null
            : current.decodedRevision,
        decodedUrl:
          current.decodedUrl === failedUrl
            ? null
            : current.decodedUrl,
        previousReadyUrl:
          current.previousReadyUrl === failedUrl
            ? null
            : current.previousReadyUrl,
        imageError: true,
        imageErrorUrl: failedUrl,
      }));
    },
    [project.slug, thumbnailRevision],
  );

  const handleDisplayedImageLoad = React.useCallback(
    async (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const expectedSource = displayImageUrl;

      if (!expectedSource) {
        return;
      }

      if (typeof image.decode === "function") {
        try {
          await image.decode();
        } catch {
          markDisplayedImageFailed(expectedSource);
          return;
        }
      }

      if (
        displayedSourceRef.current !== expectedSource ||
        image.getAttribute("src") !== expectedSource
      ) {
        return;
      }

      rememberProjectThumbnailDecoded(project, expectedSource);
      const decodedCurrentImage =
        expectedSource === thumbnailUrl;

      if (decodedCurrentImage) {
        logPreviewTransition(
          "READY-decode",
          project.slug,
          thumbnailRevision,
        );
      }

      setPreviewState((current) => ({
        ...current,
        generationRevision:
          decodedCurrentImage &&
          current.generationRevision === thumbnailRevision
            ? null
            : current.generationRevision,
        loadingRevision: null,
        decodedRevision:
          decodedCurrentImage
            ? thumbnailRevision
            : previousReadyRevision,
        decodedUrl: expectedSource,
        previousReadyUrl:
          decodedCurrentImage
            ? expectedSource
            : current.previousReadyUrl || expectedSource,
        imageError:
          decodedCurrentImage ||
          current.imageErrorUrl === expectedSource
            ? false
            : current.imageError,
        imageErrorUrl:
          decodedCurrentImage ||
          current.imageErrorUrl === expectedSource
            ? null
            : current.imageErrorUrl,
      }));
    },
    [
      displayImageUrl,
      markDisplayedImageFailed,
      project,
      previousReadyRevision,
      thumbnailRevision,
      thumbnailUrl,
    ],
  );

  const handleDisplayedImageError = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const failedSource = event.currentTarget.getAttribute("src");

      if (!failedSource || failedSource !== displayImageUrl) {
        return;
      }

      markDisplayedImageFailed(failedSource);
    },
    [displayImageUrl, markDisplayedImageFailed],
  );

  const cardClassName = [
    "mm-project-card",
    previewBusy ? "is-media-pending" : "",
    opening ? "is-opening" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClassName} aria-busy={previewBusy}>
      <div
        className="mm-project-card__preview"
        data-preview-presentation={previewPresentation}
      >
        {showGenerationSvg ? (
          <ProjectMapPlaceholder project={project} />
        ) : null}

        {neutralPresentation ? (
          <ProjectPreviewNeutralState
            presentation={neutralPresentation}
            projectName={project.name}
          />
        ) : null}

        {displayImageUrl ? (
          <img
            src={displayImageUrl}
            alt={
              previewPresentation === "failed-previous-image"
                ? `Última prévia válida do projeto ${project.name}`
                : `Prévia do projeto ${project.name}`
            }
            loading={showGenerationSvg ? "eager" : "lazy"}
            decoding="async"
            className={
              displayImageDecoded ? "is-loaded" : "is-loading"
            }
            onLoad={handleDisplayedImageLoad}
            onError={handleDisplayedImageError}
          />
        ) : null}

        {previewPresentation === "failed-previous-image" &&
        displayImageDecoded ? (
          <span
            className="mm-project-card__preview-notice is-failed"
            role="status"
          >
            Falha ao atualizar. Exibindo a última prévia.
          </span>
        ) : null}

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
            onClick={(
              event: React.MouseEvent<HTMLDivElement>,
            ) => {
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
            onClick={(
              event: React.MouseEvent<HTMLAnchorElement>,
            ) => {
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
