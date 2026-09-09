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
import { assertProjectPersistenceRoute } from "../../../_lib/project-map-route-policy.js";
import {
  PROJECT_LIFECYCLE_STATES,
  getProjectLifecycleRow,
  isLifecycleManagedProject,
  publicProjectLifecycle,
} from "../../../_lib/project-lifecycle.js";
import { createSaveTrace } from "../../../_lib/save-observability.js";
import {
  assertSaveDeployCompatibility,
  getSaveDeploymentMetadata,
  saveDeployResponseHeaders,
} from "../../../_lib/save-deploy-contract.js";
import {
  assertInlineProjectConfigRequestSize,
  isLargeProjectConfigRequest,
  saveLargeProjectConfigStream,
} from "../../../_lib/project-large-config-save.js";
import {
  authorizeLargeProjectCreation,
  finalizeLargeProjectCreation,
  hasLargeCreationContext,
  markLargeProjectCreationFailed,
} from "../../../_lib/project-large-creation.js";
import { saveLargeLegacyProjectConfigStream } from "../../../_lib/project-large-legacy-config-save.js";

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

function requestPath(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

function targetsConfigPut(request) {
  return (
    request.method === "PUT" &&
    /\/api\/projects\/[^/]+\/config\/?$/.test(requestPath(request))
  );
}

function targetsViewerRestrictedMutation(request) {
  const path = requestPath(request);
  const method = String(request.method || "GET").toUpperCase();
  if (method === "PUT" && /\/api\/projects\/[^/]+\/config\/?$/.test(path)) {
    return true;
  }
  if (method === "POST" && /\/api\/projects\/[^/]+\/save\/?$/.test(path)) {
    return true;
  }
  if (
    (method === "PATCH" || method === "PUT") &&
    /\/api\/projects\/[^/]+\/metadata\/?$/.test(path)
  ) {
    return true;
  }
  return (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    /\/api\/projects\/[^/]+\/thumbnail(?:\/|$)/.test(path)
  );
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

async function loadPersistenceContext(env, request, params) {
  const user = await requireSession(env, request);
  const slug = decodeProjectSlug(params?.slug);
  if (!slug) {
    const error = new Error("Slug do projeto não informado.");
    error.status = 400;
    error.code = "PROJECT_SLUG_REQUIRED";
    throw error;
  }
  const project = await getAuthorizedProject(env, user, slug);
  if (!project) {
    const error = new Error("Projeto não encontrado ou sem permissão de acesso.");
    error.status = 404;
    error.code = "PROJECT_NOT_FOUND";
    throw error;
  }
  assertProjectPersistenceRoute(user, project);
  return { user, project, slug };
}

async function auditLargeSave(
  env,
  request,
  user,
  project,
  result,
  metadata = {},
) {
  if (!user || !project) return;
  const operation = metadata.operation === "create" ? "create" : "update";
  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId: organizationId(project),
    projectId: project?.id ?? null,
    action:
      operation === "create"
        ? "project_create_stream"
        : "projects.config.save.large_stream",
    resourceType: "project",
    resourceId: project?.slug ?? project?.id ?? null,
    result,
    metadata: { ...metadata, operation },
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

function lifecycleBlockedError(project) {
  const error = new Error(
    "Somente projetos ACTIVE podem publicar uma nova revisão.",
  );
  error.status = 409;
  error.code = "PROJECT_CONFIG_LIFECYCLE_BLOCKED";
  error.details = { lifecycleState: project?.lifecycle_state ?? null };
  return error;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const configPut = targetsConfigPut(request);
  const restrictedMutation = targetsViewerRestrictedMutation(request);

  if (!configPut) {
    if (!restrictedMutation) return context.next();
    const correlationId = getOrCreateCorrelationId(request);
    try {
      await loadPersistenceContext(env, request, params);
      return context.next();
    } catch (error) {
      const normalized = normalizeMaonoError(error, { correlationId });
      return errorResponseFromError(normalized, { correlationId });
    }
  }

  const correlationId = getOrCreateCorrelationId(request);
  let deployment = getSaveDeploymentMetadata(env);

  if (!isLargeProjectConfigRequest(request)) {
    try {
      await loadPersistenceContext(env, request, params);
      assertInlineProjectConfigRequestSize(request);
      return context.next();
    } catch (error) {
      const normalized = normalizeMaonoError(error, { correlationId });
      return errorResponseFromError(normalized, {
        correlationId,
        headers: saveDeployResponseHeaders(deployment),
      });
    }
  }

  const creationRequest = hasLargeCreationContext(request);
  const trace = createSaveTrace({
    request,
    correlationId,
    operation: creationRequest ? "create" : "update",
  });
  let user = null;
  let project = null;
  let slug = null;
  let creationKey = null;

  try {
    user = await requireSession(env, request);
    slug = decodeProjectSlug(params?.slug);
    if (!slug) {
      const error = new Error("Slug do projeto não informado.");
      error.status = 400;
      error.code = "PROJECT_SLUG_REQUIRED";
      throw error;
    }

    if (creationRequest) {
      const creation = await authorizeLargeProjectCreation(
        env,
        request,
        user,
        slug,
      );
      project = creation.project;
      creationKey = creation.idempotencyKey;
    } else {
      project = await getAuthorizedProject(env, user, slug);
      if (!project) {
        const error = new Error("Projeto não encontrado ou sem permissão de acesso.");
        error.status = 404;
        error.code = "PROJECT_NOT_FOUND";
        throw error;
      }
      assertProjectPersistenceRoute(user, project);
      project = await hydrateLifecycleProject(env, project);

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
    }

    trace.updateContext({
      projectId: project.id,
      organizationId: organizationId(project),
    });
    deployment = await assertSaveDeployCompatibility(env, request);

    let saved;
    if (creationRequest) {
      saved = await saveLargeProjectConfigStream(env, {
        request,
        project,
        user,
        saveTrace: trace,
        operation: "create",
        allowedLifecycleStates: [
          PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
          PROJECT_LIFECYCLE_STATES.CONFIG_READY,
          PROJECT_LIFECYCLE_STATES.ACTIVE,
        ],
        expectedLifecycleState: PROJECT_LIFECYCLE_STATES.PREPARING_STORAGE,
        syncOrganizationFile: false,
        afterPublish: async ({ project: publishedProject, artifact }) =>
          finalizeLargeProjectCreation(env, request, user, {
            project: publishedProject,
            artifact,
            idempotencyKey: creationKey,
          }),
      });
    } else if (!isLifecycleManagedProject(project)) {
      saved = await saveLargeLegacyProjectConfigStream(env, {
        request,
        project,
        user,
        saveTrace: trace,
      });
    } else {
      if (project.lifecycle_state !== PROJECT_LIFECYCLE_STATES.ACTIVE) {
        throw lifecycleBlockedError(project);
      }
      saved = await saveLargeProjectConfigStream(env, {
        request,
        project,
        user,
        saveTrace: trace,
      });
    }

    const updatedProject = { ...project, ...saved.project };
    const configRevision = Number(
      saved.revision ?? updatedProject.config_revision ?? 0,
    );
    const sizeBytes = Number(saved.artifact?.sizeBytes || 0);

    trace.updateContext({ candidateRevision: configRevision, payloadBytes: sizeBytes });
    trace.finishSuccess({ httpStatus: creationRequest ? 201 : 200 });

    await auditLargeSave(env, request, user, updatedProject, "success", {
      correlationId,
      saveId: trace.saveId,
      configRevision,
      sizeBytes,
      transport: "stream",
      checksumAlgorithm: saved.artifact?.checksumAlgorithm ?? null,
      idempotent: Boolean(saved.idempotent),
      promotedFromLegacy: Boolean(saved.promotedFromLegacy),
      operation: creationRequest ? "create" : "update",
    }).catch(() => null);

    return jsonResponse(
      {
        ok: true,
        status: creationRequest ? "active" : undefined,
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
        operation: creationRequest ? "create" : "update",
        promotedFromLegacy: Boolean(saved.promotedFromLegacy),
      },
      {
        status: creationRequest ? 201 : 200,
        headers: combineHeaders(trace, deployment),
      },
    );
  } catch (error) {
    const normalized = normalizeMaonoError(error, {
      defaultCode: creationRequest
        ? "PROJECT_CREATE_LARGE_FAILED"
        : "PROJECT_CONFIG_LARGE_SAVE_FAILED",
      correlationId,
    });
    trace.fail(normalized, {
      stage: normalized?.details?.stage ?? trace.currentStage ?? "WRITE",
      httpStatus: normalized.status,
    });

    if (creationRequest && project && creationKey) {
      await markLargeProjectCreationFailed(env, request, user, {
        project,
        idempotencyKey: creationKey,
        error: normalized,
        stage: normalized?.details?.stage ?? trace.currentStage ?? "WRITE",
      }).catch(() => null);
    }

    await auditLargeSave(env, request, user, project, "error", {
      correlationId,
      saveId: trace.saveId,
      code: normalized.code,
      category: normalized.category,
      retryable: normalized.retryable,
      stage: normalized?.details?.stage ?? trace.currentStage ?? null,
      transport: "stream",
      operation: creationRequest ? "create" : "update",
    }).catch(() => null);

    return errorResponseFromError(normalized, {
      correlationId,
      headers: combineHeaders(trace, deployment),
      publicMessage:
        Number(normalized.status || 500) >= 500
          ? creationRequest
            ? "Não foi possível concluir a criação do projeto grande. A tentativa pode ser retomada com segurança."
            : "Não foi possível salvar a configuração grande do projeto."
          : undefined,
    });
  }
}
