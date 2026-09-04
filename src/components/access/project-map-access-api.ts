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

async function requestPolicy(
  organizationId: number | string,
  userId: number | string,
  init?: RequestInit,
): Promise<ProjectMapAccessPolicy> {
  const response = await fetch(
    `/api/organizations/${encodeURIComponent(String(organizationId))}/users/${encodeURIComponent(String(userId))}/map-access`,
    {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || "Não foi possível atualizar o acesso ao mapa.",
    );
    (error as Error & { code?: string }).code = payload?.code;
    throw error;
  }
  return payload as ProjectMapAccessPolicy;
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
