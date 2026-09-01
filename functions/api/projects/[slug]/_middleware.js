import {
  errorResponseFromError,
  jsonResponse,
} from "../../../_lib/http.js";
import {
  getOrCreateCorrelationId,
  normalizeMaonoError,
} from "../../../_lib/maono-error.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject, publicProject } from "../../../_lib/projects.js";
import { can, recordAuditLog } from "../../../_lib/permissions.js";
import {
  getProjectLifecycleRow,
  publicProjectLifecycle,
} from "../../../_lib/project-lifecycle.js";
import {
  createSaveTrace,
} from "../../../_lib/save-observability.js";
import {
  assertSaveDeployCompatibility,
  getSaveDeploymentMetadata,
  saveDeployResponseHeaders,
} from "../../../_lib/save-deploy-contract.js";
import {
  isLargeProjectConfigRequest,
  saveLargeProjectConfigStream,
} from "../../../_lib/project-large-config-save.js";

function decodeProjectSlug(value) {
  try {
    return decodeURIComponent(String(value || "")).trim();
  } catch {
    return String(value || "").trim();
  }
}

function organizationId(project) {
  return project?.organization_id ?? project?.organizationId ?? null;
}

function combineHeaders(trace, deployment) {
  return {
    ...saveDeployResponseHeaders(deployment),
    ...(trace?.responseHeaders?.() || {}),
  };
}

async function hydrateLifecycleProject(env, project) {
  const orgId = organizationId(project);
  if (!project?.id || !orgId) return project;
  try {
    const lifecycle = await getProjectLifecycleRow(env, {
      projectId: project.id,
      organizationId: orgId,
    });
    return lifecycle ? { ...project, ...lifecycle } : project;
  } catch (error) {
    if (/no such column|no such table/i.test(String(error?.message || ""))) {
      return project;
    }
    throw error;
  }
}

async function auditLargeSave(env, request, user, project, result, metadata = {}) {
  if (!user || !project) return;
  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId: organizationId(project),
    projectId: project?.id ?? null,
    action: "projects.config.save.large_stream",
    resourceType: "project",
    resourceId: project?.slug ?? project?.id ?? null,
    result,
    metadata,
    request,
  });
}

function projectResponse(project, configRevision) {
  const base = publicProject(project) || {};
  return {
    ...base,
    id: base.id ?? project?.id,
    name: base.name ?? project?.name,
    slug: base.slug ?? project?.slug,
    configRevision,
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== "PUT" || !isLargeProjectConfigRequest(request)) {
    return context.next();
  }

  const correlationId = getOrCreateCorrelationId(request);
  const trace = createSaveTrace({ request, correlationId, operation: "update" });
  let deployment = getSaveDeploymentMetadata(env);
  let user = null;
  let project = null;
  let slug = null;

  try {
    user = await requireSession(env, request);
    slug = decodeProjectSlug(params?.slug);
    if (!slug) {
      const error = new Error("Slug do projeto não informado.");
      error.status = 400;
      error.code = "PROJECT_SLUG_REQUIRED";
      throw error;
    }

    project = await getAuthorizedProject(env, user, slug);
    if (!project) {
      const error = new Error("Projeto não encontrado ou sem permissão de acesso.");
      error.status = 404;
      error.code = "PROJECT_NOT_FOUND";
      throw error;
    }
    project = await hydrateLifecycleProject(env, project);
    trace.updateContext({
      projectId: project.id,
      organizationId: organizationId(project),
    });

    const decision = await can(env, user, "project.save", {
      project,
      projectId: project.id,
      projectSlug: project.slug ?? slug,
      organizationId: organizationId(project),
    });
    if (!decision.allowed) {
      const error = new Error("Acesso negado.");
      error.status = 403;
      error.code = "FORBIDDEN";
      error.details = {
        permission: "project.save",
        reason: decision.reason || "DENY_BY_DEFAULT",
      };
      throw error;
    }

    // SAVE-02 continua sendo a barreira de deploy antes de qualquer escrita.
    deployment = await assertSaveDeployCompatibility(env, request);

    const saved = await saveLargeProjectConfigStream(env, {
      request,
      project,
      user,
      saveTrace: trace,
    });
    const updatedProject = { ...project, ...saved.project };
    const configRevision = Number(
      saved.revision ?? updatedProject.config_revision ?? 0,
    );
    const sizeBytes = Number(saved.artifact?.sizeBytes || 0);

    trace.updateContext({ candidateRevision: configRevision, payloadBytes: sizeBytes });
    trace.finishSuccess({ httpStatus: 200 });

    await auditLargeSave(env, request, user, updatedProject, "success", {
      correlationId,
      saveId: trace.saveId,
      configRevision,
      sizeBytes,
      transport: "stream",
      checksumAlgorithm: saved.artifact?.checksumAlgorithm ?? null,
      idempotent: Boolean(saved.idempotent),
    }).catch(() => null);

    return jsonResponse(
      {
        ok: true,
        idempotent: Boolean(saved.idempotent),
        project: projectResponse(updatedProject, configRevision),
        lifecycle: publicProjectLifecycle(updatedProject),
        fileName: updatedProject.default_config_file || "config.kepler.json",
        sizeBytes,
        configRevision,
        thumbnail: {
          status: updatedProject.preview_status ?? "PENDING",
          revision: configRevision,
          thumbnailRevision: updatedProject.preview_revision ?? null,
          updatedAt: updatedProject.preview_updated_at ?? null,
        },
        preview: null,
        previewError: null,
        transport: "stream",
      },
      { headers: combineHeaders(trace, deployment) },
    );
  } catch (error) {
    const normalized = normalizeMaonoError(error, {
      defaultCode: "PROJECT_CONFIG_LARGE_SAVE_FAILED",
      correlationId,
    });
    trace.fail(normalized, {
      stage: normalized?.details?.stage ?? trace.currentStage ?? "WRITE",
      httpStatus: normalized.status,
    });

    await auditLargeSave(env, request, user, project, "error", {
      correlationId,
      saveId: trace.saveId,
      code: normalized.code,
      category: normalized.category,
      retryable: normalized.retryable,
      stage: normalized?.details?.stage ?? trace.currentStage ?? null,
      transport: "stream",
    }).catch(() => null);

    return errorResponseFromError(normalized, {
      correlationId,
      headers: combineHeaders(trace, deployment),
      publicMessage:
        Number(normalized.status || 500) >= 500
          ? "Não foi possível salvar a configuração grande do projeto."
          : undefined,
    });
  }
}
