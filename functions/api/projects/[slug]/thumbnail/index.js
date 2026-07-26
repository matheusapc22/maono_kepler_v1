import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../../_lib/http.js";
import { requireSession } from "../../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../../_lib/projects.js";
import {
  recordAuditLog,
  requireProjectPermission,
} from "../../../../_lib/permissions.js";
import {
  deleteDropboxPathIfExists,
  downloadDropboxBinaryFile,
  getPreviewFileNameFromConfigFile,
  getRevisionedPreviewFileNameFromConfigFile,
  joinDropboxPath,
  uploadDropboxBinaryFile,
} from "../../../../_lib/dropbox.js";
import {
  getProjectPreviewState,
  markProjectPreviewAttempt,
  markProjectPreviewFailed,
  markProjectPreviewMissing,
  markProjectPreviewReady,
  normalizePreviewRevision,
  normalizePreviewStatus,
  publicProjectPreview,
  sanitizeCaptureMethod,
  sanitizePreviewCode,
} from "../../../../_lib/project-preview.js";

const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

function thumbnailRevisionFromRequest(request, body = null) {
  const url = new URL(request.url);
  const value = url.searchParams.get("revision") ?? body?.revision;

  return normalizePreviewRevision(value, { allowZero: false });
}

function requestedImageRevision(request) {
  const value = new URL(request.url).searchParams.get("v");

  if (value === null || value === "") {
    return null;
  }

  return normalizePreviewRevision(value);
}

function isPng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < PNG_SIGNATURE.length) {
    return false;
  }

  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isDropboxNotFound(error) {
  const message = String(error?.message || "");

  return (
    error?.code === "DROPBOX_PATH_NOT_FOUND" ||
    message.includes("path/not_found") ||
    message.includes("not_found")
  );
}

function safeDuration(startedAt) {
  return Math.max(0, Date.now() - Number(startedAt || Date.now()));
}

