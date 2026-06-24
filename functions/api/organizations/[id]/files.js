import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  buildOrganizationDocumentPath,
  getOrganizationOrThrow,
  handleApiError,
  insertRow,
  jsonResponse,
  listRowsByOrganization,
  methodNotAllowed,
  normalizeOrganizationFile,
  now,
  parsePositiveInteger,
  readUploadedOrganizationFile,
  uploadBufferToDropbox,
  getRouteParam,
} from "../../../_lib/organizations.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "GET") {
    return onRequestGet(context);
  }

  if (request.method === "POST") {
    return onRequestPost(context);
  }

  return methodNotAllowed(request.method, ["GET", "POST"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");

    await requireOrganizationPermission(
      env,
      request,
      "document.view",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document",
      },
      {
        audit: false,
        resourceType: "document",
      },
    );

    await getOrganizationOrThrow(env, organizationId);

    const rows = await listRowsByOrganization(env, "organization_files", organizationId);

    return jsonResponse({
      ok: true,
      files: rows.map(normalizeOrganizationFile),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");

    const { user } = await requireOrganizationPermission(
      env,
      request,
      "document.upload",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document",
      },
      {
        auditAction: "document.upload",
        resourceType: "document",
        resourceId: organizationId,
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);

    const uploadedFile = await readUploadedOrganizationFile(request);
    const dropboxPath = buildOrganizationDocumentPath(organizationId, uploadedFile.name);

    await uploadBufferToDropbox(env, dropboxPath, uploadedFile.arrayBuffer);

    const row = await insertRow(env, "organization_files", {
      organization_id: organizationId,
      name: uploadedFile.name,
      file_name: uploadedFile.name,
      original_name: uploadedFile.name,
      mime_type: uploadedFile.mimeType,
      content_type: uploadedFile.mimeType,
      size: uploadedFile.size,
      size_bytes: uploadedFile.size,
      dropbox_path: dropboxPath,
      path: dropboxPath,
      file_path: dropboxPath,
      storage_path: dropboxPath,
      uploaded_by: user.id,
      created_by: user.id,
      user_id: user.id,
      created_at: now(),
      updated_at: now(),
      active: 1,
    });

    return jsonResponse(
      {
        ok: true,
        file: normalizeOrganizationFile(row),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
