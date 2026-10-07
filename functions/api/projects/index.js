import { errorResponseFromError, jsonResponse, methodNotAllowed } from "../../_lib/http.js";
import { normalizeRole, requireSession } from "../../_lib/auth.js";
import { listProjectsForActiveOrganization } from "../../_lib/project-list.js";
import { publicProject } from "../../_lib/projects.js";
import { isProjectLifecycleEnabled, publicProjectLifecycle } from "../../_lib/project-lifecycle.js";
import { reserveProjectCreation } from "../../_lib/project-creation-reservation.js";
import { assertSaveDeployCompatibility, saveDeployResponseHeaders } from "../../_lib/save-deploy-contract.js";
import { assertSameSaveOrigin, primarySaveEnvironment, retiredSaveProtocolResponse, readBoundedSaveJsonBody } from "../../_lib/project-save-protocol.js";

export async function onRequest(context) {
  const {request} = context;
  const env = primarySaveEnvironment(context.env);
  if (!["GET","POST"].includes(request.method)) return methodNotAllowed(["GET","POST"]);
  try {
    const user = await requireSession(env,request);
    if (request.method === "GET") return jsonResponse({ok:true,projects:await listProjectsForActiveOrganization(env,user)});
    assertSameSaveOrigin(request);
    const deployment = await assertSaveDeployCompatibility(env,request);
    if (normalizeRole(user.role) === "viewer") throw Object.assign(new Error("Usuários Viewer não podem criar projetos."), {status:403,code:"VIEWER_PROJECT_CREATE_FORBIDDEN"});
    if (!isProjectLifecycleEnabled(env)) throw Object.assign(new Error("A criação está temporariamente indisponível."), {status:503,code:"PROJECT_LIFECYCLE_ROLLOUT_DISABLED"});
    const body = await readBoundedSaveJsonBody(request);
    if (body?.durableSave !== true) return retiredSaveProtocolResponse();
    const reserved = await reserveProjectCreation(env,request,user,body);
    const active = reserved.project.lifecycle_state === "ACTIVE";
    return jsonResponse({
      ok:true,status:active ? "active":"pending",idempotent:reserved.idempotent,
      project:{...publicProject(reserved.project),accessLevel:"owner",access_level:"owner",active,lifecycle:publicProjectLifecycle(reserved.project)},
      configRevision:Number(reserved.project.config_revision || 0),
      creation:{transport:"durable-operation",expectedRevision:0,configMetadata:reserved.configMetadata},
    }, {status:reserved.status,headers:saveDeployResponseHeaders(deployment)});
  } catch(error) { return errorResponseFromError(error); }
}
