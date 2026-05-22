import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/projects.js";

function requireAdmin(user) {
  if (user?.role !== "admin") {
    const error = new Error("Apenas administradores podem acessar este recurso.");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    const user = await requireSession(env, request);
    requireAdmin(user);

    if (request.method !== "DELETE") {
      return methodNotAllowed(["DELETE"]);
    }

    const accessId = Number(params.id);

    if (!accessId) {
      return errorResponse("ID do acesso inválido.", 400, "ACCESS_ID_INVALID");
    }

    const access = await env.DB.prepare(
      `SELECT id, user_id, project_id, access_level
       FROM user_projects
       WHERE id = ?
       LIMIT 1`
    )
      .bind(accessId)
      .first();

    if (!access) {
      return errorResponse("Vínculo de acesso não encontrado.", 404, "ACCESS_NOT_FOUND");
    }

    await env.DB.prepare(`DELETE FROM user_projects WHERE id = ?`)
      .bind(accessId)
      .run();

    await logAudit(env, {
      userId: user.id,
      projectId: access.project_id,
      action: "admin.access.delete",
      details: { targetUserId: access.user_id, accessLevel: access.access_level },
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "ADMIN_ACCESS_DELETE_ERROR");
  }
}
