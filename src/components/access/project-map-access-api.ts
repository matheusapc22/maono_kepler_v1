import {
  buildClientApiError,
  requestJson,
} from "../../lib/api-transport";

export type ProjectMapRouteMode = "viewer" | "editor";

export type ProjectMapRouteAccess = {
  projectId: number | string;
  projectName: string;
  projectSlug: string;
  mode: ProjectMapRouteMode;
};

export type ProjectMapAccessPolicy = {
  target: {
    id: number | string;
    name?: string | null;
    email?: string | null;
    role?: string | null;
    organizationAccessLevel?: string | null;
  };
  projectRoutes: ProjectMapRouteAccess[];
  create: {
    allowed: boolean;
    explicitlyDenied: boolean;
  };
};

type ProjectMapAccessResponse = ProjectMapAccessPolicy & {
  ok?: boolean;
};

async function requestPolicy(
  organizationId: number | string,
  userId: number | string,
  init?: RequestInit,
): Promise<ProjectMapAccessPolicy> {
  const payload = await requestJson<ProjectMapAccessResponse>(
    `/api/organizations/${encodeURIComponent(String(organizationId))}/users/${encodeURIComponent(String(userId))}/map-access`,
    {
      cache: "no-store",
      ...init,
    },
  );

  if (
    payload?.ok === false ||
    !payload?.target ||
    !Array.isArray(payload.projectRoutes) ||
    !payload?.create
  ) {
    throw buildClientApiError({
      status: 502,
      code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
      category: "INFRASTRUCTURE",
      retryable: true,
    });
  }

  return payload;
}

export function loadProjectMapAccessPolicy(
  organizationId: number | string,
  userId: number | string,
) {
  return requestPolicy(organizationId, userId);
}

export function updateProjectMapRoute(
  organizationId: number | string,
  userId: number | string,
  projectId: number | string,
  mode: ProjectMapRouteMode,
) {
  return requestPolicy(organizationId, userId, {
    method: "PATCH",
    body: JSON.stringify({ projectId, mode }),
  });
}

export function updateProjectCreateAccess(
  organizationId: number | string,
  userId: number | string,
  createEnabled: boolean,
) {
  return requestPolicy(organizationId, userId, {
    method: "PATCH",
    body: JSON.stringify({ createEnabled }),
  });
}
