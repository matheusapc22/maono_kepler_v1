import { requireOrganizationPermission } from "../../../../../../../_lib/permissions.js";
import { getRouteParam, jsonResponse, methodNotAllowed, parsePositiveInteger, readJsonBody } from "../../../../../../../_lib/organizations.js";
import { assertRoadmapSchema, createComment, listComments, roadmapErrorResponse } from "../../../../../../../_lib/roadmaps.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return handle(context, false);
  if (context.request.method === "POST") return handle(context, true);
  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}
async function handle({ env, request, params }, create) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const roadmapId = parsePositiveInteger(getRouteParam(params, "roadmapId"), "roadmapId");
    const taskId = parsePositiveInteger(getRouteParam(params, "taskId"), "taskId");
    const { user } = await requireOrganizationPermission(env, request, create ? "roadmap.comment.create" : "roadmap.view", { organizationId, roadmapId, taskId, scopeType: "organization", resourceType: "roadmap_comment" }, { audit: false });
    await assertRoadmapSchema(env);
    const comments = create ? await createComment(env, organizationId, roadmapId, taskId, user, await readJsonBody(request)) : await listComments(env, organizationId, roadmapId, taskId);
    return jsonResponse({ ok: true, comments }, { status: create ? 201 : 200 });
  } catch (error) { return roadmapErrorResponse(error, request); }
}
