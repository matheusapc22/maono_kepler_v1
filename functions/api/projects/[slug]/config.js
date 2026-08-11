import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, publicProject } from "../../../_lib/projects.js";
import { touchProjectAfterConfigSave } from "../../../_lib/project-service.js";
import { can, recordAuditLog } from "../../../_lib/permissions.js";
import {
  getRevisionedPreviewFileNameFromConfigFile,
  uploadDropboxBinaryFile,
} from "../../../_lib/dropbox.js";
import {
  markProjectPreviewFailed,
  markProjectPreviewReady,
  publicProjectPreview,
} from "../../../_lib/project-preview.js";
import {
  getProjectLifecycleRow,
  publicProjectLifecycle,
} from "../../../_lib/project-lifecycle.js";
import {
  readPublishedProjectConfig,
  saveProjectConfig,
} from "../../../_lib/project-config-service.js";

const AUDIT_TEXT_LIMIT = 800;
const AUDIT_SHORT_TEXT_LIMIT = 160;

function asyncThumbnailEnabled(env) {
  return String(env?.ASYNC_PROJECT_THUMBNAIL ?? "true").toLowerCase() !== "false";
}

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
    organizationId:
      base.organizationId ??
      base.organization_id ??
      project?.organization_id ??
      undefined,
    createdBy: base.createdBy ?? null,
    updatedBy: base.updatedBy ?? null,
    metadataVersion: Number(
      base.metadataVersion ?? project?.metadata_version ?? project?.metadataVersion ?? 1,
    ),
    createdAt: base.createdAt ?? base.created_at ?? project?.created_at ?? undefined,
    updatedAt: base.updatedAt ?? base.updated_at ?? project?.updated_at ?? undefined,
    lifecycle: publicProjectLifecycle(project),
    ...publicProjectPreview({ ...project, ...base }),
  };
}

function publicPreviewForConfigResponse(preview) {
  if (!preview) return null;
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
  if (!config.version) return "O JSON não possui campo version.";
  if (!config.config || typeof config.config !== "object") {
    return "O JSON não possui o objeto config.";
  }
  if (!Array.isArray(config.datasets)) {
    return "O JSON não possui datasets em formato de lista.";
  }
  return null;
}

function decodeDataUrl(dataUrl) {
  const value = String(dataUrl || "");
  const match = value.match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/i);
  if (!match) return null;

  const contentType = match[1].toLowerCase();
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, contentType };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Erro desconhecido.");
}

function logUnexpectedError(error) {
  if (Number(error?.status || 500) >= 500) {
    console.error("[Maono projects] Falha no endpoint de config:", error);
  }
}

