import { jsonResponse, errorResponse, methodNotAllowed } from "../_lib/http.js";
import { getSessionUser } from "../_lib/auth.js";
import { listProjectsForUser, publicProject } from "../_lib/projects.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await getSessionUser(env, request);

    if (!user) {
      return jsonResponse({
        authenticated: false,
        user: null,
        projects: [],
      });
    }

    const projects = await listProjectsForUser(env, user);

    return jsonResponse({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      projects: projects.map(publicProject),
    });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "SESSION_ERROR");
  }
}
