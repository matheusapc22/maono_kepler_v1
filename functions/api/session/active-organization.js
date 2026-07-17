import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../_lib/http.js";
import {
  getSessionUser,
  normalizeRole,
  requireSession,
  setSessionActiveOrganization,
} from "../../_lib/auth.js";
import { recordAuditLog } from "../../_lib/permissions.js";
import { buildAuthenticatedSession } from "../session.js";

const AUDIT_ACTION = "organization.context.switch";

function getDb(env) {
  const db = env.DB || env.D1 || env.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    const error = new Error("Banco de dados D1 não configurado.");
    error.status = 500;
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  return db;
}

function normalizeOrganizationId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function getCurrentOrganizationId(user) {
  return (
    user?.activeOrganizationId ??
    user?.active_organization_id ??
    user?.organizationId ??
    user?.organization_id ??
    null
  );
}

async function auditSwitch(env, request, event) {
  try {
    await recordAuditLog(env, {
      actorUserId: event.user?.id ?? null,
      organizationId: event.organizationId ?? null,
      action: AUDIT_ACTION,
      resourceType: "organization",
      resourceId: event.organizationId ?? null,
      result: event.result,
      metadata: {
        fromOrganizationId: event.fromOrganizationId ?? null,
        toOrganizationId: event.organizationId ?? null,
        reason: event.reason ?? null,
      },
      request,
    });
  } catch (error) {
    console.warn("[Maono organization] Falha ao registrar auditoria:", error);
  }
}

function requestError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "PUT") {
    return methodNotAllowed(["PUT"]);
  }

  let user = null;
  let organizationId = null;
  let fromOrganizationId = null;
  let auditRecorded = false;

  try {
    user = await requireSession(env, request);
    fromOrganizationId = getCurrentOrganizationId(user);

    const body = await readJsonBody(request);
    organizationId = normalizeOrganizationId(body?.organizationId);

    if (!organizationId) {
      throw requestError(
        "Informe uma organização válida.",
        400,
        "INVALID_ORGANIZATION_ID",
      );
    }

    const db = getDb(env);
    const organization = await db
      .prepare(
        `SELECT id, name, slug, active
         FROM organizations
         WHERE id = ?
         LIMIT 1`,
      )
      .bind(organizationId)
      .first();

    if (!organization) {
      throw requestError(
        "Organização não encontrada.",
        404,
        "ORGANIZATION_NOT_FOUND",
      );
    }

    if (!(organization.active === 1 || organization.active === true)) {
      throw requestError(
        "Esta organização está inativa.",
        409,
        "ORGANIZATION_INACTIVE",
      );
    }

    if (normalizeRole(user.role) !== "super_admin") {
      const membership = await db
        .prepare(
          `SELECT access_level
           FROM organization_users
           WHERE user_id = ?
             AND organization_id = ?
           LIMIT 1`,
        )
        .bind(user.id, organizationId)
        .first();

      if (!membership) {
        throw requestError(
          "Você não possui acesso a esta organização.",
          403,
          "ORGANIZATION_ACCESS_DENIED",
        );
      }
    }

    await setSessionActiveOrganization(env, request, organizationId);

    let session;

    try {
      const refreshedUser = await getSessionUser(env, request);

      if (!refreshedUser) {
        throw requestError(
          "Sessão inválida ou expirada.",
          401,
          "UNAUTHORIZED",
        );
      }

      session = await buildAuthenticatedSession(env, refreshedUser);
    } catch (error) {
      await setSessionActiveOrganization(env, request, fromOrganizationId);
      throw error;
    }

    await auditSwitch(env, request, {
      user,
      organizationId,
      fromOrganizationId,
      result: "success",
      reason: "ACTIVE_ORGANIZATION_UPDATED",
    });
    auditRecorded = true;

    return jsonResponse(session);
  } catch (error) {
    if (!auditRecorded) {
      await auditSwitch(env, request, {
        user,
        organizationId,
        fromOrganizationId,
        result: "denied",
        reason: error.code || "ORGANIZATION_SWITCH_ERROR",
      });
    }

    const status = error.status || 500;
    const code = error.code || "ORGANIZATION_SWITCH_ERROR";

    if (status >= 500) {
      console.error("[Maono organization] Falha ao trocar organização:", error);
    }

    return errorResponse(
      status >= 500
        ? "Não foi possível trocar a organização."
        : error.message,
      status,
      code,
    );
  }
}
