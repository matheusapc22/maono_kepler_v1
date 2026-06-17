import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import {
  recordAuditLog,
  requirePermission,
} from "../../_lib/permissions.js";
import { listWorkspaceProjectsForUser } from "../../_lib/workspace-projects.js";

async function readOptionalJsonBody(request) {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    const error = new Error("JSON inválido.");
    error.status = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

function getCreateProjectContext(body) {
  return {
    organizationId:
      body.organizationId ??
      body.organization_id ??
      body.organization?.id ??
      null,
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!["GET", "POST"].includes(request.method)) {
    return methodNotAllowed(["GET", "POST"]);
  }

  try {
    const user = await requireSession(env, request);

    if (request.method === "GET") {
      const projects = await listWorkspaceProjectsForUser(env, user);

      return jsonResponse({
        ok: true,
        projects,
      });
    }

    const body = await readOptionalJsonBody(request);
    const permissionContext = getCreateProjectContext(body);

    await requirePermission(
      env,
      request,
      "project.create",
      permissionContext,
      {
        user,
        auditAction: "project.create.request",
        auditOnSuccess: false,
        resourceType: "project",
        resourceId: permissionContext.organizationId,
      },
    );

    await recordAuditLog(env, {
      actorUserId: user?.id,
      organizationId: permissionContext.organizationId,
      projectId: null,
      action: "project.create.request",
      resourceType: "project",
      resourceId: permissionContext.organizationId,
      result: "not_implemented",
      metadata: {
        permission: "project.create",
        reason: "PROJECT_CREATE_NOT_IMPLEMENTED",
      },
      request,
    });

    return errorResponse(
      "Criação de novo mapa ainda não foi conectada ao fluxo de Dropbox/Kepler.",
      501,
      "PROJECT_CREATE_NOT_IMPLEMENTED",
    );
  } catch (error) {
    console.error("[Maono projects] Falha no endpoint de projetos:", error);

    if (error.status === 400) {
      return errorResponse(
        error.message || "Requisição inválida.",
        400,
        error.code || "BAD_REQUEST",
      );
    }

    if (error.status === 401) {
      return errorResponse(
        "Sessão inválida ou expirada.",
        401,
        error.code || "UNAUTHORIZED",
      );
    }

    if (error.status === 403) {
      return errorResponse(
        "Você não tem permissão para criar projetos.",
        403,
        error.code || "PROJECT_CREATE_FORBIDDEN",
      );
    }

    return errorResponse(
      "Não foi possível carregar os projetos.",
      error.status || 500,
      error.code || "PROJECTS_ERROR",
    );
  }
}