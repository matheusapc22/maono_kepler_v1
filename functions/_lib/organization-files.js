import {
  deleteDropboxPathIfExists,
  downloadDropboxBinaryFile,
  joinDropboxPath,
  normalizeDropboxFolderPath,
  uploadDropboxBinaryFile,
} from "./dropbox.js";
import {
  getDb,
  getTableColumns,
  insertRow,
  jsonResponse,
  sanitizeFileName,
  updateRow,
} from "./organizations.js";
import { recordAuditLog } from "./permissions.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "geojson",
  "json",
  "csv",
  "xlsx",
  "xls",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "zip",
  "txt",
  "docx",
]);

const SAFE_PUBLIC_CODES = new Set([
  "FILE_REQUIRED",
  "EMPTY_FILE",
  "FILE_TOO_LARGE",
  "FILE_TYPE_NOT_ALLOWED",
  "PROJECT_NOT_FOUND",
  "ORGANIZATION_STORAGE_PATH_INVALID",
  "ORGANIZATION_FILE_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
]);

function createFileError(message, status, code, stage, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.stage = stage;
  error.publicMessage = message;
  Object.assign(error, extra);
  return error;
}

function extensionFromName(fileName) {
  const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function inferFileType(extension) {
  if (extension === "geojson") return "geojson";
  if (extension === "json") return "json";
  if (extension === "csv") return "csv";
  if (extension === "xlsx" || extension === "xls") return "spreadsheet";
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (extension === "zip") return "zip";
  if (extension === "docx") return "document";
  if (extension === "txt") return "text";
  return "other";
}

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getRequestId(request) {
  const provided = request?.headers?.get("x-request-id")?.trim();
  return provided || crypto.randomUUID();
}

function getIdempotencyKey(request, formData) {
  const headerValue = request.headers.get("idempotency-key")?.trim();
  const formValue = String(formData.get("idempotencyKey") || "").trim();
  const value = headerValue || formValue;

  if (!value) return null;
  if (value.length > 180) {
    throw createFileError(
      "Chave de idempotência inválida.",
      400,
      "IDEMPOTENCY_KEY_INVALID",
      "file.idempotency",
    );
  }

  return value;
}

export function buildOrganizationDocumentsRoot(organization) {
  const organizationRoot = normalizeDropboxFolderPath(
    organization?.dropbox_root_path,
  );

  if (!organizationRoot || !organizationRoot.startsWith("/projects/")) {
    throw createFileError(
      "A organização não possui uma pasta Dropbox válida.",
      500,
      "ORGANIZATION_STORAGE_PATH_INVALID",
      "organization.storage",
    );
  }

  return `${organizationRoot}/documents`;
}

export function buildStoredFileName(originalName) {
  const safeName = sanitizeFileName(originalName);
  const uniquePart = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${Date.now()}-${uniquePart}-${safeName}`;
}

export function splitDropboxFilePath(path) {
  const normalized = String(path || "").trim().replace(/\/+$/g, "");
  const separator = normalized.lastIndexOf("/");

  if (!normalized.startsWith("/") || separator <= 0 || separator === normalized.length - 1) {
    throw createFileError(
      "Caminho de arquivo Dropbox inválido.",
      500,
      "DROPBOX_FILE_PATH_INVALID",
      "dropbox.path",
    );
  }

  return {
    rootPath: normalized.slice(0, separator),
    fileName: normalized.slice(separator + 1),
  };
}

export async function readOrganizationFileUpload(request) {
  let formData;

  try {
    formData = await request.formData();
  } catch (cause) {
    throw createFileError(
      "Não foi possível interpretar o formulário de upload.",
      400,
      "UPLOAD_FORM_INVALID",
      "file.parse_form",
      { cause },
    );
  }

  const file = formData.get("file") || formData.get("document");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw createFileError(
      "Arquivo não enviado. Use o campo file.",
      400,
      "FILE_REQUIRED",
      "file.validate",
    );
  }

  const originalName = sanitizeFileName(file.name || "documento");
  const extension = extensionFromName(originalName);
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw createFileError(
      "Tipo de arquivo não permitido.",
      415,
      "FILE_TYPE_NOT_ALLOWED",
      "file.validate",
      { extension: extension || null },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength <= 0) {
    throw createFileError(
      "Arquivo vazio.",
      400,
      "EMPTY_FILE",
      "file.validate",
    );
  }

  if (arrayBuffer.byteLength > MAX_FILE_BYTES) {
    throw createFileError(
      "Arquivo excede o limite de 50 MB.",
      413,
      "FILE_TOO_LARGE",
      "file.validate",
    );
  }

  const rawProjectId = String(formData.get("projectId") || "").trim();
  const projectId = rawProjectId ? Number(rawProjectId) : null;
  if (rawProjectId && (!Number.isInteger(projectId) || projectId <= 0)) {
    throw createFileError(
      "Projeto inválido.",
      400,
      "PROJECT_ID_INVALID",
      "project.validate",
    );
  }

  return {
    arrayBuffer,
    originalName,
    mimeType: file.type || "application/octet-stream",
    size: arrayBuffer.byteLength,
    extension,
    fileType: inferFileType(extension),
    sha256: await sha256Hex(arrayBuffer),
    projectId,
    idempotencyKey: getIdempotencyKey(request, formData),
  };
}

export async function validateProjectForOrganization(env, organizationId, projectId) {
  if (!projectId) return null;

  const row = await getDb(env)
    .prepare(
      `SELECT id, organization_id, name, slug
       FROM projects
       WHERE id = ? AND organization_id = ?
         AND (active = 1 OR active IS NULL)
       LIMIT 1`,
    )
    .bind(projectId, organizationId)
    .first();

  if (!row) {
    throw createFileError(
      "Projeto não encontrado nesta organização.",
      404,
      "PROJECT_NOT_FOUND",
      "project.lookup",
    );
  }

  return row;
}

export async function findFileByIdempotencyKey(env, organizationId, idempotencyKey) {
  if (!idempotencyKey) return null;

  const columns = await getTableColumns(env, "organization_files");
  if (!columns.has("idempotency_key")) return null;

  return getDb(env)
    .prepare(
      `SELECT *
       FROM organization_files
       WHERE organization_id = ? AND idempotency_key = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(organizationId, idempotencyKey)
    .first();
}

export function publicOrganizationFile(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id || null,
    name: row.original_name || row.name || row.file_name || "Documento",
    fileName: row.file_name || null,
    fileType: row.file_type || "other",
    mimeType: row.mime_type || row.content_type || null,
    size: row.size_bytes || row.size || null,
    sha256: row.sha256 || null,
    status: row.status || (row.active ? "ACTIVE" : "INACTIVE"),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: row.uploaded_by || row.created_by || row.user_id || null,
  };
}

