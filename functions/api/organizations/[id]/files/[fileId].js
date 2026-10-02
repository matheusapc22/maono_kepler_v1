import { requireOrganizationPermission } from "../../../../_lib/permissions.js";
import {
  findRowByIdAndOrganization,
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../_lib/organizations.js";
import {
  organizationFileErrorResponse,
  organizationFileRequestId,
  publicOrganizationFile,
  recordOrganizationFileAudit,
} from "../../../../_lib/organization-files.js";
import {
  moveOrganizationFileToFolder,
} from "../../../../_lib/organization-file-folders.js";
import { trashOrganizationFile } from "../../../../_lib/organization-file-trash.js";
import { renameOrganizationFile } from "../../../../_lib/organization-file-rename.js";
import { requireProjectGeoJsonAccess } from "../../../../_lib/geojson-access.js";

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
    const payload = await readJsonBody(request);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      const error = new Error("Informe um objeto com name ou folderId.");
      error.status = 400;
      error.code = "DOCUMENT_FILE_PATCH_INVALID";
      throw error;
    }
    const isRename = Object.prototype.hasOwnProperty.call(payload, "name");
    const isMove = Object.prototype.hasOwnProperty.call(payload, "folderId");
    const action = isRename ? "document.rename" : "document.folder.move";
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
        auditAction: action,
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
      { surface: action, auditAllowed: true },
    );

    if (isRename && isMove) {
      const error = new Error("Renomeie ou mova o arquivo em operações separadas.");
      error.status = 400;
      error.code = "DOCUMENT_FILE_PATCH_AMBIGUOUS";
      error.stage = "document.update";
      throw error;
    }
    if (!isRename && !isMove) {
      const error = new Error("Informe name para renomear ou folderId para mover; use null para mover à raiz.");
      error.status = 400;
      error.code = "DOCUMENT_FOLDER_ID_REQUIRED";
      error.stage = "document.folder.move";
      error.publicMessage = error.message;
      throw error;
    }

    const updated = isRename
      ? await renameOrganizationFile(env, organizationId, fileId, payload.name)
      : await moveOrganizationFileToFolder(env, organizationId, fileId, payload.folderId);

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: user.id,
      organizationId,
      projectId: file.project_id || null,
      action,
      fileId,
      fileName: updated.original_name || updated.name || updated.file_name,
      size: file.size_bytes || file.size || null,
    });

    return jsonResponse(
      {
        ok: true,
        requestId,
        file: publicOrganizationFile(updated),
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
      { surface: "document.delete", auditAllowed: true },
    );

    const trashed = await trashOrganizationFile(env, {
      organizationId,
      fileId,
      userId: user.id,
    });

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: user.id,
      organizationId,
      projectId: file.project_id || null,
      action: "document.trash",
      fileId,
      fileName: file.original_name || file.name || file.file_name,
      size: file.size_bytes || file.size || null,
    });

    return jsonResponse(
      {
        ok: true,
        deleted: true,
        trashed: true,
        requestId,
        file: publicOrganizationFile(trashed),
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}
