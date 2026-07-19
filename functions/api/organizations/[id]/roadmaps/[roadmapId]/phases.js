import { requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import { getRouteParam, jsonResponse, methodNotAllowed, parsePositiveInteger, readJsonBody } from "../../../../../_lib/organizations.js";
import { assertRoadmapSchema, createPhase, roadmapErrorResponse } from "../../../../../_lib/roadmaps.js";
export async function onRequest({ env, request, params }) {
  if (request.method !== "POST") return methodNotAllowed(request.method, ["POST"]);
  try { const organizationId=parsePositiveInteger(getRouteParam(params,"id"),"organizationId"); const roadmapId=parsePositiveInteger(getRouteParam(params,"roadmapId"),"roadmapId"); const {user}=await requireOrganizationPermission(env,request,"roadmap.manage",{organizationId,roadmapId,scopeType:"organization",resourceType:"roadmap_phase"},{audit:false}); await assertRoadmapSchema(env); return jsonResponse({ok:true,phase:await createPhase(env,organizationId,roadmapId,user,await readJsonBody(request))},{status:201}); } catch(error){ return roadmapErrorResponse(error,request); }
}
