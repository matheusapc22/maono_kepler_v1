import {
  getOwnProjectChangeRequest,
  projectChangeRequestErrorResponse,
} from "../../../../_lib/project-change-requests.js";

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
    const changeRequest = await getOwnProjectChangeRequest(
      env,
      request,
      routeValue(params, "slug"),
      routeValue(params, "id"),
    );
    return Response.json({ ok: true, changeRequest });
  } catch (error) {
    return projectChangeRequestErrorResponse(error, request);
  }
}
