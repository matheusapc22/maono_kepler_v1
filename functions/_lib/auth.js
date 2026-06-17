import { getCookie } from "./http.js";

export const SESSION_COOKIE_NAME = "maono_session";

const SESSION_TTL_SECONDS = 60 * 60 * 8;
const PASSWORD_HASH_ITERATIONS = 100000;

const ROLE_ALIASES = {
  client: "owner",
};

const OFFICIAL_ROLES = new Set([
  "super_admin",
  "admin",
  "owner",
  "editor",
  "viewer",
]);

function getDb(env) {
  const db = env.DB || env.D1 || env.MAONO_DB;

  if (!db || typeof db.prepare !== "function") {
    const error = new Error("Banco de dados D1 não configurado.");
    error.status = 500;
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  return db;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  const normalizedHex = String(hex || "");

  if (!normalizedHex || normalizedHex.length % 2 !== 0) {
    return new Uint8Array();
  }

  const bytes = new Uint8Array(normalizedHex.length / 2);

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalizedHex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

function constantTimeStringEqual(left, right) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");

  let diff = leftValue.length ^ rightValue.length;
  const maxLength = Math.max(leftValue.length, rightValue.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = leftValue.charCodeAt(index) || 0;
    const rightCode = rightValue.charCodeAt(index) || 0;
    diff |= leftCode ^ rightCode;
  }

  return diff === 0;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeRole(role) {
  const rawRole = String(role || "").trim().toLowerCase();
  const normalizedRole = ROLE_ALIASES[rawRole] || rawRole;

  return OFFICIAL_ROLES.has(normalizedRole) ? normalizedRole : "viewer";
}

export function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest);
}

export async function hashPassword(password, saltHex = null) {
  const salt = saltHex
    ? fromHex(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));

  if (!salt || salt.length === 0) {
    const error = new Error("Salt de senha inválido.");
    error.status = 400;
    error.code = "INVALID_PASSWORD_SALT";
    throw error;
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_HASH_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return `${toHex(salt)}:${toHex(bits)}`;
}

export async function verifyPassword(password, storedHash) {
  if (!password || !storedHash || !String(storedHash).includes(":")) {
    return false;
  }

  const [saltHex, expectedHashHex] = String(storedHash).split(":");

  if (!saltHex || !expectedHashHex) {
    return false;
  }

  try {
    const calculated = await hashPassword(password, saltHex);
    const [, calculatedHashHex] = calculated.split(":");

    return constantTimeStringEqual(calculatedHashHex, expectedHashHex);
  } catch {
    return false;
  }
}

export async function createSession(env, userId) {
  if (!userId) {
    const error = new Error("Usuário inválido para criação de sessão.");
    error.status = 400;
    error.code = "INVALID_SESSION_USER";
    throw error;
  }

  const db = getDb(env);
  const token = createSessionToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();

  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES (?, ?, ?)`,
    )
    .bind(tokenHash, userId, expiresAt)
    .run();

  return {
    token,
    expiresAt,
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function destroySession(env, request) {
  const token = getCookie(request, SESSION_COOKIE_NAME);

  if (!token) {
    return;
  }

  const db = getDb(env);
  const tokenHash = await sha256Hex(token);

  await db
    .prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .bind(tokenHash)
    .run();
}

function normalizeSessionUser(row) {
  if (!row) {
    return null;
  }

  const rawRole = row.role;
  const role = normalizeRole(rawRole);

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
    rawRole: rawRole && String(rawRole) !== role ? rawRole : undefined,
    active: row.active,
    expires_at: row.expires_at,
    sessionExpiresAt: row.expires_at,
  };
}

export async function getSessionUser(env, request) {
  const token = getCookie(request, SESSION_COOKIE_NAME);

  if (!token) {
    return null;
  }

  const db = getDb(env);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  const result = await db
    .prepare(
      `SELECT
        users.id,
        users.email,
        users.name,
        users.role,
        users.active,
        sessions.expires_at
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > ?
        AND users.active = 1
      LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first();

  return normalizeSessionUser(result);
}

export async function requireSession(env, request) {
  const user = await getSessionUser(env, request);

  if (!user) {
    const error = new Error("Sessão inválida ou expirada.");
    error.status = 401;
    error.code = "UNAUTHORIZED";
    throw error;
  }

  return user;
}

/**
 * Wrapper legado.
 *
 * Não usar em código novo como regra final de autorização.
 * A autorização granular deve migrar para functions/_lib/permissions.js.
 */
export function canManagePlatform(user) {
  const role = normalizeRole(user?.role);

  return role === "super_admin" || role === "admin";
}

/**
 * Wrapper legado.
 *
 * Não usar em código novo como regra final de autorização.
 * Para salvar mapa, a regra-alvo é:
 * can(user, "project.save", { project, organization })
 * no backend em functions/_lib/permissions.js.
 */
export function canEditProject(user, accessLevel) {
  const role = normalizeRole(user?.role);
  const normalizedAccessLevel = String(accessLevel || "")
    .trim()
    .toLowerCase();

  if (role === "super_admin") {
    return true;
  }

  if (role === "admin") {
    return true;
  }

  return (
    normalizedAccessLevel === "owner" ||
    normalizedAccessLevel === "editor"
  );
}