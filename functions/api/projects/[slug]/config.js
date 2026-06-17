import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, publicProject } from "../../../_lib/projects.js";
import {
  recordAuditLog,
  requireProjectPermission,
} from "../../../_lib/permissions.js";
import {
  deleteDropboxPathIfExists,
  downloadDropboxTextFile,
  getPreviewFileNameFromConfigFile,
  joinDropboxPath,
  uploadDropboxBinaryFile,
  uploadDropboxTextFile,
} from "../../../_lib/dropbox.js";

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

function getProjectAuditResourceId(project, fallbackSlug) {
  return project?.slug ?? fallbackSlug ?? project?.id ?? null;
}

function getProjectPermissionContext(project, slug) {
  return {
    project,
    projectId: project?.id ?? null,
    projectSlug: project?.slug ?? slug ?? null,
    organizationId: getProjectOrganizationId(project),
  };
}

function publicProjectForConfigResponse(project) {
  const base = publicProject(project) || {};
  const accessLevel =
    base.accessLevel ??
    base.access_level ??
    project?.access_level ??
    project?.accessLevel ??
    undefined;

  return {
    id: base.id ?? project?.id,
    name: base.name ?? project?.name,
    slug: base.slug ?? project?.slug,
    description: base.description ?? project?.description ?? undefined,
    accessLevel,
    active:
      typeof base.active === "boolean"
        ? base.active
        : project?.active === 1 || project?.active === true,
    createdAt:
      base.createdAt ??
      base.created_at ??
      project?.created_at ??
      undefined,
    updatedAt:
      base.updatedAt ??
      base.updated_at ??
      project?.updated_at ??
      undefined,
  };
}

function publicPreviewForConfigResponse(preview) {
  if (!preview) {
    return null;
  }

  return {
    previewFileName: preview.previewFileName,
    previewSizeBytes: preview.previewSizeBytes,
    previewContentType: preview.previewContentType,
  };
}

function validateKeplerConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "Envie uma configuração Kepler em formato JSON.";
  }

  if (!config.version) {
    return "O JSON não possui campo version.";
  }

  if (!config.config || typeof config.config !== "object") {
    return "O JSON não possui o objeto config.";
  }

  if (!Array.isArray(config.datasets)) {
    return "O JSON não possui datasets em formato de lista.";
  }

  return null;
}

function jsonSizeBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function decodeDataUrl(dataUrl) {
  const value = String(dataUrl || "");
  const match = value.match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/i);

  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase();
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return { bytes, contentType };
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || "Erro desconhecido.");
}

function logUnexpectedError(error) {
  const status = error?.status || 500;

  if (status >= 500) {
    console.error("[Maono projects] Falha no endpoint de config:", error);
  }
}

