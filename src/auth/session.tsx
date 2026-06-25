import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { normalizeRole } from "../access-control/roles";
import {
  normalizePermissions,
  type Permission,
} from "../access-control/permissions";

type MaonoId = number | string;

type MaonoRole =
  | "super_admin"
  | "admin"
  | "owner"
  | "editor"
  | "viewer"
  | "client"
  | string;

type MaonoFeatureFlag = string;

type MaonoLimits = Record<string, unknown>;

type MaonoOrganization = {
  id: MaonoId;
  organizationId?: MaonoId | null;
  organization_id?: MaonoId | null;
  name?: string;
  slug?: string;
  role?: MaonoRole;
  accessLevel?: string;
  access_level?: string;
  active?: boolean;
  plan?: string;
  permissions?: Permission[];
  scopes?: string[];
  featureFlags?: MaonoFeatureFlag[];
  limits?: MaonoLimits;
};

type MaonoUser = {
  id: MaonoId;
  email: string;
  name?: string;
  role: MaonoRole;

  /**
   * Mantém rastreabilidade temporária para migração de roles legadas.
   * Exemplo: backend antigo pode retornar "client", mas a UI deve operar como "owner".
   */
  rawRole?: string;

  organizationId?: MaonoId | null;
  organization_id?: MaonoId | null;
  activeOrganizationId?: MaonoId | null;
  activeOrganization?: MaonoOrganization | null;
  organization?: MaonoOrganization | null;
  organizations?: MaonoOrganization[];

  permissions?: Permission[];
  scopes?: string[];
  accessLevel?: string | null;
  access_level?: string | null;
  featureFlags?: MaonoFeatureFlag[];
  limits?: MaonoLimits;
};

type MaonoProject = {
  id: MaonoId;
  name: string;
  slug: string;
  description?: string;
  organizationId?: MaonoId | null;
  organization_id?: MaonoId | null;
  accessLevel: "owner" | "editor" | "viewer" | string;
  access_level?: "owner" | "editor" | "viewer" | string;
  permissions?: Permission[];
  active?: boolean;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  createdAt?: string;
  updatedAt?: string;

  /**
   * Não incluir no payload público:
   * - dropboxRootPath
   * - defaultConfigFile
   * - caminhos internos
   * - tokens
   * - metadados administrativos sensíveis
   */
};

type PublicSession = {
  authenticated: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
  activeOrganization?: MaonoOrganization | null;
  organizations?: MaonoOrganization[];
};

declare global {
  interface Window {
    __MAONO_SESSION__?: PublicSession;
  }
}

type SessionState = {
  authenticated: boolean;
  loading: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const EMPTY_SESSION: PublicSession = {
  authenticated: false,
  user: null,
  projects: [],
  activeOrganization: null,
  organizations: [],
};

const SessionContext = createContext<SessionState | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toId(value: unknown): MaonoId | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed || null;
  }

  return null;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed || undefined;
}

function toBooleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toPermissionArray(value: unknown): Permission[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizePermissions(value);
}

function toLimits(value: unknown): MaonoLimits | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return { ...value };
}

function mergePermissions(
  ...values: Array<Permission[] | undefined>
): Permission[] {
  return Array.from(new Set(values.flatMap((value) => value ?? [])));
}

function mergeStringArrays(...values: Array<string[] | undefined>): string[] {
  return Array.from(new Set(values.flatMap((value) => value ?? [])));
}

function normalizeOrganization(value: unknown): MaonoOrganization | null {
  if (!isRecord(value)) {
    return null;
  }

  const id =
    toId(value.id) ??
    toId(value.organizationId) ??
    toId(value.organization_id);

  if (id === null) {
    return null;
  }

  const accessLevel =
    toStringValue(value.accessLevel) ?? toStringValue(value.access_level);

  return {
    id,
    organizationId: toId(value.organizationId) ?? id,
    organization_id: toId(value.organization_id) ?? id,
    name: toStringValue(value.name),
    slug: toStringValue(value.slug),
    role: toStringValue(value.role),
    accessLevel,
    access_level: accessLevel,
    active: toBooleanValue(value.active),
    plan: toStringValue(value.plan),
    permissions: toPermissionArray(value.permissions),
    scopes: toStringArray(value.scopes),
    featureFlags: toStringArray(
      value.featureFlags ?? value.feature_flags ?? value.flags,
    ),
    limits: toLimits(value.limits),
  };
}

