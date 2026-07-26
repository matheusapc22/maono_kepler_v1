export type ProjectThumbnailStatus =
  | "UNKNOWN"
  | "PENDING"
  | "READY"
  | "FAILED"
  | "MISSING";

export type ProjectThumbnailState = {
  thumbnailStatus: ProjectThumbnailStatus;
  configRevision: number;
  thumbnailRevision: number | null;
  thumbnailUpdatedAt: string | null;
  thumbnailAttempts: number;
};

export class ProjectThumbnailRequestError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  stale: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      retryable?: boolean;
      stale?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ProjectThumbnailRequestError";
    this.status = Number(options.status || 0);
    this.code = options.code || "PROJECT_THUMBNAIL_REQUEST_FAILED";
    this.retryable = Boolean(options.retryable);
    this.stale = Boolean(options.stale);
  }
}

function normalizeStatus(value: unknown): ProjectThumbnailStatus {
  const normalized = String(value || "").trim().toUpperCase();

  if (
    normalized === "PENDING" ||
    normalized === "READY" ||
    normalized === "FAILED" ||
    normalized === "MISSING"
  ) {
    return normalized;
  }

  return "UNKNOWN";
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseError(response: Response, data: any) {
  const code =
    String(data?.error?.code || data?.code || "").trim() ||
    "PROJECT_THUMBNAIL_REQUEST_FAILED";
  const stale =
    response.status === 409 &&
    code === "STALE_THUMBNAIL_REVISION";
  const retryable =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500;
  const message =
    data?.error?.message ||
    data?.message ||
    (stale
      ? "A captura pertence a uma revisão anterior."
      : "Não foi possível processar a visualização do projeto.");

  return new ProjectThumbnailRequestError(message, {
    status: response.status,
    code,
    retryable,
    stale,
  });
}

export function normalizeThumbnailState(value: any): ProjectThumbnailState {
  return {
    thumbnailStatus: normalizeStatus(
      value?.thumbnailStatus ?? value?.status,
    ),
    configRevision: Math.max(
      0,
      Number(value?.configRevision ?? value?.revision ?? 0) || 0,
    ),
    thumbnailRevision:
      value?.thumbnailRevision === null ||
      value?.thumbnailRevision === undefined
        ? null
        : Math.max(0, Number(value.thumbnailRevision) || 0),
    thumbnailUpdatedAt:
      value?.thumbnailUpdatedAt ?? value?.updatedAt ?? null,
    thumbnailAttempts: Math.max(
      0,
      Number(value?.thumbnailAttempts ?? value?.attempts ?? 0) || 0,
    ),
  };
}

export async function uploadProjectThumbnail({
  slug,
  revision,
  blob,
  captureMethod,
  signal,
}: {
  slug: string;
  revision: number;
  blob: Blob;
  captureMethod: string;
  signal?: AbortSignal;
}) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(
      slug,
    )}/thumbnail?revision=${encodeURIComponent(String(revision))}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "image/png",
        "X-Maono-Capture-Method": captureMethod,
      },
      body: blob,
      signal,
    },
  );
  const data = await readJson(response);

  if (!response.ok || data?.ok === false) {
    throw responseError(response, data);
  }

  return {
    status: normalizeStatus(data?.status),
    revision: Number(data?.revision ?? revision),
    idempotent: Boolean(data?.idempotent),
  };
}

export async function fetchProjectThumbnailStatus(
  slug: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/thumbnail/status`,
    {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const data = await readJson(response);

  if (!response.ok || data?.ok === false) {
    throw responseError(response, data);
  }

  return normalizeThumbnailState(data);
}

export async function markProjectThumbnailFailed({
  slug,
  revision,
  captureMethod,
  errorCode,
  signal,
}: {
  slug: string;
  revision: number;
  captureMethod: string;
  errorCode: string;
  signal?: AbortSignal;
}) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/thumbnail`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        revision,
        captureMethod,
        errorCode,
      }),
      signal,
    },
  );
  const data = await readJson(response);

  if (!response.ok || data?.ok === false) {
    throw responseError(response, data);
  }

  return normalizeThumbnailState(data);
}
