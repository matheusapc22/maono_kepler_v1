import {
  useSession as useAuthSession,
  type MaonoOrganization,
  type MaonoProject,
  type MaonoUser,
} from "../auth/session";

export type UseSessionState = {
  loading: boolean;
  authenticated: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];

  /**
   * Mantido por compatibilidade com telas antigas.
   * A sessão central atual não guarda erro no estado público.
   */
  error: string | null;

  /**
   * Alias temporário para refreshSession.
   * Preferir refreshSession em novos componentes.
   */
  refresh: () => Promise<void>;
  refreshSession: () => Promise<void>;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

/**
 * Hook de compatibilidade.
 *
 * A fonte real da sessão é src/auth/session.tsx.
 * Este arquivo existe para evitar quebrar imports antigos de:
 *
 * import { useSession } from "../hooks/useSession";
 *
 * Não adicionar nova chamada direta para /api/session aqui.
 */
export function useSession(): UseSessionState {
  const session = useAuthSession();

  return {
    loading: session.loading,
    authenticated: session.authenticated,
    user: session.user,
    projects: session.projects,
    activeOrganization: session.activeOrganization,
    organizations: session.organizations,
    error: null,
    refresh: session.refreshSession,
    refreshSession: session.refreshSession,
    login: session.login,
    logout: session.logout,
  };
}

export type { MaonoOrganization, MaonoProject, MaonoUser };