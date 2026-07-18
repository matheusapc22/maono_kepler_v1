import { requireEnv } from "./http.js";

const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
const DROPBOX_UPLOAD_SESSION_START_URL =
  "https://content.dropboxapi.com/2/files/upload_session/start";
const DROPBOX_UPLOAD_SESSION_APPEND_URL =
  "https://content.dropboxapi.com/2/files/upload_session/append_v2";
const DROPBOX_UPLOAD_SESSION_FINISH_URL =
  "https://content.dropboxapi.com/2/files/upload_session/finish";
const DROPBOX_LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder";
const DROPBOX_CREATE_FOLDER_URL =
  "https://api.dropboxapi.com/2/files/create_folder_v2";
const DROPBOX_DELETE_URL = "https://api.dropboxapi.com/2/files/delete_v2";
const DROPBOX_UPLOAD_CONTENT_TYPE = "application/octet-stream";

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

async function getDropboxAccessToken(env) {
  requireEnv(env, [
    "DROPBOX_APP_KEY",
    "DROPBOX_APP_SECRET",
    "DROPBOX_REFRESH_TOKEN",
  ]);

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", env.DROPBOX_REFRESH_TOKEN);
  body.set("client_id", env.DROPBOX_APP_KEY);
  body.set("client_secret", env.DROPBOX_APP_SECRET);

  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Falha ao renovar token Dropbox: ${response.status} ${text}`,
    );
  }

  const data = await response.json();

  return data.access_token;
}

async function createDropboxFolderWithToken(accessToken, path) {
  const normalizedPath = normalizeDropboxFolderPath(path);

  if (!normalizedPath) {
    return null;
  }

  const response = await fetch(DROPBOX_CREATE_FOLDER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: normalizedPath,
      autorename: false,
    }),
  });

  if (response.ok) {
    return await response.json();
  }

  const text = await response.text();

  if (text.includes("path/conflict/folder") || text.includes("path/conflict")) {
    return null;
  }

  throw new Error(
    `Falha ao criar pasta Dropbox ${normalizedPath}: ${response.status} ${text}`,
  );
}

export async function ensureDropboxFolder(env, path) {
  const accessToken = await getDropboxAccessToken(env);
  const normalizedPath = normalizeDropboxFolderPath(path);

  if (!normalizedPath) {
    return null;
  }

  const parts = normalizedPath.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = `${current}/${part}`;
    await createDropboxFolderWithToken(accessToken, current);
  }

  return { path: normalizedPath };
}

export async function listDropboxFolder(env, path = "") {
  const accessToken = await getDropboxAccessToken(env);
  const normalizedPath = normalizeDropboxFolderPath(path);

  const response = await fetch(DROPBOX_LIST_FOLDER_URL, {
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
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Falha ao listar pasta Dropbox ${normalizedPath || "/"}: ${response.status} ${text}`,
    );
  }

  return await response.json();
}

export async function deleteDropboxPath(env, path) {
  const accessToken = await getDropboxAccessToken(env);
  const normalizedPath = normalizeDropboxPath(path);

  if (!normalizedPath) {
    throw new Error("Não é permitido excluir a raiz do Dropbox.");
  }

  const response = await fetch(DROPBOX_DELETE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: normalizedPath }),
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Falha ao excluir caminho Dropbox ${normalizedPath}: ${response.status} ${text}`,
    );
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
  const accessToken = await getDropboxAccessToken(env);
  const path = joinDropboxPath(rootPath, fileName);

  const response = await fetch(DROPBOX_DOWNLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Falha ao baixar arquivo Dropbox ${path}: ${response.status} ${text}`,
    );

    error.status = response.status;
    throw error;
  }

  return response;
}

export async function uploadDropboxTextFile(env, rootPath, fileName, content) {
  return await uploadDropboxBinaryFile(env, rootPath, fileName, content);
}

export async function uploadDropboxBinaryFile(env, rootPath, fileName, content) {
  const normalizedRootPath = normalizeDropboxFolderPath(rootPath);
  const path = joinDropboxPath(normalizedRootPath, fileName);

  await ensureDropboxFolder(env, normalizedRootPath);

  const accessToken = await getDropboxAccessToken(env);

  const response = await fetch(DROPBOX_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,

      // A API /2/files/upload do Dropbox aceita application/octet-stream.
      // Não envie application/json nem image/png aqui; o tipo real é inferido
      // pelo nome/extensão do arquivo.
      "Content-Type": DROPBOX_UPLOAD_CONTENT_TYPE,

      "Dropbox-API-Arg": JSON.stringify({
        path,
        mode: "overwrite",
        autorename: false,
        mute: false,
        strict_conflict: false,
      }),
    },
    body: content,
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Falha ao enviar arquivo Dropbox ${path}: ${response.status} ${text}`,
    );
  }

  return await response.json();
}

async function uploadSessionRequest(
  env,
  url,
  apiArgument,
  content,
  errorMessage,
) {
  const accessToken = await getDropboxAccessToken(env);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": DROPBOX_UPLOAD_CONTENT_TYPE,
      "Dropbox-API-Arg": JSON.stringify(apiArgument),
    },
    body: content,
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
