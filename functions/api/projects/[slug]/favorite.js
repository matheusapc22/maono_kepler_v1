import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import {
  recordAuditLog,
  requireProjectPermission,
} from "../../../_lib/permissions.js";
import {
  getAccessibleProjectBySlug,
  markProjectFavorite,
  unmarkProjectFavorite,
} from "../../../_lib/workspace-projects.js";

function decodeProjectSlug(value) {
  try {
    return decodeURIComponent(String(value || "")).trim();
  } catch {
    return String(value || "").trim();
  }
}

function getProjectOrganizationId(project) {
  return project?.organization_id ?? project?.organizationId ?? null;
}

function getProjectAuditId(project) {
  return project?.slug || project?.id || null;
}

function getFavoriteAuditAction(method) {
  return method === "POST"
    ? "project.favorite.add"
    : "project.favorite.remove";
}

function getProjectPermissionContext(project) {
  return {
    project,
    projectId: project?.id ?? null,
    projectSlug: project?.slug ?? null,
    organizationId: getProjectOrganizationId(project),
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (!["POST", "DELETE"].includes(request.method)) {
    return methodNotAllowed(["POST", "DELETE"]);
  }

  const auditAction = getFavoriteAuditAction(request.method);

  try {
    const user = await requireSession(env, request);
    const slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        action: auditAction,
        resourceType: "project",
        resourceId: null,
        result: "denied",
        metadata: {
          reason: "MISSING_PROJECT_SLUG",
          permission: "project.favorite",
        },
        request,
      });

      return errorResponse(
        "Slug do projeto não informado.",
        400,
        "PROJECT_SLUG_REQUIRED",
      );
    }

    const project = await getAccessibleProjectBySlug(env, user, slug);

    if (!project) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        action: auditAction,
        resourceType: "project",
        resourceId: slug,
        result: "denied",
        metadata: {
          reason: "PROJECT_NOT_FOUND_OR_NOT_AUTHORIZED",
          permission: "project.favorite",
        },
        request,
      });

      return errorResponse(
        "Projeto não encontrado ou não autorizado.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    const permissionContext = getProjectPermissionContext(project);

    await requireProjectPermission(
      env,
      request,
      "project.favorite",
      permissionContext,
      {
        user,
        auditAction,
        auditOnSuccess: false,
        resourceType: "project",
        resourceId: getProjectAuditId(project),
      },
    );

    const updatedProject =
      request.method === "POST"
        ? await markProjectFavorite(env, user, project)
        : await unmarkProjectFavorite(env, user, project);

    await recordAuditLog(env, {
      actorUserId: user?.id,
      organizationId: getProjectOrganizationId(project),
      projectId: project?.id ?? null,
      action: auditAction,
      resourceType: "project",
      resourceId: getProjectAuditId(project),
      result: "success",
      metadata: {
        permission: "project.favorite",
        method: request.method,
      },
      request,
    });

    return jsonResponse({
      ok: true,
      project: updatedProject,
    });
  } catch (error) {
    console.error("[Maono projects] Falha ao alterar favorito:", error);

    const status = error.status || 500;
    const code = error.code || "PROJECT_FAVORITE_ERROR";

    if (status === 401) {
      return errorResponse(
        "Sessão inválida ou expirada.",
        401,
        code,
      );
    }

    if (status === 403) {
      return errorResponse(
        "Você não tem permissão para favoritar este projeto.",
        403,
        code,
      );
    }

    return errorResponse(
      "Não foi possível atualizar o favorito.",
      status,
      code,
    );
  }
}