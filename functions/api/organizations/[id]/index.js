import { requireOrganizationPermission } from "../../../_lib/permissions.js";
import {
  getOrganizationById,
  getRouteParam,
  handleApiError,
  jsonResponse,
  listOrganizationUsers,
  listRowsByOrganization,
  methodNotAllowed,
  parsePositiveInteger,
  sanitizeOrganization,
  tableExists,
} from "../../../_lib/organizations.js";

function getOrganizationId(params) {
  return parsePositiveInteger(getRouteParam(params, "id"), "organizationId");
}

async function countRowsByOrganizationSafe(env, tableName, organizationId) {
  try {
    if (!(await tableExists(env, tableName))) {
      return 0;
    }

    const rows = await listRowsByOrganization(env, tableName, organizationId);

    return rows.length;
  } catch (error) {
    console.warn(
      `[Maono organizations API] Métrica ignorada para ${tableName}:`,
      error?.message || error,
    );

    return 0;
  }
}

async function buildOrganizationMetrics(env, organizationId) {
  const users = await listOrganizationUsers(env, organizationId);

  const projects = await countRowsByOrganizationSafe(
    env,
    "projects",
    organizationId,
  );

  const files = await countRowsByOrganizationSafe(
    env,
    "organization_files",
    organizationId,
  );

  const tickets = await countRowsByOrganizationSafe(
    env,
    "organization_tickets",
    organizationId,
  );

  const exportsCount = await countRowsByOrganizationSafe(
    env,
    "organization_exports",
    organizationId,
  );

  return {
    users: users.length,
    projects,
    files,
    tickets,
    exports: exportsCount,
  };
}

export async function onRequestGet({ env, request, params }) {
  try {
    const organizationId = getOrganizationId(params);

    await requireOrganizationPermission(
      env,
      request,
      "organization.view",
      organizationId,
      {
        resourceType: "organization",
        resourceId: organizationId,
      },
    );

    const organization = await getOrganizationById(env, organizationId);
    const metrics = await buildOrganizationMetrics(env, organizationId);

    return jsonResponse({
      ok: true,
      organization: sanitizeOrganization(organization, metrics),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function onRequest({ request }) {
  return methodNotAllowed(request.method, ["GET"]);
}