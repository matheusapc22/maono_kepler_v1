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

export type DownloadResponse = {
  blob: Blob;
  fileName: string | null;
  contentType: string | null;
};

type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
};

type JsonValue = unknown;

class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function pathSegment(value: number | string): string {
  return encodeURIComponent(String(value));
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

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = parseJsonSafely(text);

  if (!response.ok) {
    throw new ApiError(getErrorMessage(data, response.status), response.status, data);
  }

  return data as T;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
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
    headers: {
      ...(init.headers || {}),
    },
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

    throw new ApiError(getErrorMessage(data, response.status), response.status, data);
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
    `/api/organizations/${pathSegment(organizationId)}/files`,
  );
}

export function uploadOrganizationFile(
  organizationId: number | string,
  formData: FormData,
) {
  return requestFormDataJson<{ ok: boolean; file: OrganizationFile }>(
    `/api/organizations/${pathSegment(organizationId)}/files`,
    formData,
  );
}

export function downloadOrganizationFile(
  organizationId: number | string,
  fileId: number | string,
) {
  return requestDownload(
    `/api/organizations/${pathSegment(organizationId)}/files/${pathSegment(
      fileId,
    )}/download`,
  );
}

export function deleteOrganizationFile(
  organizationId: number | string,
  fileId: number | string,
) {
  return requestJson<{ ok: boolean; deleted: boolean }>(
    `/api/organizations/${pathSegment(organizationId)}/files/${pathSegment(fileId)}`,
    {
      method: "DELETE",
    },
  );
}

export function listOrganizationTickets(organizationId: number | string) {
  return requestJson<{ ok: boolean; tickets: OrganizationTicket[] }>(
    `/api/organizations/${pathSegment(organizationId)}/tickets`,
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
    `/api/organizations/${pathSegment(organizationId)}/tickets`,
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
    `/api/organizations/${pathSegment(organizationId)}/tickets/${pathSegment(
      ticketId,
    )}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function listOrganizationExports(organizationId: number | string) {
  return requestJson<{ ok: boolean; exports: OrganizationExport[] }>(
    `/api/organizations/${pathSegment(organizationId)}/exports`,
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
    `/api/organizations/${pathSegment(organizationId)}/exports`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}