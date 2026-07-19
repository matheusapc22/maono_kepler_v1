import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  listRowsByOrganization,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../_lib/organizations.js";
import {
  buildStoredFileName,
  createPendingFileRecord,
  deleteOrganizationBinary,
  findFileByIdempotencyKey,
  markFileActive,
  markFileFailed,
  organizationFileDropboxPath,
  organizationFileErrorResponse,
  organizationFileRequestId,
  publicOrganizationFile,
  readOrganizationFileUpload,
  recordOrganizationFileAudit,
  uploadOrganizationBinary,
  validateProjectForOrganization,
} from "../../../_lib/organization-files.js";
import {
  ensureOrganizationStorage,
  publicOrganizationStorage,
} from "../../../_lib/organization-storage.js";
import { filterVisibleOrganizationFiles } from "../../../_lib/geojson-access.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "GET") return onRequestGet(context);
  if (request.method === "POST") return onRequestPost(context);

  return methodNotAllowed(request.method, ["GET", "POST"]);
}

export async function onRequestGet({ env, request, params }) {
  const requestId = organizationFileRequestId(request);

  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );

    const { user } = await requireOrganizationPermission(
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

    const organization = await getOrganizationOrThrow(env, organizationId);

    // Autorreparo: toda organização ativa acessada por esta área precisa ter
    // uma raiz canônica e a subpasta /documents fisicamente disponíveis.
    const storage = await ensureOrganizationStorage(env, organization);

    const rows = await listRowsByOrganization(
      env,
      "organization_files",
      organizationId,
    );
    const visibleRows = await filterVisibleOrganizationFiles(
      env,
      request,
      user,
      organizationId,
      rows,
    );

    return jsonResponse(
      {
        ok: true,
        requestId,
        storage: publicOrganizationStorage(storage),
        files: visibleRows.map(publicOrganizationFile),
      },
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
  let pendingFile = null;
  let uploadedPath = null;
  let uploadedToDropbox = false;
  let actor = null;
  let organizationId = null;
  let upload = null;

  try {
    organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );

    const permission = await requireOrganizationPermission(
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
    actor = permission.user;

    const organization = await getOrganizationOrThrow(env, organizationId);

    // O provisionamento ocorre antes de interpretar e persistir o arquivo.
    // Se a organização for legada, o caminho é corrigido no D1 e criado no Dropbox.
    const storage = await ensureOrganizationStorage(env, organization);

    upload = await readOrganizationFileUpload(request);
    await validateProjectForOrganization(env, organizationId, upload.projectId);

    const previous = await findFileByIdempotencyKey(
      env,
      organizationId,
      upload.idempotencyKey,
    );

    if (previous) {
      const previousStatus = String(
        previous.status || (previous.active ? "ACTIVE" : "INACTIVE"),
      ).toUpperCase();

      if (previousStatus === "ACTIVE" && previous.active !== 0) {
        return jsonResponse(
          {
            ok: true,
            idempotent: true,
            requestId,
            storage: publicOrganizationStorage(storage),
            file: publicOrganizationFile(previous),
          },
          {
            status: 200,
            headers: { "X-Request-Id": requestId },
          },
        );
      }

      const conflict = new Error(
        previousStatus === "PENDING"
          ? "Já existe um upload em processamento para esta requisição."
          : "Esta chave de idempotência já foi utilizada. Gere uma nova chave para repetir o envio.",
      );
      conflict.status = 409;
      conflict.code = "IDEMPOTENCY_CONFLICT";
      conflict.stage = "file.idempotency";
      conflict.publicMessage = conflict.message;
      throw conflict;
    }

    const documentsRoot = storage.documentsRoot;
    const storedFileName = buildStoredFileName(upload.originalName);
    uploadedPath = organizationFileDropboxPath(documentsRoot, storedFileName);

    pendingFile = await createPendingFileRecord(env, {
      organizationId,
      projectId: upload.projectId,
      originalName: upload.originalName,
      storedFileName,
      dropboxPath: uploadedPath,
      fileType: upload.fileType,
      mimeType: upload.mimeType,
      size: upload.size,
      sha256: upload.sha256,
      idempotencyKey: upload.idempotencyKey,
      userId: actor.id,
    });

    const dropboxMetadata = await uploadOrganizationBinary(
      env,
      documentsRoot,
      storedFileName,
      upload.arrayBuffer,
    );
    uploadedToDropbox = true;

    const activeFile = await markFileActive(
      env,
      pendingFile.id,
      dropboxMetadata,
    );

    await recordOrganizationFileAudit(env, {
      request,
      requestId,
      userId: actor.id,
      organizationId,
      projectId: upload.projectId,
      action: "document.upload",
      fileId: activeFile?.id || pendingFile.id,
      fileName: upload.originalName,
      size: upload.size,
    });

    return jsonResponse(
      {
        ok: true,
        requestId,
        storage: publicOrganizationStorage(storage),
        file: publicOrganizationFile(activeFile || pendingFile),
      },
      {
        status: 201,
        headers: { "X-Request-Id": requestId },
      },
    );
  } catch (error) {
    if (pendingFile?.id) {
      try {
        await markFileFailed(env, pendingFile.id, error);
      } catch (metadataError) {
        console.error(
          `[Maono organization files][${requestId}][database.mark_failed]`,
          metadataError,
        );
      }
    }

    if (uploadedToDropbox && uploadedPath) {
      try {
        await deleteOrganizationBinary(env, uploadedPath);
      } catch (cleanupError) {
        console.error(
          `[Maono organization files][${requestId}][dropbox.compensation]`,
          cleanupError,
        );
      }
    }

    if (actor && organizationId) {
      try {
        await recordOrganizationFileAudit(env, {
          request,
          requestId,
          userId: actor.id,
          organizationId,
          projectId: upload?.projectId || null,
          action: "document.upload",
          fileId: pendingFile?.id || null,
          fileName: upload?.originalName || null,
          size: upload?.size || null,
          result: "failed",
          code: error?.code || "ORGANIZATION_FILE_UPLOAD_FAILED",
        });
      } catch (auditError) {
        console.error(
          `[Maono organization files][${requestId}][audit]`,
          auditError,
        );
      }
    }

    return organizationFileErrorResponse(error, requestId);
  }
}