function normalizeOrganizations(value: unknown): MaonoOrganization[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeOrganization)
    .filter((organization): organization is MaonoOrganization =>
      Boolean(organization),
    );
}

function normalizeUser(value: unknown): MaonoUser | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = toId(value.id);
  const email = toStringValue(value.email);
  const rawRole = toStringValue(value.role);
  const normalizedRole = normalizeRole(rawRole);

  if (id === null || !email || !normalizedRole) {
    return null;
  }

  const organizations = normalizeOrganizations(value.organizations);
  const activeOrganization =
    normalizeOrganization(value.activeOrganization) ??
    normalizeOrganization(value.active_organization) ??
    normalizeOrganization(value.organization);

  const organizationId =
    toId(value.organizationId) ??
    toId(value.organization_id) ??
    toId(activeOrganization?.id);

  const activeOrganizationId =
    toId(value.activeOrganizationId) ??
    toId(value.active_organization_id) ??
    toId(organizationId);

  const accessLevel =
    toStringValue(value.accessLevel) ??
    toStringValue(value.access_level) ??
    null;

  return {
    id,
    email,
    name: toStringValue(value.name),
    role: normalizedRole as MaonoRole,
    rawRole,

    organizationId,
    organization_id: organizationId,
    activeOrganizationId,
    activeOrganization,
    organization: activeOrganization,
    organizations,

    permissions: toPermissionArray(value.permissions),
    scopes: toStringArray(value.scopes),
    accessLevel,
    access_level: accessLevel,
    featureFlags: toStringArray(
      value.featureFlags ?? value.feature_flags ?? value.flags,
    ),
    limits: toLimits(value.limits),
  };
}

function normalizeProject(value: unknown): MaonoProject | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = toId(value.id);
  const name = toStringValue(value.name);
  const slug = toStringValue(value.slug);

  if (id === null || !name || !slug) {
    return null;
  }

  const accessLevel =
    toStringValue(value.accessLevel) ??
    toStringValue(value.access_level) ??
    "viewer";

  return {
    id,
    name,
    slug,
    description: toStringValue(value.description),
    organizationId:
      toId(value.organizationId) ?? toId(value.organization_id) ?? null,
    organization_id:
      toId(value.organization_id) ?? toId(value.organizationId) ?? null,
    accessLevel,
    access_level: accessLevel,
    permissions: toPermissionArray(value.permissions),
    active: typeof value.active === "boolean" ? value.active : undefined,
    thumbnailUrl:
      toStringValue(value.thumbnailUrl) ?? toStringValue(value.thumbnail_url),
    thumbnail_url:
      toStringValue(value.thumbnail_url) ?? toStringValue(value.thumbnailUrl),
    createdAt:
      toStringValue(value.createdAt) ?? toStringValue(value.created_at),
    updatedAt:
      toStringValue(value.updatedAt) ?? toStringValue(value.updated_at),
  };
}

function normalizeProjects(value: unknown): MaonoProject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeProject)
    .filter((project): project is MaonoProject => Boolean(project));
}

function enrichUserWithSessionContext({
  user,
  activeOrganization,
  organizations,
  rootPermissions,
  rootScopes,
}: {
  user: MaonoUser;
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];
  rootPermissions: Permission[];
  rootScopes: string[];
}): MaonoUser {
  const nextActiveOrganization =
    activeOrganization ?? user.activeOrganization ?? user.organization ?? null;

  const nextOrganizations =
    organizations.length > 0 ? organizations : user.organizations ?? [];

  const organizationId =
    user.organizationId ??
    user.organization_id ??
    nextActiveOrganization?.id ??
    null;

  const activeOrganizationId =
    user.activeOrganizationId ?? organizationId ?? nextActiveOrganization?.id ?? null;

  return {
    ...user,
    organizationId,
    organization_id: organizationId,
    activeOrganizationId,
    activeOrganization: nextActiveOrganization,
    organization: nextActiveOrganization,
    organizations: nextOrganizations,
    permissions: mergePermissions(user.permissions, rootPermissions),
    scopes: mergeStringArrays(user.scopes, rootScopes),
  };
}

