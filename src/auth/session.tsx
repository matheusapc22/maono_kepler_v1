import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { normalizeRole } from "../access-control/roles";
import {
  normalizePermissions,
  type Permission,
} from "../access-control/permissions";
import {
  buildApiError,
  buildClientApiError,
  fetchWithNetworkGuard,
  parseJsonResponse,
  parseResponseJson,
  requestJson,
} from "../lib/api-transport";
import { normalizeUserError } from "../lib/user-error-catalog";
import { fetchAuthLoginWithDeadline } from "./login-resilience";
import {
  classifySessionResponse,
  fetchSessionResponseWithRetry,
  isRetryableSessionStatus,
  isSessionRequestAbort,
  type SessionHealth,
} from "./session-resilience";

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

type ProjectActor = {
  id: MaonoId;
  name: string;
};

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
  deniedPermissions?: Permission[];
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
  deniedPermissions?: Permission[];
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
  deniedPermissions?: Permission[];
  active?: boolean;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  createdBy?: ProjectActor | null;
  updatedBy?: ProjectActor | null;
  metadataVersion?: number;
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
  deniedPermissions?: Permission[];
};

declare global {
  interface Window {
    __MAONO_SESSION__?: PublicSession;
  }
}

type SessionState = {
  authenticated: boolean;
  loading: boolean;
  health: SessionHealth;
  user: MaonoUser | null;
  projects: MaonoProject[];
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];
  switchingOrganization: boolean;
  organizationSwitchError: string | null;
  switchOrganization: (organizationId: MaonoId) => Promise<void>;
  clearOrganizationSwitchError: () => void;
  refreshSession: (options?: { signal?: AbortSignal }) => Promise<void>;
  login: (
    email: string,
    password: string,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
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

function invalidSessionPayload(reason: string) {
  const sessionError = buildClientApiError({
    status: 502,
    code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
    category: "INFRASTRUCTURE",
    retryable: true,
    details: { reason },
  });
  sessionError.name = "SessionPayloadError";
  return sessionError;
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

function toPositiveInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeProjectActor(value: unknown): ProjectActor | null {
  if (!isRecord(value)) {
    return null;
  }

  const id =
    toId(value.id) ??
    toId(value.userId) ??
    toId(value.user_id);
  const name = toStringValue(value.name);

  if (id === null || !name) {
    return null;
  }

  return { id, name };
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
    deniedPermissions: toPermissionArray(
      value.deniedPermissions ?? value.denied_permissions,
    ),
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
    deniedPermissions: toPermissionArray(
      value.deniedPermissions ?? value.denied_permissions,
    ),
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
    deniedPermissions: toPermissionArray(
      value.deniedPermissions ?? value.denied_permissions,
    ),
    active: typeof value.active === "boolean" ? value.active : undefined,
    thumbnailUrl:
      toStringValue(value.thumbnailUrl) ?? toStringValue(value.thumbnail_url),
    thumbnail_url:
      toStringValue(value.thumbnail_url) ?? toStringValue(value.thumbnailUrl),
    createdBy: normalizeProjectActor(
      value.createdBy ?? value.created_by,
    ),
    updatedBy: normalizeProjectActor(
      value.updatedBy ?? value.updated_by,
    ),
    metadataVersion: toPositiveInteger(
      value.metadataVersion ?? value.metadata_version,
    ),
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
  rootDeniedPermissions,
  rootScopes,
}: {
  user: MaonoUser;
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];
  rootPermissions: Permission[];
  rootDeniedPermissions: Permission[];
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
    user.activeOrganizationId ??
    organizationId ??
    nextActiveOrganization?.id ??
    null;

  return {
    ...user,
    organizationId,
    organization_id: organizationId,
    activeOrganizationId,
    activeOrganization: nextActiveOrganization,
    organization: nextActiveOrganization,
    organizations: nextOrganizations,
    permissions: mergePermissions(user.permissions, rootPermissions),
    deniedPermissions: mergePermissions(
      user.deniedPermissions,
      rootDeniedPermissions,
    ),
    scopes: mergeStringArrays(user.scopes, rootScopes),
  };
}

function normalizeSessionPayload(value: unknown): PublicSession {
  if (!isRecord(value)) {
    throw invalidSessionPayload("SESSION_PAYLOAD_NOT_OBJECT");
  }

  if (value.authenticated === false) {
    return EMPTY_SESSION;
  }

  if (value.authenticated !== true) {
    throw invalidSessionPayload("SESSION_AUTH_STATE_INVALID");
  }

  const userFromPayload = normalizeUser(value.user);

  if (!userFromPayload) {
    throw invalidSessionPayload("SESSION_USER_INVALID");
  }

  const projects = normalizeProjects(value.projects);

  const organizationsFromRoot = normalizeOrganizations(value.organizations);
  const activeOrganizationFromRoot =
    normalizeOrganization(value.activeOrganization) ??
    normalizeOrganization(value.active_organization);

  const rootPermissions = toPermissionArray(value.permissions);
  const rootDeniedPermissions = toPermissionArray(
    value.deniedPermissions ?? value.denied_permissions,
  );
  const rootScopes = toStringArray(value.scopes);

  const organizations =
    organizationsFromRoot.length > 0
      ? organizationsFromRoot
      : userFromPayload.organizations ?? [];

  const activeOrganization =
    activeOrganizationFromRoot ??
    userFromPayload.activeOrganization ??
    userFromPayload.organization ??
    organizations[0] ??
    null;

  const user = enrichUserWithSessionContext({
    user: userFromPayload,
    activeOrganization,
    organizations,
    rootPermissions,
    rootDeniedPermissions,
    rootScopes,
  });

  return {
    authenticated: true,
    user,
    projects,
    activeOrganization,
    organizations,
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

async function readSuccessfulSessionJson(response: Response) {
  const parsed = await parseResponseJson(response);

  if (!parsed.valid) {
    throw invalidSessionPayload("SESSION_RESPONSE_INVALID_JSON");
  }

  return parsed.data;
}

export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<SessionHealth>("loading");
  const [user, setUser] = useState<MaonoUser | null>(null);
  const [projects, setProjects] = useState<MaonoProject[]>([]);
  const [activeOrganization, setActiveOrganization] =
    useState<MaonoOrganization | null>(null);
  const [organizations, setOrganizations] = useState<MaonoOrganization[]>([]);
  const [switchingOrganization, setSwitchingOrganization] = useState(false);
  const [organizationSwitchError, setOrganizationSwitchError] = useState<
    string | null
  >(null);
  const requestSequenceRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const authenticatedRef = useRef(false);

  const applySession = useCallback((rawData: unknown) => {
    const nextSession = normalizeSessionPayload(rawData);

    authenticatedRef.current = nextSession.authenticated;
    setAuthenticated(nextSession.authenticated);
    setUser(nextSession.user);
    setProjects(nextSession.projects);
    setActiveOrganization(nextSession.activeOrganization ?? null);
    setOrganizations(nextSession.organizations ?? []);

    publishSessionToWindow(nextSession);
    return nextSession;
  }, []);

  const refreshSession = useCallback(
    async (options: { signal?: AbortSignal } = {}) => {
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      requestControllerRef.current?.abort();

      const controller = new AbortController();
      requestControllerRef.current = controller;

      function handleExternalAbort() {
        controller.abort();
      }

      options.signal?.addEventListener("abort", handleExternalAbort, {
        once: true,
      });
      setLoading(true);

      if (!authenticatedRef.current) {
        setHealth("loading");
      }

      try {
        const { response } = await fetchSessionResponseWithRetry({
          signal: controller.signal,
        });

        if (requestId !== requestSequenceRef.current) {
          return;
        }

        const policy = classifySessionResponse(
          response.status,
          authenticatedRef.current,
        );

        if (policy.disposition === "unauthenticated") {
          applySession(EMPTY_SESSION);
          setHealth("unauthenticated");
          return;
        }

        if (policy.disposition === "preserve") {
          setHealth(policy.health);

          if (response.status === 403) {
            console.warn(
              "[Maono session] Sessão preservada após resposta 403; a ação não possui permissão.",
            );
          } else {
            console.error(
              `[Maono session] Sessão preservada após falha HTTP ${response.status}.`,
            );
          }
          return;
        }

        const data = await readSuccessfulSessionJson(response);
        const nextSession = applySession(data);
        setHealth(nextSession.authenticated ? "healthy" : "unauthenticated");
      } catch (requestFailure) {
        if (isSessionRequestAbort(requestFailure)) {
          return;
        }

        console.error(
          "[Maono session] Infraestrutura indisponível ao atualizar sessão; estado conhecido preservado.",
          requestFailure,
        );

        if (requestId === requestSequenceRef.current) {
          setHealth("degraded");
        }
      } finally {
        options.signal?.removeEventListener("abort", handleExternalAbort);

        if (requestId === requestSequenceRef.current) {
          setLoading(false);
          requestControllerRef.current = null;
        }
      }
    },
    [applySession],
  );

  const clearOrganizationSwitchError = useCallback(() => {
    setOrganizationSwitchError(null);
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: MaonoId) => {
      const normalizedId = toId(organizationId);

      if (normalizedId === null) {
        throw buildClientApiError({
          status: 400,
          code: "INVALID_ORGANIZATION_ID",
          retryable: false,
        });
      }

      if (String(activeOrganization?.id ?? "") === String(normalizedId)) {
        setOrganizationSwitchError(null);
        return;
      }

      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      let responseStatus: number | null = null;

      setLoading(false);
      setSwitchingOrganization(true);
      setOrganizationSwitchError(null);

      try {
        const response = await fetchWithNetworkGuard(
          "/api/session/active-organization",
          {
            method: "PUT",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ organizationId: normalizedId }),
            signal: controller.signal,
          },
        );
        responseStatus = response.status;
        const parsed = await parseResponseJson(response);

        if (requestId !== requestSequenceRef.current) {
          return;
        }

        if (!response.ok) {
          if (response.status === 401) {
            applySession(EMPTY_SESSION);
            setHealth("unauthenticated");
          } else if (response.status === 403) {
            setHealth(authenticatedRef.current ? "healthy" : "degraded");
          } else if (isRetryableSessionStatus(response.status)) {
            setHealth("degraded");
          }

          throw buildApiError(
            response,
            parsed.valid ? parsed.data : null,
          );
        }

        if (!parsed.valid) {
          throw invalidSessionPayload("ORGANIZATION_SWITCH_RESPONSE_INVALID_JSON");
        }

        const nextSession = applySession(parsed.data);
        setHealth(nextSession.authenticated ? "healthy" : "unauthenticated");
        setOrganizationSwitchError(null);
      } catch (requestFailure) {
        if (isSessionRequestAbort(requestFailure)) {
          return;
        }

        if (requestId === requestSequenceRef.current) {
          if (responseStatus === null) {
            setHealth("degraded");
          }
          setOrganizationSwitchError(
            normalizeUserError(requestFailure).message,
          );
        }

        throw requestFailure;
      } finally {
        if (requestId === requestSequenceRef.current) {
          setSwitchingOrganization(false);
          requestControllerRef.current = null;
        }
      }
    },
    [activeOrganization?.id, applySession],
  );

  const login = useCallback(
    async (
      email: string,
      password: string,
      options: { signal?: AbortSignal } = {},
    ) => {
      const response = await fetchAuthLoginWithDeadline({
        signal: options.signal,
        init: {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        },
      });

      await parseJsonResponse(response);

      if (options.signal?.aborted) {
        return;
      }

      await refreshSession({ signal: options.signal });
    },
    [refreshSession],
  );

  const logout = useCallback(async () => {
    requestSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setLoading(false);
    setSwitchingOrganization(false);
    setOrganizationSwitchError(null);

    try {
      await requestJson("/api/auth/logout", {
        method: "POST",
      });
    } catch (requestFailure) {
      console.warn(
        "[Maono session] Logout remoto não confirmado; sessão local será encerrada.",
        requestFailure,
      );
    } finally {
      applySession(EMPTY_SESSION);
      setHealth("unauthenticated");
    }
  }, [applySession]);

  useEffect(() => {
    void refreshSession();

    return () => {
      requestSequenceRef.current += 1;
      requestControllerRef.current?.abort();
    };
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      authenticated,
      loading,
      health,
      user,
      projects,
      activeOrganization,
      organizations,
      switchingOrganization,
      organizationSwitchError,
      switchOrganization,
      clearOrganizationSwitchError,
      refreshSession,
      login,
      logout,
    }),
    [
      authenticated,
      loading,
      health,
      user,
      projects,
      activeOrganization,
      organizations,
      switchingOrganization,
      organizationSwitchError,
      switchOrganization,
      clearOrganizationSwitchError,
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
  ProjectActor,
  MaonoUser,
  Permission,
  PublicSession,
  SessionHealth,
};
