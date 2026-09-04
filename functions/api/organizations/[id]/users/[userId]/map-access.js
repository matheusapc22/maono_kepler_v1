import { normalizeRole, requireSession } from "../../../../../_lib/auth.js";
import { getAccessGovernanceCapabilities } from "../../../../../_lib/access-governance.js";
import {
  getRouteParam,
  grantOrganizationPermission,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../../_lib/organizations.js";
import { can, recordAuditLog } from "../../../../../_lib/permissions.js";
import { normalizeProjectMapRouteAccessLevel } from "../../../../../_lib/project-map-route-policy.js";

const CREATE_PERMISSION = "project.create";
const ROUTE_MODES = new Set(["viewer", "editor"]);

function organizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

function targetUserId(params) {
  return parsePositiveInteger(getRouteParam(params, "userId"), "userId");
}

function apiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readTarget(env, orgId, userId) {
  return env.DB.prepare(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.role,
       u.active,
       ou.access_level AS organization_access_level
     FROM users u
     INNER JOIN organization_users ou
       ON ou.user_id = u.id
      AND ou.organization_id = ?
     WHERE u.id = ?
     LIMIT 1`,
  )
    .bind(orgId, userId)
    .first();
}

async function authorizeManagement(env, request, actor, orgId, target) {
  if (!target) throw apiError("Usuário não encontrado na organização.", 404, "USER_NOT_FOUND");
  if (String(actor?.id) === String(target.id)) {
    throw apiError("O usuário não pode alterar o próprio modo de acesso.", 403, "SELF_SERVICE_BLOCKED");
  }

  const governance = await getAccessGovernanceCapabilities(env, orgId, actor);
  if (governance.mode === "super_admin") return governance;

  const directDecision = await can(env, actor, "users.manage_access", {
    organizationId: orgId,
    scopeType: "organization",
    resourceId: target.id,
  });
  const targetLevel = String(target.organization_access_level || "").toLowerCase();
  const delegated =
    governance.canManageAdditionalAccesses &&
    governance.allowedTargetLevels.includes(targetLevel);

  if (!directDecision.allowed && !delegated) {
    throw apiError(
      "Você não possui autorização para alterar o acesso ao mapa deste usuário.",
      403,
      "MAP_ACCESS_MANAGEMENT_FORBIDDEN",
    );
  }
  return governance;
}

async function listProjectRoutes(env, orgId, userId) {
  const result = await env.DB.prepare(
    `SELECT
       p.id AS project_id,
       p.name AS project_name,
       p.slug AS project_slug,
       up.access_level
     FROM user_projects up
     INNER JOIN projects p ON p.id = up.project_id
     WHERE up.user_id = ?
       AND p.organization_id = ?
       AND (p.lifecycle_state = 'ACTIVE' OR (p.lifecycle_state IS NULL AND p.active = 1))
     ORDER BY p.name ASC`,
  )
    .bind(userId, orgId)
    .all();

  return (result?.results || []).map((row) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    projectSlug: row.project_slug,
    mode: normalizeProjectMapRouteAccessLevel(row.access_level) || "viewer",
  }));
}

async function createAccessState(env, orgId, target) {
  const denial = await env.DB.prepare(
    `SELECT id
     FROM user_permission_denials
     WHERE user_id = ? AND organization_id = ? AND permission = ?
     LIMIT 1`,
  )
    .bind(target.id, orgId, CREATE_PERMISSION)
    .first();

  const targetForDecision = {
    id: target.id,
    role: target.role,
    activeOrganizationId: orgId,
    organizationId: orgId,
  };
  const decision = await can(env, targetForDecision, CREATE_PERMISSION, {
    organizationId: orgId,
    scopeType: "organization",
  });

  return {
    allowed: normalizeRole(target.role) === "viewer" ? false : decision.allowed,
    explicitlyDenied: Boolean(denial?.id) || normalizeRole(target.role) === "viewer",
  };
}

async function setProjectRoute(env, request, actor, orgId, target, payload) {
  const projectId = parsePositiveInteger(payload.projectId, "projectId");
  const mode = String(payload.mode || "").trim().toLowerCase();
  if (!ROUTE_MODES.has(mode)) {
    throw apiError("Modo do mapa inválido.", 400, "PROJECT_MAP_ROUTE_INVALID");
  }
  if (normalizeRole(target.role) === "viewer" && mode !== "viewer") {
    throw apiError(
      "Usuários Viewer utilizam obrigatoriamente a rota Viewer.",
      409,
      "VIEWER_ROUTE_LOCKED",
    );
  }

  const linked = await env.DB.prepare(
    `SELECT up.id, up.access_level, p.slug
     FROM user_projects up
     INNER JOIN projects p ON p.id = up.project_id
     WHERE up.user_id = ? AND up.project_id = ? AND p.organization_id = ?
     LIMIT 1`,
  )
    .bind(target.id, projectId, orgId)
    .first();
  if (!linked) {
    throw apiError("O usuário não possui vínculo com este projeto.", 404, "PROJECT_ACCESS_NOT_FOUND");
  }

  await env.DB.prepare(
    `UPDATE user_projects
     SET access_level = ?
     WHERE user_id = ? AND project_id = ?`,
  )
    .bind(mode, target.id, projectId)
    .run();

  await recordAuditLog(env, {
    actorUserId: actor.id,
    organizationId: orgId,
    projectId,
    action: "projects.map.route.assign",
    resourceType: "user_project",
    resourceId: `${target.id}:${projectId}`,
    result: "success",
    metadata: {
      targetUserId: target.id,
      projectSlug: linked.slug,
      previousMode: normalizeProjectMapRouteAccessLevel(linked.access_level),
      assignedMode: mode,
    },
    request,
  });
}

async function denyCreate(env, request, actor, orgId, target) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_permission_denials
       (user_id, organization_id, permission, denied_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, organization_id, permission)
     DO UPDATE SET denied_by = excluded.denied_by, updated_at = excluded.updated_at`,
  )
    .bind(target.id, orgId, CREATE_PERMISSION, actor.id, now, now)
    .run();

  await env.DB.prepare(
    `UPDATE user_permissions
     SET active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND organization_id = ? AND permission = ?`,
  )
    .bind(target.id, orgId, CREATE_PERMISSION)
    .run();

  await recordAuditLog(env, {
    actorUserId: actor.id,
    organizationId: orgId,
    action: "projects.create.access.denied",
    resourceType: "user",
    resourceId: target.id,
    result: "success",
    metadata: { permission: CREATE_PERMISSION },
    request,
  });
}

async function setCreateAccess(env, request, actor, orgId, target, enabled) {
  if (enabled && normalizeRole(target.role) === "viewer") {
    throw apiError(
      "Usuários Viewer não podem receber a rota de criação.",
      409,
      "VIEWER_PROJECT_CREATE_FORBIDDEN",
    );
  }

  if (!enabled) {
    await denyCreate(env, request, actor, orgId, target);
    return;
  }

  await grantOrganizationPermission(
    env,
    orgId,
    target.id,
    CREATE_PERMISSION,
    actor,
  );
}

async function responsePayload(env, orgId, target) {
  return {
    target: {
      id: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      organizationAccessLevel: target.organization_access_level,
    },
    projectRoutes: await listProjectRoutes(env, orgId, target.id),
    create: await createAccessState(env, orgId, target),
  };
}

export async function onRequestGet({ env, request, params }) {
  try {
    const orgId = organizationId(params);
    const userId = targetUserId(params);
    const actor = await requireSession(env, request);
    const target = await readTarget(env, orgId, userId);
    await authorizeManagement(env, request, actor, orgId, target);
    return jsonResponse({ ok: true, ...(await responsePayload(env, orgId, target)) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const orgId = organizationId(params);
    const userId = targetUserId(params);
    const actor = await requireSession(env, request);
    const target = await readTarget(env, orgId, userId);
    await authorizeManagement(env, request, actor, orgId, target);
    const payload = await readJsonBody(request);

    const changesRoute = payload?.projectId !== undefined || payload?.mode !== undefined;
    const changesCreate = payload?.createEnabled !== undefined;
    if (!changesRoute && !changesCreate) {
      throw apiError("Nenhuma alteração de acesso informada.", 400, "INVALID_PAYLOAD");
    }
    if (changesRoute) {
      await setProjectRoute(env, request, actor, orgId, target, payload);
    }
    if (changesCreate) {
      await setCreateAccess(env, request, actor, orgId, target, payload.createEnabled === true);
    }

    return jsonResponse({ ok: true, ...(await responsePayload(env, orgId, target)) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return methodNotAllowed(context.request.method, ["GET", "PATCH"]);
}
