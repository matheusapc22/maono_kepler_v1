import { getDropboxClient } from "./dropbox-client.js";
import {
  deleteLocalStoragePath,
  downloadLocalStorageFile,
  ensureLocalStorageFolder,
  getLocalStorageMetadata,
  isLocalStorageMode,
  listLocalStorageFolder,
  uploadLocalStorageFile,
} from "./local-storage.js";

const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
const DROPBOX_UPLOAD_SESSION_START_URL =
  "https://content.dropboxapi.com/2/files/upload_session/start";
const DROPBOX_UPLOAD_SESSION_APPEND_URL =
  "https://content.dropboxapi.com/2/files/upload_session/append_v2";
const DROPBOX_UPLOAD_SESSION_FINISH_URL =
  "https://content.dropboxapi.com/2/files/upload_session/finish";
const DROPBOX_LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder";
const DROPBOX_LIST_FOLDER_CONTINUE_URL =
  "https://api.dropboxapi.com/2/files/list_folder/continue";
const DROPBOX_CREATE_FOLDER_URL =
  "https://api.dropboxapi.com/2/files/create_folder_v2";
const DROPBOX_DELETE_URL = "https://api.dropboxapi.com/2/files/delete_v2";
const DROPBOX_METADATA_URL = "https://api.dropboxapi.com/2/files/get_metadata";
const DROPBOX_UPLOAD_CONTENT_TYPE = "application/octet-stream";

const DROPBOX_METADATA_TIMEOUT_MS = 5_000;
const DROPBOX_CONTENT_TIMEOUT_MS = 8_000;
const DROPBOX_SESSION_TIMEOUT_MS = 8_000;

export function normalizeDropboxFolderPath(path) {
  const cleanPath = String(path || "").trim().replace(/\/+$/g, "");

  if (!cleanPath || cleanPath === "/") {
    return "";
  }

  return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
}

export function normalizeDropboxPath(path) {
  const cleanPath = String(path || "").trim().replace(/\/+$/g, "");

  if (!cleanPath || cleanPath === "/") {
    return "";
  }

  return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
}

export function normalizeDropboxFileName(fileName) {
  const cleanFileName = String(fileName || "").trim().replace(/^\/+/, "");

  if (!cleanFileName) {
    const error = new Error("Nome de arquivo Dropbox obrigatório.");
    error.status = 400;
    error.code = "DROPBOX_FILE_NAME_REQUIRED";
    throw error;
  }

  if (
    cleanFileName.includes("/") ||
    cleanFileName.includes("\\") ||
    cleanFileName === "." ||
    cleanFileName === ".." ||
    cleanFileName.includes("..") ||
    /[\u0000-\u001f]/.test(cleanFileName)
  ) {
    const error = new Error("Nome de arquivo Dropbox inválido.");
    error.status = 400;
    error.code = "DROPBOX_FILE_NAME_INVALID";
    throw error;
  }

  return cleanFileName;
}

export function joinDropboxPath(rootPath, fileName) {
  const cleanRoot = normalizeDropboxFolderPath(rootPath);
  const cleanFile = normalizeDropboxFileName(fileName);

  return `${cleanRoot}/${cleanFile}`;
}

export function getPreviewFileNameFromConfigFile(
  fileName = "config.kepler.json",
) {
  const cleanFile = normalizeDropboxFileName(fileName);

  if (/\.json$/i.test(cleanFile)) {
    return cleanFile.replace(/\.json$/i, ".png");
  }

  return `${cleanFile}.png`;
}

export function getRevisionedPreviewFileNameFromConfigFile(
  fileName = "config.kepler.json",
  revision,
) {
  const normalizedRevision = Number(revision);

  if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) {
    const error = new Error("Revisão de preview inválida.");
    error.status = 400;
    error.code = "THUMBNAIL_REVISION_INVALID";
    throw error;
  }

  const canonicalName = getPreviewFileNameFromConfigFile(fileName);

  if (/\.png$/i.test(canonicalName)) {
    return canonicalName.replace(/\.png$/i, `.r${normalizedRevision}.png`);
  }

  return `${canonicalName}.r${normalizedRevision}.png`;
}

