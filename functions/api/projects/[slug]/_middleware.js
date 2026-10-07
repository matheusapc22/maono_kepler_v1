import { errorResponseFromError } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../_lib/projects.js";
import { assertProjectPersistenceRoute } from "../../../_lib/project-map-route-policy.js";
import { retiredSaveProtocolResponse } from "../../../_lib/project-save-protocol.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = new URL(request.url).pathname;
  if ((request.method === "PUT" && /\/config\/?$/.test(path)) ||
      (request.method === "POST" && /\/save\/?$/.test(path))) {
    return retiredSaveProtocolResponse();
  }
  // Durable operation routes own authorization, including inactive create reservations.
  if (/\/save-operations(?:\/|$)/.test(path)) return context.next();
  const restricted = ["POST","PUT","PATCH","DELETE"].includes(request.method) &&
    (/\/thumbnail(?:\/|$)/.test(path) || /\/metadata\/?$/.test(path));
  if (!restricted) return context.next();
  try {
    const user = await requireSession(env, request);
    const project = await getAuthorizedProject(env, user, String(params?.slug || ""));
    if (!project) throw Object.assign(new Error("Projeto não encontrado."), {status:404,code:"PROJECT_NOT_FOUND"});
    assertProjectPersistenceRoute(user, project);
    return context.next();
  } catch (error) { return errorResponseFromError(error); }
}
