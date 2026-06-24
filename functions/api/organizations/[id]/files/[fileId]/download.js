import { requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import {
  downloadFromDropbox,
  fileDownloadHeaders,
  findRowByIdAndOrganization,
  getFileDropboxPath,
  getOrganizationOrThrow,
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../_lib/organizations.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "GET") {
    return onRequestGet(context);
  }

  return methodNotAllowed(request.method, ["GET"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const fileId = parsePositiveInteger(getRouteParam(params, "fileId"), "fileId");

    await requireOrganizationPermission(
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

    if (!dropboxPath) {
      return jsonResponse(
        {
          ok: false,
          error: "Arquivo sem caminho de armazenamento.",
        },
        { status: 500 },
      );
    }

    const dropboxResponse = await downloadFromDropbox(env, dropboxPath);

    return new Response(dropboxResponse.body, {
      status: 200,
      headers: fileDownloadHeaders(file, dropboxResponse),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
