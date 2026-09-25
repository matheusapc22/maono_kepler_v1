import {
  ApiError,
  getApiErrorContract,
  type ApiErrorDiagnostic,
} from "./error-contract";
import { normalizeUserError } from "./user-error-catalog";

export { ApiError, isApiError } from "./error-contract";
export type {
  ApiErrorContract,
  ApiErrorDiagnostic,
  ErrorCategory,
} from "./error-contract";

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
  projectId?: number | string | null;
  projectName?: string | null;
  folderId?: number | string | null;
  trashedFromFolderId?: number | string | null;
  trashedFromFolderName?: string | null;
  deletedAt?: string | null;
  deletedBy?: {
    id: number | string;
    name?: string | null;
    email?: string | null;
  } | null;
  purgeAfter?: string | null;
  purgedAt?: string | null;
  name: string;
  fileType?: string;
  mimeType?: string;
  size?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: { id: number; name?: string; email?: string } | number | string | null;
};

export type OrganizationFileSort =
  | "updated_desc"
  | "updated_asc"
  | "name_asc"
  | "name_desc"
  | "size_asc"
  | "size_desc";

export type OrganizationFileListQuery = {
  search?: string;
  type?: string;
  projectId?: number | string;
  folderId?: number | string;
  state?: "active" | "trash";
  updatedFrom?: string;
  updatedTo?: string;
  sort?: OrganizationFileSort;
  cursor?: string;
  limit?: number;
};

export type OrganizationFileListFacets = {
  types: string[];
  projects: Array<{ id: number | string; name: string }>;
  rootCount: number;
  folderCounts: Array<{ folderId: number | string; count: number }>;
};

export type OrganizationFileListPagination = {
  limit: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  sort: OrganizationFileSort;
};

export type OrganizationFileListResponse = {
  ok: boolean;
  files: OrganizationFile[];
  facets: OrganizationFileListFacets;
  pagination: OrganizationFileListPagination;
  storage?: unknown;
};

