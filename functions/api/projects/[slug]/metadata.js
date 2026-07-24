import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../_lib/projects.js";
import {
  getProjectMetadataBySlug,
  updateProjectMetadata,
} from "../../../_lib/project-service.js";
import {
  can,
  recordAuditLog,
} from "../../../_lib/permissions.js";

const ALLOWED_METHODS = ["GET", "PATCH"];

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

function getProjectPermissionContext(project, slug) {
  return {
    project,
    projectId: project?.id ?? null,
    projectSlug: project?.slug ?? slug ?? null,
    organizationId: getProjectOrganizationId(project),
  };
}

function publicProjectForMetadataResponse(metadata, authorizedProject) {
  if (!metadata) {
    return null;
  }

  const accessLevel =
    authorizedProject?.access_level ??
    authorizedProject?.accessLevel ??
    null;

  return {
    ...metadata,
    accessLevel,
    access_level: accessLevel,
    permissions: Array.isArray(authorizedProject?.permissions)
      ? authorizedProject.permissions
      : [],
  };
}

function changedMetadataFields(body) {
  const fields = [];

  if (Object.prototype.hasOwnProperty.call(body || {}, "name")) {
    fields.push("name");
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "description")) {
    fields.push("description");
  }

  return fields;
}

async function auditProjectMetadata(
  env,
  request,
  user,
  project,
  action,
  result,
  metadata = {},
) {
  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId: getProjectOrganizationId(project),
    projectId: project?.id ?? null,
    action,
    resourceType: "project",
    resourceId: project?.slug ?? project?.id ?? metadata.slug ?? null,
    result,
    metadata,
    request,
  });
}

async function requireMetadataPermission(
  env,
  request,
  user,
  project,
  slug,
  permission,
  action,
) {
  const decision = await can(
    env,
    user,
    permission,
    getProjectPermissionContext(project, slug),
  );

  if (decision.allowed) {
    return decision;
  }

  await auditProjectMetadata(
    env,
    request,
    user,
    project,
    action,
    "denied",
    {
      slug,
      permission,
      reason: decision.reason,
    },
  );

  const error = new Error(
    permission === "project.edit"
      ? "Você não tem permissão para editar as informações deste projeto."
      : "Você não tem permissão para consultar as informações deste projeto.",
  );
  error.status = 403;
  error.code = "FORBIDDEN";
  error.permission = permission;
  error.reason = decision.reason;
  throw error;
}

function responseForError(error) {
  const status = Number(error?.status || 500);
  const code = error?.code || "PROJECT_METADATA_ERROR";

  if (status === 400) {
    return errorResponse(
      error?.message || "Requisição inválida.",
      400,
      code,
      error?.details || null,
    );
  }

  if (status === 401) {
    return errorResponse(
      "Sessão inválida ou expirada.",
      401,
      code,
    );
  }

  if (status === 403) {
    return errorResponse(
      error?.message ||
        "Você não tem permissão para acessar ou alterar este projeto.",
      403,
      code,
    );
  }

  if (status === 404) {
    return errorResponse(
      "Projeto não encontrado ou sem permissão de acesso.",
      404,
      code,
    );
  }

  if (status === 409) {
    return errorResponse(
      error?.message ||
        "Este projeto foi alterado por outra pessoa.",
      409,
      code,
      {
        currentProject: error?.currentProject || null,
      },
    );
  }

  return errorResponse(
    "Não foi possível processar os metadados do projeto.",
    status,
    code,
  );
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (!ALLOWED_METHODS.includes(request.method)) {
    return methodNotAllowed(ALLOWED_METHODS);
  }

  const action =
    request.method === "GET"
      ? "projects.metadata.read"
      : "projects.metadata.update";
  const permission =
    request.method === "GET"
      ? "project.view"
      : "project.edit";

  let user = null;
  let slug = null;
  let project = null;

  try {
    user = await requireSession(env, request);
    slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        action,
        resourceType: "project",
        resourceId: null,
        result: "invalid",
        metadata: {
          reason: "MISSING_PROJECT_SLUG",
          permission,
        },
        request,
      });

      return errorResponse(
        "Slug do projeto não informado.",
        400,
        "PROJECT_SLUG_REQUIRED",
      );
    }

    // getAuthorizedProject preserva a organização ativa, o vínculo do usuário
    // e os dados internos necessários para a decisão de permissão.
    project = await getAuthorizedProject(env, user, slug);

    if (!project) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        action,
        resourceType: "project",
        resourceId: slug,
        result: "denied",
        metadata: {
          slug,
          reason: "PROJECT_NOT_FOUND_OR_NOT_AUTHORIZED",
          permission,
        },
        request,
      });

      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    await requireMetadataPermission(
      env,
      request,
      user,
      project,
      slug,
      permission,
      action,
    );

    const organizationId = getProjectOrganizationId(project);

    if (request.method === "GET") {
      const metadata = await getProjectMetadataBySlug(env, {
        slug: project.slug,
        organizationId,
      });

      if (!metadata) {
        return errorResponse(
          "Projeto não encontrado.",
          404,
          "PROJECT_NOT_FOUND",
        );
      }

      await auditProjectMetadata(
        env,
        request,
        user,
        project,
        "projects.metadata.read",
        "success",
        {
          slug: project.slug,
          permission: "project.view",
          metadataVersion: metadata.metadataVersion,
        },
      );

      return jsonResponse({
        ok: true,
        project: publicProjectForMetadataResponse(metadata, project),
      });
    }

    const body = await readJsonBody(request);

    // A validação de campos editáveis, limites, normalização e versão ocorre
    // no serviço central. Campos como createdBy, slug, organizationId,
    // Dropbox e status são rejeitados antes de qualquer UPDATE.
    const previousVersion = Number(
      project.metadata_version ??
      project.metadataVersion ??
      body?.metadataVersion ??
      1,
    );
    const updated = await updateProjectMetadata(env, {
      projectId: project.id,
      organizationId,
      patch: body,
      actor: {
        id: user.id,
        name: user.name,
      },
    });

    const changedFields = changedMetadataFields(body);

    await auditProjectMetadata(
      env,
      request,
      user,
      project,
      "projects.metadata.update",
      "success",
      {
        slug: project.slug,
        permission: "project.edit",
        changedFields,
        previousVersion,
        newVersion: updated.metadataVersion,
      },
    );

    return jsonResponse({
      ok: true,
      project: publicProjectForMetadataResponse(updated, project),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const result =
      status === 400
        ? "invalid"
        : status === 403 || status === 404
          ? "denied"
          : status === 409
            ? "conflict"
            : "error";

    if (user && project) {
      await auditProjectMetadata(
        env,
        request,
        user,
        project,
        action,
        result,
        {
          slug: project.slug ?? slug,
          permission,
          reason: error?.code || "PROJECT_METADATA_ERROR",
          field: error?.details?.field || null,
          currentVersion:
            error?.currentProject?.metadataVersion ??
            project?.metadata_version ??
            project?.metadataVersion ??
            null,
        },
      );
    }

    if (status >= 500) {
      console.error("[Maono projects] Falha no endpoint de metadados:", error);
    }

    return responseForError(error);
  }
}
