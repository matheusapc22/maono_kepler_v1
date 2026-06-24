import { requireOrganizationPermission } from "../../../../_lib/permissions.js";
import {
  deleteFromDropbox,
  deleteOrSoftDeleteRow,
  findRowByIdAndOrganization,
  getFileDropboxPath,
  getOrganizationOrThrow,
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../_lib/organizations.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "DELETE") {
    return onRequestDelete(context);
  }

  return methodNotAllowed(request.method, ["DELETE"]);
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const fileId = parsePositiveInteger(getRouteParam(params, "fileId"), "fileId");

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
        auditAction: "document.delete",
        resourceType: "document",
        resourceId: fileId,
        auditOnSuccess: true,
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
      return jsonResponse(
        {
          ok: false,
          error: "Arquivo não encontrado.",
        },
        { status: 404 },
      );
    }

    const dropboxPath = getFileDropboxPath(file);

    if (dropboxPath) {
      await deleteFromDropbox(env, dropboxPath);
    }

    await deleteOrSoftDeleteRow(env, "organization_files", fileId);

    return jsonResponse({
      ok: true,
      deleted: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
