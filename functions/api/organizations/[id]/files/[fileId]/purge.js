import { requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../../_lib/organizations.js";
import {
  organizationFileErrorResponse,
  organizationFileRequestId,
  publicOrganizationFile,
  recordOrganizationFileAudit,
} from "../../../../../_lib/organization-files.js";
import {
  findOrganizationFileForPurge,
  purgeOrganizationFile,
} from "../../../../../_lib/organization-file-purge.js";
import { requireProjectGeoJsonAccess } from "../../../../../_lib/geojson-access.js";

const MANUAL_PURGE_CONFIRMATION = "EXCLUIR PERMANENTEMENTE";

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(context.request.method, ["POST"]);
}

export async function onRequestPost({ env, request, params }) {
  const requestId = organizationFileRequestId(request);
  let actor = null;
  let organizationId = null;
  let fileId = null;
  let file = null;

  try {
    organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );
    fileId = parsePositiveInteger(
      getRouteParam(params, "fileId"),
      "fileId",
    );

    const managePermission = await requireOrganizationPermission(
      env,
      request,
      "document.manage",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document",
        resourceId: fileId,
      },
      {
        auditAction: "document.purge.manual",
        resourceType: "document",
        resourceId: fileId,
        auditOnSuccess: false,
      },
    );
    actor = managePermission.user;

    await requireOrganizationPermission(
      env,
      request,
      "document.delete",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document",
        resourceId: fileId,
      },
      {
        auditAction: "document.purge.manual",
        resourceType: "document",
        resourceId: fileId,
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);

    const payload = await readJsonBody(request);
    if (String(payload?.confirmation || "").trim() !== MANUAL_PURGE_CONFIRMATION) {
      const error = new Error(
        `Confirmação inválida. Digite "${MANUAL_PURGE_CONFIRMATION}".`,
      );
      error.status = 400;
      error.code = "DOCUMENT_PURGE_CONFIRMATION_REQUIRED";
      error.stage = "document.purge.confirmation";
      error.publicMessage = error.message;
      throw error;
    }

    file = await findOrganizationFileForPurge(env, organizationId, fileId);
    if (!file) {
      const error = new Error("Documento não encontrado na Lixeira.");
      error.status = 404;
      error.code = "ORGANIZATION_FILE_TRASH_NOT_FOUND";
      error.stage = "document.purge.lookup";
      error.publicMessage = error.message;
      throw error;
    }

    await requireProjectGeoJsonAccess(
      env,
      request,
      actor,
      organizationId,
      file,
      { surface: "document.purge.manual", auditAllowed: true },
    );

    const result = await purgeOrganizationFile(env, {
      organizationId,
      fileId,
      requireExpired: false,
    });

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: actor.id,
      organizationId,
      projectId: file.project_id || null,
      action: "document.purge.manual",
      fileId,
      fileName: file.original_name || file.name || file.file_name,
      size: file.size_bytes || file.size || null,
      result: "success",
    });

    return jsonResponse(
      {
        ok: true,
        purged: true,
        idempotent: Boolean(result.idempotent),
        requestId,
        file: publicOrganizationFile(result.file),
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    if (actor && organizationId && fileId) {
      try {
        await recordOrganizationFileAudit(env, {
          request,
          requestId,
          userId: actor.id,
          organizationId,
          projectId: file?.project_id || null,
          action: "document.purge.manual",
          fileId,
          fileName: file?.original_name || file?.name || file?.file_name || null,
          size: file?.size_bytes || file?.size || null,
          result: "failed",
          code: error?.code || "DOCUMENT_PURGE_FAILED",
        });
      } catch (auditError) {
        console.error("[Maono document purge][audit]", auditError);
      }
    }

    return organizationFileErrorResponse(error, requestId);
  }
}

export const __documentPurgeRouteTesting = Object.freeze({
  MANUAL_PURGE_CONFIRMATION,
});
