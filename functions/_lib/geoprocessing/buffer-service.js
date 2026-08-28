import { requireSession } from "../auth.js";
import { isFeatureFlagEnabled } from "../organization-limit-service.js";
import { can, recordAuditLog } from "../permissions.js";
import {
  evaluatePreviewWritePolicy,
} from "../preview-write-policy.js";
import {
  getActiveOrganizationId,
  getAuthorizedProject,
} from "../projects.js";
import {
  createBufferError,
  normalizeBufferInput,
} from "./buffer-contract.js";
import { executeRadialBuffer } from "./radial-buffer-engine.js";

export function isBufferFeatureEnabled(env) {
  return isFeatureFlagEnabled(env?.GEOPROCESSING_BUFFER_V1, false);
}

async function safeAudit(env, event, auditImpl = recordAuditLog) {
  try {
    await auditImpl(env, event);
  } catch (error) {
    console.error("[Maono buffers] Falha de auditoria:", error);
  }
}

function runtimeCanPersist(env, { organizationId, projectSlug = null }) {
  const pathname = projectSlug
    ? `/api/projects/${encodeURIComponent(projectSlug)}/config`
    : "/api/projects";
  const method = projectSlug ? "PUT" : "POST";
  return evaluatePreviewWritePolicy(env, {
    method,
    pathname,
    organizationId,
  }).allowed;
}

async function resolveAccess(env, request, input, options) {
  const user = options.user || (await requireSession(env, request));

  if (input.projectSlug) {
    const project =
      options.project ||
      (await getAuthorizedProject(env, user, input.projectSlug));

    if (!project) {
      throw createBufferError(
        "Projeto não encontrado.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    const context = {
      project,
      projectId: project.id,
      projectSlug: project.slug,
      organizationId: project.organization_id,
      scopeType: "project",
    };
    const [viewDecision, editDecision, saveDecision] = await Promise.all([
      can(env, user, "project.view", context),
      can(env, user, "project.map.edit", context),
      can(env, user, "project.save", context),
    ]);

    if (!viewDecision.allowed) {
      throw createBufferError(
        "Você não possui permissão para gerar análises neste mapa.",
        403,
        "BUFFER_PREVIEW_FORBIDDEN",
      );
    }

    return {
      user,
      organizationId: project.organization_id,
      projectId: project.id,
      canPersist:
        editDecision.allowed &&
        saveDecision.allowed &&
        runtimeCanPersist(env, {
          organizationId: project.organization_id,
          projectSlug: project.slug,
        }),
    };
  }

  const organizationId = getActiveOrganizationId(user);
  if (!organizationId) {
    throw createBufferError(
      "Selecione uma organização ativa.",
      409,
      "ACTIVE_ORGANIZATION_REQUIRED",
    );
  }

  const createDecision = await can(env, user, "project.create", {
    organizationId,
    scopeType: "organization",
  });
  if (!createDecision.allowed) {
    throw createBufferError(
      "Você não possui permissão para gerar análises em um novo mapa.",
      403,
      "BUFFER_PREVIEW_FORBIDDEN",
    );
  }

  return {
    user,
    organizationId,
    projectId: null,
    canPersist:
      createDecision.allowed &&
      runtimeCanPersist(env, { organizationId, projectSlug: null }),
  };
}

export async function generateRadialBuffer(
  env,
  request,
  rawInput,
  options = {},
) {
  const startedAt = Date.now();
  const input = normalizeBufferInput(rawInput);

  if (!isBufferFeatureEnabled(env)) {
    throw createBufferError(
      "A ferramenta de buffers não está disponível neste ambiente.",
      503,
      "BUFFER_FEATURE_DISABLED",
    );
  }

  const access = await resolveAccess(env, request, input, options);
  const auditBase = {
    actorUserId: access.user.id,
    organizationId: access.organizationId,
    projectId: access.projectId,
    resourceType: access.projectId ? "project" : "organization",
    resourceId: access.projectId || access.organizationId,
    request,
  };
  const auditImpl = options.auditImpl || recordAuditLog;

  try {
    const { geojson, engineMetadata } = executeRadialBuffer(input, {
      segmentsPerQuadrant: options.segmentsPerQuadrant,
    });
    const metadata = {
      analysis: "radial_buffer",
      ranges: input.ranges,
      inputUnit: input.inputUnit,
      rangesMeters: input.rangesMeters,
      featureCount: geojson.features.length,
      engine: engineMetadata.engine,
      segmentsPerQuadrant: engineMetadata.segmentsPerQuadrant,
      antimeridianSplitCount: engineMetadata.antimeridianSplitCount || 0,
      crs: input.crs,
      canPersist: access.canPersist,
    };

    await safeAudit(
      env,
      {
        ...auditBase,
        action: "projects.map.buffer.preview",
        result: "success",
        metadata: {
          rangeCount: input.rangesMeters.length,
          rangesMeters: input.rangesMeters,
          unit: input.inputUnit,
          featureCount: geojson.features.length,
          durationMs: Date.now() - startedAt,
          engine: engineMetadata.engine,
          antimeridianSplitCount: engineMetadata.antimeridianSplitCount || 0,
        },
      },
      auditImpl,
    );

    return { geojson, metadata };
  } catch (error) {
    await safeAudit(
      env,
      {
        ...auditBase,
        action: "projects.map.buffer.preview",
        result: "error",
        metadata: {
          rangeCount: input.rangesMeters.length,
          rangesMeters: input.rangesMeters,
          unit: input.inputUnit,
          durationMs: Date.now() - startedAt,
          code: error?.code || "BUFFER_UNKNOWN_ERROR",
        },
      },
      auditImpl,
    );
    throw error;
  }
}
