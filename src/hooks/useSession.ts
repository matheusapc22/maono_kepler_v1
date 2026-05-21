import { useCallback, useEffect, useState } from "react";
import { getSession, MaonoProject, MaonoUser } from "../lib/api";

export type UseSessionState = {
  loading: boolean;
  authenticated: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
  error: string | null;
  refresh: () => Promise<void>;
};

export function useSession(): UseSessionState {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<MaonoUser | null>(null);
  const [projects, setProjects] = useState<MaonoProject[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const session = await getSession();
      setAuthenticated(Boolean(session.authenticated));
      setUser(session.user || null);
      setProjects(session.projects || []);
    } catch (err) {
      setAuthenticated(false);
      setUser(null);
      setProjects([]);
      setError(err instanceof Error ? err.message : "Erro ao carregar sessão.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    loading,
    authenticated,
    user,
    projects,
    error,
    refresh,
  };
}
