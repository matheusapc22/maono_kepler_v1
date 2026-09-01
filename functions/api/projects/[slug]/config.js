import {
  errorResponse,
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import {
  getOrCreateCorrelationId,
  normalizeMaonoError,
} from "../../../_lib/maono-error.js";
import {
  bindSaveTraceToConfig,
  createSaveTrace,
  readSaveJsonBody,
} from "../../../_lib/save-observability.js";
import {
  assertSaveDeployCompatibility,
  getSaveClientMetadata,
  getSaveDeploymentMetadata,
  saveDeployResponseHeaders,
} from "../../../_lib/save-deploy-contract.js";
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

function combineHeaders(saveTrace, deploymentMetadata) {
  return {
    ...saveDeployResponseHeaders(deploymentMetadata),
    ...(saveTrace?.responseHeaders?.() || {}),
  };
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
    console.error("[Maono projects] Falha no endpoint de config:", {
      correlationId: error?.correlationId ?? null,
      code: error?.code ?? null,
      category: error?.category ?? null,
      retryable: error?.retryable ?? null,
    });
  }
}

function logSaveDeployFailure(error, context = {}) {
  if (!String(error?.code || "").startsWith("SAVE_")) return;
  console.error("[Maono save deploy]", {
    event: "project_save_deploy_failed",
    correlationId: error?.correlationId ?? context.correlationId ?? null,
    code: error?.code ?? null,
    status: Number(error?.status || 500),
    retryable: Boolean(error?.retryable),
    clientContract: context.client?.clientContract ?? null,
    clientBuild: context.client?.clientBuild ?? null,
    apiContract: context.deployment?.apiContract ?? null,
    apiBuild: context.deployment?.apiBuild ?? null,
    dbSchemaExpected: context.deployment?.expectedDbSchema ?? null,
    dbSchemaActual: error?.details?.actualDbSchema ?? context.deployment?.actualDbSchema ?? null,
    projectId: context.projectId ?? null,
    organizationId: context.organizationId ?? null,
  });
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

async function saveProjectThumbnail(env, project, fileName, thumbnailDataUrl, revision) {
  const decoded = decodeDataUrl(thumbnailDataUrl);
  if (!decoded) return null;

  const previewFileName = getRevisionedPreviewFileNameFromConfigFile(fileName, revision);
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
    category: error?.category || null,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
    correlationId: error?.correlationId || null,
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
  const correlationId = getOrCreateCorrelationId(request);
  const clientMetadata = getSaveClientMetadata(request);
  let deploymentMetadata = getSaveDeploymentMetadata(env);
  if (!["GET", "PUT"].includes(request.method)) {
    return methodNotAllowed(["GET", "PUT"], {
      correlationId,
      headers: saveDeployResponseHeaders(deploymentMetadata),
    });
  }

  const saveTrace = request.method === "PUT"
    ? createSaveTrace({ request, correlationId, operation: "update" })
    : null;
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
      const error = new Error("Slug do projeto não informado.");
      error.status = 400;
      error.code = "PROJECT_SLUG_REQUIRED";
      saveTrace?.fail(error, { stage: "VALIDATE", httpStatus: 400 });
      return errorResponse(
        error.message,
        400,
        error.code,
        null,
        { correlationId, headers: combineHeaders(saveTrace, deploymentMetadata) },
      );
    }

    project = await getAuthorizedProject(env, user, slug);
    if (!project) {
      const error = new Error("Projeto não encontrado ou sem permissão de acesso.");
      error.status = 404;
      error.code = "PROJECT_NOT_FOUND";
      saveTrace?.fail(error, { stage: "VALIDATE", httpStatus: 404 });
      return errorResponse(
        error.message,
        404,
        error.code,
        null,
        { correlationId, headers: combineHeaders(saveTrace, deploymentMetadata) },
      );
    }
    project = await hydrateLifecycleProject(env, project);
    fileName = project.default_config_file || "config.kepler.json";
    saveTrace?.updateContext({
      projectId: project.id,
      organizationId: getProjectOrganizationId(project),
    });

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
        correlationId,
        configRevision: Number(project.config_revision || 0),
        lifecycleState: project.lifecycle_state ?? null,
        schemaName: project.config_schema ?? null,
        schemaVersion: project.config_schema_version ?? null,
        sizeBytes: project.config_size_bytes ?? null,
        legacy: loaded.legacy,
      });

      return jsonResponse(
        {
          ok: true,
          project: publicProjectForConfigResponse(project),
          lifecycle: loaded.lifecycle,
          config: loaded.config,
        },
        { headers: saveDeployResponseHeaders(deploymentMetadata) },
      );
    }

    // SAVE-02: valida FE ↔ API ↔ D1 antes de ler o payload de persistência e,
    // principalmente, antes de reservar/gravar qualquer revisão.
    deploymentMetadata = await assertSaveDeployCompatibility(env, request);

    const body = await readSaveJsonBody(request, saveTrace);
    const config = body?.config;
    bindSaveTraceToConfig(config, saveTrace);
    const expectedConfigRevision = body?.expectedConfigRevision;
    saveTrace?.updateContext({ expectedRevision: expectedConfigRevision });
    const validationError = validateKeplerConfig(config);
    if (validationError) {
      await auditProjectConfigAccess(env, request, user, project, action, "invalid", {
        slug,
        fileName,
        permission,
        correlationId,
        saveId: saveTrace?.saveId ?? null,
        reason: "INVALID_KEPLER_CONFIG",
        validationError,
      });
      const error = new Error(validationError);
      error.status = 400;
      error.code = "INVALID_KEPLER_CONFIG";
      saveTrace?.fail(error, { stage: "VALIDATE", httpStatus: 400 });
      return errorResponse(
        validationError,
        400,
        "INVALID_KEPLER_CONFIG",
        null,
        { correlationId, headers: combineHeaders(saveTrace, deploymentMetadata) },
      );
    }

    const saved = await saveProjectConfig(env, {
      project,
      config,
      expectedConfigRevision,
      actor: { id: user.id, name: user.name || "Usuário" },
      touchProjectAfterConfigSave,
    });
    let updatedProject = { ...project, ...saved.project };
    const configRevision = Number(saved.revision || updatedProject.config_revision || 0);
    const sizeBytes = Number(saved.artifact?.sizeBytes || 0);
    saveTrace?.updateContext({ candidateRevision: configRevision });
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

    await auditProjectConfigAccess(env, request, user, updatedProject, action, "success", {
      slug,
      fileName,
      permission,
      correlationId,
      saveId: saveTrace?.saveId ?? null,
      sizeBytes,
      configRevision,
      lifecycleState: updatedProject.lifecycle_state ?? null,
      schemaName: updatedProject.config_schema ?? null,
      schemaVersion: updatedProject.config_schema_version ?? null,
      checksumAlgorithm: updatedProject.config_checksum_algorithm ?? null,
      revisionMode: saved.legacy ? "legacy" : "immutable",
      previewStatus: thumbnailState.thumbnailStatus,
      saveConfigMs: saveTrace?.totalDurationMs() ?? null,
      preview: publicPreview,
      previewError: sanitizeAuditText(previewError, AUDIT_TEXT_LIMIT),
      thumbnailCapture: publicThumbnailCaptureForAudit(body?.thumbnailCapture),
      clientContract: deploymentMetadata.clientContract,
      clientBuild: deploymentMetadata.clientBuild,
      apiContract: deploymentMetadata.apiContract,
      apiBuild: deploymentMetadata.apiBuild,
      dbSchema: deploymentMetadata.actualDbSchema,
    });

    saveTrace?.finishSuccess({ httpStatus: 200 });
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
        deploy: {
          apiContract: deploymentMetadata.apiContract,
          dbSchema: deploymentMetadata.actualDbSchema,
        },
      },
      { headers: combineHeaders(saveTrace, deploymentMetadata) },
    );
  } catch (error) {
    const status = Number(error?.status || 500);
    const normalized = normalizeMaonoError(error, {
      defaultCode: "PROJECT_CONFIG_ERROR",
      correlationId,
    });
    saveTrace?.fail(normalized, {
      stage: normalized?.details?.stage || saveTrace?.currentStage || "VALIDATE",
      httpStatus: status,
      category: normalized.category,
      retryable: normalized.retryable,
    });
    logUnexpectedError(normalized);
    logSaveDeployFailure(normalized, {
      correlationId,
      client: clientMetadata,
      deployment: deploymentMetadata,
      projectId: project?.id ?? null,
      organizationId: getProjectOrganizationId(project),
    });

    await auditUnexpectedProjectConfigError(
      env,
      request,
      user,
      project,
      action,
      slug,
      fileName,
      permission,
      normalized,
      status < 500 ? "invalid" : "error",
    ).catch(() => null);

    const responseOptions = {
      correlationId,
      headers: combineHeaders(saveTrace, deploymentMetadata),
    };
    if (normalized.code === "SAVE_CLIENT_CONTRACT_UNSUPPORTED") {
      return errorResponseFromError(normalized, {
        ...responseOptions,
        publicMessage: "A Maõno foi atualizada. Recarregue a página antes de salvar novamente.",
      });
    }
    if (normalized.code === "SAVE_DB_SCHEMA_MISMATCH") {
      return errorResponseFromError(normalized, {
        ...responseOptions,
        publicMessage: "O serviço está sendo atualizado. Tente salvar novamente em instantes.",
      });
    }
    if (status === 401) {
      return errorResponseFromError(normalized, {
        ...responseOptions,
        publicMessage: "Sessão inválida ou expirada.",
      });
    }
    if (status === 403) {
      return errorResponseFromError(normalized, {
        ...responseOptions,
        publicMessage: "Você não tem permissão para acessar ou alterar este projeto.",
      });
    }
    if (status === 404) {
      return errorResponseFromError(normalized, {
        ...responseOptions,
        publicMessage: "Projeto não encontrado ou sem permissão de acesso.",
      });
    }
    if (status < 500) {
      return errorResponseFromError(normalized, {
        ...responseOptions,
        publicMessage: error?.message || "Requisição inválida.",
      });
    }

    return errorResponseFromError(normalized, {
      ...responseOptions,
      publicMessage: "Não foi possível processar a configuração do projeto.",
    });
  }
}
