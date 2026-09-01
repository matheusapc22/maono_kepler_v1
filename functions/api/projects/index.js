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
import {
  assertSaveDeployCompatibility,
  getSaveClientMetadata,
  getSaveDeploymentMetadata,
  saveDeployResponseHeaders,
} from "../../_lib/save-deploy-contract.js";
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

function combineHeaders(saveTrace, deploymentMetadata) {
  return {
    ...saveDeployResponseHeaders(deploymentMetadata),
    ...(saveTrace?.responseHeaders?.() || {}),
  };
}

function publicSaveMessage(normalized, requestMethod) {
  if (normalized.code === "SAVE_CLIENT_CONTRACT_UNSUPPORTED") {
    return "A Maõno foi atualizada. Recarregue a página antes de salvar novamente.";
  }
  if (normalized.code === "SAVE_DB_SCHEMA_MISMATCH") {
    return "O serviço está sendo atualizado. Tente salvar novamente em instantes.";
  }
  return normalized.message ||
    (requestMethod === "GET"
      ? "Não foi possível carregar os projetos."
      : "Não foi possível criar o projeto.");
}

export async function onRequest(context) {
  const { request, env } = context;

  const correlationId = getOrCreateCorrelationId(request);
  const clientMetadata = getSaveClientMetadata(request);
  let deploymentMetadata = getSaveDeploymentMetadata(env);

  if (!["GET", "POST"].includes(request.method)) {
    return methodNotAllowed(["GET", "POST"], {
      correlationId,
      headers: saveDeployResponseHeaders(deploymentMetadata),
    });
  }

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
        {
          correlationId,
          headers: combineHeaders(saveTrace, deploymentMetadata),
        },
      );
    }

    // SAVE-02: contratos são validados antes de qualquer mutação de criação.
    deploymentMetadata = await assertSaveDeployCompatibility(env, request);

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
        deploy: {
          apiContract: deploymentMetadata.apiContract,
          dbSchema: deploymentMetadata.actualDbSchema,
        },
      },
      {
        status: result.status,
        headers: combineHeaders(saveTrace, deploymentMetadata),
      },
    );
  } catch (error) {
    const status = Number(error?.status || 500);
    const normalized = normalizeMaonoError(error, {
      defaultCode: "PROJECTS_ERROR",
      correlationId,
    });

    saveTrace?.fail(normalized, {
      stage: normalized?.details?.stage || saveTrace?.currentStage || null,
      httpStatus: status,
      category: normalized.category,
      retryable: normalized.retryable,
    });

    if (status >= 500 || normalized.code?.startsWith?.("SAVE_")) {
      console.error("[Maono projects] Falha na criação completa do projeto:", {
        event: "project_save_failed",
        saveId: saveTrace?.saveId ?? null,
        correlationId,
        code: normalized.code,
        category: normalized.category,
        retryable: normalized.retryable,
        status: normalized.status,
        clientContract: clientMetadata.clientContract,
        clientBuild: clientMetadata.clientBuild,
        apiContract: deploymentMetadata.apiContract,
        apiBuild: deploymentMetadata.apiBuild,
        dbSchemaExpected: deploymentMetadata.expectedDbSchema,
        dbSchemaActual: normalized?.details?.actualDbSchema ?? deploymentMetadata.actualDbSchema ?? null,
      });
    }

    return errorResponseFromError(normalized, {
      correlationId,
      headers: combineHeaders(saveTrace, deploymentMetadata),
      publicMessage: publicSaveMessage(normalized, request.method),
    });
  }
}
