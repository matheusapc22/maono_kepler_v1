import type {
  MapPanelContextValue,
  MapRuntimeMode,
} from "./types";

const DEFAULT_HANDOFF_TTL_MS = 60_000;

type MapPanelContextHandoff = {
  pathname: string;
  organizationKey: string;
  projectSlug: string;
  mode: Exclude<MapRuntimeMode, "create">;
  context: MapPanelContextValue;
  expiresAt: number;
};

let currentHandoff: MapPanelContextHandoff | null = null;

function normalizePathname(pathname: string) {
  const normalized = pathname.trim() || "/";
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function contextOrganizationKey(context: MapPanelContextValue) {
  return String(context.organization?.id ?? "none");
}

function contextProjectSlug(context: MapPanelContextValue) {
  return String(context.project?.slug ?? "");
}

function isValidHandoff(
  handoff: MapPanelContextHandoff,
  now: number,
) {
  return (
    handoff.expiresAt > now &&
    handoff.context.allowed === true &&
    handoff.context.mode === handoff.mode &&
    contextProjectSlug(handoff.context) === handoff.projectSlug &&
    contextOrganizationKey(handoff.context) === handoff.organizationKey
  );
}

export function primeMapPanelContextHandoff({
  pathname,
  context,
  ttlMs = DEFAULT_HANDOFF_TTL_MS,
  now = Date.now(),
}: {
  pathname: string;
  context: MapPanelContextValue;
  ttlMs?: number;
  now?: number;
}) {
  if (
    context.mode !== "editor" &&
    context.mode !== "viewer"
  ) {
    throw new Error("Somente contextos editor/viewer podem ser preparados.");
  }

  const projectSlug = contextProjectSlug(context);
  const organizationKey = contextOrganizationKey(context);

  if (!projectSlug || organizationKey === "none") {
    throw new Error("Contexto de mapa incompleto para handoff.");
  }

  currentHandoff = {
    pathname: normalizePathname(pathname),
    organizationKey,
    projectSlug,
    mode: context.mode,
    context,
    expiresAt: now + Math.max(1, ttlMs),
  };
}

export function consumeMapPanelContextHandoff({
  pathname,
  organizationKey,
  projectSlug,
  mode,
  now = Date.now(),
}: {
  pathname: string;
  organizationKey: string;
  projectSlug: string;
  mode: Exclude<MapRuntimeMode, "create">;
  now?: number;
}) {
  const handoff = currentHandoff;
  currentHandoff = null;

  if (!handoff || !isValidHandoff(handoff, now)) {
    return null;
  }

  if (
    handoff.pathname !== normalizePathname(pathname) ||
    handoff.organizationKey !== String(organizationKey) ||
    handoff.projectSlug !== projectSlug ||
    handoff.mode !== mode
  ) {
    return null;
  }

  return handoff.context;
}

export function clearMapPanelContextHandoff() {
  currentHandoff = null;
}

export function getMapPanelContextHandoffDiagnostics() {
  return currentHandoff
    ? {
        pathname: currentHandoff.pathname,
        organizationKey: currentHandoff.organizationKey,
        projectSlug: currentHandoff.projectSlug,
        mode: currentHandoff.mode,
        expiresAt: currentHandoff.expiresAt,
      }
    : null;
}
