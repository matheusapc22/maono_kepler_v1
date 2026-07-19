import { requireOrganizationPermission } from "../../../../_lib/permissions.js";
import {
  deleteOrSoftDeleteRow,
  findRowByIdAndOrganization,
  getFileDropboxPath,
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  updateRow,
} from "../../../../_lib/organizations.js";
import {
  deleteOrganizationBinary,
  organizationFileErrorResponse,
  organizationFileRequestId,
  recordOrganizationFileAudit,
} from "../../../../_lib/organization-files.js";
import { requireProjectGeoJsonAccess } from "../../../../_lib/geojson-access.js";

export async function onRequest(context) {
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(context.request.method, ["DELETE"]);
}

export async function onRequestDelete({ env, request, params }) {
  const requestId = organizationFileRequestId(request);

  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );
    const fileId = parsePositiveInteger(
      getRouteParam(params, "fileId"),
      "fileId",
    );

    const { user } = await requireOrganizationPermission(
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
        auditAction: "document.delete",
        resourceType: "document",
        resourceId: fileId,
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    const file = await findRowByIdAndOrganization(
      env,
      "organization_files",
      fileId,
      organizationId,
    );

    if (!file) {
      const error = new Error("Arquivo não encontrado.");
      error.status = 404;
      error.code = "ORGANIZATION_FILE_NOT_FOUND";
      error.stage = "file.lookup";
      error.publicMessage = error.message;
      throw error;
    }

    await requireProjectGeoJsonAccess(
      env,
      request,
      user,
      organizationId,
      file,
      { surface: "document.delete", auditAllowed: true },
    );

    const dropboxPath = getFileDropboxPath(file);
    if (dropboxPath) await deleteOrganizationBinary(env, dropboxPath);

    await updateRow(env, "organization_files", fileId, {
      status: "DELETED",
      error_message: null,
      updated_at: new Date().toISOString(),
    });
    await deleteOrSoftDeleteRow(env, "organization_files", fileId);

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: user.id,
      organizationId,
      projectId: file.project_id || null,
      action: "document.delete",
      fileId,
      fileName: file.original_name || file.name || file.file_name,
      size: file.size_bytes || file.size || null,
    });

    return jsonResponse(
      { ok: true, deleted: true, requestId },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}
