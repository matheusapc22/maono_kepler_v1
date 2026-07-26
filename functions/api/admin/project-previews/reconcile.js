import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import {
  getPreviewFileNameFromConfigFile,
  getDropboxMetadata,
} from "../../../_lib/dropbox.js";
import {
  markProjectPreviewMissing,
  markProjectPreviewReady,
} from "../../../_lib/project-preview.js";
import { recordAuditLog } from "../../../_lib/permissions.js";
import { getActiveOrganizationId } from "../../../_lib/projects.js";

function normalizeLimit(value) {
  const normalized = Number(value);

  if (!Number.isInteger(normalized)) {
    return 25;
  }

  return Math.min(25, Math.max(1, normalized));
}

function isDropboxNotFound(error) {
  const message = String(error?.message || "");

  return (
    error?.code === "DROPBOX_PATH_NOT_FOUND" ||
    message.includes("path/not_found") ||
    message.includes("not_found")
  );
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
        "A reconciliação de previews é exclusiva do Super Admin.",
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
    const { results } = await env.DB.prepare(
      `SELECT
        id,
        slug,
        organization_id,
        dropbox_root_path,
        default_config_file,
        config_revision,
        preview_status
       FROM projects
       WHERE organization_id = ?
         AND active = 1
         AND preview_status = 'UNKNOWN'
       ORDER BY id
       LIMIT ?`,
    )
      .bind(organizationId, limit)
      .all();

    const summary = {
      inspected: 0,
      ready: 0,
      missing: 0,
      errors: 0,
    };

    for (const project of results || []) {
      summary.inspected += 1;
      const fileName = getPreviewFileNameFromConfigFile(
        project.default_config_file || "config.kepler.json",
      );

      try {
        await getDropboxMetadata(
          env,
          project.dropbox_root_path,
          fileName,
        );
        const ready = await markProjectPreviewReady(env, {
          projectId: project.id,
          organizationId,
          revision: Number(project.config_revision || 0),
          captureMethod: "admin-reconcile",
        });

        if (ready) {
          summary.ready += 1;
        }
      } catch (error) {
        if (isDropboxNotFound(error)) {
          await markProjectPreviewMissing(env, {
            projectId: project.id,
            organizationId,
            expectedStatus: "UNKNOWN",
          });
          summary.missing += 1;
        } else {
          summary.errors += 1;
        }
      }
    }

    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "projects.thumbnail.reconcile",
      resourceType: "organization",
      resourceId: organizationId,
      result: summary.errors ? "partial" : "success",
      metadata: { limit, ...summary },
      request,
    });

    return jsonResponse({
      ok: true,
      organizationId,
      limit,
      ...summary,
    });
  } catch (error) {
    const status = Number(error?.status || 500);

    return errorResponse(
      status >= 500
        ? "Não foi possível reconciliar os previews."
        : error?.message || "Requisição inválida.",
      status,
      error?.code || "PROJECT_PREVIEW_RECONCILE_ERROR",
    );
  }
}
