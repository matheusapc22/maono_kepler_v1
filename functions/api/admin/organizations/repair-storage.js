import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import {
  recordAuditLog,
  requirePermission,
} from "../../../_lib/permissions.js";
import {
  repairActiveOrganizationStorages,
} from "../../../_lib/organization-storage.js";

async function requireGlobalStorageRepairAccess(env, request) {
  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      scopeType: "global",
    },
    {
      resourceType: "platform",
      resourceId: "admin.organizations.repair_storage",
      auditAction: "admin.organizations.repair_storage",
      auditOnSuccess: false,
    },
  );
}

export async function onRequest({ env, request }) {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  let actor = null;

  try {
    const permission = await requireGlobalStorageRepairAccess(env, request);
    actor = permission.user;

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 100);
    const result = await repairActiveOrganizationStorages(env, { limit });

    await recordAuditLog(env, {
      actorUserId: actor.id,
      action: "admin.organizations.repair_storage",
      resourceType: "platform",
      resourceId: "organization_storage",
      result: result.failed > 0 ? "partial" : "success",
      metadata: {
        checked: result.checked,
        ready: result.ready,
        failed: result.failed,
      },
      request,
    });

    return jsonResponse({
      ok: result.failed === 0,
      ...result,
    });
  } catch (error) {
    if (actor?.id) {
      try {
        await recordAuditLog(env, {
          actorUserId: actor.id,
          action: "admin.organizations.repair_storage",
          resourceType: "platform",
          resourceId: "organization_storage",
          result: "failed",
          metadata: {
            code: error?.code || "ORGANIZATION_STORAGE_REPAIR_FAILED",
            stage: error?.stage || "organization.storage.repair",
          },
          request,
        });
      } catch (auditError) {
        console.error("[Maono storage repair][audit]", auditError);
      }
    }

    return errorResponse(
      error?.publicMessage || error?.message || "Falha ao reconciliar o armazenamento.",
      error?.status || 500,
      error?.code || "ORGANIZATION_STORAGE_REPAIR_FAILED",
      {
        stage: error?.stage || "organization.storage.repair",
      },
    );
  }
}
