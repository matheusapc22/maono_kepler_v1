import {
  recordAuditLog,
  requireOrganizationPermission,
} from "../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../_lib/organizations.js";
import {
  createDocumentFolder,
  listDocumentFolders,
  publicDocumentFolder,
} from "../../../_lib/organization-file-folders.js";
import {
  organizationFileErrorResponse,
  organizationFileRequestId,
} from "../../../_lib/organization-files.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}

function organizationIdFrom(params) {
  return parsePositiveInteger(
    getRouteParam(params, "id"),
    "organizationId",
  );
}

export async function onRequestGet({ env, request, params }) {
  const requestId = organizationFileRequestId(request);

  try {
    const organizationId = organizationIdFrom(params);

    await requireOrganizationPermission(
      env,
      request,
      "document.view",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document_folder",
      },
      { audit: false, resourceType: "document_folder" },
    );

    await getOrganizationOrThrow(env, organizationId);
    const folders = await listDocumentFolders(env, organizationId);

    return jsonResponse(
      { ok: true, requestId, folders },
      {
        headers: {
          "X-Request-Id": requestId,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}

export async function onRequestPost({ env, request, params }) {
  const requestId = organizationFileRequestId(request);

  try {
    const organizationId = organizationIdFrom(params);
    const { user } = await requireOrganizationPermission(
      env,
      request,
      "document.manage",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "document_folder",
      },
      {
        auditAction: "document.folder.create",
        resourceType: "document_folder",
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    const payload = await readJsonBody(request);
    const folder = await createDocumentFolder(env, {
      organizationId,
      parentId: Object.prototype.hasOwnProperty.call(payload, "parentId")
        ? payload.parentId
        : null,
      name: payload.name,
      userId: user.id,
    });

    await recordAuditLog(env, {
      actorUserId: user.id,
      organizationId,
      action: "document.folder.create",
      resourceType: "document_folder",
      resourceId: folder.id,
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
      {
        status: 201,
        headers: { "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    return organizationFileErrorResponse(error, requestId);
  }
}
