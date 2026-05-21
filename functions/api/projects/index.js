import { errorResponse, jsonResponse, methodNotAllowed } from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import { listProjectsForUser, publicProject, logAudit } from "../../_lib/projects.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);
    const projects = await listProjectsForUser(env, user);

    await logAudit(env, {
      userId: user.id,
      action: "projects.list",
      details: { count: projects.length },
    });

    return jsonResponse({
      ok: true,
      projects: projects.map(publicProject),
    });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "PROJECTS_ERROR");
  }
}
