import { requireEnv } from "./http.js";

const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
const DROPBOX_LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder";

function joinDropboxPath(rootPath, fileName) {
  const cleanRoot = String(rootPath || "").replace(/\/+$/, "");
  const cleanFile = String(fileName || "").replace(/^\/+/, "");
  return `${cleanRoot}/${cleanFile}`;
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
    throw new Error(`Falha ao renovar token Dropbox: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

export async function listDropboxFolder(env, path = "") {
  const accessToken = await getDropboxAccessToken(env);

  const response = await fetch(DROPBOX_LIST_FOLDER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path,
      recursive: false,
      include_deleted: false,
      include_has_explicit_shared_members: false,
      include_mounted_folders: true,
      include_non_downloadable_files: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao listar pasta Dropbox ${path || "/"}: ${response.status} ${text}`);
  }

  return await response.json();
}

export async function downloadDropboxTextFile(env, rootPath, fileName) {
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
    throw new Error(`Falha ao baixar arquivo Dropbox ${path}: ${response.status} ${text}`);
  }

  return await response.text();
}

export async function uploadDropboxTextFile(env, rootPath, fileName, content) {
  const accessToken = await getDropboxAccessToken(env);
  const path = joinDropboxPath(rootPath, fileName);

  const response = await fetch(DROPBOX_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
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
    throw new Error(`Falha ao enviar arquivo Dropbox ${path}: ${response.status} ${text}`);
  }

  return await response.json();
}
