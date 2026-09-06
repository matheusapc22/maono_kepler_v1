import type { RequestLifecycle } from "./change-request-api";
import type { ViewerChangeOperation } from "./viewer-working-copy";

export type ViewerTrackedChangeRequest = RequestLifecycle & {
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
  resubmittedFromRequestId: string | null;
  resubmittedToRequestId: string | null;
  operations?: Array<ViewerChangeOperation & { sequence?: number }>;
};

export type ResubmitViewerChangeRequestInput = {
  baseRevision: number;
  reason: string;
  operations: ViewerChangeOperation[];
  idempotencyKey: string;
};

export class ViewerRequestTrackingApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(
    message: string,
    { code = "VIEWER_REQUEST_TRACKING_FAILED", status = 0, details = null }:
      { code?: string; status?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ViewerRequestTrackingApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function collectionUrl(projectSlug: string) {
  return `/api/projects/${encodeURIComponent(projectSlug)}/change-requests`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.ok) {
    const error = payload?.error || {};
    throw new ViewerRequestTrackingApiError(
      error.message || "Não foi possível consultar as solicitações.",
      { code: error.code, status: response.status, details: error.details },
    );
  }
  return payload as T;
}

export async function listViewerTrackedChangeRequests(
  projectSlug: string,
  { limit = 50, signal }: { limit?: number; signal?: AbortSignal } = {},
) {
  const response = await fetch(
    `${collectionUrl(projectSlug)}/tracking?limit=${Math.min(Math.max(limit, 1), 100)}`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
    },
  );
  const payload = await parseResponse<{
    ok: true;
    items: ViewerTrackedChangeRequest[];
  }>(response);
  return payload.items;
}

export async function resubmitViewerChangeRequest(
  projectSlug: string,
  sourceRequestId: string,
  input: ResubmitViewerChangeRequestInput,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${collectionUrl(projectSlug)}/${encodeURIComponent(sourceRequestId)}/resubmit`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        baseRevision: input.baseRevision,
        reason: input.reason,
        operations: input.operations,
      }),
    },
  );
  return parseResponse<{
    ok: true;
    replayed: boolean;
    changeRequest: ViewerTrackedChangeRequest;
  }>(response);
}