async function auditThumbnail(
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

async function requireThumbnailPermission(
  env,
  request,
  user,
  project,
  slug,
  permission,
  auditAction,
) {
  await requireProjectPermission(
    env,
    request,
    permission,
    getProjectPermissionContext(project, slug),
    {
      user,
      auditAction,
      auditOnSuccess: false,
      resourceType: "project",
      resourceId: project?.slug ?? slug,
    },
  );
}

async function cleanupPreviousPreview(env, project, previousRevision, revision) {
  const configFileName = project.default_config_file || "config.kepler.json";
  let fileName = null;

  if (
    previousRevision !== null &&
    previousRevision !== undefined &&
    Number(previousRevision) !== Number(revision)
  ) {
    fileName = getRevisionedPreviewFileNameFromConfigFile(
      configFileName,
      previousRevision,
    );
  } else if (previousRevision === null || previousRevision === undefined) {
    fileName = getPreviewFileNameFromConfigFile(configFileName);
  }

  if (!fileName) {
    return;
  }

  try {
    await deleteDropboxPathIfExists(
      env,
      joinDropboxPath(project.dropbox_root_path, fileName),
    );
  } catch (error) {
    console.warn(
      "[Maono preview] Não foi possível limpar preview anterior:",
      sanitizePreviewCode(error?.code || "PREVIEW_CLEANUP_FAILED"),
    );
  }
}

async function processThumbnailUpload({
  env,
  request,
  user,
  project,
  revision,
  bytes,
  captureMethod,
  previousRevision,
}) {
  const startedAt = Date.now();
  const organizationId = getProjectOrganizationId(project);
  const configFileName = project.default_config_file || "config.kepler.json";
  const previewFileName = getRevisionedPreviewFileNameFromConfigFile(
    configFileName,
    revision,
  );

  try {
    await uploadDropboxBinaryFile(
      env,
      project.dropbox_root_path,
      previewFileName,
      bytes,
      "image/png",
    );

    const current = await getProjectPreviewState(env, {
      projectId: project.id,
      organizationId,
    });

    if (Number(current?.config_revision) !== Number(revision)) {
      await deleteDropboxPathIfExists(
        env,
        joinDropboxPath(project.dropbox_root_path, previewFileName),
      );

      await auditThumbnail(
        env,
        request,
        user,
        project,
        "projects.thumbnail.complete",
        "stale",
        {
          revision,
          currentRevision: current?.config_revision ?? null,
          durationMs: safeDuration(startedAt),
        },
      );
      return;
    }

    const ready = await markProjectPreviewReady(env, {
      projectId: project.id,
      organizationId,
      revision,
      captureMethod,
    });

    if (!ready) {
      await deleteDropboxPathIfExists(
        env,
        joinDropboxPath(project.dropbox_root_path, previewFileName),
      );
      return;
    }

    await cleanupPreviousPreview(
      env,
      project,
      previousRevision,
      revision,
    );

    await auditThumbnail(
      env,
      request,
      user,
      project,
      "projects.thumbnail.complete",
      "success",
      {
        revision,
        captureMethod,
        sizeBytes: bytes.byteLength,
        durationMs: safeDuration(startedAt),
      },
    );
  } catch (error) {
    const errorCode = sanitizePreviewCode(
      error?.code || "THUMBNAIL_UPLOAD_FAILED",
    );

    await markProjectPreviewFailed(env, {
      projectId: project.id,
      organizationId,
      revision,
      errorCode,
      captureMethod,
    });

    await auditThumbnail(
      env,
      request,
      user,
      project,
      "projects.thumbnail.complete",
      "error",
      {
        revision,
        captureMethod,
        sizeBytes: bytes.byteLength,
        errorCode,
        durationMs: safeDuration(startedAt),
      },
    );
  }
}

async function handleThumbnailGet(context, user, project, slug) {
  const { request, env } = context;
  await requireThumbnailPermission(
    env,
    request,
    user,
    project,
    slug,
    "project.view",
    "projects.thumbnail.read",
  );

  const state = await getProjectPreviewState(env, {
    projectId: project.id,
    organizationId: getProjectOrganizationId(project),
  });
  const status = normalizePreviewStatus(state?.preview_status);
  const requestedRevision = requestedImageRevision(request);
  const readyRevision = normalizePreviewRevision(state?.preview_revision);
  const configFileName = project.default_config_file || "config.kepler.json";

  if (
    status === "READY" &&
    requestedRevision !== null &&
    requestedRevision !== readyRevision
  ) {
    return errorResponse(
      "A revisão solicitada não é mais a visualização atual.",
      404,
      "PROJECT_THUMBNAIL_REVISION_NOT_FOUND",
    );
  }

  if (!["READY", "UNKNOWN"].includes(status)) {
    return errorResponse(
      "A visualização real deste projeto ainda não está disponível.",
      404,
      "PROJECT_THUMBNAIL_NOT_READY",
    );
  }

  const previewFileName =
    status === "READY" &&
    readyRevision !== null &&
    readyRevision > 0
      ? getRevisionedPreviewFileNameFromConfigFile(
          configFileName,
          readyRevision,
        )
      : getPreviewFileNameFromConfigFile(configFileName);

  try {
    const dropboxResponse = await downloadDropboxBinaryFile(
      env,
      project.dropbox_root_path,
      previewFileName,
    );
    const body = await dropboxResponse.arrayBuffer();

    if (status === "UNKNOWN") {
      await markProjectPreviewReady(env, {
        projectId: project.id,
        organizationId: getProjectOrganizationId(project),
        revision: Number(state?.config_revision || 0),
        captureMethod: "legacy-reconcile",
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Maono-Thumbnail-Revision": String(
          readyRevision ?? state?.config_revision ?? 0,
        ),
      },
    });
  } catch (error) {
    if (isDropboxNotFound(error)) {
      await markProjectPreviewMissing(env, {
        projectId: project.id,
        organizationId: getProjectOrganizationId(project),
        expectedStatus: status,
      });

      return errorResponse(
        "Preview PNG não encontrado para este projeto.",
        404,
        "PROJECT_THUMBNAIL_NOT_FOUND",
      );
    }

    throw error;
  }
}

