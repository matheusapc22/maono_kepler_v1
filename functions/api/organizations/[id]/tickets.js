import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  handleApiError,
  insertRow,
  jsonResponse,
  listRowsByOrganization,
  methodNotAllowed,
  normalizeTicket,
  now,
  parsePositiveInteger,
  readJsonBody,
  validateTicketCreatePayload,
} from "../../../_lib/organizations.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "GET") {
    return onRequestGet(context);
  }

  if (request.method === "POST") {
    return onRequestPost(context);
  }

  return methodNotAllowed(request.method, ["GET", "POST"]);
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");

    await requireOrganizationPermission(
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

    const rows = await listRowsByOrganization(env, "tickets", organizationId);

    return jsonResponse({
      ok: true,
      tickets: rows.map(normalizeTicket),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequestPost({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");

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
        auditAction: "ticket.create",
        resourceType: "ticket",
        resourceId: organizationId,
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);

    const payload = validateTicketCreatePayload(await readJsonBody(request));

    const row = await insertRow(env, "tickets", {
      organization_id: organizationId,
      subject: payload.subject,
      title: payload.subject,
      description: payload.description,
      body: payload.description,
      status: "open",
      priority: payload.priority,
      created_by: user.id,
      user_id: user.id,
      created_at: now(),
      updated_at: now(),
      active: 1,
    });

    return jsonResponse(
      {
        ok: true,
        ticket: normalizeTicket(row),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
