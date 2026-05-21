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
  verifyPassword,
} from "../../_lib/auth.js";

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
      return errorResponse("Informe e-mail e senha.", 400, "MISSING_CREDENTIALS");
    }

    const user = await env.DB.prepare(
      `SELECT id, email, name, role, password_hash, active
       FROM users
       WHERE email = ?
       LIMIT 1`
    )
      .bind(email)
      .first();

    if (!user || user.active !== 1) {
      return errorResponse("Credenciais inválidas.", 401, "INVALID_CREDENTIALS");
    }

    const validPassword = await verifyPassword(password, user.password_hash);

    if (!validPassword) {
      return errorResponse("Credenciais inválidas.", 401, "INVALID_CREDENTIALS");
    }

    const session = await createSession(env, user.id);
    const cookie = buildCookie(SESSION_COOKIE_NAME, session.token, {
      maxAge: session.maxAge,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    return jsonResponse(
      {
        ok: true,
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      {
        headers: {
          "Set-Cookie": cookie,
        },
      }
    );
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "LOGIN_ERROR");
  }
}
