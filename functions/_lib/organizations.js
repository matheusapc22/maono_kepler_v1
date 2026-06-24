const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const MAX_ORGANIZATION_FILE_BYTES = 50 * 1024 * 1024;

const EXPORT_TYPES = new Set([
  "projects_summary",
  "documents_index",
  "tickets_summary",
]);

const EXPORT_FORMATS = new Set(["csv", "json"]);

const TICKET_PRIORITIES = new Set(["low", "normal", "high"]);
const TICKET_STATUSES = new Set(["open", "in_progress", "resolved", "closed"]);

export function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function methodNotAllowed(method, allowedMethods = []) {
  return jsonResponse(
    {
      ok: false,
      error: `Método ${method} não permitido.`,
      allowedMethods,
    },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", "),
      },
    },
  );
}

export function handleApiError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;

  if (safeStatus >= 500) {
    console.error("[Maono organizations API]", error);
  }

  return jsonResponse(
    {
      ok: false,
      error:
        safeStatus >= 500
          ? "Erro interno ao processar a requisição."
          : error?.message || "Erro na requisição.",
      code: error?.code || undefined,
      reason: error?.reason || undefined,
    },
    { status: safeStatus },
  );
}

export function getDb(env) {
  const db = env.DB || env.D1 || env.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    const error = new Error("Banco de dados D1 não configurado.");
    error.status = 500;
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  return db;
}

export function parsePositiveInteger(value, label = "id") {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`${label} inválido.`);
    error.status = 400;
    error.code = "INVALID_ID";
    throw error;
  }

  return id;
}

