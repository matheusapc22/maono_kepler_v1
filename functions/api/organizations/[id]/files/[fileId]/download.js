import { requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import {
  fileDownloadHeaders,
  findRowByIdAndOrganization,
  getFileDropboxPath,
  getOrganizationOrThrow,
  getRouteParam,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../_lib/organizations.js";
import {
  downloadOrganizationBinary,
  organizationFileErrorResponse,
  organizationFileRequestId,
  recordOrganizationFileAudit,
} from "../../../../../_lib/organization-files.js";
import { requireProjectGeoJsonAccess } from "../../../../../_lib/geojson-access.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(context.request.method, ["GET"]);
}

export async function onRequestGet({ env, request, params }) {
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
      "document.download",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document",
        resourceId: fileId,
      },
      {
        auditAction: "document.download",
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
      { surface: "document.download", auditAllowed: true },
    );

    const dropboxPath = getFileDropboxPath(file);
    if (!dropboxPath) {
      const error = new Error("Arquivo sem caminho de armazenamento.");
      error.status = 500;
      error.code = "ORGANIZATION_FILE_PATH_MISSING";
      error.stage = "file.metadata";
      throw error;
    }

    const dropboxResponse = await downloadOrganizationBinary(env, dropboxPath);

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: user.id,
      organizationId,
      projectId: file.project_id || null,
      action: "document.download",
      fileId,
      fileName: file.original_name || file.name || file.file_name,
      size: file.size_bytes || file.size || null,
    });

    return new Response(dropboxResponse.body, {
      status: 200,
      headers: {
        ...fileDownloadHeaders(file, dropboxResponse),
        "X-Request-Id": requestId,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}
