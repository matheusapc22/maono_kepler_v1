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
  readJsonBody,
  updateRow,
} from "../../../../_lib/organizations.js";
import {
  deleteOrganizationBinary,
  organizationFileErrorResponse,
  organizationFileRequestId,
  publicOrganizationFile,
  recordOrganizationFileAudit,
} from "../../../../_lib/organization-files.js";
import {
  moveOrganizationFileToFolder,
} from "../../../../_lib/organization-file-folders.js";
import { requireProjectGeoJsonAccess } from "../../../../_lib/geojson-access.js";
import {
  requireOrganizationStorageReady,
} from "../../../../_lib/organization-storage-readiness.js";

export async function onRequest(context) {
  if (context.request.method === "PATCH") return onRequestPatch(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(context.request.method, ["PATCH", "DELETE"]);
}

function idsFrom(params) {
  return {
    organizationId: parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    ),
    fileId: parsePositiveInteger(
      getRouteParam(params, "fileId"),
      "fileId",
    ),
  };
}

function fileNotFound() {
  const error = new Error("Arquivo não encontrado.");
  error.status = 404;
  error.code = "ORGANIZATION_FILE_NOT_FOUND";
  error.stage = "file.lookup";
  error.publicMessage = error.message;
  return error;
}

export async function onRequestPatch({ env, request, params }) {
  const requestId = organizationFileRequestId(request);

  try {
    const { organizationId, fileId } = idsFrom(params);
    const { user } = await requireOrganizationPermission(
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
        auditAction: "document.folder.move",
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
    if (!file) throw fileNotFound();

    await requireProjectGeoJsonAccess(
      env,
      request,
      user,
      organizationId,
      file,
      { surface: "document.folder.move", auditAllowed: true },
    );

    const payload = await readJsonBody(request);
    if (!Object.prototype.hasOwnProperty.call(payload, "folderId")) {
      const error = new Error("Informe folderId; use null para mover à raiz.");
      error.status = 400;
      error.code = "DOCUMENT_FOLDER_ID_REQUIRED";
      error.stage = "document.folder.move";
      error.publicMessage = error.message;
      throw error;
    }

    const moved = await moveOrganizationFileToFolder(
      env,
      organizationId,
      fileId,
      payload.folderId,
    );

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: user.id,
      organizationId,
      projectId: file.project_id || null,
      action: "document.folder.move",
      fileId,
      fileName: file.original_name || file.name || file.file_name,
      size: file.size_bytes || file.size || null,
    });

    return jsonResponse(
      {
        ok: true,
        requestId,
        file: publicOrganizationFile(moved),
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}

export async function onRequestDelete({ env, request, params }) {
  const requestId = organizationFileRequestId(request);

  try {
    const { organizationId, fileId } = idsFrom(params);

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

    const organization = await getOrganizationOrThrow(env, organizationId);
    const file = await findRowByIdAndOrganization(
      env,
      "organization_files",
      fileId,
      organizationId,
    );

    if (!file) throw fileNotFound();

    await requireProjectGeoJsonAccess(
      env,
      request,
      user,
      organizationId,
      file,
      { surface: "document.delete", auditAllowed: true },
    );

    const dropboxPath = getFileDropboxPath(file);
    if (dropboxPath) {
      requireOrganizationStorageReady(organization, {
        operation: "document.delete.readiness",
      });
      await deleteOrganizationBinary(env, dropboxPath);
    }

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
