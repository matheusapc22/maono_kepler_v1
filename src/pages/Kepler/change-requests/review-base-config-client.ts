import { ProjectChangeRequestApiError } from "./change-request-api";
import {
  getProjectChangeReview,
  type ProjectChangeReview,
} from "./review-api";

export class ReviewBaseConfigError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code: string, retryable = false) {
    super(message);
    this.name = "ReviewBaseConfigError";
    this.code = code;
    this.retryable = retryable;
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Carregamento cancelado.", "AbortError");
}

function validateDescriptor(review: ProjectChangeReview) {
  if (review.contractVersion !== 2) {
    throw new ReviewBaseConfigError(
      "A versão do contrato de Review não é compatível com este frontend.",
      "CHANGE_REQUEST_REVIEW_CONTRACT_UNSUPPORTED",
    );
  }
  const descriptor = review.base.delivery;
  if (
    descriptor?.transport !== "direct" ||
    Number(descriptor.revision) !== Number(review.base.revision) ||
    !Number.isInteger(Number(descriptor.sizeBytes)) ||
    Number(descriptor.sizeBytes) <= 0
  ) {
    throw new ReviewBaseConfigError(
      "O backend não retornou um descriptor válido da revisão-base.",
      "CHANGE_REQUEST_BASE_DESCRIPTOR_INVALID",
    );
  }
  let validUrl = false;
  try {
    validUrl = new URL(descriptor.downloadUrl).protocol === "https:";
  } catch {
    validUrl = false;
  }
  if (!validUrl) {
    throw new ReviewBaseConfigError(
      "A URL temporária da revisão-base é inválida.",
      "CHANGE_REQUEST_BASE_DESCRIPTOR_INVALID",
    );
  }
  return descriptor;
}

async function readCompleteJson(
  response: Response,
  expectedSizeBytes: number,
  signal: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ReviewBaseConfigError(
      "O storage não retornou um body legível para a revisão-base.",
      "CHANGE_REQUEST_BASE_STREAM_UNAVAILABLE",
      true,
    );
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const cancel = () => {
    Promise.resolve(reader.cancel(signal.reason)).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > expectedSizeBytes) {
        throw new ReviewBaseConfigError(
          "A revisão-base recebeu mais bytes do que o ledger publicado.",
          "CHANGE_REQUEST_BASE_LENGTH_MISMATCH",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof ReviewBaseConfigError) throw error;
    throw new ReviewBaseConfigError(
      "O download da revisão-base foi interrompido.",
      "CHANGE_REQUEST_BASE_STREAM_INTERRUPTED",
      true,
    );
  } finally {
    signal.removeEventListener("abort", cancel);
  }

  if (receivedBytes !== expectedSizeBytes) {
    throw new ReviewBaseConfigError(
      "O download da revisão-base terminou antes de receber todos os bytes esperados.",
      "CHANGE_REQUEST_BASE_STREAM_INTERRUPTED",
      true,
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  for (let index = 0; index < chunks.length; index += 1) {
    text += decoder.decode(chunks[index], { stream: true });
    chunks[index] = new Uint8Array(0);
  }
  text += decoder.decode();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReviewBaseConfigError(
      "A revisão-base foi recebida por completo, mas o JSON armazenado é inválido.",
      "CHANGE_REQUEST_BASE_JSON_INVALID",
    );
  }
}

async function downloadDescriptor(
  review: ProjectChangeReview,
  signal: AbortSignal,
) {
  const descriptor = validateDescriptor(review);
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetch(descriptor.downloadUrl, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ReviewBaseConfigError(
      "Não foi possível acessar diretamente a revisão-base no storage.",
      "CHANGE_REQUEST_BASE_DIRECT_DOWNLOAD_FAILED",
      true,
    );
  }
  if (!response.ok) {
    throw new ReviewBaseConfigError(
      "O storage não conseguiu entregar a revisão-base.",
      "CHANGE_REQUEST_BASE_DIRECT_DOWNLOAD_FAILED",
      response.status >= 500 || [408, 425, 429].includes(response.status),
    );
  }
  return readCompleteJson(response, Number(descriptor.sizeBytes), signal);
}

export async function loadReviewBaseProjectConfig(
  projectSlug: string,
  changeRequestId: string,
  signal: AbortSignal,
) {
  let pinnedRevision: number | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    throwIfAborted(signal);
    try {
      const review = await getProjectChangeReview(projectSlug, changeRequestId, {
        force: attempt > 1,
      });
      if (String(review.project.slug) !== String(projectSlug)) {
        throw new ReviewBaseConfigError(
          "A solicitação de Review não pertence a este projeto.",
          "CHANGE_REQUEST_REVIEW_PROJECT_MISMATCH",
        );
      }
      const revision = Number(review.base.revision);
      if (pinnedRevision !== null && revision !== pinnedRevision) {
        throw new ReviewBaseConfigError(
          "A revisão-base mudou durante a repetição do carregamento.",
          "CHANGE_REQUEST_BASE_REVISION_CHANGED",
        );
      }
      pinnedRevision = revision;
      const config = await downloadDescriptor(review, signal);
      return {
        review,
        config,
        projectId: review.project.id,
        revision,
        schemaVersion: review.base.schemaVersion ?? 1,
        sizeBytes: review.base.delivery.sizeBytes,
      };
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      lastError = error;
      const retryable =
        error instanceof ReviewBaseConfigError
          ? error.retryable
          : error instanceof ProjectChangeRequestApiError
            ? error.status >= 500 || [408, 425, 429].includes(error.status)
            : true;
      if (!retryable || attempt === 2) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ReviewBaseConfigError(
        "Não foi possível carregar a revisão-base.",
        "CHANGE_REQUEST_BASE_LOAD_FAILED",
      );
}