export function getRouteParam(params, key) {
  const value = params?.[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export async function readJsonBody(request) {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("JSON inválido.");
    error.status = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

export function normalizeText(value, { required = false, maxLength = 500 } = {}) {
  if (value === null || value === undefined) {
    if (required) {
      const error = new Error("Campo obrigatório ausente.");
      error.status = 400;
      error.code = "REQUIRED_FIELD";
      throw error;
    }

    return "";
  }

  const text = String(value).trim();

  if (required && !text) {
    const error = new Error("Campo obrigatório ausente.");
    error.status = 400;
    error.code = "REQUIRED_FIELD";
    throw error;
  }

  if (text.length > maxLength) {
    const error = new Error(`Campo excede o limite de ${maxLength} caracteres.`);
    error.status = 400;
    error.code = "FIELD_TOO_LONG";
    throw error;
  }

  return text;
}

export function sanitizeFileName(name) {
  const fallback = "documento";
  const rawName = String(name || fallback).trim() || fallback;

  return rawName
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 160) || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

export async function tableExists(env, tableName) {
  const db = getDb(env);
  const row = await db
    .prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1
      `,
    )
    .bind(tableName)
    .first();

  return Boolean(row?.name);
}

export async function requireTable(env, tableName) {
  if (await tableExists(env, tableName)) {
    return true;
  }

  const error = new Error(`Tabela ${tableName} não encontrada. Aplique a migration correspondente antes de usar este endpoint.`);
  error.status = 500;
  error.code = "TABLE_NOT_FOUND";
  throw error;
}

export async function getTableColumns(env, tableName) {
  await requireTable(env, tableName);

  const db = getDb(env);
  const result = await db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();

  return new Set((result?.results || []).map((row) => String(row.name)));
}

function hasColumn(columns, column) {
  return columns.has(column);
}

export async function getOrganizationOrThrow(env, organizationId) {
  await requireTable(env, "organizations");

  const db = getDb(env);
  const organization = await db
    .prepare(
      `
      SELECT *
      FROM organizations
      WHERE id = ?
      LIMIT 1
      `,
    )
    .bind(organizationId)
    .first();

  if (!organization || organization.active === 0 || organization.active === "0") {
    const error = new Error("Organização não encontrada.");
    error.status = 404;
    error.code = "ORGANIZATION_NOT_FOUND";
    throw error;
  }

  return organization;
}

export async function listRowsByOrganization(env, tableName, organizationId) {
  const columns = await getTableColumns(env, tableName);

  if (!hasColumn(columns, "organization_id")) {
    const error = new Error(`Tabela ${tableName} não possui organization_id.`);
    error.status = 500;
    error.code = "INVALID_SCHEMA";
    throw error;
  }

  const where = ["organization_id = ?"];

  if (hasColumn(columns, "deleted_at")) {
    where.push("deleted_at IS NULL");
  }

  if (hasColumn(columns, "active")) {
    where.push("(active = 1 OR active IS NULL)");
  }

  const orderColumn = hasColumn(columns, "updated_at")
    ? "updated_at"
    : hasColumn(columns, "created_at")
      ? "created_at"
      : hasColumn(columns, "id")
        ? "id"
        : null;

  const sql = `
    SELECT *
    FROM ${quoteIdentifier(tableName)}
    WHERE ${where.join(" AND ")}
    ${orderColumn ? `ORDER BY ${quoteIdentifier(orderColumn)} DESC` : ""}
  `;

  const result = await getDb(env).prepare(sql).bind(organizationId).all();

  return result?.results || [];
}

export async function findRowByIdAndOrganization(env, tableName, rowId, organizationId) {
  const columns = await getTableColumns(env, tableName);

  if (!hasColumn(columns, "id") || !hasColumn(columns, "organization_id")) {
    const error = new Error(`Tabela ${tableName} precisa ter id e organization_id.`);
    error.status = 500;
    error.code = "INVALID_SCHEMA";
    throw error;
  }

  const where = ["id = ?", "organization_id = ?"];

  if (hasColumn(columns, "deleted_at")) {
    where.push("deleted_at IS NULL");
  }

  if (hasColumn(columns, "active")) {
    where.push("(active = 1 OR active IS NULL)");
  }

  const row = await getDb(env)
    .prepare(
      `
      SELECT *
      FROM ${quoteIdentifier(tableName)}
      WHERE ${where.join(" AND ")}
      LIMIT 1
      `,
    )
    .bind(rowId, organizationId)
    .first();

  return row || null;
}

export async function insertRow(env, tableName, data) {
  const columns = await getTableColumns(env, tableName);
  const entries = Object.entries(data).filter(
    ([column, value]) => value !== undefined && hasColumn(columns, column),
  );

  if (entries.length === 0) {
    const error = new Error(`Nenhuma coluna compatível para inserir em ${tableName}.`);
    error.status = 500;
    error.code = "INVALID_SCHEMA";
    throw error;
  }

  const columnNames = entries.map(([column]) => quoteIdentifier(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const values = entries.map(([, value]) => value);

  const result = await getDb(env)
    .prepare(
      `
      INSERT INTO ${quoteIdentifier(tableName)} (${columnNames})
      VALUES (${placeholders})
      `,
    )
    .bind(...values)
    .run();

  const lastInsertId = result?.meta?.last_row_id || result?.meta?.last_insert_rowid;

  if (lastInsertId && hasColumn(columns, "id")) {
    const row = await getDb(env)
      .prepare(`SELECT * FROM ${quoteIdentifier(tableName)} WHERE id = ? LIMIT 1`)
      .bind(lastInsertId)
      .first();

    return row || { id: lastInsertId, ...data };
  }

  return { id: lastInsertId || null, ...data };
}

export async function updateRow(env, tableName, rowId, data) {
  const columns = await getTableColumns(env, tableName);
  const entries = Object.entries(data).filter(
    ([column, value]) => value !== undefined && hasColumn(columns, column),
  );

  if (entries.length === 0) {
    return null;
  }

  const assignments = entries
    .map(([column]) => `${quoteIdentifier(column)} = ?`)
    .join(", ");

  await getDb(env)
    .prepare(
      `
      UPDATE ${quoteIdentifier(tableName)}
      SET ${assignments}
      WHERE id = ?
      `,
    )
    .bind(...entries.map(([, value]) => value), rowId)
    .run();

  return getDb(env)
    .prepare(`SELECT * FROM ${quoteIdentifier(tableName)} WHERE id = ? LIMIT 1`)
    .bind(rowId)
    .first();
}

export async function deleteOrSoftDeleteRow(env, tableName, rowId) {
  const columns = await getTableColumns(env, tableName);

  if (hasColumn(columns, "deleted_at")) {
    await updateRow(env, tableName, rowId, {
      deleted_at: nowIso(),
      updated_at: nowIso(),
    });

    return;
  }

  if (hasColumn(columns, "active")) {
    await updateRow(env, tableName, rowId, {
      active: 0,
      updated_at: nowIso(),
    });

    return;
  }

  await getDb(env)
    .prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE id = ?`)
    .bind(rowId)
    .run();
}

export function normalizeOrganizationFile(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name:
      row.name ||
      row.file_name ||
      row.original_name ||
      row.title ||
      "Documento",
    mimeType: row.mime_type || row.content_type || null,
    size: row.size_bytes || row.size || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: row.created_by || row.uploaded_by || row.user_id || null,
  };
}

export function getFileDropboxPath(row) {
  return (
    row.dropbox_path ||
    row.path ||
    row.file_path ||
    row.storage_path ||
    null
  );
}

export function normalizeTicket(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    subject: row.subject || row.title || "Chamado",
    description: row.description || row.body || null,
    status: row.status || "open",
    priority: row.priority || "normal",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: row.created_by || row.user_id || null,
    assignedTo: row.assigned_to || null,
  };
}

