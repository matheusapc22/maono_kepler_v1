import { can, requireOrganizationPermission } from "../../../../../../../_lib/permissions.js";
import { requireTicketAccess } from "../../../../../../../_lib/ticket-access.js";
import { resolveTicketConversationContext } from "../../../../../../../_lib/ticket-conversations.js";
import {
  cancelTicketAttachmentUpload,
  getTicketAttachmentUploadSession,
  reconcileTicketAttachmentUpload,
  uploadTicketAttachmentSessionChunk,
} from "../../../../../../../_lib/ticket-attachment-uploads.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
} from "../../../../../../../_lib/organizations.js";
import { ensureTicketCenterSchema, ticketCenterErrorResponse } from "../../../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "HEAD") return onRequestHead(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return methodNotAllowed(context.request.method, ["HEAD", "PATCH", "POST", "DELETE"]);
}

function routeIds(params) {
  return {
    organizationId: parsePositiveInteger(getRouteParam(params, "id"), "organizationId"),
    ticketId: parsePositiveInteger(getRouteParam(params, "ticketId"), "ticketId"),
    uploadId: String(getRouteParam(params, "uploadId") || "").trim(),
  };
}

async function authorizedContext(env, request, organizationId, ticketId) {
  const { user } = await requireOrganizationPermission(
    env,
    request,
    "ticket.view",
    { organizationId, scopeType: "organization", resourceType: "ticket_upload", resourceId: ticketId },
    { audit: false, resourceType: "ticket_upload" },
  );
  await getOrganizationOrThrow(env, organizationId);
  await ensureTicketCenterSchema(env);
  await requireTicketAccess(env, organizationId, ticketId, user, "ticket.comment");
  return {
    user,
    conversation: await resolveTicketConversationContext(env, organizationId, ticketId, user, { ticketView: true }),
  };
}

async function requireStandardUploadMutationPermission(
  env,
  user,
  organizationId,
  ticketId,
  session,
) {
  if (session.draftId) return;
  const permissionContext = {
    organizationId,
    scopeType: "organization",
    resourceType: "ticket",
    resourceId: ticketId,
  };
  const [createDecision, manageDecision] = await Promise.all([
    can(env, user, "ticket.create", permissionContext),
    can(env, user, "ticket.manage", permissionContext),
  ]);
  if (!createDecision.allowed && !manageDecision.allowed) {
    const error = new Error("Você não pode continuar este envio.");
    error.status = 403;
    error.code = "ATTACHMENT_UPLOAD_FORBIDDEN";
    throw error;
  }
}

function sessionHeaders(session) {
  return {
    "Cache-Control": "private, no-store",
    "Upload-Offset": String(session.offset),
    "Upload-Length": String(session.size),
    "Upload-Expires": session.expiresAt,
    "ETag": session.etag,
  };
}

export async function onRequestHead({ env, request, params }) {
  try {
    const { organizationId, ticketId, uploadId } = routeIds(params);
    const { conversation } = await authorizedContext(env, request, organizationId, ticketId);
    const session = await getTicketAttachmentUploadSession(env, conversation, uploadId);
    return new Response(null, { status: 204, headers: sessionHeaders(session) });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const { organizationId, ticketId, uploadId } = routeIds(params);
    const { user, conversation } = await authorizedContext(env, request, organizationId, ticketId);
    const session = await getTicketAttachmentUploadSession(env, conversation, uploadId);
    await requireStandardUploadMutationPermission(
      env, user, organizationId, ticketId, session,
    );
    const result = await uploadTicketAttachmentSessionChunk(env, conversation, uploadId, user, request);
    return jsonResponse({ ok: true, ...result }, { headers: sessionHeaders(result.session) });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

// Explicit reconcile endpoint. It never appends bytes; it only confirms a
// provider commit already present after a finalize response was lost.
export async function onRequestPost({ env, request, params }) {
  try {
    const { organizationId, ticketId, uploadId } = routeIds(params);
    const { user, conversation } = await authorizedContext(env, request, organizationId, ticketId);
    const session = await getTicketAttachmentUploadSession(env, conversation, uploadId);
    await requireStandardUploadMutationPermission(
      env, user, organizationId, ticketId, session,
    );
    const result = await reconcileTicketAttachmentUpload(env, conversation, uploadId, user, request);
    return jsonResponse({ ok: true, ...result }, { headers: sessionHeaders(result.session) });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestDelete({ env, request, params }) {
  try {
    const { organizationId, ticketId, uploadId } = routeIds(params);
    const { conversation } = await authorizedContext(env, request, organizationId, ticketId);
    const result = await cancelTicketAttachmentUpload(env, conversation, uploadId);
    return jsonResponse({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
