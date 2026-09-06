import { listEditorProjectChangeRequests, parseInboxOptions } from "../../../../_lib/project-change-request-inbox.js";
import { projectChangeRequestErrorResponse } from "../../../../_lib/project-change-requests.js";

export async function onRequest({ env, request, params }) {
  if (request.method !== "GET") return new Response("Method Not Allowed", {
    status: 405, headers: { Allow: "GET" },
  });
  try {
    const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
    const result = await listEditorProjectChangeRequests(
      env, request, slug, parseInboxOptions(new URL(request.url)),
    );
    return Response.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = projectChangeRequestErrorResponse(error, request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