export function normalizeExport(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type || row.export_type,
    format: row.format || row.file_format,
    status: row.status || "queued",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    requestedBy: row.requested_by || row.created_by || null,
  };
}

export function validateTicketCreatePayload(payload) {
  const subject = normalizeText(payload.subject || payload.title, {
    required: true,
    maxLength: 160,
  });

  const description = normalizeText(payload.description || payload.body, {
    required: true,
    maxLength: 5000,
  });

  const priority = normalizeText(payload.priority || "normal", {
    required: false,
    maxLength: 20,
  }) || "normal";

  if (!TICKET_PRIORITIES.has(priority)) {
    const error = new Error("Prioridade inválida.");
    error.status = 400;
    error.code = "INVALID_PRIORITY";
    throw error;
  }

  return { subject, description, priority };
}

export function validateTicketPatchPayload(payload) {
  const patch = {};

  if (payload.status !== undefined) {
    const status = normalizeText(payload.status, { required: true, maxLength: 30 });

    if (!TICKET_STATUSES.has(status)) {
      const error = new Error("Status inválido.");
      error.status = 400;
      error.code = "INVALID_STATUS";
      throw error;
    }

    patch.status = status;
  }

  if (payload.priority !== undefined) {
    const priority = normalizeText(payload.priority, { required: true, maxLength: 20 });

    if (!TICKET_PRIORITIES.has(priority)) {
      const error = new Error("Prioridade inválida.");
      error.status = 400;
      error.code = "INVALID_PRIORITY";
      throw error;
    }

    patch.priority = priority;
  }

  if (Object.keys(patch).length === 0) {
    const error = new Error("Nenhuma alteração válida informada.");
    error.status = 400;
    error.code = "EMPTY_PATCH";
    throw error;
  }

  return patch;
}

export function validateExportPayload(payload) {
  const type = normalizeText(payload.type || payload.exportType, {
    required: true,
    maxLength: 80,
  });

  const format = normalizeText(payload.format || "csv", {
    required: true,
    maxLength: 20,
  });

  if (!EXPORT_TYPES.has(type)) {
    const error = new Error("Tipo de exportação inválido.");
    error.status = 400;
    error.code = "INVALID_EXPORT_TYPE";
    throw error;
  }

  if (!EXPORT_FORMATS.has(format)) {
    const error = new Error("Formato de exportação inválido.");
    error.status = 400;
    error.code = "INVALID_EXPORT_FORMAT";
    throw error;
  }

  return { type, format };
}