async function updateLinkedOrganizationFileSize(env, project, sizeBytes) {
  if (!project.organization_file_id) return;

  await env.DB.prepare(
    `UPDATE organization_files
     SET size_bytes = ?, is_project = 1, active = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(sizeBytes, project.organization_file_id)
    .run();
}

async function markProjectConfigUpdated(env, projectId) {
  return env.DB.prepare(
    `UPDATE projects
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
     RETURNING *`,
  )
    .bind(projectId)
    .first();
}

async function saveProjectThumbnail(env, project, fileName, thumbnailDataUrl) {
  const decoded = decodeDataUrl(thumbnailDataUrl);

  if (!decoded) {
    return null;
  }

  const previewFileName = getPreviewFileNameFromConfigFile(fileName);
  const previewPath = joinDropboxPath(project.dropbox_root_path, previewFileName);

  // Política Maõno: apenas uma imagem canônica por projeto.
  // Exclui a anterior antes de salvar a nova para não acumular previews.
  await deleteDropboxPathIfExists(env, previewPath);

  await uploadDropboxBinaryFile(
    env,
    project.dropbox_root_path,
    previewFileName,
    decoded.bytes,
    decoded.contentType,
  );

  return {
    previewFileName,
    previewPath,
    previewSizeBytes: decoded.bytes.byteLength,
    previewContentType: decoded.contentType,
  };
}

async function auditProjectConfigAccess(
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
    resourceId: getProjectAuditResourceId(project, metadata.slug),
    result,
    metadata,
    request,
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (!["GET", "PUT"].includes(request.method)) {
    return methodNotAllowed(["GET", "PUT"]);
  }

  try {
    const user = await requireSession(env, request);
    const slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        action:
          request.method === "GET"
            ? "projects.config.read"
            : "projects.config.save",
        resourceType: "project",
        resourceId: null,
        result: "denied",
        metadata: {
          reason: "MISSING_PROJECT_SLUG",
        },
        request,
      });

      return errorResponse(
        "Slug do projeto não informado.",
        400,
        "PROJECT_SLUG_REQUIRED",
      );
    }

    const project = await getAuthorizedProject(env, user, slug);

    if (!project) {
      await recordAuditLog(env, {
        actorUserId: user?.id,
        action:
          request.method === "GET"
            ? "projects.config.read"
            : "projects.config.save",
        resourceType: "project",
        resourceId: slug,
        result: "denied",
        metadata: {
          slug,
          reason: "PROJECT_NOT_FOUND_OR_NOT_AUTHORIZED",
        },
        request,
      });

      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    const fileName = project.default_config_file || "config.kepler.json";
    const permissionContext = getProjectPermissionContext(project, slug);

    if (request.method === "GET") {
      await requireProjectPermission(
        env,
        request,
        "project.view",
        permissionContext,
        {
          user,
          auditAction: "projects.config.read",
          auditOnSuccess: false,
          resourceType: "project",
          resourceId: getProjectAuditResourceId(project, slug),
        },
      );

      const fileText = await downloadDropboxTextFile(
        env,
        project.dropbox_root_path,
        fileName,
      );

      let parsedConfig = null;

      try {
        parsedConfig = JSON.parse(fileText);
      } catch (_error) {
        await auditProjectConfigAccess(
          env,
          request,
          user,
          project,
          "projects.config.read",
          "error",
          {
            slug,
            fileName,
            reason: "INVALID_PROJECT_CONFIG",
          },
        );

        return errorResponse(
          "O arquivo do Dropbox não contém um JSON válido.",
          500,
          "INVALID_PROJECT_CONFIG",
        );
      }

      await auditProjectConfigAccess(
        env,
        request,
        user,
        project,
        "projects.config.read",
        "success",
        {
          slug,
          fileName,
          permission: "project.view",
        },
      );

      return jsonResponse({
        ok: true,
        project: publicProjectForConfigResponse(project),
        config: parsedConfig,
      });
    }

    await requireProjectPermission(
      env,
      request,
      "project.save",
      permissionContext,
      {
        user,
        auditAction: "projects.config.save",
        auditOnSuccess: false,
        resourceType: "project",
        resourceId: getProjectAuditResourceId(project, slug),
      },
    );

    const body = await readJsonBody(request);
    const config = body?.config;
    const validationError = validateKeplerConfig(config);

    if (validationError) {
      await auditProjectConfigAccess(
        env,
        request,
        user,
        project,
        "projects.config.save",
        "invalid",
        {
          slug,
          fileName,
          permission: "project.save",
          reason: "INVALID_KEPLER_CONFIG",
          validationError,
        },
      );

      return errorResponse(
        validationError,
        400,
        "INVALID_KEPLER_CONFIG",
      );
    }

    const content = JSON.stringify(config, null, 2);
    const sizeBytes = jsonSizeBytes(content);

    // O JSON é o arquivo crítico. A falha do preview nunca deve bloquear
    // o salvamento do projeto.
    await uploadDropboxTextFile(
      env,
      project.dropbox_root_path,
      fileName,
      content,
    );

    let preview = null;
    let previewError = null;

    if (body?.thumbnailDataUrl) {
      try {
        preview = await saveProjectThumbnail(
          env,
          project,
          fileName,
          body.thumbnailDataUrl,
        );
      } catch (error) {
        previewError = getErrorMessage(error);
      }
    }

    await updateLinkedOrganizationFileSize(env, project, sizeBytes);
    const updatedProject = await markProjectConfigUpdated(env, project.id);
    const publicPreview = publicPreviewForConfigResponse(preview);

    await auditProjectConfigAccess(
      env,
      request,
      user,
      project,
      "projects.config.save",
      "success",
      {
        slug,
        fileName,
        permission: "project.save",
        sizeBytes,
        preview,
        previewError,
        thumbnailCapture: body?.thumbnailCapture || null,
      },
    );

    return jsonResponse({
      ok: true,
      project: publicProjectForConfigResponse({ ...project, ...updatedProject }),
      fileName,
      sizeBytes,
      preview: publicPreview,
      previewError,
    });
  } catch (error) {
    logUnexpectedError(error);

    const status = error?.status || 500;
    const code = error?.code || "PROJECT_CONFIG_ERROR";

    if (status === 400) {
      return errorResponse(
        error.message || "Requisição inválida.",
        400,
        code,
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

    return errorResponse(
      "Não foi possível processar a configuração do projeto.",
      status,
      code,
    );
  }
}