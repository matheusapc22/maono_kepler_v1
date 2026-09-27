import {
  can,
  requireOrganizationPermission,
} from "../../../../../_lib/permissions.js";
import { requireTicketAccess } from "../../../../../_lib/ticket-access.js";
import {
  getTicketResumableUploadCapability,
  initiateResumableTicketAttachmentUpload,
} from "../../../../../_lib/ticket-attachment-uploads.js";
import {
  assertConversationDraftAttachmentWrite,
  resolveTicketConversationContext,
} from "../../../../../_lib/ticket-conversations.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../../../_lib/organizations.js";
import {
  createTicketAttachment,
  ensureTicketCenterSchema,
  getTicketOrThrow,
  initiateTicketAttachmentUpload,
  listTicketAttachments,
  ticketCenterErrorResponse,
} from "../../../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);

  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}

function routeIds(params) {
  return {
    organizationId: parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    ),
    ticketId: parsePositiveInteger(
      getRouteParam(params, "ticketId"),
      "ticketId",
    ),
  };
}

async function ticketViewContext(env, request, organizationId, ticketId) {
  return requireOrganizationPermission(
    env,
    request,
    "ticket.view",
    {
      organizationId,
      scopeType: "organization",
      resourceType: "ticket",
      resourceId: ticketId,
    },
    {
      audit: false,
      resourceType: "ticket",
    },
  );
}

export async function onRequestGet({ env, request, params }) {
  try {
    const { organizationId, ticketId } = routeIds(params);
    const { user } = await ticketViewContext(env, request, organizationId, ticketId);
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await requireTicketAccess(env, organizationId, ticketId, user, "ticket.view");
    await getTicketOrThrow(env, organizationId, ticketId);

    const conversationContext = await resolveTicketConversationContext(
      env, organizationId, ticketId, user, { ticketView: true },
    );
    return jsonResponse({
      ok: true,
      attachments: await listTicketAttachments(
        env,
        organizationId,
        ticketId,
        { canViewInternal: conversationContext.noteView },
      ),
    });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const { organizationId, ticketId } = routeIds(params);
    const { user } = await ticketViewContext(
      env,
      request,
      organizationId,
      ticketId,
    );
    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    await requireTicketAccess(env, organizationId, ticketId, user, "ticket.comment");

    const permissionContext = {
      organizationId,
      scopeType: "organization",
      resourceType: "ticket",
      resourceId: ticketId,
    };
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.toLowerCase().includes("application/json")) {
      const payload = await readJsonBody(request);
      if (payload?.draftId) {
        const conversationContext = await resolveTicketConversationContext(
          env, organizationId, ticketId, user, { ticketView: true },
        );
        const draft = await assertConversationDraftAttachmentWrite(
          env, conversationContext, payload.draftId,
        );
        const resumable = await getTicketResumableUploadCapability(env);
        const result = resumable.configured
          ? await initiateResumableTicketAttachmentUpload(
              env, organizationId, ticketId, user, payload, { draft },
            )
          : await initiateTicketAttachmentUpload(
              env, organizationId, ticketId, user, payload, { draftId: draft.id },
            );
        return jsonResponse({ ok: true, ...result }, { status: 201 });
      }

      const createDecision = await can(env, user, "ticket.create", permissionContext);
      const manageDecision = await can(env, user, "ticket.manage", permissionContext);
      if (!createDecision.allowed && !manageDecision.allowed) {
        const error = new Error("Você não pode adicionar anexos a este chamado.");
        error.status = 403;
        error.code = "ATTACHMENT_UPLOAD_FORBIDDEN";
        throw error;
      }
      const resumable = await getTicketResumableUploadCapability(env);
      const result = resumable.configured
        ? await initiateResumableTicketAttachmentUpload(
            env, organizationId, ticketId, user, payload,
          )
        : await initiateTicketAttachmentUpload(
            env, organizationId, ticketId, user, payload,
          );
      return jsonResponse({ ok: true, ...result }, { status: 201 });
    }

    const resumable = await getTicketResumableUploadCapability(env);
    if (resumable.configured) {
      const error = new Error("Este ambiente exige o fluxo resumível para novos anexos.");
      error.status = resumable.schemaReady ? 409 : 503;
      error.code = resumable.schemaReady
        ? "ATTACHMENT_RESUMABLE_UPLOAD_REQUIRED"
        : "TICKET_RESUMABLE_UPLOADS_SCHEMA_OUTDATED";
      throw error;
    }

    const createDecision = await can(env, user, "ticket.create", permissionContext);
    const manageDecision = await can(env, user, "ticket.manage", permissionContext);
    if (!createDecision.allowed && !manageDecision.allowed) {
      const error = new Error("Você não pode adicionar anexos a este chamado.");
      error.status = 403;
      error.code = "ATTACHMENT_UPLOAD_FORBIDDEN";
      throw error;
    }

    const attachment = await createTicketAttachment(
      env,
      organizationId,
      ticketId,
      user,
      request,
    );

    return jsonResponse({ ok: true, attachment }, { status: 201 });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
