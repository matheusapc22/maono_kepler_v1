import { onRequest as register } from "../../functions/api/projects/[slug]/save-operations/index.js";
import { onRequest as status } from "../../functions/api/projects/[slug]/save-operations/[operationId].js";
import { onRequest as payload } from "../../functions/api/projects/[slug]/save-operations/[operationId]/payload.js";

// Pages matches URL.pathname and passes percent-encoded captures unchanged:
// https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/templates/pages-template-worker.ts
// Its path-to-regexp 6.3.0 matcher defaults to identity decoding. Keep decoding
// in the real endpoint, not in this local HTTP adapter.
export function routeProjectSaveRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/save-operations(?:\/([^/]+))?(\/payload)?\/?$/);
  if (!match) throw new Error(`Unexpected save route: ${pathname}`);
  const handler = match[3] ? payload : match[2] ? status : register;
  return handler({ ...context, params: { slug: match[1], operationId: match[2] } });
}