export async function createPendingFileRecord(env, data) {
  const timestamp = new Date().toISOString();

  return insertRow(env, "organization_files", {
    organization_id: data.organizationId,
    project_id: data.projectId,
    name: data.originalName,
    original_name: data.originalName,
    file_name: data.storedFileName,
    dropbox_path: data.dropboxPath,
    file_type: data.fileType,
    mime_type: data.mimeType,
    content_type: data.mimeType,
    size_bytes: data.size,
    size: data.size,
    sha256: data.sha256,
    status: "PENDING",
    idempotency_key: data.idempotencyKey,
    uploaded_by: data.userId,
    created_by: data.userId,
    user_id: data.userId,
    active: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

export async function markFileActive(env, fileId, metadata = {}) {
  return updateRow(env, "organization_files", fileId, {
    status: "ACTIVE",
    error_message: null,
    dropbox_file_id: metadata.id || null,
    dropbox_rev: metadata.rev || null,
    active: 1,
    updated_at: new Date().toISOString(),
  });
}

export async function markFileFailed(env, fileId, error) {
  if (!fileId) return null;

  return updateRow(env, "organization_files", fileId, {
    status: "FAILED",
    error_message: String(error?.message || "Falha desconhecida").slice(0, 1000),
    active: 0,
    updated_at: new Date().toISOString(),
  });
}

export async function uploadOrganizationBinary(env, rootPath, fileName, arrayBuffer) {
  try {
    return await uploadDropboxBinaryFile(env, rootPath, fileName, arrayBuffer);
  } catch (error) {
    error.status = error.status >= 400 ? error.status : 502;
    error.code = error.code || "DROPBOX_UPLOAD_FAILED";
    error.stage = error.stage || "dropbox.upload";
    error.publicMessage = "Não foi possível enviar o arquivo ao Dropbox.";
    throw error;
  }
}

export async function downloadOrganizationBinary(env, dropboxPath) {
  const { rootPath, fileName } = splitDropboxFilePath(dropboxPath);

  try {
    return await downloadDropboxBinaryFile(env, rootPath, fileName);
  } catch (error) {
    error.status = error.status === 409 ? 404 : error.status >= 400 ? error.status : 502;
    error.code = error.code || "DROPBOX_DOWNLOAD_FAILED";
    error.stage = error.stage || "dropbox.download";
    error.publicMessage = "Não foi possível baixar o arquivo do Dropbox.";
    throw error;
  }
}

export async function deleteOrganizationBinary(env, dropboxPath) {
  try {
    return await deleteDropboxPathIfExists(env, dropboxPath);
  } catch (error) {
    error.status = error.status >= 400 ? error.status : 502;
    error.code = error.code || "DROPBOX_DELETE_FAILED";
    error.stage = error.stage || "dropbox.delete";
    error.publicMessage = "Não foi possível excluir o arquivo do Dropbox.";
    throw error;
  }
}

export async function recordOrganizationFileAudit(env, event) {
  return recordAuditLog(env, {
    actorUserId: event.userId,
    organizationId: event.organizationId,
    projectId: event.projectId || null,
    action: event.action,
    resourceType: "document",
    resourceId: event.fileId || null,
    result: event.result || "success",
    metadata: {
      requestId: event.requestId,
      fileName: event.fileName || null,
      size: event.size || null,
      code: event.code || null,
    },
    request: event.request,
  });
}

export function organizationFileErrorResponse(error, requestId = crypto.randomUUID()) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const code = error?.code || "ORGANIZATION_FILE_ERROR";
  const stage = error?.stage || "organization_file";
  const exposeMessage = safeStatus < 500 || SAFE_PUBLIC_CODES.has(code);
  const message = exposeMessage
    ? error?.publicMessage || error?.message || "Erro na requisição."
    : error?.publicMessage || "Erro interno ao processar a requisição.";

  console.error(`[Maono organization files][${requestId}][${stage}]`, error);

  return jsonResponse(
    {
      ok: false,
      error: message,
      code,
      stage,
      requestId,
    },
    {
      status: safeStatus,
      headers: {
        "X-Request-Id": requestId,
      },
    },
  );
}

export function organizationFileRequestId(request) {
  return getRequestId(request);
}

export function organizationFileDropboxPath(rootPath, storedFileName) {
  return joinDropboxPath(rootPath, storedFileName);
}
