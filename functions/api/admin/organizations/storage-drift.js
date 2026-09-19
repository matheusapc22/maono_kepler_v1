import {
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../../_lib/http.js";
import { getOrCreateCorrelationId } from "../../../_lib/maono-error.js";
import {
  applyOrganizationStorageDriftRepairs,
  buildOrganizationStorageDriftReport,
  publicOrganizationStorageDriftReport,
} from "../../../_lib/organization-storage-drift.js";
import {
  recordAuditLog,
  requirePermission,
} from "../../../_lib/permissions.js";

async function requireGlobalDriftAccess(env, request, action) {
  return requirePermission(
    env,
    request,
    "admin.panel.access",
    {
      scopeType: "global",
    },
    {
      resourceType: "platform",
      resourceId: "admin.organizations.storage_drift",
      auditAction: action,
      auditOnSuccess: false,
    },
  );
}

export async function onRequest({ env, request }) {
  const correlationId = getOrCreateCorrelationId(request);
  let actor = null;

  try {
    if (request.method === "GET") {
      const permission = await requireGlobalDriftAccess(
        env,
        request,
        "admin.organizations.storage_drift.report",
      );
      actor = permission.user;

      const report = await buildOrganizationStorageDriftReport(
        env,
        { correlationId },
      );

      await recordAuditLog(env, {
        actorUserId: actor.id,
        action: "admin.organizations.storage_drift.report",
        resourceType: "platform",
        resourceId: "organization_storage",
        result: "success",
        metadata: {
          correlationId,
          complete: report.complete,
          providerPages: report.providerPages,
          summary: report.summary,
        },
        request,
      });

      return jsonResponse(
        {
          ok: true,
          report: publicOrganizationStorageDriftReport(report),
        },
        {
          headers: {
            "X-Correlation-Id": correlationId,
          },
        },
      );
    }

    if (request.method === "POST") {
      const permission = await requireGlobalDriftAccess(
        env,
        request,
        "admin.organizations.storage_drift.apply",
      );
      actor = permission.user;

      const body = await readJsonBody(request);
      const result = await applyOrganizationStorageDriftRepairs(
        env,
        {
          approvedOrganizationIds:
            body?.approvedOrganizationIds,
          confirmation: body?.confirmation,
          correlationId,
        },
      );

      await recordAuditLog(env, {
        actorUserId: actor.id,
        action: "admin.organizations.storage_drift.apply",
        resourceType: "platform",
        resourceId: "organization_storage",
        result:
          result.failed > 0 ? "partial" : "success",
        metadata: {
          correlationId,
          approved: result.approved,
          repaired: result.repaired,
          skipped: result.skipped,
          failed: result.failed,
        },
        request,
      });

      return jsonResponse(
        {
          ok: result.failed === 0,
          result,
        },
        {
          headers: {
            "X-Correlation-Id": correlationId,
          },
        },
      );
    }

    return methodNotAllowed(["GET", "POST"], {
      correlationId,
    });
  } catch (error) {
    if (actor?.id) {
      try {
        await recordAuditLog(env, {
          actorUserId: actor.id,
          action:
            request.method === "POST"
              ? "admin.organizations.storage_drift.apply"
              : "admin.organizations.storage_drift.report",
          resourceType: "platform",
          resourceId: "organization_storage",
          result: "failed",
          metadata: {
            correlationId,
            code:
              error?.code ||
              "ORGANIZATION_STORAGE_DRIFT_FAILED",
            stage:
              error?.stage ||
              "organization.storage.drift",
          },
          request,
        });
      } catch (auditError) {
        console.error("[Maono storage drift][audit]", {
          correlationId,
          code:
            auditError?.code || "AUDIT_LOG_FAILED",
        });
      }
    }

    return errorResponseFromError(error, {
      correlationId,
      defaultCode: "ORGANIZATION_STORAGE_DRIFT_FAILED",
      category: "STORAGE",
      publicMessage:
        "Não foi possível concluir a análise de armazenamento.",
    });
  }
}
