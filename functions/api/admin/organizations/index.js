import {
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { getOrCreateCorrelationId } from "../../../_lib/maono-error.js";
import {
  createOrganizationLifecycle,
} from "../../../_lib/organization-lifecycle.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";
import { readOrganizationStorageIncident } from "../../../_lib/organization-storage-retry.js";

async function requireGlobalAdminPanelAccess(env, request, action) {
  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      scopeType: "global",
    },
    {
      resourceType: "platform",
      resourceId: "admin.organizations",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

function publicOrganization(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    dropboxRootPath: row.dropbox_root_path,
    active: Boolean(row.active),
    storageStatus: row.storage_status || null,
    storageError: readOrganizationStorageIncident(row.storage_error)?.providerCode || null,
    storageCheckedAt: row.storage_checked_at || null,
    fileCount: row.file_count || 0,
    projectCount: row.project_count || 0,
    userCount: row.user_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listOrganizations(env, { includeInactive = false } = {}) {
  const whereClause = includeInactive ? "" : "WHERE organizations.active = 1";

  const { results } = await env.DB.prepare(
    `SELECT
      organizations.*,
      COUNT(DISTINCT organization_files.id) AS file_count,
      COUNT(DISTINCT projects.id) AS project_count,
      COUNT(DISTINCT organization_users.id) AS user_count
    FROM organizations
    LEFT JOIN organization_files
      ON organization_files.organization_id = organizations.id
      AND organization_files.active = 1
    LEFT JOIN projects
      ON projects.organization_id = organizations.id
      AND projects.active = 1
    LEFT JOIN organization_users
      ON organization_users.organization_id = organizations.id
    ${whereClause}
    GROUP BY organizations.id
    ORDER BY organizations.active DESC, organizations.name ASC`,
  ).all();

  return results || [];
}

export async function onRequest(context) {
  const { request, env } = context;
  const correlationId = getOrCreateCorrelationId(request);

  try {
    if (request.method === "GET") {
      await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.organizations.view",
      );

      const url = new URL(request.url);
      const includeInactive =
        url.searchParams.get("includeInactive") === "true";
      const organizations = await listOrganizations(env, { includeInactive });

      return jsonResponse(
        {
          ok: true,
          scope: "global",
          organizations: organizations.map(publicOrganization),
        },
        {
          headers: {
            "X-Correlation-Id": correlationId,
          },
        },
      );
    }

    if (request.method === "POST") {
      const { user } = await requireGlobalAdminPanelAccess(
        env,
        request,
        "admin.organizations.create",
      );

      const body = await readJsonBody(request);
      const lifecycle = await createOrganizationLifecycle(env, body, {
        correlationId,
      });
      const organization = lifecycle.organization;

      await logAudit(env, {
        userId: user.id,
        action: "admin.organizations.create",
        details: {
          correlationId,
          organizationId: organization.id,
          slug: organization.slug,
          active: Boolean(organization.active),
          lifecycleCreated: lifecycle.created,
          lifecycleResumed: lifecycle.resumed,
          storageReady: lifecycle.storageReady,
          storageStatus: organization.storage_status || null,
        },
      });

      return jsonResponse(
        {
          ok: true,
          organization: publicOrganization(organization),
          lifecycle: {
            created: lifecycle.created,
            resumed: lifecycle.resumed,
            storageReady: lifecycle.storageReady,
          },
        },
        {
          status: lifecycle.created ? 201 : 200,
          headers: {
            "X-Correlation-Id": correlationId,
          },
        },
      );
    }

    return methodNotAllowed(["GET", "POST"], { correlationId });
  } catch (error) {
    return errorResponseFromError(error, {
      correlationId,
      defaultCode: "ADMIN_ORGANIZATIONS_ERROR",
      publicMessage:
        error?.publicMessage || "Não foi possível concluir a operação com organizações.",
    });
  }
}
