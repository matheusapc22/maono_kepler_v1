import { buildCookie, errorResponse, jsonResponse, methodNotAllowed } from "../../_lib/http.js";
import { SESSION_COOKIE_NAME, destroySession } from "../../_lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    await destroySession(env, request);

    const expiredCookie = buildCookie(SESSION_COOKIE_NAME, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    return jsonResponse(
      { ok: true, authenticated: false },
      { headers: { "Set-Cookie": expiredCookie } }
    );
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "LOGOUT_ERROR");
  }
}