async function createDropboxFolderWithClient(client, path) {
  const normalizedPath = normalizeDropboxFolderPath(path);

  if (!normalizedPath) return null;

  const response = await client.request({
    operation: "files.create_folder_v2",
    url: DROPBOX_CREATE_FOLDER_URL,
    timeoutMs: DROPBOX_METADATA_TIMEOUT_MS,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: normalizedPath,
        autorename: false,
      }),
    }),
  });

  if (response.ok) return await response.json();

  const text = await response.text();
  if (response.status === 409 && text.includes("path/conflict")) {
    // A conflict can be a file, not a folder. Verify metadata before treating
    // create as idempotent; otherwise provisioning can publish a false READY.
    const metadataResponse = await client.request({
      operation: "files.get_metadata",
      url: DROPBOX_METADATA_URL,
      timeoutMs: DROPBOX_METADATA_TIMEOUT_MS,
      buildInit: ({ accessToken }) => ({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: normalizedPath, include_deleted: false }),
      }),
    });
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json();
      if (metadata?.[".tag"] === "folder") return { metadata };
      const error = new Error("O caminho de armazenamento não corresponde a uma pasta.");
      error.status = 409;
      error.code = "DROPBOX_FOLDER_TYPE_CONFLICT";
      error.retryable = false;
      throw error;
    }
    const error = new Error("Não foi possível validar a pasta de armazenamento existente.");
    error.status = metadataResponse.status;
    error.code = "DROPBOX_FOLDER_VALIDATION_FAILED";
    error.retryable = metadataResponse.status === 429 || metadataResponse.status >= 500;
    throw error;
  }

  const error = new Error(
    `Falha ao criar pasta Dropbox ${normalizedPath}: ${response.status} ${text}`,
  );
  error.status = response.status;
  error.code = "DROPBOX_CREATE_FOLDER_FAILED";
  error.dropboxStatus = response.status;
  throw error;
}

export async function ensureDropboxFolder(env, path) {
  if (isLocalStorageMode(env)) {
    return await ensureLocalStorageFolder(env, path);
  }

  const normalizedPath = normalizeDropboxFolderPath(path);
  if (!normalizedPath) return null;

  const client = getDropboxClient(env);
  const parts = normalizedPath.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = `${current}/${part}`;
    await createDropboxFolderWithClient(client, current);
  }

  return { path: normalizedPath };
}

