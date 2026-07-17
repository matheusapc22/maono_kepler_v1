import { errorResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../_lib/projects.js";
import {
  recordAuditLog,
  requireProjectPermission,
} from "../../../_lib/permissions.js";
import {
  downloadDropboxBinaryFile,
  getPreviewFileNameFromConfigFile,
} from "../../../_lib/dropbox.js";

const THUMBNAIL_READ_ACTION = "projects.thumbnail.read";
const THUMBNAIL_READ_PERMISSION = "project.view";

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

async function auditThumbnailReadDenied(
  env,
  request,
  user,
  project,
  slug,
  reason,
) {
  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId: getProjectOrganizationId(project),
    projectId: project?.id ?? null,
    action: THUMBNAIL_READ_ACTION,
    resourceType: "project",
    resourceId: getProjectAuditResourceId(project, slug),
    result: "denied",
    metadata: {
      slug: slug || null,
      permission: THUMBNAIL_READ_PERMISSION,
      reason,
    },
    request,
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);
    const slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      await auditThumbnailReadDenied(
        env,
        request,
        user,
        null,
        null,
        "MISSING_PROJECT_SLUG",
      );

      return errorResponse(
        "Slug do projeto não informado.",
        400,
        "PROJECT_SLUG_REQUIRED",
      );
    }

    const project = await getAuthorizedProject(env, user, slug);

    if (!project) {
      await auditThumbnailReadDenied(
        env,
        request,
        user,
        null,
        slug,
        "PROJECT_NOT_FOUND_OR_NOT_AUTHORIZED",
      );

      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    await requireProjectPermission(
      env,
      request,
      THUMBNAIL_READ_PERMISSION,
      getProjectPermissionContext(project, slug),
      {
        user,
        auditAction: THUMBNAIL_READ_ACTION,
        auditOnSuccess: false,
        resourceType: "project",
        resourceId: getProjectAuditResourceId(project, slug),
      },
    );

    const configFileName = project.default_config_file || "config.kepler.json";
    const previewFileName = getPreviewFileNameFromConfigFile(configFileName);

    const dropboxResponse = await downloadDropboxBinaryFile(
      env,
      project.dropbox_root_path,
      previewFileName,
    );

    const body = await dropboxResponse.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const status = error?.status || 500;
    const code = error?.code || "PROJECT_THUMBNAIL_ERROR";
    const errorMessage = String(error?.message || "");
    const isDropboxPathNotFound =
      status === 409 &&
      errorMessage.includes("path/not_found");

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
        "Você não tem permissão para visualizar este projeto.",
        403,
        code,
      );
    }

    if (status === 404 || isDropboxPathNotFound) {
      return errorResponse(
        "Preview PNG não encontrado para este projeto.",
        404,
        "PROJECT_THUMBNAIL_NOT_FOUND",
      );
    }

    return errorResponse(
      "Não foi possível carregar o preview PNG deste projeto.",
      status,
      code,
    );
  }
}