export async function readUploadedOrganizationFile(request) {
  const formData = await request.formData();
  const file = formData.get("file") || formData.get("document");

  if (!file || typeof file.arrayBuffer !== "function") {
    const error = new Error("Arquivo não enviado. Use o campo file.");
    error.status = 400;
    error.code = "FILE_REQUIRED";
    throw error;
  }

  const arrayBuffer = await file.arrayBuffer();

  if (arrayBuffer.byteLength <= 0) {
    const error = new Error("Arquivo vazio.");
    error.status = 400;
    error.code = "EMPTY_FILE";
    throw error;
  }

  if (arrayBuffer.byteLength > MAX_ORGANIZATION_FILE_BYTES) {
    const error = new Error("Arquivo excede o limite permitido.");
    error.status = 413;
    error.code = "FILE_TOO_LARGE";
    throw error;
  }

  const name = sanitizeFileName(file.name || formData.get("name") || "documento");
  const mimeType = file.type || "application/octet-stream";

  return {
    arrayBuffer,
    name,
    mimeType,
    size: arrayBuffer.byteLength,
  };
}

function getDropboxToken(env) {
  return env.DROPBOX_ACCESS_TOKEN || env.DROPBOX_TOKEN || env.MAONO_DROPBOX_ACCESS_TOKEN || null;
}

function assertDropboxPathSafe(path) {
  const normalized = String(path || "").trim();

  if (!normalized || normalized === "/" || normalized === "\\" || normalized.split("/").filter(Boolean).length < 2) {
    const error = new Error("Caminho Dropbox inseguro.");
    error.status = 400;
    error.code = "UNSAFE_DROPBOX_PATH";
    throw error;
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

async function parseDropboxError(response) {
  const text = await response.text();

  try {
    const data = text ? JSON.parse(text) : null;

    return data?.error_summary || data?.error?.[".tag"] || text || "Erro no Dropbox.";
  } catch {
    return text || "Erro no Dropbox.";
  }
}

export function buildOrganizationDocumentPath(organizationId, fileName) {
  const safeName = sanitizeFileName(fileName);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `/organizations/${organizationId}/documents/${stamp}-${safeName}`;
}

export async function uploadBufferToDropbox(env, path, arrayBuffer) {
  const token = getDropboxToken(env);

  if (!token) {
    const error = new Error("Token Dropbox não configurado.");
    error.status = 500;
    error.code = "DROPBOX_NOT_CONFIGURED";
    throw error;
  }

  const safePath = assertDropboxPathSafe(path);

  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({
        path: safePath,
        mode: "add",
        autorename: false,
        mute: false,
        strict_conflict: false,
      }),
      "Content-Type": "application/octet-stream",
    },
    body: arrayBuffer,
  });

  if (!response.ok) {
    const error = new Error(await parseDropboxError(response));
    error.status = response.status;
    error.code = "DROPBOX_UPLOAD_FAILED";
    throw error;
  }

  return response.json();
}

export async function downloadFromDropbox(env, path) {
  const token = getDropboxToken(env);

  if (!token) {
    const error = new Error("Token Dropbox não configurado.");
    error.status = 500;
    error.code = "DROPBOX_NOT_CONFIGURED";
    throw error;
  }

  const safePath = assertDropboxPathSafe(path);

  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({
        path: safePath,
      }),
    },
  });

  if (!response.ok) {
    const error = new Error(await parseDropboxError(response));
    error.status = response.status;
    error.code = "DROPBOX_DOWNLOAD_FAILED";
    throw error;
  }

  return response;
}

export async function deleteFromDropbox(env, path) {
  const token = getDropboxToken(env);

  if (!token) {
    const error = new Error("Token Dropbox não configurado.");
    error.status = 500;
    error.code = "DROPBOX_NOT_CONFIGURED";
    throw error;
  }

  const safePath = assertDropboxPathSafe(path);

  const response = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: safePath,
    }),
  });

  if (!response.ok) {
    const error = new Error(await parseDropboxError(response));
    error.status = response.status;
    error.code = "DROPBOX_DELETE_FAILED";
    throw error;
  }

  return response.json();
}

export function fileDownloadHeaders(fileRow, dropboxResponse) {
  const name = sanitizeFileName(
    fileRow.name ||
      fileRow.file_name ||
      fileRow.original_name ||
      "documento",
  );

  return {
    "Content-Type":
      fileRow.mime_type ||
      fileRow.content_type ||
      dropboxResponse.headers.get("Content-Type") ||
      "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, no-store",
  };
}

export function now() {
  return nowIso();
}
