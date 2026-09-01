import { getDropboxClient } from "./dropbox-client.js";
import { joinDropboxPath } from "./dropbox.js";

const DROPBOX_UPLOAD_SESSION_START_URL =
  "https://content.dropboxapi.com/2/files/upload_session/start";
const DROPBOX_UPLOAD_SESSION_APPEND_URL =
  "https://content.dropboxapi.com/2/files/upload_session/append_v2";
const DROPBOX_UPLOAD_SESSION_FINISH_URL =
  "https://content.dropboxapi.com/2/files/upload_session/finish";
const DROPBOX_UPLOAD_CONTENT_TYPE = "application/octet-stream";
const DROPBOX_SESSION_TIMEOUT_MS = 8_000;

export const DROPBOX_STREAM_BLOCK_BYTES = 4 * 1024 * 1024;

function uploadError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function parseProviderPayload(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function findCorrectOffset(value) {
  if (!value || typeof value !== "object") return null;
  if (Number.isInteger(Number(value.correct_offset))) {
    return Number(value.correct_offset);
  }
  for (const nested of Object.values(value)) {
    const found = findCorrectOffset(nested);
    if (found !== null) return found;
  }
  return null;
}

async function sessionRequest(
  env,
  { url, operation, apiArgument, body, failureMessage },
) {
  const client = getDropboxClient(env);
  const response = await client.request({
    operation,
    url,
    timeoutMs: DROPBOX_SESSION_TIMEOUT_MS,
    // Cursor mutations are reconciled by offset/metadata instead of blind retry.
    maxRetries: 0,
    buildInit: ({ accessToken }) => ({
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": DROPBOX_UPLOAD_CONTENT_TYPE,
        "Dropbox-API-Arg": JSON.stringify(apiArgument),
      },
      body,
    }),
  });

  if (response.ok) {
    return await response.json();
  }

  const text = await response.text();
  const providerPayload = parseProviderPayload(text);
  const correctOffset = findCorrectOffset(providerPayload);

  if (Number(response.status) === 409 && correctOffset !== null) {
    throw uploadError(
      "O cursor da sessão de upload do Dropbox divergiu do offset esperado.",
      409,
      "DROPBOX_UPLOAD_SESSION_OFFSET_CONFLICT",
      {
        provider: "dropbox",
        providerStatus: 409,
        correctOffset,
      },
    );
  }

  if (Number(response.status) === 409 && /path\/conflict/i.test(text)) {
    throw uploadError(
      "A revisão imutável já existe no Dropbox.",
      409,
      "DROPBOX_PATH_CONFLICT",
      { provider: "dropbox", providerStatus: 409 },
    );
  }

  throw uploadError(
    `${failureMessage}: ${response.status} ${text}`,
    Number(response.status) >= 500 ? 502 : Number(response.status) || 502,
    "DROPBOX_UPLOAD_SESSION_FAILED",
    {
      provider: "dropbox",
      providerStatus: Number(response.status || 0) || null,
      ...(correctOffset !== null ? { correctOffset } : {}),
    },
  );
}

export async function startLargeDropboxUploadSession(env) {
  return sessionRequest(env, {
    url: DROPBOX_UPLOAD_SESSION_START_URL,
    operation: "files.upload_session.start.large-map-config",
    apiArgument: { close: false },
    body: new Uint8Array(0),
    failureMessage: "Falha ao iniciar streaming do MapConfig no Dropbox",
  });
}

export async function appendLargeDropboxUploadSession(
  env,
  sessionId,
  offset,
  content,
) {
  return sessionRequest(env, {
    url: DROPBOX_UPLOAD_SESSION_APPEND_URL,
    operation: "files.upload_session.append.large-map-config",
    apiArgument: {
      cursor: {
        session_id: String(sessionId || ""),
        offset: Number(offset || 0),
      },
      close: false,
    },
    body: content,
    failureMessage: "Falha ao continuar streaming do MapConfig no Dropbox",
  });
}

export async function finishLargeDropboxUploadSession(
  env,
  sessionId,
  offset,
  rootPath,
  fileName,
  content,
  { writeMode = "create" } = {},
) {
  if (!["create", "overwrite"].includes(writeMode)) {
    throw uploadError(
      "Modo de conclusão do streaming Dropbox inválido.",
      400,
      "DROPBOX_WRITE_MODE_INVALID",
    );
  }

  const createOnly = writeMode === "create";
  const path = joinDropboxPath(rootPath, fileName);
  return sessionRequest(env, {
    url: DROPBOX_UPLOAD_SESSION_FINISH_URL,
    operation: "files.upload_session.finish.large-map-config",
    apiArgument: {
      cursor: {
        session_id: String(sessionId || ""),
        offset: Number(offset || 0),
      },
      commit: {
        path,
        mode: createOnly ? "add" : "overwrite",
        autorename: false,
        mute: false,
        strict_conflict: createOnly,
      },
    },
    body: content,
    failureMessage: `Falha ao concluir streaming do MapConfig no Dropbox ${path}`,
  });
}
