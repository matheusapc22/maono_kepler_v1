let rateLimitSchemaReady = false;
let rateLimitSchemaPromise = null;

export function withMapAnalysisRuntimeDefaults(env) {
  if (!env || typeof env !== "object") return env;

  if (env.MAONO_ISOCHRONE_V1 !== undefined) {
    return env;
  }

  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "MAONO_ISOCHRONE_V1") {
        return "true";
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
