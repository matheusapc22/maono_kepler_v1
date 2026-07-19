import { requireOrganizationPermission } from "../../../../../../_lib/permissions.js";
import { getRouteParam, jsonResponse, methodNotAllowed, parsePositiveInteger, readJsonBody } from "../../../../../../_lib/organizations.js";
import { archiveTask, assertRoadmapSchema, roadmapErrorResponse, updateTask } from "../../../../../../_lib/roadmaps.js";

export async function onRequest(context) {
  if (context.request.method === "PATCH") return mutate(context, false);
  if (context.request.method === "DELETE") return mutate(context, true);
  return methodNotAllowed(context.request.method, ["PATCH", "DELETE"]);
}
async function mutate({ env, request, params }, remove) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const roadmapId = parsePositiveInteger(getRouteParam(params, "roadmapId"), "roadmapId");
    const taskId = parsePositiveInteger(getRouteParam(params, "taskId"), "taskId");
    const { user } = await requireOrganizationPermission(env, request, "roadmap.task.manage", { organizationId, roadmapId, taskId, scopeType: "organization", resourceType: "roadmap_task" }, { audit: false });
    await assertRoadmapSchema(env);
    if (remove) { await archiveTask(env, organizationId, roadmapId, taskId, user); return jsonResponse({ ok: true }); }
    const task = await updateTask(env, organizationId, roadmapId, taskId, user, await readJsonBody(request));
    return jsonResponse({ ok: true, task });
  } catch (error) { return roadmapErrorResponse(error, request); }
}
