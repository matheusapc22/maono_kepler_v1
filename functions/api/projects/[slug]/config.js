import { errorResponseFromError, jsonResponse, methodNotAllowed } from "../../../_lib/http.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, publicProject } from "../../../_lib/projects.js";
import { can, recordAuditLog } from "../../../_lib/permissions.js";
import { getProjectLifecycleRow, publicProjectLifecycle } from "../../../_lib/project-lifecycle.js";
import { publicProjectPreview } from "../../../_lib/project-preview.js";
import { readPublishedProjectConfig } from "../../../_lib/project-config-service.js";
import { saveDeployResponseHeaders } from "../../../_lib/save-deploy-contract.js";
import { retiredSaveProtocolResponse } from "../../../_lib/project-save-protocol.js";

export async function onRequest({ request, env, params }) {
  // Rejected before reading the body, reserving a revision or touching storage.
  if (request.method === "PUT") return retiredSaveProtocolResponse();
  if (request.method !== "GET") return methodNotAllowed(["GET", "PUT"]);
  try {
    const user = await requireSession(env, request);
    const slug = String(params?.slug || "");
    let project = await getAuthorizedProject(env, user, slug);
    if (!project) throw Object.assign(new Error("Projeto não encontrado."), { status:404, code:"PROJECT_NOT_FOUND" });
    const lifecycle = await getProjectLifecycleRow(env, { projectId:project.id, organizationId:project.organization_id });
    project = { ...project, ...lifecycle };
    const decision = await can(env, user, "project.view", { project, projectId:project.id, projectSlug:project.slug, organizationId:project.organization_id });
    if (!decision.allowed) throw Object.assign(new Error("Acesso negado."), { status:403, code:"FORBIDDEN" });
    const loaded = await readPublishedProjectConfig(env, project);
    await recordAuditLog(env, {
      actorUserId:user.id, organizationId:project.organization_id, projectId:project.id,
      action:"projects.config.read", resourceType:"project", resourceId:project.slug,
      result:"success", metadata:{configRevision:Number(project.config_revision || 0),legacy:loaded.legacy}, request,
    }).catch(() => null);
    return jsonResponse({
      ok:true,
      project:{ ...publicProject(project), lifecycle:publicProjectLifecycle(project), ...publicProjectPreview(project) },
      lifecycle:loaded.lifecycle, config:loaded.config,
    }, {headers:saveDeployResponseHeaders()});
  } catch (error) { return errorResponseFromError(error); }
}
