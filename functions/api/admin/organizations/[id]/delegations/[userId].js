import { normalizeRole, requireSession } from "../../../../../_lib/auth.js";
import { disableDelegationPolicy, permissionCatalog, readDelegationPolicy, saveDelegationPolicy } from "../../../../../_lib/access-delegation.js";
import { errorResponse, jsonResponse, methodNotAllowed, readJsonBody } from "../../../../../_lib/http.js";

function positive(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; }

export async function onRequestGet({ env, request, params }) {
  try {
    const actor = await requireSession(env, request); const organizationId = positive(params.id); const userId = positive(params.userId);
    if (!organizationId || !userId) return errorResponse("Identificador inválido.", 400, "INVALID_IDENTIFIER");
    if (normalizeRole(actor.role) !== "super_admin" && Number(actor.id) !== userId) return errorResponse("Acesso negado.", 403, "FORBIDDEN");
    const policy = await readDelegationPolicy(env, organizationId, userId);
    return jsonResponse({ ok: true, policy, catalog: permissionCatalog() });
  } catch (error) { return errorResponse(error.message, error.status || 500, error.code || "DELEGATION_READ_ERROR", { reason: error.reason, policyVersion: error.policyVersion }); }
}

export async function onRequestPut({ env, request, params }) {
  try {
    const actor = await requireSession(env, request); const body = await readJsonBody(request);
    const policy = await saveDelegationPolicy(env, request, actor, params.id, params.userId, body);
    return jsonResponse({ ok: true, policy });
  } catch (error) { return errorResponse(error.message, error.status || 500, error.code || "DELEGATION_UPDATE_ERROR", { reason: error.reason, policyVersion: error.policyVersion }); }
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const actor = await requireSession(env, request);
    const result = await disableDelegationPolicy(env, request, actor, params.id, params.userId);
    return jsonResponse({ ok: true, ...result });
  } catch (error) { return errorResponse(error.message, error.status || 500, error.code || "DELEGATION_DISABLE_ERROR", { reason: error.reason }); }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PUT") return onRequestPut(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(["GET", "PUT", "DELETE"]);
}
