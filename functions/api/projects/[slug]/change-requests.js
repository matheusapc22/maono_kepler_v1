import { readJsonBody } from "../../../_lib/organizations.js";
import {
  listOwnProjectChangeRequests,
  projectChangeRequestErrorResponse,
} from "../../../_lib/project-change-requests.js";
import {
  submitAnalysisAwareProjectChangeRequest,
} from "../../../_lib/project-change-request-analysis-submission.js";

function routeSlug(params) {
  const value = params?.slug;
  return Array.isArray(value) ? value[0] : value;
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);

  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST" },
  });
}

export async function onRequestGet({ env, request, params }) {
  try {
    const url = new URL(request.url);
    const items = await listOwnProjectChangeRequests(
      env,
      request,
      routeSlug(params),
      { limit: url.searchParams.get("limit") },
    );
    return Response.json({ ok: true, items });
  } catch (error) {
    return projectChangeRequestErrorResponse(error, request);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const result = await submitAnalysisAwareProjectChangeRequest(
      env,
      request,
      routeSlug(params),
      await readJsonBody(request),
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
