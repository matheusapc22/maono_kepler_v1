import { requireOrganizationPermission } from "../../../../../_lib/permissions.js";
import { getRouteParam, jsonResponse, methodNotAllowed, parsePositiveInteger, readJsonBody } from "../../../../../_lib/organizations.js";
import { assertRoadmapSchema, createTask, getRoadmapBundle, roadmapErrorResponse } from "../../../../../_lib/roadmaps.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}
function ids(params) { return { organizationId: parsePositiveInteger(getRouteParam(params, "id"), "organizationId"), roadmapId: parsePositiveInteger(getRouteParam(params, "roadmapId"), "roadmapId") }; }
export async function onRequestGet({ env, request, params }) {
  try { const value = ids(params); await requireOrganizationPermission(env, request, "roadmap.view", { ...value, scopeType: "organization", resourceType: "roadmap" }, { audit: false }); await assertRoadmapSchema(env); return jsonResponse({ ok: true, ...(await getRoadmapBundle(env, value.organizationId, value.roadmapId)) }); } catch (error) { return roadmapErrorResponse(error, request); }
}
export async function onRequestPost({ env, request, params }) {
  try { const value = ids(params); const { user } = await requireOrganizationPermission(env, request, "roadmap.task.manage", { ...value, scopeType: "organization", resourceType: "roadmap_task" }, { audit: false }); await assertRoadmapSchema(env); const task = await createTask(env, value.organizationId, value.roadmapId, user, await readJsonBody(request)); return jsonResponse({ ok: true, task }, { status: 201 }); } catch (error) { return roadmapErrorResponse(error, request); }
}