export async function listDropboxFolder(env, path = "") {
  if (isLocalStorageMode(env)) {
    return await listLocalStorageFolder(env, path);
  }

  const client = getDropboxClient(env);
  const normalizedPath = normalizeDropboxFolderPath(path);
  const response = await client.request({
    operation: "files.list_folder",
    url: DROPBOX_LIST_FOLDER_URL,
    timeoutMs: DROPBOX_METADATA_TIMEOUT_MS,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: normalizedPath,
        recursive: false,
        include_deleted: false,
        include_has_explicit_shared_members: false,
        include_mounted_folders: true,
        include_non_downloadable_files: true,
      }),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Falha ao listar pasta Dropbox ${normalizedPath || "/"}: ${response.status} ${text}`,
    );
    error.status = response.status;
    error.code = "DROPBOX_LIST_FOLDER_FAILED";
    error.dropboxStatus = response.status;
    throw error;
  }

  return await response.json();
}

export async function listDropboxFolderAll(
  env,
  path = "",
  {
    maxPages = 100,
  } = {},
) {
  const firstPage = await listDropboxFolder(env, path);

  if (isLocalStorageMode(env) || !firstPage?.has_more) {
    return {
      entries: firstPage?.entries || [],
      cursor: firstPage?.cursor || null,
      has_more: false,
      pages: 1,
    };
  }

  const client = getDropboxClient(env);
  const entries = [...(firstPage.entries || [])];
  let cursor = firstPage.cursor || null;
  let hasMore = Boolean(firstPage.has_more);
  let pages = 1;
  const safeMaxPages = Math.max(
    1,
    Math.min(Number(maxPages) || 100, 1_000),
  );

  while (hasMore) {
    if (!cursor) {
      const error = new Error(
        "Dropbox retornou paginação sem cursor.",
      );
      error.status = 502;
      error.code = "DROPBOX_LIST_CURSOR_MISSING";
      throw error;
    }

    if (pages >= safeMaxPages) {
      const error = new Error(
        "A listagem Dropbox excedeu o limite seguro de páginas.",
      );
      error.status = 502;
      error.code = "DROPBOX_LIST_PAGE_LIMIT_EXCEEDED";
      error.details = {
        path: normalizeDropboxFolderPath(path),
        maxPages: safeMaxPages,
      };
      throw error;
    }

    const response = await client.request({
      operation: "files.list_folder.continue",
      url: DROPBOX_LIST_FOLDER_CONTINUE_URL,
      timeoutMs: DROPBOX_METADATA_TIMEOUT_MS,
      buildInit: ({ accessToken }) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cursor }),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(
        `Falha ao continuar listagem Dropbox: ${response.status} ${text}`,
      );
      error.status = response.status;
      error.code = "DROPBOX_LIST_FOLDER_CONTINUE_FAILED";
      error.dropboxStatus = response.status;
      throw error;
    }

    const page = await response.json();
    entries.push(...(page?.entries || []));
    cursor = page?.cursor || cursor;
    hasMore = Boolean(page?.has_more);
    pages += 1;
  }

  return {
    entries,
    cursor,
    has_more: false,
    pages,
  };
}

export async function getDropboxMetadata(env, rootPath, fileName) {
  if (isLocalStorageMode(env)) {
    return await getLocalStorageMetadata(env, rootPath, fileName);
  }

  const client = getDropboxClient(env);
  const path = joinDropboxPath(rootPath, fileName);
  const response = await client.request({
    operation: "files.get_metadata",
    url: DROPBOX_METADATA_URL,
    timeoutMs: DROPBOX_METADATA_TIMEOUT_MS,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path,
        include_media_info: false,
        include_deleted: false,
        include_has_explicit_shared_members: false,
      }),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Falha ao consultar arquivo Dropbox ${path}: ${response.status} ${text}`,
    );
    error.status = response.status;
    error.code = text.includes("path/not_found")
      ? "DROPBOX_PATH_NOT_FOUND"
      : "DROPBOX_METADATA_FAILED";
    error.dropboxStatus = response.status;
    throw error;
  }

  return await response.json();
}

export async function deleteDropboxPath(env, path) {
  if (isLocalStorageMode(env)) {
    return await deleteLocalStoragePath(env, path);
  }

  const normalizedPath = normalizeDropboxPath(path);
  if (!normalizedPath) {
    const error = new Error("Não é permitido excluir a raiz do Dropbox.");
    error.status = 400;
    error.code = "DROPBOX_PATH_INVALID";
    throw error;
  }

  const client = getDropboxClient(env);
  const response = await client.request({
    operation: "files.delete_v2",
    url: DROPBOX_DELETE_URL,
    timeoutMs: DROPBOX_METADATA_TIMEOUT_MS,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: normalizedPath }),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Falha ao excluir caminho Dropbox ${normalizedPath}: ${response.status} ${text}`,
    );
    error.status = response.status;
    error.code = "DROPBOX_DELETE_FAILED";
    error.dropboxStatus = response.status;
    throw error;
  }

  return await response.json();
}

export async function deleteDropboxPathIfExists(env, path) {
  try {
    return await deleteDropboxPath(env, path);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("path/not_found") || message.includes("not_found")) {
      return null;
    }
    throw error;
  }
}

export async function downloadDropboxTextFile(env, rootPath, fileName) {
  const response = await downloadDropboxBinaryFile(env, rootPath, fileName);
  return await response.text();
}

export async function downloadDropboxBinaryFile(env, rootPath, fileName) {
  if (isLocalStorageMode(env)) {
    return await downloadLocalStorageFile(env, rootPath, fileName);
  }

  const client = getDropboxClient(env);
  const path = joinDropboxPath(rootPath, fileName);
  const response = await client.request({
    operation: "files.download",
    url: DROPBOX_DOWNLOAD_URL,
    timeoutMs: DROPBOX_CONTENT_TIMEOUT_MS,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path }),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Falha ao baixar arquivo Dropbox ${path}: ${response.status} ${text}`,
    );
    error.status = response.status;
    error.code = text.includes("path/not_found")
      ? "DROPBOX_PATH_NOT_FOUND"
      : "DROPBOX_DOWNLOAD_FAILED";
    error.dropboxStatus = response.status;
    throw error;
  }

  return response;
}

