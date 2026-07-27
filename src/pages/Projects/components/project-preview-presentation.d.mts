import type { ProjectThumbnailStatus } from "../projects-api";

export type PreviewPresentation =
  | "generation-svg"
  | "current-image"
  | "loading-neutral"
  | "missing-neutral"
  | "failed-previous-image"
  | "failed-neutral";

export type PreviewPresentationInput = {
  status: ProjectThumbnailStatus;
  currentUrl: string | null;
  currentRevision: number | null;
  generationRevision: number | null;
  decodedUrl: string | null;
  imageError: boolean;
  previousReadyUrl: string | null;
};

export function resolvePreviewPresentation(
  input: PreviewPresentationInput,
): PreviewPresentation;
