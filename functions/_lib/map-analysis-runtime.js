import { isFeatureFlagEnabled } from "./organization-limit-service.js";

let rateLimitSchemaReady = false;
let rateLimitSchemaPromise = null;

export const ISOCHRONE_FEATURE_REASONS = Object.freeze({
  ENABLED: "ENABLED",
  OVERLAY_DISABLED: "OVERLAY_DISABLED",
  KILL_SWITCH_ACTIVE: "KILL_SWITCH_ACTIVE",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
});

function isTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

/**
 * Resolve o estado operacional da isócrona a partir de uma única fonte de verdade.
 *
 * A flag legada MAONO_ISOCHRONE_V1 não participa mais da decisão operacional.
 * A feature acompanha o overlay Maõno, exige o provedor configurado e só pode ser
 * desligada explicitamente pelo kill switch dedicado.
 *
 * O retorno é seguro para exposição no contexto público: nunca contém segredo,
 * chave, valor de variável ou detalhe do provedor além do motivo normalizado.
 */
export function resolveIsochroneFeatureState(env) {
  const layerManagerEnabled = isFeatureFlagEnabled(
    env?.MAONO_LAYER_MANAGER_V1,
    false,
  );
  const overlayEnabled = isFeatureFlagEnabled(
    env?.MAONO_MAP_OVERLAY_V1,
    layerManagerEnabled,
  );

  if (!overlayEnabled) {
    return {
      enabled: false,
      reason: ISOCHRONE_FEATURE_REASONS.OVERLAY_DISABLED,
    };
  }

  if (isTrue(env?.MAONO_ISOCHRONE_KILL_SWITCH)) {
    return {
      enabled: false,
      reason: ISOCHRONE_FEATURE_REASONS.KILL_SWITCH_ACTIVE,
    };
  }

  if (!String(env?.GEOAPIFY_API_KEY || "").trim()) {
    return {
      enabled: false,
      reason: ISOCHRONE_FEATURE_REASONS.PROVIDER_NOT_CONFIGURED,
    };
  }

  return {
    enabled: true,
    reason: ISOCHRONE_FEATURE_REASONS.ENABLED,
  };
}

/**
 * Compatibilidade transitória para consumidores antigos que ainda leem
 * MAONO_ISOCHRONE_V1. Novos consumidores devem usar resolveIsochroneFeatureState.
 */
export function withMapAnalysisRuntimeDefaults(env) {
  if (!env || typeof env !== "object") return env;

  const state = resolveIsochroneFeatureState(env);

  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "MAONO_ISOCHRONE_V1") {
        return state.enabled ? "true" : "false";
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (property === "MAONO_ISOCHRONE_V1") {
        return true;
      }
      return Reflect.has(target, property);
    },
  });
}

export async function ensureMapAnalysisRateLimitSchema(env) {
  if (rateLimitSchemaReady || !env?.DB?.prepare) {
    return;
  }

  if (!rateLimitSchemaPromise) {
    rateLimitSchemaPromise = (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS map_analysis_rate_limits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          organization_id INTEGER NOT NULL,
          analysis_type TEXT NOT NULL CHECK (analysis_type IN ('isochrone')),
          bucket_started_at TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count >= 1),
          expires_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id),
          UNIQUE (user_id, organization_id, analysis_type, bucket_started_at)
        )`,
      ).run();

      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_map_analysis_rate_limits_expiration
         ON map_analysis_rate_limits (expires_at)`,
      ).run();

      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_map_analysis_rate_limits_org_type
         ON map_analysis_rate_limits (
           organization_id,
           analysis_type,
           bucket_started_at
         )`,
      ).run();

      rateLimitSchemaReady = true;
    })().catch((error) => {
      rateLimitSchemaPromise = null;
      throw error;
    });
  }

  await rateLimitSchemaPromise;
}
