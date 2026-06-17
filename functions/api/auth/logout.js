import {
  buildCookie,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../_lib/http.js";
import { SESSION_COOKIE_NAME, destroySession } from "../../_lib/auth.js";

function isSecureRequest(request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestUrl = new URL(request.url);

  if (forwardedProto) {
    return forwardedProto.toLowerCase().includes("https");
  }

  return requestUrl.protocol === "https:";
}

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
      secure: isSecureRequest(request),
      sameSite: "Lax",
    });

    return jsonResponse(
      {
        ok: true,
        authenticated: false,
        user: null,
        projects: [],
      },
      {
        headers: {
          "Set-Cookie": expiredCookie,
        },
      },
    );
  } catch (error) {
    console.error("[Maono logout] Falha ao encerrar sessão:", error);

    return errorResponse(
      "Não foi possível encerrar a sessão.",
      error.status || 500,
      error.code || "LOGOUT_ERROR",
    );
  }
}