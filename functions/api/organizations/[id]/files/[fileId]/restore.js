import { requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../_lib/organizations.js";
import {
  organizationFileErrorResponse,
  organizationFileRequestId,
  publicOrganizationFile,
  recordOrganizationFileAudit,
} from "../../../../../_lib/organization-files.js";
import {
  findTrashedOrganizationFile,
  restoreOrganizationFile,
} from "../../../../../_lib/organization-file-trash.js";
import { requireProjectGeoJsonAccess } from "../../../../../_lib/geojson-access.js";

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(context.request.method, ["POST"]);
}

export async function onRequestPost({ env, request, params }) {
  const requestId = organizationFileRequestId(request);
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const fileId = parsePositiveInteger(getRouteParam(params, "fileId"), "fileId");
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "document.delete",
      { organizationId, scopeType: "organization", resourceType: "document", resourceId: fileId },
      { auditAction: "document.restore", resourceType: "document", resourceId: fileId, auditOnSuccess: false },
    );

    await getOrganizationOrThrow(env, organizationId);
    const file = await findTrashedOrganizationFile(env, organizationId, fileId);
    if (!file) {
      const error = new Error("Documento não encontrado na Lixeira.");
      error.status = 404;
      error.code = "ORGANIZATION_FILE_TRASH_NOT_FOUND";
      error.stage = "document.restore.lookup";
      error.publicMessage = error.message;
      throw error;
    }

    await requireProjectGeoJsonAccess(
      env,
      request,
      user,
      organizationId,
      file,
      { surface: "document.restore", auditAllowed: true },
    );

    const restored = await restoreOrganizationFile(env, { organizationId, fileId });

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: user.id,
      organizationId,
      projectId: file.project_id || null,
      action: "document.restore",
      fileId,
      fileName: file.original_name || file.name || file.file_name,
      size: file.size_bytes || file.size || null,
    });

    return jsonResponse(
      {
        ok: true,
        restored: true,
        requestId,
        restoredToRoot: restored.restoredToRoot,
        originalFolderMissing: restored.originalFolderMissing,
        file: publicOrganizationFile(restored.file),
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}