function normalizeSessionPayload(value: unknown): PublicSession {
  if (!isRecord(value)) {
    return EMPTY_SESSION;
  }

  const userFromPayload = normalizeUser(value.user);
  const authenticated = Boolean(value.authenticated && userFromPayload);
  const projects = authenticated ? normalizeProjects(value.projects) : [];

  const organizationsFromRoot = normalizeOrganizations(value.organizations);
  const activeOrganizationFromRoot =
    normalizeOrganization(value.activeOrganization) ??
    normalizeOrganization(value.active_organization);

  const rootPermissions = toPermissionArray(value.permissions);
  const rootScopes = toStringArray(value.scopes);

  const organizations =
    organizationsFromRoot.length > 0
      ? organizationsFromRoot
      : userFromPayload?.organizations ?? [];

  const activeOrganization =
    activeOrganizationFromRoot ??
    userFromPayload?.activeOrganization ??
    userFromPayload?.organization ??
    organizations[0] ??
    null;

  const user =
    authenticated && userFromPayload
      ? enrichUserWithSessionContext({
          user: userFromPayload,
          activeOrganization,
          organizations,
          rootPermissions,
          rootScopes,
        })
      : null;

  return {
    authenticated,
    user,
    projects,
    activeOrganization: authenticated ? activeOrganization : null,
    organizations: authenticated ? organizations : [],
  };
}

function publishSessionToWindow(session: PublicSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.__MAONO_SESSION__ = {
    authenticated: session.authenticated,
    user: session.user,
    projects: session.projects,
    activeOrganization: session.activeOrganization ?? null,
    organizations: session.organizations ?? [],
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: {
        message: response.ok
          ? "A resposta da API não está em JSON válido."
          : text.slice(0, 500),
      },
    };
  }
}

export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MaonoUser | null>(null);
  const [projects, setProjects] = useState<MaonoProject[]>([]);
  const [activeOrganization, setActiveOrganization] =
    useState<MaonoOrganization | null>(null);
  const [organizations, setOrganizations] = useState<MaonoOrganization[]>([]);

  const applySession = useCallback((rawData: unknown) => {
    const nextSession = normalizeSessionPayload(rawData);

    setAuthenticated(nextSession.authenticated);
    setUser(nextSession.user);
    setProjects(nextSession.projects);
    setActiveOrganization(nextSession.activeOrganization ?? null);
    setOrganizations(nextSession.organizations ?? []);

    publishSessionToWindow(nextSession);
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

      if (!response.ok) {
        applySession(EMPTY_SESSION);
        return;
      }

      applySession(data);
    } catch (error) {
      console.error("[Maono] Falha ao atualizar sessão.", error);
      applySession(EMPTY_SESSION);
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
        const message =
          isRecord(data) &&
          isRecord(data.error) &&
          typeof data.error.message === "string"
            ? data.error.message
            : "Não foi possível fazer login.";

        throw new Error(message);
      }

      await refreshSession();
    },
    [refreshSession],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });
    } finally {
      applySession(EMPTY_SESSION);
    }
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
      activeOrganization,
      organizations,
      refreshSession,
      login,
      logout,
    }),
    [
      authenticated,
      loading,
      user,
      projects,
      activeOrganization,
      organizations,
      refreshSession,
      login,
      logout,
    ],
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

export type {
  MaonoFeatureFlag,
  MaonoId,
  MaonoLimits,
  MaonoOrganization,
  MaonoProject,
  MaonoRole,
  MaonoUser,
  Permission,
  PublicSession,
};