async function handleThumbnailPut(context, user, project, slug) {
  const { request, env } = context;
  await requireThumbnailPermission(
    env,
    request,
    user,
    project,
    slug,
    "project.save",
    "projects.thumbnail.request",
  );

  const revision = thumbnailRevisionFromRequest(request);

  if (!revision) {
    return errorResponse(
      "Informe uma revisão positiva para a visualização.",
      400,
      "THUMBNAIL_REVISION_INVALID",
    );
  }

  const state = await getProjectPreviewState(env, {
    projectId: project.id,
    organizationId: getProjectOrganizationId(project),
  });

  if (Number(state?.config_revision) !== revision) {
    return errorResponse(
      "Esta captura pertence a uma revisão anterior do projeto.",
      409,
      "STALE_THUMBNAIL_REVISION",
      {
        revision,
        currentRevision: state?.config_revision ?? null,
      },
    );
  }

  if (
    normalizePreviewStatus(state?.preview_status) === "READY" &&
    Number(state?.preview_revision) === revision
  ) {
    return jsonResponse({
      ok: true,
      status: "READY",
      revision,
      idempotent: true,
    });
  }

  const contentType = String(
    request.headers.get("Content-Type") || "",
  )
    .split(";")[0]
    .trim()
    .toLowerCase();
  const declaredLength = Number(request.headers.get("Content-Length") || 0);

  if (contentType !== "image/png") {
    return errorResponse(
      "A visualização deve ser enviada como image/png.",
      400,
      "INVALID_THUMBNAIL_CONTENT_TYPE",
    );
  }

  if (declaredLength > MAX_THUMBNAIL_BYTES) {
    return errorResponse(
      "A visualização excede o limite de 4 MiB.",
      413,
      "THUMBNAIL_TOO_LARGE",
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());

  if (!bytes.byteLength || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    return errorResponse(
      "A visualização está vazia ou excede o limite de 4 MiB.",
      bytes.byteLength ? 413 : 400,
      bytes.byteLength ? "THUMBNAIL_TOO_LARGE" : "THUMBNAIL_EMPTY",
    );
  }

  if (!isPng(bytes)) {
    return errorResponse(
      "O corpo não contém uma assinatura PNG válida.",
      400,
      "INVALID_THUMBNAIL_SIGNATURE",
    );
  }

  const captureMethod = sanitizeCaptureMethod(
    request.headers.get("X-Maono-Capture-Method"),
  );
  const accepted = await markProjectPreviewAttempt(env, {
    projectId: project.id,
    organizationId: getProjectOrganizationId(project),
    revision,
    captureMethod,
  });

  if (!accepted) {
    return errorResponse(
      "Esta captura pertence a uma revisão anterior do projeto.",
      409,
      "STALE_THUMBNAIL_REVISION",
    );
  }

  await auditThumbnail(
    env,
    request,
    user,
    project,
    "projects.thumbnail.request",
    "accepted",
    {
      revision,
      captureMethod,
      sizeBytes: bytes.byteLength,
    },
  );

  const task = processThumbnailUpload({
    env,
    request,
    user,
    project,
    revision,
    bytes,
    captureMethod,
    previousRevision: state?.preview_revision ?? null,
  });

  if (typeof context.waitUntil === "function") {
    context.waitUntil(task);

    return jsonResponse(
      {
        ok: true,
        status: "PENDING",
        revision,
      },
      {
        status: 202,
        headers: {
          "Retry-After": "2",
        },
      },
    );
  }

  await task;
  const completed = await getProjectPreviewState(env, {
    projectId: project.id,
    organizationId: getProjectOrganizationId(project),
  });

  return jsonResponse({
    ok: true,
    status: normalizePreviewStatus(completed?.preview_status),
    revision,
  });
}

async function handleThumbnailPatch(context, user, project, slug) {
  const { request, env } = context;
  await requireThumbnailPermission(
    env,
    request,
    user,
    project,
    slug,
    "project.save",
    "projects.thumbnail.fail",
  );

  const body = await readJsonBody(request);
  const revision = thumbnailRevisionFromRequest(request, body);

  if (!revision) {
    return errorResponse(
      "Informe uma revisão positiva para registrar a falha.",
      400,
      "THUMBNAIL_REVISION_INVALID",
    );
  }

  const failed = await markProjectPreviewFailed(env, {
    projectId: project.id,
    organizationId: getProjectOrganizationId(project),
    revision,
    errorCode: body?.errorCode || "CLIENT_CAPTURE_FAILED",
    captureMethod:
      body?.captureMethod ||
      request.headers.get("X-Maono-Capture-Method"),
  });

  if (!failed) {
    return errorResponse(
      "Esta captura pertence a uma revisão anterior do projeto.",
      409,
      "STALE_THUMBNAIL_REVISION",
    );
  }

  await auditThumbnail(
    env,
    request,
    user,
    project,
    "projects.thumbnail.complete",
    "error",
    {
      revision,
      errorCode: sanitizePreviewCode(
        body?.errorCode || "CLIENT_CAPTURE_FAILED",
      ),
      captureMethod: sanitizeCaptureMethod(body?.captureMethod),
    },
  );

  return jsonResponse({
    ok: true,
    ...publicProjectPreview(failed),
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (!["GET", "PUT", "PATCH"].includes(request.method)) {
    return methodNotAllowed(["GET", "PUT", "PATCH"]);
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

    if (request.method === "GET") {
      return await handleThumbnailGet(context, user, project, slug);
    }

    if (request.method === "PUT") {
      return await handleThumbnailPut(context, user, project, slug);
    }

    return await handleThumbnailPatch(context, user, project, slug);
  } catch (error) {
    const status = Number(error?.status || 500);
    const code = error?.code || "PROJECT_THUMBNAIL_ERROR";

    if (status === 401) {
      return errorResponse(
        "Sessão inválida ou expirada.",
        401,
        code,
      );
    }

    if (status === 403) {
      return errorResponse(
        "Você não tem permissão para acessar esta visualização.",
        403,
        code,
      );
    }

    if (status === 404 || isDropboxNotFound(error)) {
      return errorResponse(
        "Projeto ou visualização não encontrados.",
        404,
        "PROJECT_THUMBNAIL_NOT_FOUND",
      );
    }

    console.error("[Maono preview] Falha no endpoint de thumbnail:", {
      code: sanitizePreviewCode(code),
      status,
    });

    return errorResponse(
      "Não foi possível processar a visualização deste projeto.",
      status,
      code,
    );
  }
}
