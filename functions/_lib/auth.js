import { getCookie } from "./http.js";

export const SESSION_COOKIE_NAME = "maono_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const PASSWORD_HASH_ITERATIONS = 100000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest);
}

export async function hashPassword(password, saltHex = null) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_HASH_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return `${toHex(salt)}:${toHex(bits)}`;
}

export async function verifyPassword(password, storedHash) {
  if (!password || !storedHash || !storedHash.includes(":")) return false;
  const [saltHex, expectedHashHex] = storedHash.split(":");
  const calculated = await hashPassword(password, saltHex);
  const [, calculatedHashHex] = calculated.split(":");
  return calculatedHashHex === expectedHashHex;
}

export async function createSession(env, userId) {
  const token = createSessionToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`
  )
    .bind(tokenHash, userId, expiresAt)
    .run();

  return { token, expiresAt, maxAge: SESSION_TTL_SECONDS };
}

export async function destroySession(env, request) {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return;
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .bind(tokenHash)
    .run();
}

export async function getSessionUser(env, request) {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
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
    LIMIT 1`
  )
    .bind(tokenHash, now)
    .first();

  return result || null;
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

export function canManagePlatform(user) {
  return user?.role === "admin";
}

export function canEditProject(user, accessLevel) {
  return user?.role === "admin" || accessLevel === "editor" || accessLevel === "owner";
}
