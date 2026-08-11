const LOCAL_APP_ENV = "local";
const LOCAL_STORAGE_DRIVER = "local-d1";

function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    const error = new Error(
      "Banco D1 não configurado para armazenamento local.",
    );
    error.status = 500;
    error.code = "LOCAL_STORAGE_DATABASE_NOT_CONFIGURED";
    throw error;
  }

  return db;
}

function normalizePath(value) {
  const cleanPath = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/+$/g, "");

  if (!cleanPath || cleanPath === "/") return "";
  return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
}

function normalizeFileName(value) {
  const fileName = String(value || "").trim().replace(/^\/+/, "");
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..")
  ) {
    const error = new Error("Nome de arquivo local inválido.");
    error.status = 400;
    error.code = "LOCAL_STORAGE_FILE_NAME_INVALID";
    throw error;
  }
  return fileName;
}

function joinPath(rootPath, fileName) {
  return `${normalizePath(rootPath)}/${normalizeFileName(fileName)}`;
}

function pathName(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "";
}

function notFoundError(path) {
  const error = new Error(`path/not_found: ${path}`);
  error.status = 409;
  error.code = "DROPBOX_PATH_NOT_FOUND";
  return error;
}

function conflictError(path) {
  const error = new Error(`path/conflict/file: ${path}`);
  error.status = 409;
  error.code = "LOCAL_STORAGE_PATH_CONFLICT";
  return error;
}

async function contentToBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  if (typeof Blob !== "undefined" && content instanceof Blob) {
    return new Uint8Array(await content.arrayBuffer());
  }
  return new TextEncoder().encode(String(content ?? ""));
}

function storedContentToBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  if (Array.isArray(content)) return Uint8Array.from(content);
  return new TextEncoder().encode(String(content ?? ""));
}

function createFileMetadata(row) {
  const path = normalizePath(row.path);
  const updatedAt = row.updated_at || new Date().toISOString();
  const size = Number(row.size_bytes || 0);
  const revisionTime = Number.isFinite(Date.parse(updatedAt))
    ? Date.parse(updatedAt)
    : Date.now();

  return {
    ".tag": "file",
    id: `id:local:${path.toLowerCase()}`,
    name: pathName(path),
    path_lower: path.toLowerCase(),
    path_display: path,
    client_modified: updatedAt,
    server_modified: updatedAt,
    rev: `local-${revisionTime}-${size}`,
    size,
    content_type: row.content_type || "application/octet-stream",
  };
}

function createFolderMetadata(path) {
  const normalizedPath = normalizePath(path);
  return {
    ".tag": "folder",
    id: `id:local-folder:${normalizedPath.toLowerCase()}`,
    name: pathName(normalizedPath),
    path_lower: normalizedPath.toLowerCase(),
    path_display: normalizedPath,
  };
}

