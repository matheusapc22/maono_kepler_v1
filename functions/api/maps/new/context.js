import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
} from "../../../_lib/http.js";
import { normalizeRole, requireSession } from "../../../_lib/auth.js";
import { resolveNewMapCreateContext } from "../../../_lib/map-panel-service.js";
import { ensureOrganizationStorage } from "../../../_lib/organization-storage.js";
import {
  resolveIsochroneFeatureState,
  withMapAnalysisRuntimeDefaults,
} from "../../../_lib/map-analysis-runtime.js";

const STORAGE_NOT_READY = "ORGANIZATION_STORAGE_NOT_CONFIGURED";
const STORAGE_PROVISION_FAILED = "ORGANIZATION_STORAGE_PROVISION_FAILED";

async function reconcileBlockedOrganizationStorage(env, context) {
  if (
    context?.allowed ||
    context?.reason !== STORAGE_NOT_READY ||
    !context?.organization?.id ||
    !env?.DB?.prepare
  ) {
    return false;
  }

  const organization = await env.DB.prepare(
    `SELECT *
     FROM organizations
     WHERE id = ?
       AND active = 1
     LIMIT 1`,
  )
    .bind(context.organization.id)
    .first();

  if (!organization) return false;

  try {
    const storage = await ensureOrganizationStorage(env, organization);
    return storage?.ready === true;
  } catch (error) {
    console.warn("[Maono new-map storage] Falha ao reconciliar armazenamento", {
      organizationId: organization.id,
      code: error?.code || STORAGE_PROVISION_FAILED,
    });

    if (error?.code !== STORAGE_PROVISION_FAILED) {
      throw error;
    }
    return false;
  }
}

function viewerCreateForbidden() {
  const error = new Error("Usuários Viewer não podem criar novos projetos.");
  error.status = 403;
  error.code = "VIEWER_PROJECT_CREATE_FORBIDDEN";
  return error;
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  try {
    const user = await requireSession(env, request);
    if (normalizeRole(user?.role) === "viewer") {
      throw viewerCreateForbidden();
    }

    const isochroneFeatureState = resolveIsochroneFeatureState(env);
    const runtimeEnv = withMapAnalysisRuntimeDefaults(env);
    let context = await resolveNewMapCreateContext(runtimeEnv, request, { user });

    if (await reconcileBlockedOrganizationStorage(runtimeEnv, context)) {
      context = await resolveNewMapCreateContext(runtimeEnv, request, { user });
    }

    return jsonResponse({
      ok: true,
      ...context,
      features: {
        ...context.features,
        maonoIsochroneState: isochroneFeatureState,
      },
    });
  } catch (error) {
    return errorResponse(
      error?.message || "Não foi possível abrir a área de criação de mapas.",
      Number(error?.status || 500),
      error?.code || "NEW_MAP_CONTEXT_ERROR",
      error?.details || null,
    );
  }
}
