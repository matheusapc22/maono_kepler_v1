import { requireOrganizationPermission } from "../../../../_lib/permissions.js";
import { getRouteParam, jsonResponse, methodNotAllowed, parsePositiveInteger, readJsonBody } from "../../../../_lib/organizations.js";
import { assertRoadmapSchema, getRoadmapBundle, roadmapErrorResponse, updateRoadmap } from "../../../../_lib/roadmaps.js";

export async function onRequest(context) {
  if (context.request.method === "PATCH") return mutate(context, false);
  if (context.request.method === "DELETE") return mutate(context, true);
  if (context.request.method !== "GET") return methodNotAllowed(context.request.method, ["GET", "PATCH", "DELETE"]);
  const { env, request, params } = context;
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const roadmapId = parsePositiveInteger(getRouteParam(params, "roadmapId"), "roadmapId");
    await requireOrganizationPermission(env, request, "roadmap.view", { organizationId, scopeType: "organization", resourceType: "roadmap", resourceId: roadmapId }, { audit: false });
    await assertRoadmapSchema(env);
    const url = new URL(request.url);
    const filters = Object.fromEntries(["status", "priority", "assigneeId", "phaseId", "search", "periodStart", "periodEnd"].map((key) => [key, url.searchParams.get(key) || ""]));
    return jsonResponse({ ok: true, ...(await getRoadmapBundle(env, organizationId, roadmapId, filters)) });
  } catch (error) { return roadmapErrorResponse(error, request); }
}

async function mutate({ env, request, params }, archive) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const roadmapId = parsePositiveInteger(getRouteParam(params, "roadmapId"), "roadmapId");
    const { user } = await requireOrganizationPermission(env, request, "roadmap.manage", { organizationId, roadmapId, scopeType: "organization", resourceType: "roadmap" }, { audit: false });
    await assertRoadmapSchema(env);
    const roadmap = await updateRoadmap(env, organizationId, roadmapId, user, archive ? {} : await readJsonBody(request), archive);
    return jsonResponse({ ok: true, roadmap });
  } catch (error) { return roadmapErrorResponse(error, request); }
}