export type OrganizationDocumentFolder = {
  id: number | string;
  organizationId: number | string;
  parentId?: number | string | null;
  name: string;
  createdBy?: number | string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type OrganizationTicket = {
  id: number;
  subject: string;
  description?: string;
  status: string;
  priority?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: { id: number; name?: string; email?: string };
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
  deniedPermissions?: string[];
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
  password?: string;
};

export type OrganizationUserPermissionGrant = {
  id?: number | string;
  organizationId?: number | string;
  userId?: number | string;
  permission?: string;
  native?: boolean;
  denied?: boolean;
  createdAt?: string;
};

export type OrganizationUserPermissionRevoke = {
  organizationId?: number | string;
  userId?: number | string;
  permission?: string;
  revoked?: boolean;
  native?: boolean;
  denied?: boolean;
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

export type OrganizationLimitCounter = { used: number; limit: number };

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

type ParsedJsonBody = {
  valid: boolean;
  data: unknown;
};

function pathSegment(value: number | string): string {
  return encodeURIComponent(String(value));
}

function organizationPath(organizationId: number | string): string {
  return `/api/organizations/${pathSegment(organizationId)}`;
}

function organizationUserPath(organizationId: number | string, userId: number | string): string {
  return `${organizationPath(organizationId)}/users/${pathSegment(userId)}`;
}

function buildHeaders(
  initHeaders: HeadersInit | undefined,
  options: { json?: boolean } = {},
): Headers {
  const headers = new Headers(initHeaders);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.json && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function parseResponseJson(response: Response): Promise<ParsedJsonBody> {
  if (response.status === 204 || response.status === 205) {
    return { valid: true, data: null };
  }

  try {
    return { valid: true, data: await response.json() };
  } catch {
    return { valid: false, data: null };
  }
}

function inferCategoryFromStatus(status: number): ApiErrorDiagnostic["category"] {
  if (status === 401) return "AUTH";
  if (status === 403) return "PERMISSION";
  if (status === 404 || status === 409) return "PROJECT";
  return status >= 500 ? "INFRASTRUCTURE" : undefined;
}

function inferRetryableFromStatus(status: number) {
  return [408, 425, 429, 502, 503, 504].includes(status);
}

function buildApiError(
  response: Response,
  data: unknown,
  overrides: Partial<ApiErrorDiagnostic> = {},
): ApiError {
  const contract = getApiErrorContract(data);
  const status = Number(overrides.status ?? response.status ?? 500);
  const diagnostic: ApiErrorDiagnostic = {
    status,
    code: overrides.code ?? contract.code,
    category:
      overrides.category ??
      contract.category ??
      inferCategoryFromStatus(status),
    retryable:
      overrides.retryable ??
      contract.retryable ??
      inferRetryableFromStatus(status),
    correlationId:
      overrides.correlationId ??
      contract.correlationId ??
      response.headers.get("X-Correlation-Id") ??
      undefined,
    details: overrides.details ?? contract.details,
  };
  const presentation = normalizeUserError(diagnostic);
  return new ApiError(diagnostic, data, presentation.message);
}

function buildClientApiError(
  diagnostic: ApiErrorDiagnostic,
): ApiError {
  const presentation = normalizeUserError(diagnostic);
  return new ApiError(diagnostic, null, presentation.message);
}

async function fetchWithNetworkGuard(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw buildClientApiError({
      status: 503,
      code: "INFRASTRUCTURE_NETWORK_FAILURE",
      category: "INFRASTRUCTURE",
      retryable: true,
    });
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const parsed = await parseResponseJson(response);

  if (!response.ok) {
    throw buildApiError(response, parsed.valid ? parsed.data : null);
  }

  if (!parsed.valid) {
    throw buildApiError(response, null, {
      status: 502,
      code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
      category: "INFRASTRUCTURE",
      retryable: true,
    });
  }

  return parsed.data as T;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithNetworkGuard(url, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init.headers, { json: true }),
  });
  return parseJsonResponse<T>(response);
}

async function requestFormDataJson<T>(
  url: string,
  formData: FormData,
  init: Omit<RequestInit, "body" | "method"> = {},
): Promise<T> {
  const response = await fetchWithNetworkGuard(url, {
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
  const response = await fetchWithNetworkGuard(url, {
    ...init,
    method: init.method || "GET",
    credentials: "include",
  });

  if (!response.ok) {
    const parsed = await parseResponseJson(response);
    throw buildApiError(response, parsed.valid ? parsed.data : null);
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
  if (!header) return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  }
  const simpleMatch = header.match(/filename="?([^"]+)"?/i);
  return simpleMatch?.[1] || null;
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

/** Mantido por compatibilidade com chamadas existentes. */
export function saveProjectConfig(projectSlug: string, config: unknown) {
  return requestJson<{ ok: boolean; saved: boolean }>(
    `/api/projects/${pathSegment(projectSlug)}/save`,
    {
      method: "POST",
      body: JSON.stringify({ config }),
    },
  );
}

export function listOrganizationFiles(
  organizationId: number | string,
  query: OrganizationFileListQuery = {},
) {
  const params = new URLSearchParams();

  if (query.search) params.set("search", query.search);
  if (query.type) params.set("type", query.type);
  if (query.projectId) params.set("projectId", String(query.projectId));
  if (query.folderId) params.set("folderId", String(query.folderId));
  if (query.state) params.set("state", query.state);
  if (query.updatedFrom) params.set("updatedFrom", query.updatedFrom);
  if (query.updatedTo) params.set("updatedTo", query.updatedTo);
  if (query.sort) params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));

  const queryString = params.toString();
  return requestJson<OrganizationFileListResponse>(
    `${organizationPath(organizationId)}/files${queryString ? `?${queryString}` : ""}`,
  );
}

export function listOrganizationDocumentFolders(
  organizationId: number | string,
) {
  return requestJson<{ ok: boolean; folders: OrganizationDocumentFolder[] }>(
    `${organizationPath(organizationId)}/document-folders`,
  );
}

export function createOrganizationDocumentFolder(
  organizationId: number | string,
  payload: { name: string; parentId?: number | string | null },
) {
  return requestJson<{ ok: boolean; folder: OrganizationDocumentFolder }>(
    `${organizationPath(organizationId)}/document-folders`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateOrganizationDocumentFolder(
  organizationId: number | string,
  folderId: number | string,
  payload: { name?: string; parentId?: number | string | null },
) {
  return requestJson<{ ok: boolean; folder: OrganizationDocumentFolder }>(
    `${organizationPath(organizationId)}/document-folders/${pathSegment(folderId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteOrganizationDocumentFolder(
  organizationId: number | string,
  folderId: number | string,
) {
  return requestJson<{ ok: boolean; deleted: boolean }>(
    `${organizationPath(organizationId)}/document-folders/${pathSegment(folderId)}`,
    { method: "DELETE" },
  );
}

export function moveOrganizationFileToFolder(
  organizationId: number | string,
  fileId: number | string,
  folderId: number | string | null,
) {
  return requestJson<{ ok: boolean; file: OrganizationFile }>(
    `${organizationPath(organizationId)}/files/${pathSegment(fileId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ folderId }),
    },
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
  return requestJson<{
    ok: boolean;
    deleted: boolean;
    trashed?: boolean;
    file?: OrganizationFile;
  }>(
    `${organizationPath(organizationId)}/files/${pathSegment(fileId)}`,
    { method: "DELETE" },
  );
}

export function restoreOrganizationFile(
  organizationId: number | string,
  fileId: number | string,
) {
  return requestJson<{
    ok: boolean;
    restored: boolean;
    restoredToRoot: boolean;
    originalFolderMissing: boolean;
    file: OrganizationFile;
  }>(
    `${organizationPath(organizationId)}/files/${pathSegment(fileId)}/restore`,
    { method: "POST" },
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
  payload: { type: string; format: string },
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

export function deleteOrganizationUserMembership(
  organizationId: number | string,
  userId: number | string,
) {
  return requestJson<{ ok: boolean; removed: boolean }>(
    organizationUserPath(organizationId, userId),
    { method: "DELETE" },
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
    `${organizationUserPath(organizationId, userId)}/permissions/${pathSegment(permission)}`,
    { method: "DELETE" },
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
    request: { id: number | string; status: string };
  }>(`${organizationPath(organizationId)}/limits/requests`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
