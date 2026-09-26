import {
  assertTicketTriageWriteReady,
  getTicketTriageCapability,
  isTicketTriageEnabled,
} from "../../../_lib/ticket-triage.js";
import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  assertTicketCommandReady, executeTicketCreate, isTicketCommandsEnabled,
} from "../../../_lib/ticket-commands.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  jsonResponse,
  methodNotAllowed,
  parsePositiveInteger,
  readJsonBody,
} from "../../../_lib/organizations.js";
import {
  createTicket,
  ensureTicketCenterSchema,
  listTickets,
  migrateLegacyTickets,
  parseTicketListOptions,
  ticketCenterErrorResponse,
} from "../../../_lib/ticket-center.js";

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);

  return methodNotAllowed(context.request.method, ["GET", "POST"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );

    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.view",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "ticket",
      },
      {
        audit: false,
        resourceType: "ticket",
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    if (isTicketCommandsEnabled(env)) {
      await assertTicketCommandReady(env, organizationId);
    } else if (!isTicketTriageEnabled(env) || await getTicketTriageCapability(env)) {
      await migrateLegacyTickets(env, organizationId, user.id);
    }

    const data = await listTickets(
      env,
      organizationId,
      parseTicketListOptions(request.url),
      user,
    );

    return jsonResponse({ ok: true, ...data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(
      getRouteParam(params, "id"),
      "organizationId",
    );

    const { user } = await requireOrganizationPermission(
      env,
      request,
      "ticket.create",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "ticket",
      },
      {
        audit: false,
        // The domain service records successful creation after persistence.
        auditOnSuccess: false,
        resourceType: "ticket",
      },
    );

    await getOrganizationOrThrow(env, organizationId);
    await ensureTicketCenterSchema(env);
    const payload = await readJsonBody(request);
    if (isTicketCommandsEnabled(env) || request.headers.has("Idempotency-Key")) {
      await assertTicketCommandReady(env, organizationId);
      const result = await executeTicketCreate(env, organizationId, user, payload, request);
      return jsonResponse({ ok: true, ticket: result.ticket }, { status: result.status || 201,
        headers: { "Cache-Control": "private, no-store", "Idempotency-Replayed": String(Boolean(result.replayed)) },
      });
    }
    await assertTicketTriageWriteReady(env, payload);
    await migrateLegacyTickets(env, organizationId, user.id);

    const ticket = await createTicket(
      env,
      organizationId,
      user,
      payload,
      request,
    );

    return jsonResponse({ ok: true, ticket }, { status: 201 });
  } catch (error) {
    return ticketCenterErrorResponse(error, request);
  }
}
