import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../_lib/http.js";
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

  try {
    const user = await requireSession(env, request);

    if (request.method === "GET") {
      const projects = await listProjectsForActiveOrganization(env, user);
      return jsonResponse({ ok: true, projects });
    }

    // A flag pode impedir novas admissões durante rollout, mas nunca muda o
    // protocolo de leitura/save de projetos que já possuem lifecycle_state.
    if (!isProjectLifecycleEnabled(env)) {
      return errorResponse(
        "A criação de novos projetos está temporariamente indisponível.",
        503,
        "PROJECT_LIFECYCLE_ROLLOUT_DISABLED",
      );
    }

    const body = await readJsonBody(request);
    const result = await createProjectFromKepler(
      env,
      request,
      user,
      body,
      { getActiveOrganizationId },
    );

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
      { status: result.status },
    );
  } catch (error) {
    const status = Number(error?.status || 500);
    const code = error?.code || "PROJECTS_ERROR";

    if (status >= 500) {
      console.error("[Maono projects] Falha na criação completa do projeto:", error);
    }

    return errorResponse(
      error?.message ||
        (request.method === "GET"
          ? "Não foi possível carregar os projetos."
          : "Não foi possível criar o projeto."),
      status,
      code,
      error?.details || null,
    );
  }
}
