import {
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import {
  getOrCreateCorrelationId,
} from "../../../_lib/maono-error.js";
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

function numericQueryParam(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export async function onRequest({ env, request }) {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const correlationId = getOrCreateCorrelationId(request);
  let actor = null;

  try {
    const permission = await requireGlobalStorageRepairAccess(env, request);
    actor = permission.user;

    const url = new URL(request.url);
    const limit = numericQueryParam(url, "limit", 100);
    const afterId = numericQueryParam(
      url,
      "afterId",
      numericQueryParam(url, "cursor", 0),
    );
    const result = await repairActiveOrganizationStorages(env, {
      limit,
      afterId,
      correlationId,
    });

    await recordAuditLog(env, {
      actorUserId: actor.id,
      action: "admin.organizations.repair_storage",
      resourceType: "platform",
      resourceId: "organization_storage",
      result: result.failed > 0 ? "partial" : "success",
      metadata: {
        correlationId,
        checked: result.checked,
        ready: result.ready,
        failed: result.failed,
        skipped: result.skipped,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      },
      request,
    });

    return jsonResponse(
      {
        ok: result.failed === 0,
        ...result,
      },
      {
        headers: {
          "X-Correlation-Id": correlationId,
        },
      },
    );
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
            correlationId,
            code: error?.code || "ORGANIZATION_STORAGE_REPAIR_FAILED",
            stage: error?.stage || "organization.storage.repair",
          },
          request,
        });
      } catch (auditError) {
        console.error("[Maono storage repair][audit]", {
          correlationId,
          code: auditError?.code || "AUDIT_LOG_FAILED",
        });
      }
    }

    return errorResponseFromError(error, {
      correlationId,
      publicMessage: "Falha ao reconciliar o armazenamento.",
      defaultCode: "ORGANIZATION_STORAGE_REPAIR_FAILED",
      category: "STORAGE",
    });
  }
}
