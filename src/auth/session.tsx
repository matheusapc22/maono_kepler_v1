import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type MaonoUser = {
  id: number;
  email: string;
  name?: string;
  role: "admin" | "client" | "viewer" | "editor" | string;
};

type MaonoProject = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  accessLevel: "owner" | "editor" | "viewer" | string;
};

type SessionState = {
  authenticated: boolean;
  loading: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

function publishSessionToWindow(session: {
  authenticated: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
}) {
  window.__MAONO_SESSION__ = session;
}

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return { error: { message: await response.text() } };
}

export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MaonoUser | null>(null);
  const [projects, setProjects] = useState<MaonoProject[]>([]);

  const applySession = useCallback((data: any) => {
    const nextAuthenticated = Boolean(data?.authenticated);
    const nextUser = data?.user || null;
    const nextProjects = Array.isArray(data?.projects) ? data.projects : [];

    setAuthenticated(nextAuthenticated);
    setUser(nextUser);
    setProjects(nextProjects);
    publishSessionToWindow({
      authenticated: nextAuthenticated,
      user: nextUser,
      projects: nextProjects,
    });
  }, []);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/session", {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });
      const data = await readJsonResponse(response);
      applySession(data);
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error?.message || "Não foi possível fazer login.");
      }

      await refreshSession();
    },
    [refreshSession]
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });
    applySession({ authenticated: false, user: null, projects: [] });
  }, [applySession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      authenticated,
      loading,
      user,
      projects,
      refreshSession,
      login,
      logout,
    }),
    [authenticated, loading, user, projects, refreshSession, login, logout]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession precisa estar dentro de SessionProvider.");
  }
  return context;
}

export type { MaonoProject, MaonoUser };
