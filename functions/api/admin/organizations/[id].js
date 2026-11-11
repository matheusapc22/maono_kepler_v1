import {
  errorResponse,
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { getOrCreateCorrelationId } from "../../../_lib/maono-error.js";
import {
  getOrganizationLifecycleById,
  updateOrganizationLifecycle,
} from "../../../_lib/organization-lifecycle.js";
import { requirePermission } from "../../../_lib/permissions.js";
import { logAudit } from "../../../_lib/projects.js";
import { readOrganizationStorageIncident } from "../../../_lib/organization-storage-retry.js";

function normalizePositiveInteger(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

async function requireOrganizationAdminPanelAccess(
  env,
  request,
  organizationId,
  action,
) {
  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      organizationId,
      scopeType: "organization",
    },
    {
      resourceType: "organization",
      resourceId: organizationId,
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
    active: Boolean(row.active),
    dropboxRootConfigured: Boolean(row.dropbox_root_path),
    storageStatus: row.storage_status || null,
    storageError: readOrganizationStorageIncident(row.storage_error)?.providerCode || null,
    storageCheckedAt: row.storage_checked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const correlationId = getOrCreateCorrelationId(request);

  try {
    const organizationId = normalizePositiveInteger(params.id);

    if (!organizationId) {
      return errorResponse(
        "ID da organização inválido.",
        400,
        "ORGANIZATION_ID_INVALID",
        null,
        { correlationId },
      );
    }

    if (request.method === "GET") {
      await requireOrganizationAdminPanelAccess(
        env,
        request,
        organizationId,
        "admin.organizations.view",
      );

      const organization = await getOrganizationLifecycleById(
        env,
        organizationId,
      );

      if (!organization) {
        return errorResponse(
          "Organização não encontrada.",
          404,
          "ORGANIZATION_NOT_FOUND",
          null,
          { correlationId },
        );
      }

      return jsonResponse(
        {
          ok: true,
          organization: publicOrganization(organization),
        },
        {
          headers: {
            "X-Correlation-Id": correlationId,
          },
        },
      );
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const { user } = await requireOrganizationAdminPanelAccess(
        env,
        request,
        organizationId,
        "admin.organizations.update",
      );

      const body = await readJsonBody(request);
      const lifecycle = await updateOrganizationLifecycle(
        env,
        organizationId,
        body,
        { correlationId },
      );
      const organization = lifecycle.organization;

      await logAudit(env, {
        userId: user.id,
        action: "admin.organizations.update",
        details: {
          correlationId,
          organizationId,
          slug: organization.slug,
          active: Boolean(organization.active),
          dropboxRootConfigured: Boolean(organization.dropbox_root_path),
          storageReady: lifecycle.storageReady,
          storagePending: lifecycle.storagePending,
          storageStatus: organization.storage_status || null,
        },
      });

      return jsonResponse(
        {
          ok: true,
          organization: publicOrganization(organization),
          lifecycle: {
            storageReady: lifecycle.storageReady,
            storagePending: lifecycle.storagePending,
          },
        },
        {
          headers: {
            "X-Correlation-Id": correlationId,
          },
        },
      );
    }

    if (request.method === "DELETE") {
      await requireOrganizationAdminPanelAccess(
        env,
        request,
        organizationId,
        "admin.organizations.delete",
      );

      return errorResponse('Use a exclusão permanente protegida na gestão de organizações.',410,'ORGANIZATION_PERMANENT_DELETE_REQUIRED',null,{correlationId});
    }

    return methodNotAllowed(
      ["GET", "PUT", "PATCH", "DELETE"],
      { correlationId },
    );
  } catch (error) {
    return errorResponseFromError(error, {
      correlationId,
      defaultCode: "ADMIN_ORGANIZATION_ERROR",
      publicMessage:
        error?.publicMessage || "Não foi possível concluir a operação com a organização.",
    });
  }
}
