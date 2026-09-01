import {
  errorResponse,
  errorResponseFromError,
  jsonResponse,
  methodNotAllowed,
} from "../../_lib/http.js";
import {
  getOrCreateCorrelationId,
  normalizeMaonoError,
} from "../../_lib/maono-error.js";
import {
  bindSaveTraceToConfig,
  createSaveTrace,
  readSaveJsonBody,
} from "../../_lib/save-observability.js";
import { requireSession } from "../../_lib/auth.js";
import { listProjectsForActiveOrganization } from "../../_lib/project-list.js";
import {
  getActiveOrganizationId,
  publicProject,
} from "../../_lib/projects.js";
import {
  isProjectLifecycleEnabled,
  publicProjectLifecycle,
} from "../../_lib/project-lifecycle.js";
import { createProjectFromKepler } from "../../_lib/project-creation-lifecycle-service.js";

function publicCreatedProject(project) {
  return {
    ...publicProject(project),
    accessLevel: "owner",
    access_level: "owner",
    permissions: [],
    active: true,
    favorite: false,
    lifecycle: publicProjectLifecycle(project),
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!["GET", "POST"].includes(request.method)) {
    return methodNotAllowed(["GET", "POST"]);
  }

  const correlationId = getOrCreateCorrelationId(request);
  const saveTrace = request.method === "POST"
    ? createSaveTrace({ request, correlationId, operation: "create" })
    : null;

  try {
    const user = await requireSession(env, request);

    if (request.method === "GET") {
      const projects = await listProjectsForActiveOrganization(env, user);
      return jsonResponse({ ok: true, projects });
    }

    // A flag pode impedir novas admissões durante rollout, mas nunca muda o
    // protocolo de leitura/save de projetos que já possuem lifecycle_state.
    if (!isProjectLifecycleEnabled(env)) {
      const error = new Error(
        "A criação de novos projetos está temporariamente indisponível.",
      );
      error.status = 503;
      error.code = "PROJECT_LIFECYCLE_ROLLOUT_DISABLED";
      saveTrace?.fail(error, { stage: "VALIDATE", httpStatus: 503 });
      return errorResponse(
        error.message,
        error.status,
        error.code,
        null,
        { correlationId, headers: saveTrace?.responseHeaders() },
      );
    }

    const body = await readSaveJsonBody(request, saveTrace);
    bindSaveTraceToConfig(body?.config, saveTrace);
    saveTrace?.updateContext({
      organizationId:
        body?.organizationId ??
        body?.organization_id ??
        body?.organization?.id ??
        null,
      expectedRevision: 0,
    });

    const result = await createProjectFromKepler(
      env,
      request,
      user,
      body,
      { getActiveOrganizationId },
    );

    saveTrace?.updateContext({
      projectId: result.project?.id ?? null,
      organizationId:
        result.project?.organization_id ??
        result.project?.organizationId ??
        body?.organizationId ??
        null,
      candidateRevision: result.configRevision ?? null,
    });
    saveTrace?.finishSuccess({ httpStatus: result.status });

    return jsonResponse(
      {
        ok: true,
        status:
          result.project?.lifecycle_state === "ACTIVE" ? "active" : "pending",
        idempotent: result.idempotent,
        project: publicCreatedProject(result.project),
        fileName: result.fileName,
        sizeBytes: result.sizeBytes,
        configRevision: result.configRevision,
        thumbnail: result.thumbnail,
        preview: result.preview,
      },
      {
        status: result.status,
        headers: saveTrace?.responseHeaders(),
      },
    );
  } catch (error) {
    const status = Number(error?.status || 500);
    const normalized = normalizeMaonoError(error, {
      defaultCode: "PROJECTS_ERROR",
      correlationId,
    });

    saveTrace?.fail(normalized, {
      stage: normalized?.details?.stage || saveTrace?.currentStage || "VALIDATE",
      httpStatus: status,
      category: normalized.category,
      retryable: normalized.retryable,
    });

    if (status >= 500) {
      console.error("[Maono projects] Falha na criação completa do projeto:", {
        saveId: saveTrace?.saveId ?? null,
        correlationId,
        code: normalized.code,
        category: normalized.category,
        retryable: normalized.retryable,
        status: normalized.status,
      });
    }

    return errorResponseFromError(normalized, {
      correlationId,
      headers: saveTrace?.responseHeaders(),
      publicMessage:
        normalized.message ||
        (request.method === "GET"
          ? "Não foi possível carregar os projetos."
          : "Não foi possível criar o projeto."),
    });
  }
}
