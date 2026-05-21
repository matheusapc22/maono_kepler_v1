export type MaonoUser = {
  id: number;
  email: string;
  name?: string;
  role: "admin" | "editor" | "viewer" | "client" | string;
};

export type MaonoProject = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  accessLevel: "owner" | "editor" | "viewer" | string;
};

export type SessionResponse = {
  authenticated: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
};

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.error?.message || `Erro HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as T;
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
    `/api/projects/${encodeURIComponent(projectSlug)}/config`
  );
}

export function saveProjectConfig(projectSlug: string, config: unknown) {
  return requestJson<{ ok: boolean; saved: boolean }>(
    `/api/projects/${encodeURIComponent(projectSlug)}/save`,
    {
      method: "POST",
      body: JSON.stringify({ config }),
    }
  );
}
