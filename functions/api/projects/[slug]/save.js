import {
  errorResponse,
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import {
  getOrCreateCorrelationId,
  normalizeMaonoError,
} from "../../../_lib/maono-error.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../_lib/projects.js";
import { uploadDropboxTextFile } from "../../../_lib/dropbox.js";
import {
  recordAuditLog,
  requireProjectPermission,
} from "../../../_lib/permissions.js";

const LEGACY_SAVE_ACTION = "projects.config.save";
const LEGACY_SAVE_ENDPOINT = "legacy_save";
const PROJECT_SAVE_PERMISSION = "project.save";
const DEFAULT_CONFIG_FILE = "config.kepler.json";
const AUDIT_TEXT_LIMIT = 600;

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

function getProjectAuditResourceId(project, fallbackSlug) {
  return project?.slug ?? fallbackSlug ?? project?.id ?? null;
}

function jsonSizeBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || "Erro desconhecido.");
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
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function logUnexpectedError(error) {
  const status = error?.status || 500;
  if (status >= 500) {
    console.error("[Maono projects] Falha no endpoint legado de save:", {
      correlationId: error?.correlationId ?? null,
      code: error?.code ?? null,
      category: error?.category ?? null,
      retryable: error?.retryable ?? null,
    });
  }
}

async function auditLegacySave(env, request, user, project, result, metadata = {}) {
  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId: getProjectOrganizationId(project),
    projectId: project?.id ?? null,
    action: LEGACY_SAVE_ACTION,
    resourceType: "project",
    resourceId: getProjectAuditResourceId(project, metadata.slug),
    result,
    metadata: {
      endpoint: LEGACY_SAVE_ENDPOINT,
      permission: PROJECT_SAVE_PERMISSION,
      ...metadata,
    },
    request,
  });
}

async function auditUnexpectedLegacySaveError(
  env,
  request,
  user,
  project,
  slug,
  fileName,
  error,
  result = "error",
) {
  if (!user || !project) return;
  await auditLegacySave(env, request, user, project, result, {
    slug,
    fileName,
    reason: error?.code || "PROJECT_SAVE_ERROR",
    errorMessage: sanitizeAuditText(getErrorMessage(error)),
    category: error?.category || null,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
    correlationId: error?.correlationId || null,
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const correlationId = getOrCreateCorrelationId(request);
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"], { correlationId });
  }

  let user = null;
  let slug = null;
  let project = null;
  let fileName = DEFAULT_CONFIG_FILE;

  try {
    user = await requireSession(env, request);
    slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      await auditLegacySave(env, request, user, null, "denied", {
        slug: null,
        fileName: null,
        correlationId,
        reason: "MISSING_PROJECT_SLUG",
      });
      return errorResponse(
        "Slug do projeto não informado.",
        400,
        "PROJECT_SLUG_REQUIRED",
        null,
        { correlationId },
      );
    }

    project = await getAuthorizedProject(env, user, slug);
    if (!project) {
      await auditLegacySave(env, request, user, null, "denied", {
        slug,
        fileName: null,
        correlationId,
        reason: "PROJECT_NOT_FOUND_OR_NOT_AUTHORIZED",
      });
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
        null,
        { correlationId },
      );
    }

    fileName = project.default_config_file || DEFAULT_CONFIG_FILE;
    await requireProjectPermission(
      env,
      request,
      PROJECT_SAVE_PERMISSION,
      getProjectPermissionContext(project, slug),
      {
        user,
        auditAction: LEGACY_SAVE_ACTION,
        auditOnSuccess: false,
        resourceType: "project",
        resourceId: getProjectAuditResourceId(project, slug),
      },
    );

    const body = await readJsonBody(request);
    const config = body?.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      await auditLegacySave(env, request, user, project, "invalid", {
        slug,
        fileName,
        correlationId,
        reason: "MISSING_CONFIG",
      });
      return errorResponse(
        "Envie o campo config em formato JSON no corpo da requisição.",
        400,
        "MISSING_CONFIG",
        null,
        { correlationId },
      );
    }

    const content = JSON.stringify(config, null, 2);
    const sizeBytes = jsonSizeBytes(content);
    const dropboxResult = await uploadDropboxTextFile(
      env,
      project.dropbox_root_path,
      fileName,
      content,
    );

    await auditLegacySave(env, request, user, project, "success", {
      slug,
      fileName,
      correlationId,
      sizeBytes,
      dropboxRev: dropboxResult?.rev ?? null,
    });

    return jsonResponse({
      ok: true,
      saved: true,
      legacy: true,
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
      },
      dropbox: {
        id: dropboxResult?.id,
        name: dropboxResult?.name,
        rev: dropboxResult?.rev,
        pathDisplay: dropboxResult?.path_display,
      },
    });
  } catch (error) {
    const normalized = normalizeMaonoError(error, {
      defaultCode: "PROJECT_SAVE_ERROR",
      correlationId,
    });
    const status = Number(normalized.status || 500);
    logUnexpectedError(normalized);

    await auditUnexpectedLegacySaveError(
      env,
      request,
      user,
      project,
      slug,
      fileName,
      normalized,
      status < 500 ? "invalid" : "error",
    ).catch(() => null);

    if (status === 400) {
      return errorResponseFromError(normalized, {
        correlationId,
        publicMessage: error?.message || "Requisição inválida.",
      });
    }
    if (status === 401) {
      return errorResponseFromError(normalized, {
        correlationId,
        publicMessage: "Sessão inválida ou expirada.",
      });
    }
    if (status === 403) {
      return errorResponseFromError(normalized, {
        correlationId,
        publicMessage: "Você não tem permissão para salvar alterações permanentes neste projeto.",
      });
    }
    if (status === 404) {
      return errorResponseFromError(normalized, {
        correlationId,
        publicMessage: "Projeto não encontrado ou sem permissão de acesso.",
      });
    }

    return errorResponseFromError(normalized, {
      correlationId,
      publicMessage: "Não foi possível salvar o projeto.",
    });
  }
}
