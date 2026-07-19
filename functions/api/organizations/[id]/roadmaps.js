import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import { getOrganizationOrThrow, getRouteParam, jsonResponse, methodNotAllowed, parsePositiveInteger, readJsonBody } from "../../../_lib/organizations.js";
import { assertRoadmapSchema, createRoadmap, listRoadmaps, roadmapErrorResponse } from "../../../_lib/roadmaps.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}

async function scope(env, request, params, permission) {
  const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
  const auth = await requireOrganizationPermission(env, request, permission, { organizationId, scopeType: "organization", resourceType: "roadmap" }, { audit: false, resourceType: "roadmap" });
  await getOrganizationOrThrow(env, organizationId);
  await assertRoadmapSchema(env);
  return { organizationId, ...auth };
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { organizationId } = await scope(env, request, params, "roadmap.view");
    return jsonResponse({ ok: true, roadmaps: await listRoadmaps(env, organizationId) });
  } catch (error) { return roadmapErrorResponse(error, request); }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const { organizationId, user } = await scope(env, request, params, "roadmap.manage");
    const roadmap = await createRoadmap(env, organizationId, user, await readJsonBody(request));
    return jsonResponse({ ok: true, roadmap }, { status: 201 });
  } catch (error) { return roadmapErrorResponse(error, request); }
}
