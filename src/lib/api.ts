export type MaonoUser = {
  id: number;
  email: string;
  name?: string;
  role: "super_admin" | "admin" | "owner" | "editor" | "viewer" | "client" | string;
  organizationId?: number | string | null;
  organization_id?: number | string | null;
  activeOrganizationId?: number | string | null;
  permissions?: string[];
  scopes?: string[];
};

export type MaonoProject = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  accessLevel: "owner" | "editor" | "viewer" | string;
  organizationId?: number | string | null;
  organization_id?: number | string | null;
};

export type SessionResponse = {
  authenticated: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
};

export type OrganizationFile = {
  id: number;
  name: string;
  mimeType?: string;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: {
    id: number;
    name?: string;
    email?: string;
  };
};

export type OrganizationTicket = {
  id: number;
  subject: string;
  description?: string;
  status: string;
  priority?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: {
    id: number;
    name?: string;
    email?: string;
  };
};

export type OrganizationExport = {
  id: number;
  type: string;
  format: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

export type OrganizationUser = {
  id: number | string;
  organizationId: number | string;
  name?: string;
  email?: string;
  role?: "super_admin" | "admin" | "owner" | "editor" | "viewer" | "client" | string;
  accessLevel?: "owner" | "editor" | "viewer" | string;
  active?: boolean;
  permissions?: string[];
  createdAt?: string;
  updatedAt?: string;
  membershipCreatedAt?: string;
};

export type CreateOrganizationUserPayload = {
  name: string;
  email: string;
  role?: "owner" | "editor" | "viewer" | "admin" | "super_admin" | string;
  accessLevel?: "owner" | "editor" | "viewer" | string;
  active?: boolean;
};

export type UpdateOrganizationUserPayload = {
  name?: string;
  fullName?: string;
  active?: boolean;
  role?: "owner" | "editor" | "viewer" | "admin" | "super_admin" | string;
  accessLevel?: "owner" | "editor" | "viewer" | string;
  access_level?: "owner" | "editor" | "viewer" | string;
};

export type OrganizationUserPermissionGrant = {
  id?: number | string;
  organizationId?: number | string;
  userId?: number | string;
  permission?: string;
  createdAt?: string;
};

export type OrganizationUserPermissionRevoke = {
  organizationId?: number | string;
  userId?: number | string;
  permission?: string;
  revoked?: boolean;
};

export type OrganizationMetrics = {
  users: number;
  projects: number;
  files: number;
  tickets: number;
  exports: number;
};

export type OrganizationDetails = {
  id: number | string;
  name?: string;
  slug?: string;
  active?: boolean;
  plan?: string;
  createdAt?: string;
  updatedAt?: string;
  metrics?: OrganizationMetrics;
};

export type OrganizationLimitCounter = {
  used: number;
  limit: number;
};

export type OrganizationLimits = {
  plan: string;
  users: OrganizationLimitCounter;
  projects: OrganizationLimitCounter;
  storageMb: OrganizationLimitCounter;
  exports: OrganizationLimitCounter;
};

export type OrganizationLimitRequest = {
  id: number | string;
  organizationId?: number | string;
  requestType?: string;
  requestedPlan?: string | null;
  requestedLimits?: Record<string, unknown> | null;
  reason?: string | null;
  requestedBy?: number | string | null;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateOrganizationLimitRequestPayload = {
  requestType: string;
  requestedPlan?: string | null;
  requestedLimits?: Record<string, unknown> | null;
  reason?: string;
};

export type DownloadResponse = {
  blob: Blob;
  fileName: string | null;
  contentType: string | null;
};

type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
};

type JsonValue = unknown;

class ApiError extends Error {
  status: number;
  code?: string;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function pathSegment(value: number | string): string {
  return encodeURIComponent(String(value));
}

function organizationPath(organizationId: number | string): string {
  return `/api/organizations/${pathSegment(organizationId)}`;
}

function organizationUserPath(
  organizationId: number | string,
  userId: number | string,
): string {
  return `${organizationPath(organizationId)}/users/${pathSegment(userId)}`;
}

function parseJsonSafely(text: string): JsonValue {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const data = payload as ApiErrorPayload;

    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }

    if (
      data.error &&
      typeof data.error === "object" &&
      "message" in data.error &&
      typeof (data.error as { message?: unknown }).message === "string"
    ) {
      return (data.error as { message: string }).message;
    }

    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  }

  return `Erro HTTP ${status}`;
}

function getErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const data = payload as ApiErrorPayload;

  if (typeof data.code === "string" && data.code.trim()) {
    return data.code;
  }

  if (
    data.error &&
    typeof data.error === "object" &&
    "code" in data.error &&
    typeof (data.error as { code?: unknown }).code === "string"
  ) {
    return (data.error as { code: string }).code;
  }

  return undefined;
}

function buildHeaders(
  initHeaders: HeadersInit | undefined,
  options: {
    json?: boolean;
  } = {},
): Headers {
  const headers = new Headers(initHeaders);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (options.json && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = parseJsonSafely(text);

  if (!response.ok) {
    throw new ApiError(
      getErrorMessage(data, response.status),
      response.status,
      data,
      getErrorCode(data),
    );
  }

  return data as T;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init.headers, {
      json: true,
    }),
  });

  return parseJsonResponse<T>(response);
}

async function requestFormDataJson<T>(
  url: string,
  formData: FormData,
  init: Omit<RequestInit, "body" | "method"> = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    method: "POST",
    credentials: "include",
    body: formData,
    headers: buildHeaders(init.headers),
  });

  return parseJsonResponse<T>(response);
}

async function requestDownload(
  url: string,
  init: RequestInit = {},
): Promise<DownloadResponse> {
  const response = await fetch(url, {
    ...init,
    method: init.method || "GET",
    credentials: "include",
  });

  if (!response.ok) {
    const text = await response.text();
    const data = parseJsonSafely(text);

    throw new ApiError(
      getErrorMessage(data, response.status),
      response.status,
      data,
      getErrorCode(data),
    );
  }

  const blob = await response.blob();

  return {
    blob,
    fileName: getFileNameFromContentDisposition(
      response.headers.get("Content-Disposition"),
    ),
    contentType: response.headers.get("Content-Type"),
  };
}

function getFileNameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  }

  const simpleMatch = header.match(/filename="?([^"]+)"?/i);
  if (simpleMatch?.[1]) {
    return simpleMatch[1];
  }

  return null;
}

export function getSession() {
  return requestJson<SessionResponse>("/api/session");
}

export function login(email: string, password: string) {
  return requestJson<SessionResponse & { ok: boolean }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return requestJson<{ ok: boolean; authenticated: false }>("/api/auth/logout", {
    method: "POST",
  });
}

export function listProjects() {
  return requestJson<{ ok: boolean; projects: MaonoProject[] }>("/api/projects");
}

export function getProjectConfig(projectSlug: string) {
  return requestJson<{ ok: boolean; project: MaonoProject; config: unknown }>(
    `/api/projects/${pathSegment(projectSlug)}/config`,
  );
}

/**
 * Mantido por compatibilidade com chamadas existentes.
 * O endpoint central atual para config é /api/projects/:slug/config,
 * mas esta função só deve ser trocada para PUT quando os consumidores forem revisados.
 */
export function saveProjectConfig(projectSlug: string, config: unknown) {
  return requestJson<{ ok: boolean; saved: boolean }>(
    `/api/projects/${pathSegment(projectSlug)}/save`,
    {
      method: "POST",
      body: JSON.stringify({ config }),
    },
  );
}

export function listOrganizationFiles(organizationId: number | string) {
  return requestJson<{ ok: boolean; files: OrganizationFile[] }>(
    `${organizationPath(organizationId)}/files`,
  );
}

export function uploadOrganizationFile(
  organizationId: number | string,
  formData: FormData,
) {
  return requestFormDataJson<{ ok: boolean; file: OrganizationFile }>(
    `${organizationPath(organizationId)}/files`,
    formData,
  );
}

