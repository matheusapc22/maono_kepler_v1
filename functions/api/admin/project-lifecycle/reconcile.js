import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { recordAuditLog } from "../../../_lib/permissions.js";
import { getActiveOrganizationId } from "../../../_lib/projects.js";
import { reconcileLegacyProjectLifecycle } from "../../../_lib/project-lifecycle-reconciler.js";

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 10;
  return Math.min(25, Math.max(1, parsed));
}

function normalizeCursor(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function transitionId(projectId) {
  const suffix = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `legacy-reconcile:${projectId}:${suffix}`;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const user = await requireSession(env, request);
    if (String(user?.role || "").toLowerCase() !== "super_admin") {
      return errorResponse(
        "A reconciliação de lifecycle é exclusiva do Super Admin.",
        403,
        "SUPER_ADMIN_REQUIRED",
      );
    }

    const organizationId = getActiveOrganizationId(user);
    if (!organizationId) {
      return errorResponse(
        "Selecione uma organização ativa.",
        409,
        "ACTIVE_ORGANIZATION_REQUIRED",
      );
    }

    const body = await readJsonBody(request);
    const limit = normalizeLimit(body?.limit);
    const afterProjectId = normalizeCursor(body?.afterProjectId);
    const query = await env.DB.prepare(
      `SELECT *
         FROM projects
        WHERE organization_id = ?
          AND active = 1
          AND lifecycle_state IS NULL
          AND id > ?
        ORDER BY id
        LIMIT ?`,
    )
      .bind(organizationId, afterProjectId, limit)
      .all();

    const summary = {
      inspected: 0,
      reconciled: 0,
      idempotent: 0,
      errors: 0,
      items: [],
    };
    let nextCursor = afterProjectId;

    for (const project of query?.results || []) {
      summary.inspected += 1;
      nextCursor = Math.max(nextCursor, Number(project.id || 0));
      try {
        const result = await reconcileLegacyProjectLifecycle(env, project, {
          actorUserId: user.id,
          transitionId: transitionId(project.id),
        });
        if (result.idempotent) summary.idempotent += 1;
        else summary.reconciled += 1;
        summary.items.push({
          projectId: project.id,
          status: "ACTIVE",
          revision: result.revision,
          sizeBytes: result.sizeBytes,
        });
      } catch (error) {
        summary.errors += 1;
        summary.items.push({
          projectId: project.id,
          status: "ERROR",
          code: error?.code || "PROJECT_LIFECYCLE_RECONCILE_ITEM_ERROR",
        });
      }
    }

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM projects
        WHERE organization_id = ?
          AND active = 1
          AND lifecycle_state IS NULL`,
    )
      .bind(organizationId)
      .first();
    const unresolvedInactive = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM projects
        WHERE organization_id = ?
          AND active = 0
          AND lifecycle_state IS NULL`,
    )
      .bind(organizationId)
      .first();

    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "project.lifecycle.reconcile",
      resourceType: "organization",
      resourceId: organizationId,
      result: summary.errors ? "partial" : "success",
      metadata: {
        limit,
        afterProjectId,
        nextCursor,
        inspected: summary.inspected,
        reconciled: summary.reconciled,
        idempotent: summary.idempotent,
        errors: summary.errors,
        remainingLegacyActive: Number(remaining?.total || 0),
        unresolvedInactive: Number(unresolvedInactive?.total || 0),
      },
      request,
    });

    return jsonResponse({
      ok: true,
      organizationId,
      limit,
      afterProjectId,
      nextCursor,
      remainingLegacyActive: Number(remaining?.total || 0),
      unresolvedInactive: Number(unresolvedInactive?.total || 0),
      ...summary,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    return errorResponse(
      status >= 500
        ? "Não foi possível reconciliar o lifecycle dos projetos."
        : error?.message || "Requisição inválida.",
      status,
      error?.code || "PROJECT_LIFECYCLE_RECONCILE_ERROR",
      error?.details || null,
    );
  }
}
