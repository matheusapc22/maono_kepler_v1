import {
  buildCookie,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../_lib/http.js";
import {
  SESSION_COOKIE_NAME,
  createSession,
  normalizeEmail,
  normalizeRole,
  verifyPassword,
} from "../../_lib/auth.js";

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

function isSecureRequest(request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestUrl = new URL(request.url);

  if (forwardedProto) {
    return forwardedProto.toLowerCase().includes("https");
  }

  return requestUrl.protocol === "https:";
}

function publicLoginUser(user) {
  const role = normalizeRole(user.role);

  return {
    id: user.id,
    email: user.email,
    name: user.name || undefined,
    role,
    rawRole: user.role && String(user.role) !== role ? user.role : undefined,
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const body = await readJsonBody(request);
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");

    if (!email || !password) {
      return errorResponse(
        "Informe e-mail e senha.",
        400,
        "MISSING_CREDENTIALS",
      );
    }

    const db = getDb(env);

    const user = await db
      .prepare(
        `SELECT
          id,
          email,
          name,
          role,
          password_hash,
          active
         FROM users
         WHERE email = ?
         LIMIT 1`,
      )
      .bind(email)
      .first();

    if (!user || user.active !== 1) {
      return errorResponse(
        "Credenciais inválidas.",
        401,
        "INVALID_CREDENTIALS",
      );
    }

    const validPassword = await verifyPassword(password, user.password_hash);

    if (!validPassword) {
      return errorResponse(
        "Credenciais inválidas.",
        401,
        "INVALID_CREDENTIALS",
      );
    }

    const session = await createSession(env, user.id);

    const cookie = buildCookie(SESSION_COOKIE_NAME, session.token, {
      maxAge: session.maxAge,
      path: "/",
      httpOnly: true,
      secure: isSecureRequest(request),
      sameSite: "Lax",
    });

    return jsonResponse(
      {
        ok: true,
        authenticated: true,

        /**
         * Payload mínimo para compatibilidade imediata.
         * O payload completo e seguro deve ser lido em GET /api/session.
         */
        user: publicLoginUser(user),
      },
      {
        headers: {
          "Set-Cookie": cookie,
        },
      },
    );
  } catch (error) {
    console.error("[Maono login] Falha ao autenticar usuário:", error);

    return errorResponse(
      "Não foi possível fazer login.",
      error.status || 500,
      error.code || "LOGIN_ERROR",
    );
  }
}