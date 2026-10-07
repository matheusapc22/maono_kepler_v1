import { getPreviewOperation, publicPreviewOperation, previewDatabase } from "../../../../_lib/project-preview-operations.js";
import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../../_lib/http.js";
import { requireSession } from "../../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../../_lib/projects.js";
import { requireProjectPermission } from "../../../../_lib/permissions.js";
import {
  getProjectPreviewState,
  publicProjectPreview,
} from "../../../../_lib/project-preview.js";

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

export async function onRequest(context) {
  const { request, params } = context;
  const env = { ...context.env, DB: context.env.DB?.withSession ? context.env.DB.withSession("first-primary") : context.env.DB };

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);
    const slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      return errorResponse(
        "Slug do projeto não informado.",
        400,
        "PROJECT_SLUG_REQUIRED",
      );
    }

    const project = await getAuthorizedProject(env, user, slug);

    if (!project) {
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    await requireProjectPermission(
      env,
      request,
      "project.view",
      {
        project,
        projectId: project.id,
        projectSlug: project.slug ?? slug,
        organizationId: getProjectOrganizationId(project),
      },
      {
        user,
        auditAction: "projects.thumbnail.status",
        auditOnSuccess: false,
        resourceType: "project",
        resourceId: project.slug ?? slug,
      },
    );

    const state = await getProjectPreviewState(env, {
      projectId: project.id,
      organizationId: getProjectOrganizationId(project),
    });

    if (!state) {
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    const operationId = new URL(request.url).searchParams.get("operationId");
    if (operationId) {
      const operation = await getPreviewOperation(env, { organizationId: getProjectOrganizationId(project), projectId: project.id, actorUserId: user.id, operationId });
      if (!operation) return errorResponse("Operação não encontrada.", 404, "PROJECT_PREVIEW_OPERATION_NOT_FOUND");
      return jsonResponse({ ok: true, operation: publicPreviewOperation(operation) }, { headers: { "Cache-Control": "no-store" } });
    }
    let job = null;
    if (state.preview_operation_id) job = await previewDatabase(env).prepare("SELECT state, revision FROM project_preview_operations WHERE id = ? AND organization_id = ? AND project_id = ?")
      .bind(state.preview_operation_id, getProjectOrganizationId(project), project.id).first();
    const jobState = job && job.revision === state.config_revision ? job.state : state.preview_status === "PENDING" ? "WAITING_CAPTURE" : null;
    return jsonResponse({ ok: true, ...publicProjectPreview(state), jobState }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = Number(error?.status || 500);
    const code = error?.code || "PROJECT_THUMBNAIL_STATUS_ERROR";

    if (status === 401) {
      return errorResponse("Sessão inválida ou expirada.", 401, code);
    }

    if (status === 403) {
      return errorResponse(
        "Você não tem permissão para visualizar este projeto.",
        403,
        code,
      );
    }

    if (status === 404) {
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    return errorResponse(
      "Não foi possível consultar o estado da visualização.",
      status,
      code,
    );
  }
}
