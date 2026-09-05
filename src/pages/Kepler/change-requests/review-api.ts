import { ProjectChangeRequestApiError } from "./change-request-api";

export type ReviewOperationProjection = {
  id: string;
  sequence: number;
  type: "point.create";
  version: number;
  label: string;
  focus: {
    latitude: number;
    longitude: number;
  };
  target: {
    layerId: string | null;
    dataId: string | null;
    label: string;
  };
  overlay: {
    kind: "point";
    latitude: number;
    longitude: number;
  };
  properties: Record<string, unknown>;
};

export type ProjectChangeReview = {
  changeRequest: {
    id: string;
    organizationId: number;
    projectId: number;
    requestedByUserId: number;
    ticketId: number | null;
    baseRevision: number;
    status: string;
    reason: string;
    operationCount: number;
    submittedAt: string;
    createdAt: string;
    updatedAt: string;
  };
  project: {
    id: number | string;
    slug: string;
    name: string;
    currentRevision: number;
  };
  base: {
    revision: number;
    config: Record<string, unknown>;
    sizeBytes?: number;
    schemaVersion?: number;
  };
  proposal: {
    checksum: string;
    sizeBytes: number;
    schemaName: string;
    schemaVersion: number;
    operationCount: number;
    operations: ReviewOperationProjection[];
  } | null;
  conflict: {
    code: string;
    message: string;
    baseRevision?: number;
    currentRevision?: number;
    details?: unknown;
  } | null;
  permissions: {
    canApprove: boolean;
    canReject: boolean;
    canApply: boolean;
  };
};

type ApiPayload = {
  ok?: boolean;
  review?: ProjectChangeReview;
  appliedRevision?: number;
  idempotent?: boolean;
  projectIdentity?: { id: number | string; slug: string } | null;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    requestId?: string;
    details?: unknown;
  };
};

const reviewCache = new Map<string, Promise<ProjectChangeReview>>();

function cacheKey(projectSlug: string, changeRequestId: string) {
  return `${projectSlug}:${changeRequestId}`;
}

function itemUrl(projectSlug: string, changeRequestId: string) {
  return `/api/projects/${encodeURIComponent(projectSlug)}/change-requests/${encodeURIComponent(changeRequestId)}`;
}

async function parseResponse(response: Response): Promise<ApiPayload> {
  const payload = (await response.json().catch(() => null)) as ApiPayload | null;
  if (!response.ok || !payload?.ok) {
    const error = payload?.error || {};
    throw new ProjectChangeRequestApiError(
      error.message || "Não foi possível processar o Review da solicitação.",
      {
        code: error.code,
        status: response.status,
        requestId: error.requestId || response.headers.get("X-Request-Id"),
        details: error.details,
      },
    );
  }
  return payload;
}

export function invalidateProjectChangeReview(
  projectSlug: string,
  changeRequestId: string,
) {
  reviewCache.delete(cacheKey(projectSlug, changeRequestId));
}

export function getProjectChangeReview(
  projectSlug: string,
  changeRequestId: string,
  { force = false }: { force?: boolean } = {},
) {
  const key = cacheKey(projectSlug, changeRequestId);
  if (force) reviewCache.delete(key);
  const existing = reviewCache.get(key);
  if (existing) return existing;

  const promise = fetch(`${itemUrl(projectSlug, changeRequestId)}/review`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
    .then(parseResponse)
    .then((payload) => {
      if (!payload.review) {
        throw new ProjectChangeRequestApiError(
          "A API não retornou o workspace de Review.",
          { code: "CHANGE_REQUEST_REVIEW_PAYLOAD_MISSING" },
        );
      }
      return payload.review;
    })
    .catch((error) => {
      reviewCache.delete(key);
      throw error;
    });

  reviewCache.set(key, promise);
  return promise;
}

export async function changeProjectChangeReviewState(
  projectSlug: string,
  changeRequestId: string,
  input: { action: "start" | "approve" | "reject"; comment?: string },
) {
  const response = await fetch(`${itemUrl(projectSlug, changeRequestId)}/review`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseResponse(response);
  if (!payload.review) {
    throw new ProjectChangeRequestApiError(
      "A API não retornou o workspace atualizado.",
      { code: "CHANGE_REQUEST_REVIEW_PAYLOAD_MISSING" },
    );
  }
  reviewCache.set(cacheKey(projectSlug, changeRequestId), Promise.resolve(payload.review));
  return payload.review;
}

export async function applyProjectChangeReview(
  projectSlug: string,
  changeRequestId: string,
) {
  const response = await fetch(`${itemUrl(projectSlug, changeRequestId)}/apply`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  const payload = await parseResponse(response);
  if (!payload.review || !Number.isInteger(Number(payload.appliedRevision))) {
    throw new ProjectChangeRequestApiError(
      "A API não confirmou a revisão aplicada.",
      { code: "CHANGE_REQUEST_APPLY_PAYLOAD_MISSING" },
    );
  }
  reviewCache.set(cacheKey(projectSlug, changeRequestId), Promise.resolve(payload.review));
  return {
    review: payload.review,
    appliedRevision: Number(payload.appliedRevision),
    idempotent: Boolean(payload.idempotent),
    projectIdentity: payload.projectIdentity || null,
  };
}
