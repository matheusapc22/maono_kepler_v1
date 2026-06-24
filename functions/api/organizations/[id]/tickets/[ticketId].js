import { requireOrganizationPermission } from "../../../../_lib/permissions.js";
import {
  findRowByIdAndOrganization,
  getOrganizationOrThrow,
  getRouteParam,
  handleApiError,
  jsonResponse,
  methodNotAllowed,
  normalizeTicket,
  now,
  parsePositiveInteger,
  readJsonBody,
  updateRow,
  validateTicketPatchPayload,
} from "../../../../_lib/organizations.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "PATCH") {
    return onRequestPatch(context);
  }

  return methodNotAllowed(request.method, ["PATCH"]);
}

export async function onRequestPatch({ env, request, params }) {
  try {
    const organizationId = parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
    const ticketId = parsePositiveInteger(getRouteParam(params, "ticketId"), "ticketId");

    await requireOrganizationPermission(
      env,
      request,
      "ticket.manage",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "ticket",
        resourceId: ticketId,
      },
      {
        auditAction: "ticket.manage",
        resourceType: "ticket",
        resourceId: ticketId,
        auditOnSuccess: true,
      },
    );

    await getOrganizationOrThrow(env, organizationId);

    const ticket = await findRowByIdAndOrganization(
      env,
      "tickets",
      ticketId,
      organizationId,
    );

    if (!ticket) {
      return jsonResponse(
        {
          ok: false,
          error: "Chamado não encontrado.",
        },
        { status: 404 },
      );
    }

    const patch = validateTicketPatchPayload(await readJsonBody(request));

    const row = await updateRow(env, "tickets", ticketId, {
      ...patch,
      updated_at: now(),
    });

    return jsonResponse({
      ok: true,
      ticket: normalizeTicket(row || { ...ticket, ...patch, updated_at: now() }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