export async function uploadDropboxTextFile(env, rootPath, fileName, content) {
  return await uploadDropboxBinaryFile(env, rootPath, fileName, content);
}

export async function uploadDropboxBinaryFile(
  env,
  rootPath,
  fileName,
  content,
  contentType = "",
  { writeMode = "overwrite" } = {},
) {
  if (!["overwrite", "create"].includes(writeMode)) {
    const error = new Error("Modo de escrita Dropbox inválido.");
    error.status = 400;
    error.code = "DROPBOX_WRITE_MODE_INVALID";
    throw error;
  }

  if (isLocalStorageMode(env)) {
    return await uploadLocalStorageFile(
      env,
      rootPath,
      fileName,
      content,
      contentType,
      { writeMode },
    );
  }

  const normalizedRootPath = normalizeDropboxFolderPath(rootPath);
  const path = joinDropboxPath(normalizedRootPath, fileName);
  await ensureDropboxFolder(env, normalizedRootPath);

  const client = getDropboxClient(env);
  const createOnly = writeMode === "create";
  const response = await client.request({
    operation: "files.upload",
    url: DROPBOX_UPLOAD_URL,
    timeoutMs: DROPBOX_CONTENT_TIMEOUT_MS,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": DROPBOX_UPLOAD_CONTENT_TYPE,
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: createOnly ? "add" : "overwrite",
          autorename: false,
          mute: false,
          strict_conflict: createOnly,
        }),
      },
      body: content,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Falha ao enviar arquivo Dropbox ${path}: ${response.status} ${text}`,
    );
    error.status = response.status;
    error.code = text.includes("path/conflict")
      ? "DROPBOX_PATH_CONFLICT"
      : "DROPBOX_UPLOAD_FAILED";
    error.dropboxStatus = response.status;
    throw error;
  }

  return await response.json();
}

async function uploadSessionRequest(
  env,
  url,
  operation,
  apiArgument,
  content,
  errorMessage,
) {
  const client = getDropboxClient(env);
  const response = await client.request({
    operation,
    url,
    timeoutMs: DROPBOX_SESSION_TIMEOUT_MS,
    // Upload sessions use cursor/offset semantics. Retrying a response-lost
    // mutation blindly can advance the cursor twice, so SAVE-03 keeps these
    // operations bounded by timeout but does not retry them automatically.
    maxRetries: 0,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": DROPBOX_UPLOAD_CONTENT_TYPE,
        "Dropbox-API-Arg": JSON.stringify(apiArgument),
      },
      body: content,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`${errorMessage}: ${response.status} ${text}`);
    error.status = 502;
    error.code = "DROPBOX_UPLOAD_SESSION_FAILED";
    error.dropboxStatus = response.status;
    throw error;
  }

  return await response.json();
}

export async function startDropboxUploadSession(env) {
  return uploadSessionRequest(
    env,
    DROPBOX_UPLOAD_SESSION_START_URL,
    "files.upload_session.start",
    { close: false },
    new Uint8Array(0),
    "Falha ao iniciar sessão de upload no Dropbox",
  );
}

export async function appendDropboxUploadSession(
  env,
  sessionId,
  offset,
  content,
) {
  return uploadSessionRequest(
    env,
    DROPBOX_UPLOAD_SESSION_APPEND_URL,
    "files.upload_session.append",
    {
      cursor: {
        session_id: sessionId,
        offset,
      },
      close: false,
    },
    content,
    "Falha ao continuar sessão de upload no Dropbox",
  );
}

export async function finishDropboxUploadSession(
  env,
  sessionId,
  offset,
  rootPath,
  fileName,
  content,
) {
  const normalizedRootPath = normalizeDropboxFolderPath(rootPath);
  const path = joinDropboxPath(normalizedRootPath, fileName);

  return uploadSessionRequest(
    env,
    DROPBOX_UPLOAD_SESSION_FINISH_URL,
    "files.upload_session.finish",
    {
      cursor: {
        session_id: sessionId,
        offset,
      },
      commit: {
        path,
        mode: "overwrite",
        autorename: false,
        mute: false,
        strict_conflict: false,
      },
    },
    content,
    `Falha ao concluir upload no Dropbox ${path}`,
  );
}
