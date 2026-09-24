import {
  recordAuditLog,
  requireOrganizationPermission,
} from "../../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../_lib/organizations.js";
import {
  deleteDocumentFolder,
  publicDocumentFolder,
  updateDocumentFolder,
} from "../../../../_lib/organization-file-folders.js";
import {
  organizationFileErrorResponse,
  organizationFileRequestId,
} from "../../../../_lib/organization-files.js";

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
    folderId: parsePositiveInteger(
      getRouteParam(params, "folderId"),
      "folderId",
    ),
  };
}

export async function onRequestPatch({ env, request, params }) {
  const requestId = organizationFileRequestId(request);

  try {
    const { organizationId, folderId } = idsFrom(params);
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "document.manage",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document_folder",
        resourceId: folderId,
      },
      {
        auditAction: "document.folder.update",
        resourceType: "document_folder",
        resourceId: folderId,
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    const payload = await readJsonBody(request);
    const folder = await updateDocumentFolder(
      env,
      organizationId,
      folderId,
      payload,
    );

    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "document.folder.update",
      resourceType: "document_folder",
      resourceId: folderId,
      result: "success",
      metadata: {
        requestId,
        parentId: folder.parent_id ?? null,
      },
      request,
    });

    return jsonResponse(
      {
        ok: true,
        requestId,
        folder: publicDocumentFolder(folder),
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
    const { organizationId, folderId } = idsFrom(params);
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "document.manage",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document_folder",
        resourceId: folderId,
      },
      {
        auditAction: "document.folder.delete",
        resourceType: "document_folder",
        resourceId: folderId,
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await deleteDocumentFolder(env, organizationId, folderId);

    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "document.folder.delete",
      resourceType: "document_folder",
      resourceId: folderId,
      result: "success",
      metadata: { requestId },
      request,
    });

    return jsonResponse(
      { ok: true, deleted: true, requestId },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}