export function downloadOrganizationFile(
  organizationId: number | string,
  fileId: number | string,
) {
  return requestDownload(
    `${organizationPath(organizationId)}/files/${pathSegment(fileId)}/download`,
  );
}

export function deleteOrganizationFile(
  organizationId: number | string,
  fileId: number | string,
) {
  return requestJson<{ ok: boolean; deleted: boolean }>(
    `${organizationPath(organizationId)}/files/${pathSegment(fileId)}`,
    {
      method: "DELETE",
    },
  );
}

export function listOrganizationTickets(organizationId: number | string) {
  return requestJson<{ ok: boolean; tickets: OrganizationTicket[] }>(
    `${organizationPath(organizationId)}/tickets`,
  );
}

export function createOrganizationTicket(
  organizationId: number | string,
  payload: {
    subject: string;
    description: string;
    priority?: "low" | "normal" | "high" | string;
  },
) {
  return requestJson<{ ok: boolean; ticket: OrganizationTicket }>(
    `${organizationPath(organizationId)}/tickets`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateOrganizationTicket(
  organizationId: number | string,
  ticketId: number | string,
  payload: {
    status?: string;
    priority?: "low" | "normal" | "high" | string;
  },
) {
  return requestJson<{ ok: boolean; ticket: OrganizationTicket }>(
    `${organizationPath(organizationId)}/tickets/${pathSegment(ticketId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function listOrganizationExports(organizationId: number | string) {
  return requestJson<{ ok: boolean; exports: OrganizationExport[] }>(
    `${organizationPath(organizationId)}/exports`,
  );
}

export function createOrganizationExport(
  organizationId: number | string,
  payload: {
    type: string;
    format: string;
  },
) {
  return requestJson<{ ok: boolean; export: OrganizationExport }>(
    `${organizationPath(organizationId)}/exports`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function listOrganizationUsers(organizationId: number | string) {
  return requestJson<{ ok: boolean; users: OrganizationUser[] }>(
    `${organizationPath(organizationId)}/users`,
  );
}

export function createOrganizationUser(
  organizationId: number | string,
  payload: CreateOrganizationUserPayload,
) {
  return requestJson<{ ok: boolean; user: OrganizationUser }>(
    `${organizationPath(organizationId)}/users`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateOrganizationUser(
  organizationId: number | string,
  userId: number | string,
  payload: UpdateOrganizationUserPayload,
) {
  return requestJson<{ ok: boolean; user: OrganizationUser }>(
    organizationUserPath(organizationId, userId),
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function grantOrganizationUserPermission(
  organizationId: number | string,
  userId: number | string,
  permission: string,
  options?: { warningAcknowledged?: boolean; justification?: string },
) {
  return requestJson<{ ok: boolean; grant: OrganizationUserPermissionGrant }>(
    `${organizationUserPath(organizationId, userId)}/permissions`,
    {
      method: "POST",
      body: JSON.stringify({ permission, ...options }),
    },
  );
}

export function revokeOrganizationUserPermission(
  organizationId: number | string,
  userId: number | string,
  permission: string,
) {
  return requestJson<{ ok: boolean; revoke: OrganizationUserPermissionRevoke }>(
    `${organizationUserPath(organizationId, userId)}/permissions/${pathSegment(
      permission,
    )}`,
    {
      method: "DELETE",
    },
  );
}

export function getOrganization(organizationId: number | string) {
  return requestJson<{ ok: boolean; organization: OrganizationDetails }>(
    organizationPath(organizationId),
  );
}

export function getOrganizationLimits(organizationId: number | string) {
  return requestJson<{
    ok: boolean;
    limits: OrganizationLimits;
    pendingRequests: OrganizationLimitRequest[];
  }>(`${organizationPath(organizationId)}/limits`);
}

export function createOrganizationLimitRequest(
  organizationId: number | string,
  payload: CreateOrganizationLimitRequestPayload,
) {
  return requestJson<{
    ok: boolean;
    request: {
      id: number | string;
      status: string;
    };
  }>(`${organizationPath(organizationId)}/limits/requests`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export { ApiError };
