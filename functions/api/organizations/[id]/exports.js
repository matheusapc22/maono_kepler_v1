import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  getOrganizationOrThrow,
  getRouteParam,
  handleApiError,
  insertRow,
  jsonResponse,
  listRowsByOrganization,
  methodNotAllowed,
  normalizeExport,
  now,
  parsePositiveInteger,
  readJsonBody,
  tableExists,
  validateExportPayload,
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
      "export.view",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "export",
      },
      {
        audit: false,
        resourceType: "export",
      },
    );

    await getOrganizationOrThrow(env, organizationId);

    if (!(await tableExists(env, "organization_exports"))) {
      return jsonResponse({
        ok: true,
        exports: [],
        warning: "Tabela organization_exports ainda não existe.",
      });
    }

    const rows = await listRowsByOrganization(env, "organization_exports", organizationId);

    return jsonResponse({
      ok: true,
      exports: rows.map(normalizeExport),
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
      "export.create",
      {
        organizationId,
        scopeType: "organization",
        resourceType: "export",
      },
      {
        auditAction: "export.create",
        resourceType: "export",
        resourceId: organizationId,
        auditOnSuccess: false,
      },
    );

    await getOrganizationOrThrow(env, organizationId);

    if (!(await tableExists(env, "organization_exports"))) {
      return jsonResponse(
        {
          ok: false,
          error: "Tabela organization_exports ainda não existe. Crie a migration antes de solicitar exportações.",
        },
        { status: 500 },
      );
    }

    const payload = validateExportPayload(await readJsonBody(request));

    /**
     * Sprint 7 cria a solicitação de exportação com status queued.
     * Download real deve ser endpoint próprio validando export.download.
     */
    const row = await insertRow(env, "organization_exports", {
      organization_id: organizationId,
      type: payload.type,
      export_type: payload.type,
      format: payload.format,
      file_format: payload.format,
      status: "queued",
      requested_by: user.id,
      created_by: user.id,
      created_at: now(),
      updated_at: now(),
      active: 1,
    });

    return jsonResponse(
      {
        ok: true,
        export: normalizeExport(row),
      },
      { status: 202 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
