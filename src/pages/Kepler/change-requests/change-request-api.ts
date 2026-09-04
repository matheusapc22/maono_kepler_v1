import type { ViewerChangeOperation } from "./viewer-working-copy";

export type ProjectChangeRequest = {
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
  operations?: Array<ViewerChangeOperation & { sequence?: number }>;
};

export type SubmitProjectChangeRequestInput = {
  baseRevision: number;
  reason: string;
  operations: ViewerChangeOperation[];
  idempotencyKey: string;
};

export class ProjectChangeRequestApiError extends Error {
  code: string;
  status: number;
  requestId: string | null;
  details: unknown;

  constructor(
    message: string,
    {
      code = "PROJECT_CHANGE_REQUEST_FAILED",
      status = 0,
      requestId = null,
      details = null,
    }: {
      code?: string;
      status?: number;
      requestId?: string | null;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ProjectChangeRequestApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.ok) {
    const error = payload?.error || {};
    throw new ProjectChangeRequestApiError(
      error.message || "Não foi possível processar a solicitação de alteração.",
      {
        code: error.code,
        status: response.status,
        requestId: error.requestId || response.headers.get("X-Request-Id"),
        details: error.details,
      },
    );
  }
  return payload as T;
}

function collectionUrl(projectSlug: string) {
  return `/api/projects/${encodeURIComponent(projectSlug)}/change-requests`;
}

export async function submitProjectChangeRequest(
  projectSlug: string,
  input: SubmitProjectChangeRequestInput,
  signal?: AbortSignal,
) {
  const response = await fetch(collectionUrl(projectSlug), {
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
  });
  return parseResponse<{
    ok: true;
    replayed: boolean;
    changeRequest: ProjectChangeRequest;
  }>(response);
}

export async function listMyProjectChangeRequests(
  projectSlug: string,
  { limit = 50, signal }: { limit?: number; signal?: AbortSignal } = {},
) {
  const response = await fetch(
    `${collectionUrl(projectSlug)}?limit=${Math.min(Math.max(limit, 1), 100)}`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
    },
  );
  const payload = await parseResponse<{
    ok: true;
    items: ProjectChangeRequest[];
  }>(response);
  return payload.items;
}

export async function getProjectChangeRequest(
  projectSlug: string,
  changeRequestId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${collectionUrl(projectSlug)}/${encodeURIComponent(changeRequestId)}`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
    },
  );
  const payload = await parseResponse<{
    ok: true;
    changeRequest: ProjectChangeRequest;
  }>(response);
  return payload.changeRequest;
}
