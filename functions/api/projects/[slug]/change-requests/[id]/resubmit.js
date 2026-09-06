import {
  resubmitProjectChangeRequest,
} from "../../../../../_lib/project-change-request-resubmission.js";
import { projectChangeRequestErrorResponse } from "../../../../../_lib/project-change-requests.js";

function routeValue(params, key) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

export async function onRequest({ env, request, params }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  try {
    const input = await request.json().catch(() => {
      const error = new Error("JSON inválido.");
      error.status = 400;
      error.code = "INVALID_JSON";
      throw error;
    });
    const result = await resubmitProjectChangeRequest(
      env,
      request,
      routeValue(params, "slug"),
      routeValue(params, "id"),
      input,
    );
    return Response.json(
      {
        ok: true,
        replayed: result.replayed,
        changeRequest: result.changeRequest,
      },
      { status: result.status },
    );
  } catch (error) {
    return projectChangeRequestErrorResponse(error, request);
  }
}