function sanitizeAuditText(value, maxLength = AUDIT_TEXT_LIMIT) {
  if (value === null || value === undefined) return null;
  let text = "";
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (/data:image\/[a-z]+;base64,/i.test(text)) return "[redacted:data-url]";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function publicThumbnailCaptureForAudit(thumbnailCapture) {
  if (!thumbnailCapture || typeof thumbnailCapture !== "object") return null;
  return {
    method: sanitizeAuditText(thumbnailCapture.method, AUDIT_SHORT_TEXT_LIMIT),
    diagnostics: sanitizeAuditText(thumbnailCapture.diagnostics, AUDIT_TEXT_LIMIT),
  };
}

function createForbiddenError(permission, reason) {
  const error = new Error("Acesso negado.");
  error.status = 403;
  error.code = "FORBIDDEN";
  error.permission = permission;
  error.reason = reason || "DENY_BY_DEFAULT";
  return error;
}

async function saveProjectThumbnail(
  env,
  project,
  fileName,
  thumbnailDataUrl,
  revision,
) {
  const decoded = decodeDataUrl(thumbnailDataUrl);
  if (!decoded) return null;

  const previewFileName = getRevisionedPreviewFileNameFromConfigFile(
    fileName,
    revision,
  );
  await uploadDropboxBinaryFile(
    env,
    project.dropbox_root_path,
    previewFileName,
    decoded.bytes,
    decoded.contentType,
  );
  return {
    previewFileName,
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

async function requireProjectConfigPermission(
  env,
  request,
  user,
  project,
  slug,
  fileName,
  permission,
  action,
) {
  const decision = await can(env, user, permission, getProjectPermissionContext(project, slug));
  if (decision.allowed) return decision;

  await auditProjectConfigAccess(env, request, user, project, action, "denied", {
    slug,
    fileName,
    permission,
    reason: decision.reason,
  });
  throw createForbiddenError(permission, decision.reason);
}

async function auditUnexpectedProjectConfigError(
  env,
  request,
  user,
  project,
  action,
  slug,
  fileName,
  permission,
  error,
  result = "error",
) {
  if (!user || !project) return;
  await auditProjectConfigAccess(env, request, user, project, action, result, {
    slug,
    fileName,
    permission,
    reason: error?.code || "PROJECT_CONFIG_ERROR",
    errorMessage: sanitizeAuditText(getErrorMessage(error), AUDIT_TEXT_LIMIT),
  });
}

async function hydrateLifecycleProject(env, project) {
  const organizationId = getProjectOrganizationId(project);
  if (!project?.id || !organizationId) return project;
  try {
    const lifecycleRow = await getProjectLifecycleRow(env, {
      projectId: project.id,
      organizationId,
    });
    return lifecycleRow ? { ...project, ...lifecycleRow } : project;
  } catch (error) {
    if (/no such column|no such table/i.test(String(error?.message || ""))) {
      return project;
    }
    throw error;
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!["GET", "PUT"].includes(request.method)) {
    return methodNotAllowed(["GET", "PUT"]);
  }

  const action = request.method === "GET" ? "projects.config.read" : "projects.config.save";
  const permission = request.method === "GET" ? "project.view" : "project.save";
  let user = null;
  let slug = null;
  let project = null;
  let fileName = "config.kepler.json";

  try {
    user = await requireSession(env, request);
    slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      return errorResponse("Slug do projeto não informado.", 400, "PROJECT_SLUG_REQUIRED");
    }

    project = await getAuthorizedProject(env, user, slug);
    if (!project) {
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }
    project = await hydrateLifecycleProject(env, project);
    fileName = project.default_config_file || "config.kepler.json";

    await requireProjectConfigPermission(
      env,
      request,
      user,
      project,
      slug,
      fileName,
      permission,
      action,
    );

    if (request.method === "GET") {
      const loaded = await readPublishedProjectConfig(env, project);
      await auditProjectConfigAccess(env, request, user, project, action, "success", {
        slug,
        fileName,
        permission,
        configRevision: Number(project.config_revision || 0),
        lifecycleState: project.lifecycle_state ?? null,
        schemaName: project.config_schema ?? null,
        schemaVersion: project.config_schema_version ?? null,
        sizeBytes: project.config_size_bytes ?? null,
        legacy: loaded.legacy,
      });

      return jsonResponse({
        ok: true,
        project: publicProjectForConfigResponse(project),
        lifecycle: loaded.lifecycle,
        config: loaded.config,
      });
    }

    const body = await readJsonBody(request);
    const config = body?.config;
    const validationError = validateKeplerConfig(config);
    if (validationError) {
      await auditProjectConfigAccess(env, request, user, project, action, "invalid", {
        slug,
        fileName,
        permission,
        reason: "INVALID_KEPLER_CONFIG",
        validationError,
      });
      return errorResponse(validationError, 400, "INVALID_KEPLER_CONFIG");
    }

    const saveStartedAt = Date.now();
    const saved = await saveProjectConfig(env, {
      project,
      config,
      expectedConfigRevision: body?.expectedConfigRevision,
      actor: { id: user.id, name: user.name || "Usuário" },
      touchProjectAfterConfigSave,
    });
    let updatedProject = { ...project, ...saved.project };
    const configRevision = Number(saved.revision || updatedProject.config_revision || 0);
    const sizeBytes = Number(saved.artifact?.sizeBytes || 0);
    let preview = null;
    let previewError = null;

    if (!asyncThumbnailEnabled(env) && body?.thumbnailDataUrl && configRevision > 0) {
      try {
        preview = await saveProjectThumbnail(
          env,
          updatedProject,
          fileName,
          body.thumbnailDataUrl,
          configRevision,
        );
        const readyState = await markProjectPreviewReady(env, {
          projectId: project.id,
          organizationId: getProjectOrganizationId(project),
          revision: configRevision,
          captureMethod: body?.thumbnailCapture?.method,
        });
        if (readyState) updatedProject = { ...updatedProject, ...readyState };
      } catch (error) {
        previewError = getErrorMessage(error);
        const failedState = await markProjectPreviewFailed(env, {
          projectId: project.id,
          organizationId: getProjectOrganizationId(project),
          revision: configRevision,
          errorCode: error?.code || "LEGACY_THUMBNAIL_UPLOAD_FAILED",
          captureMethod: body?.thumbnailCapture?.method,
        });
        if (failedState) updatedProject = { ...updatedProject, ...failedState };
      }
    }

    const publicPreview = publicPreviewForConfigResponse(preview);
    const thumbnailState = publicProjectPreview(updatedProject);
    const saveConfigMs = Date.now() - saveStartedAt;

    await auditProjectConfigAccess(env, request, user, updatedProject, action, "success", {
      slug,
      fileName,
      permission,
      sizeBytes,
      configRevision,
      lifecycleState: updatedProject.lifecycle_state ?? null,
      schemaName: updatedProject.config_schema ?? null,
      schemaVersion: updatedProject.config_schema_version ?? null,
      checksumAlgorithm: updatedProject.config_checksum_algorithm ?? null,
      revisionMode: saved.legacy ? "legacy" : "immutable",
      previewStatus: thumbnailState.thumbnailStatus,
      saveConfigMs,
      preview: publicPreview,
      previewError: sanitizeAuditText(previewError, AUDIT_TEXT_LIMIT),
      thumbnailCapture: publicThumbnailCaptureForAudit(body?.thumbnailCapture),
    });

    return jsonResponse(
      {
        ok: true,
        project: publicProjectForConfigResponse(updatedProject),
        lifecycle: publicProjectLifecycle(updatedProject),
        fileName,
        sizeBytes,
        configRevision,
        thumbnail: {
          status: thumbnailState.thumbnailStatus,
          revision: configRevision,
          thumbnailRevision: thumbnailState.thumbnailRevision,
          updatedAt: thumbnailState.thumbnailUpdatedAt,
        },
        preview: publicPreview,
        previewError,
      },
      {
        headers: {
          "Server-Timing": `save-config;dur=${saveConfigMs}`,
        },
      },
    );
  } catch (error) {
    logUnexpectedError(error);
    const status = Number(error?.status || 500);
    const code = error?.code || "PROJECT_CONFIG_ERROR";

    await auditUnexpectedProjectConfigError(
      env,
      request,
      user,
      project,
      action,
      slug,
      fileName,
      permission,
      error,
      status < 500 ? "invalid" : "error",
    ).catch(() => null);

    if (status === 401) {
      return errorResponse("Sessão inválida ou expirada.", 401, code, error?.details || null);
    }
    if (status === 403) {
      return errorResponse(
        "Você não tem permissão para acessar ou alterar este projeto.",
        403,
        code,
        error?.details || null,
      );
    }
    if (status === 404) {
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        code,
        error?.details || null,
      );
    }
    if (status < 500) {
      return errorResponse(error?.message || "Requisição inválida.", status, code, error?.details || null);
    }

    return errorResponse(
      "Não foi possível processar a configuração do projeto.",
      status,
      code,
      error?.details || null,
    );
  }
}
