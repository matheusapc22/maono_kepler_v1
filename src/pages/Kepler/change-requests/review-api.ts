import { ProjectChangeRequestApiError } from "./change-request-api";

export type ReviewOperationProjection = {
  id: string;
  sequence: number;
  type:
    | "point.create"
    | "layer.style.update"
    | "layer.visibility.update"
    | "persistent.filter.update"
    | "layer.order.update"
    | "buffer.create"
    | "isochrone.create";
  version: number;
  label: string;
  focus: {
    latitude: number;
    longitude: number;
  } | null;
  target: {
    layerId: string | null;
    dataId: string | null;
    label: string;
  };
  overlay:
    | {
        kind: "point";
        latitude: number;
        longitude: number;
      }
    | {
        kind: "geojson";
        geojson: Record<string, unknown>;
      }
    | null;
  properties: Record<string, unknown>;
};

export type ReviewSourceOperation = {
  id: string;
  sequence: number;
  type: ReviewOperationProjection["type"];
  version: number;
  payload: unknown;
  createdAt?: string;
};

export type ProjectChangeReview = {
  contractVersion: 2;
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
    sizeBytes: number;
    schemaName?: string;
    schemaVersion?: number;
    delivery: {
      transport: "direct";
      downloadUrl: string;
      projectId: number;
      revision: number;
      sizeBytes: number;
      schemaName: string;
      schemaVersion: number;
      correlationId: string | null;
    };
  };
  operations: ReviewSourceOperation[];
  proposal?: {
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

function assertSupportedContract(review: ProjectChangeReview) {
  if (review.contractVersion !== 2) {
    throw new ProjectChangeRequestApiError(
      "O backend retornou uma versão de Review incompatível com este frontend.",
      {
        code: "CHANGE_REQUEST_REVIEW_CONTRACT_UNSUPPORTED",
        status: 409,
        details: { contractVersion: review.contractVersion },
      },
    );
  }
  if (
    review.base.delivery.transport !== "direct" ||
    Number(review.base.delivery.revision) !== Number(review.base.revision)
  ) {
    throw new ProjectChangeRequestApiError(
      "O descriptor da revisão-base é incompatível com o Review.",
      {
        code: "CHANGE_REQUEST_BASE_DESCRIPTOR_INVALID",
        status: 409,
      },
    );
  }
  return review;
}

function sameOperationSet(left: ProjectChangeReview, right: ProjectChangeReview) {
  return (
    Number(left.base.revision) === Number(right.base.revision) &&
    left.operations.length === right.operations.length &&
    left.operations.every(
      (operation, index) => operation.id === right.operations[index]?.id,
    )
  );
}

function carryClientProjection(
  previous: ProjectChangeReview | null,
  next: ProjectChangeReview,
) {
  if (
    previous?.proposal?.operations?.length &&
    sameOperationSet(previous, next)
  ) {
    next.proposal = previous.proposal;
  }
  return next;
}

async function cachedReview(key: string) {
  const current = reviewCache.get(key);
  if (!current) return null;
  try {
    return await current;
  } catch {
    return null;
  }
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
      return assertSupportedContract(payload.review);
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
  const key = cacheKey(projectSlug, changeRequestId);
  const previous = await cachedReview(key);
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
  const review = carryClientProjection(
    previous,
    assertSupportedContract(payload.review),
  );
  reviewCache.set(key, Promise.resolve(review));
  return review;
}

export async function applyProjectChangeReview(
  projectSlug: string,
  changeRequestId: string,
) {
  const key = cacheKey(projectSlug, changeRequestId);
  const previous = await cachedReview(key);
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
  const review = carryClientProjection(
    previous,
    assertSupportedContract(payload.review),
  );
  reviewCache.set(key, Promise.resolve(review));
  return {
    review,
    appliedRevision: Number(payload.appliedRevision),
    idempotent: Boolean(payload.idempotent),
    projectIdentity: payload.projectIdentity || null,
  };
}
