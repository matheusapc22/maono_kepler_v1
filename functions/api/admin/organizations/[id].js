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
import {
  deleteDropboxPath,
} from "../../../_lib/dropbox.js";
import { logAudit } from "../../../_lib/projects.js";

function normalizePositiveInteger(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function isDropboxNotFoundError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("path/not_found") ||
    message.includes("path_lookup/not_found")
  );
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
    storageError: row.storage_error || null,
    storageCheckedAt: row.storage_checked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function deleteOrganization(env, organizationId, hardDeleteDropbox) {
  const current = await getOrganizationLifecycleById(env, organizationId);

  if (!current) {
    return {
      error: {
        message: "Organização não encontrada.",
        status: 404,
        code: "ORGANIZATION_NOT_FOUND",
      },
    };
  }

  const linkedProjects = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM projects
     WHERE organization_id = ?
       AND active = 1`,
  )
    .bind(organizationId)
    .first();

  if (linkedProjects?.total > 0) {
    return {
      error: {
        message:
          "Esta organização possui projetos ativos. Desative ou remova os projetos antes de excluir a organização.",
        status: 409,
        code: "ORGANIZATION_HAS_ACTIVE_PROJECTS",
      },
    };
  }

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM organization_users
       WHERE organization_id = ?`,
    ).bind(organizationId),
    env.DB.prepare(
      `UPDATE organization_files
       SET active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = ?`,
    ).bind(organizationId),
    env.DB.prepare(
      `UPDATE organizations
       SET active = 0,
           storage_status = 'DISABLED',
           storage_error = NULL,
           storage_checked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(organizationId),
  ]);

  let dropboxDeleted = false;
  let dropboxAlreadyMissing = false;

  if (hardDeleteDropbox && current.dropbox_root_path) {
    try {
      await deleteDropboxPath(env, current.dropbox_root_path);
      dropboxDeleted = true;
    } catch (error) {
      if (isDropboxNotFoundError(error)) {
        dropboxAlreadyMissing = true;
      } else {
        throw error;
      }
    }
  }

  return {
    organization: current,
    dropboxDeleted,
    dropboxAlreadyMissing,
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
      const { user } = await requireOrganizationAdminPanelAccess(
        env,
        request,
        organizationId,
        "admin.organizations.delete",
      );

      const url = new URL(request.url);
      const hardDeleteDropbox = url.searchParams.get("dropbox") === "true";
      const {
        organization,
        dropboxDeleted,
        dropboxAlreadyMissing,
        error,
      } = await deleteOrganization(
        env,
        organizationId,
        hardDeleteDropbox,
      );

      if (error) {
        return errorResponse(
          error.message,
          error.status,
          error.code,
          null,
          { correlationId },
        );
      }

      await logAudit(env, {
        userId: user.id,
        action: hardDeleteDropbox
          ? "admin.organizations.delete_dropbox"
          : "admin.organizations.deactivate",
        details: {
          correlationId,
          organizationId,
          slug: organization.slug,
          hardDeleteDropbox,
          dropboxDeleted,
          dropboxAlreadyMissing,
        },
      });

      return jsonResponse(
        {
          ok: true,
          dropboxDeleted,
          dropboxAlreadyMissing,
        },
        {
          headers: {
            "X-Correlation-Id": correlationId,
          },
        },
      );
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