function inferContentType(fileName, explicitContentType = "") {
  const explicit = String(explicitContentType || "").trim();
  if (explicit && explicit.toLowerCase() !== "application/octet-stream") {
    return explicit;
  }
  const normalizedName = String(fileName || "").trim().toLowerCase();
  if (normalizedName.endsWith(".json") || normalizedName.endsWith(".geojson")) {
    return "application/json; charset=utf-8";
  }
  if (normalizedName.endsWith(".png")) return "image/png";
  if (normalizedName.endsWith(".jpg") || normalizedName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalizedName.endsWith(".webp")) return "image/webp";
  if (normalizedName.endsWith(".svg")) return "image/svg+xml";
  if (normalizedName.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (normalizedName.endsWith(".txt")) return "text/plain; charset=utf-8";
  return explicit || "application/octet-stream";
}

export function isLocalStorageMode(env) {
  const appEnv = String(env?.APP_ENV || "").trim().toLowerCase();
  const driver = String(env?.STORAGE_DRIVER || "").trim().toLowerCase();
  return appEnv === LOCAL_APP_ENV && driver === LOCAL_STORAGE_DRIVER;
}

export async function ensureLocalStorageFolder(env, path) {
  getDb(env);
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return null;
  return createFolderMetadata(normalizedPath);
}

export async function uploadLocalStorageFile(
  env,
  rootPath,
  fileName,
  content,
  contentType = "",
  { writeMode = "overwrite" } = {},
) {
  const db = getDb(env);
  const path = joinPath(rootPath, fileName);
  const bytes = await contentToBytes(content);
  const resolvedContentType = inferContentType(fileName, contentType);
  const blob = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );

  if (writeMode === "create") {
    try {
      await db
        .prepare(
          `INSERT INTO local_storage_objects (
             path, content, content_type, size_bytes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(path, blob, resolvedContentType, bytes.byteLength)
        .run();
    } catch (error) {
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(error?.message || ""))) {
        throw conflictError(path);
      }
      throw error;
    }
  } else if (writeMode === "overwrite") {
    await db
      .prepare(
        `INSERT INTO local_storage_objects (
           path, content, content_type, size_bytes, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(path)
         DO UPDATE SET
           content = excluded.content,
           content_type = excluded.content_type,
           size_bytes = excluded.size_bytes,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(path, blob, resolvedContentType, bytes.byteLength)
      .run();
  } else {
    const error = new Error("Modo de escrita local inválido.");
    error.status = 400;
    error.code = "LOCAL_STORAGE_WRITE_MODE_INVALID";
    throw error;
  }

  const row = await db
    .prepare(
      `SELECT path, content_type, size_bytes, created_at, updated_at
         FROM local_storage_objects
        WHERE path = ?
        LIMIT 1`,
    )
    .bind(path)
    .first();

  return createFileMetadata(row);
}

export async function downloadLocalStorageFile(env, rootPath, fileName) {
  const db = getDb(env);
  const path = joinPath(rootPath, fileName);
  const row = await db
    .prepare(
      `SELECT path, content, content_type, size_bytes, created_at, updated_at
         FROM local_storage_objects
        WHERE path = ?
        LIMIT 1`,
    )
    .bind(path)
    .first();
  if (!row) throw notFoundError(path);
  return new Response(storedContentToBytes(row.content), {
    status: 200,
    headers: {
      "Content-Type": row.content_type || "application/octet-stream",
      "Content-Length": String(row.size_bytes || 0),
      "Cache-Control": "no-store",
    },
  });
}

export async function getLocalStorageMetadata(env, rootPath, fileName) {
  const db = getDb(env);
  const path = joinPath(rootPath, fileName);
  const row = await db
    .prepare(
      `SELECT path, content_type, size_bytes, created_at, updated_at
         FROM local_storage_objects
        WHERE path = ?
        LIMIT 1`,
    )
    .bind(path)
    .first();
  if (!row) throw notFoundError(path);
  return createFileMetadata(row);
}

export async function listLocalStorageFolder(env, path = "") {
  const db = getDb(env);
  const rootPath = normalizePath(path);
  const prefix = rootPath ? `${rootPath}/` : "/";
  const result = await db
    .prepare(
      `SELECT path, content_type, size_bytes, created_at, updated_at
         FROM local_storage_objects
        WHERE path LIKE ?
        ORDER BY path`,
    )
    .bind(`${prefix}%`)
    .all();

  const entries = [];
  const folders = new Set();
  for (const row of result?.results || []) {
    const relativePath = String(row.path).slice(prefix.length);
    if (!relativePath) continue;
    const separatorIndex = relativePath.indexOf("/");
    if (separatorIndex >= 0) {
      const folderName = relativePath.slice(0, separatorIndex);
      const folderPath = rootPath ? `${rootPath}/${folderName}` : `/${folderName}`;
      if (!folders.has(folderPath)) {
        folders.add(folderPath);
        entries.push(createFolderMetadata(folderPath));
      }
      continue;
    }
    entries.push(createFileMetadata(row));
  }
  entries.sort((left, right) =>
    String(left.path_display).localeCompare(String(right.path_display)),
  );
  return { entries, cursor: null, has_more: false };
}

export async function deleteLocalStoragePath(env, path) {
  const db = getDb(env);
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    const error = new Error("Não é permitido excluir a raiz do armazenamento local.");
    error.status = 400;
    error.code = "LOCAL_STORAGE_ROOT_DELETE_BLOCKED";
    throw error;
  }

  const existing = await db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM local_storage_objects
        WHERE path = ? OR path LIKE ?`,
    )
    .bind(normalizedPath, `${normalizedPath}/%`)
    .first();
  if (Number(existing?.total || 0) === 0) throw notFoundError(normalizedPath);

  await db
    .prepare(
      `DELETE FROM local_storage_objects
        WHERE path = ? OR path LIKE ?`,
    )
    .bind(normalizedPath, `${normalizedPath}/%`)
    .run();

  return {
    metadata: {
      ".tag": "deleted",
      name: pathName(normalizedPath),
      path_lower: normalizedPath.toLowerCase(),
      path_display: normalizedPath,
    },
  };
}
