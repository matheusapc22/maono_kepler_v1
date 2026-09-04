import { normalizeRole } from "./auth.js";

export const PROJECT_MAP_ROUTE_MODES = Object.freeze({
  VIEWER: "viewer",
  EDITOR: "editor",
});

const EDITOR_ACCESS_LEVELS = new Set(["editor", "write", "owner"]);

function routePolicyError(message, code, details = null) {
  const error = new Error(message);
  error.status = 403;
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function normalizeProjectMapRouteAccessLevel(value) {
  const accessLevel = String(value || "").trim().toLowerCase();
  if (accessLevel === "viewer") return PROJECT_MAP_ROUTE_MODES.VIEWER;
  if (EDITOR_ACCESS_LEVELS.has(accessLevel)) return PROJECT_MAP_ROUTE_MODES.EDITOR;
  return null;
}

export function resolveEffectiveProjectMapRoute(user, project) {
  const role = normalizeRole(user?.role);
  const accessLevel =
    project?.access_level ?? project?.accessLevel ?? null;

  if (role === "super_admin") {
    return {
      mode: PROJECT_MAP_ROUTE_MODES.EDITOR,
      source: "super_admin",
      accessLevel: String(accessLevel || "owner").toLowerCase(),
    };
  }

  const linkedMode = normalizeProjectMapRouteAccessLevel(accessLevel);
  if (!linkedMode) {
    return { mode: null, source: "missing_project_access", accessLevel };
  }

  if (role === "viewer") {
    return {
      mode: PROJECT_MAP_ROUTE_MODES.VIEWER,
      source: "viewer_role",
      accessLevel: String(accessLevel || "viewer").toLowerCase(),
    };
  }

  return {
    mode: linkedMode,
    source: "project_access",
    accessLevel: String(accessLevel || "").toLowerCase(),
  };
}

export function getProjectMapRoutePath(projectSlug, mode) {
  const encodedSlug = encodeURIComponent(String(projectSlug || ""));
  if (mode === PROJECT_MAP_ROUTE_MODES.VIEWER) {
    return `/projects/${encodedSlug}/view`;
  }
  if (mode === PROJECT_MAP_ROUTE_MODES.EDITOR) {
    return `/projects/${encodedSlug}/edit`;
  }
  return null;
}

export function assertProjectPersistenceRoute(user, project) {
  const route = resolveEffectiveProjectMapRoute(user, project);
  if (route.mode === PROJECT_MAP_ROUTE_MODES.VIEWER) {
    throw routePolicyError(
      "O modo Viewer não permite persistir alterações diretamente.",
      "PROJECT_MAP_VIEWER_PERSISTENCE_FORBIDDEN",
      {
        assignedMode: route.mode,
        replacementRoute: getProjectMapRoutePath(project?.slug, route.mode),
      },
    );
  }
  return route;
}

export function isViewerRole(user) {
  return normalizeRole(user?.role) === "viewer";
}
