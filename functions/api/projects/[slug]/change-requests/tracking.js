import {
  listOwnTrackedProjectChangeRequests,
} from "../../../../_lib/project-change-request-resubmission.js";
import { projectChangeRequestErrorResponse } from "../../../../_lib/project-change-requests.js";

function routeValue(params, key) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

export async function onRequest({ env, request, params }) {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  try {
    const url = new URL(request.url);
    const items = await listOwnTrackedProjectChangeRequests(
      env,
      request,
      routeValue(params, "slug"),
      { limit: url.searchParams.get("limit") },
    );
    return Response.json({ ok: true, items });
  } catch (error) {
    return projectChangeRequestErrorResponse(error, request);
  }
}
