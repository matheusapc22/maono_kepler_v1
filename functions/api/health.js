import { jsonResponse, errorResponse, methodNotAllowed } from "../_lib/http.js";
import { publicRuntimeDiagnostics } from "../_lib/runtime-environment.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const checks = {
      dbBinding: Boolean(env.DB),
      dropboxAppKey: Boolean(env.DROPBOX_APP_KEY),
      dropboxAppSecret: Boolean(env.DROPBOX_APP_SECRET),
      dropboxRefreshToken: Boolean(env.DROPBOX_REFRESH_TOKEN),
      databaseReachable: false,
    };

    if (env.DB) {
      await env.DB.prepare("SELECT 1 AS ok").first();
      checks.databaseReachable = true;
    }

    const ok = Object.values(checks).every(Boolean);

    return jsonResponse({
      ok,
      service: "maono-kepler-v1",
      runtime: publicRuntimeDiagnostics(env),
      checks,
    });
  } catch (error) {
    return errorResponse(
      error.message,
      error.status || 500,
      error.code || "HEALTH_CHECK_ERROR"
    );
  }
}
