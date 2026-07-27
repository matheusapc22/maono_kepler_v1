const KNOWN_STATUSES = new Set([
  "UNKNOWN",
  "PENDING",
  "READY",
  "FAILED",
  "MISSING",
]);

function normalizeStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  return KNOWN_STATUSES.has(normalized) ? normalized : "UNKNOWN";
}

function sameRevision(left, right) {
  return (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    Number(left) === Number(right)
  );
}

/**
 * Resolve somente a linguagem visual da prévia. O ciclo assíncrono, o
 * carregamento da imagem e a memória da revisão permanecem no ProjectCard.
 */
export function resolvePreviewPresentation({
  status,
  currentUrl,
  currentRevision,
  generationRevision,
  decodedUrl,
  imageError,
  previousReadyUrl,
}) {
  const normalizedStatus = normalizeStatus(status);
  const hasCurrentImage = Boolean(currentUrl);
  const currentImageDecoded =
    hasCurrentImage && decodedUrl === currentUrl;
  const hasUsablePreviousImage =
    Boolean(previousReadyUrl) && previousReadyUrl !== currentUrl;

  if (normalizedStatus === "PENDING") {
    return "generation-svg";
  }

  if (normalizedStatus === "READY") {
    if (imageError || !hasCurrentImage) {
      return hasUsablePreviousImage
        ? "failed-previous-image"
        : "failed-neutral";
    }

    if (currentImageDecoded) {
      return "current-image";
    }

    if (
      sameRevision(currentRevision, generationRevision)
    ) {
      return "generation-svg";
    }

    return "loading-neutral";
  }

  if (normalizedStatus === "UNKNOWN") {
    if (imageError || !hasCurrentImage) {
      return "missing-neutral";
    }

    return currentImageDecoded
      ? "current-image"
      : "loading-neutral";
  }

  if (normalizedStatus === "FAILED") {
    return hasUsablePreviousImage || Boolean(previousReadyUrl)
      ? "failed-previous-image"
      : "failed-neutral";
  }

  return "missing-neutral";
}
