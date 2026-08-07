import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ensureMapAnalysisRateLimitSchema,
  withMapAnalysisRuntimeDefaults,
} from "../functions/_lib/map-analysis-runtime.js";

const [
  navigationRoute,
  newMapRoute,
  isochroneRoute,
  loader,
  mapPanelApi,
] = await Promise.all([
  readFile(
    new URL(
      "../functions/api/projects/[slug]/map-navigation.js",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../functions/api/maps/new/context.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../functions/api/maps/isochrones.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/map-url-loader/index.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/map-panel/map-panel-api.ts", import.meta.url),
    "utf8",
  ),
]);

test("runtime de isócrona ignora flag antiga e usa kill switch explícito", () => {
  const original = {
    GEOAPIFY_API_KEY: "secret",
    MAONO_ISOCHRONE_V1: "false",
  };
  const runtime = withMapAnalysisRuntimeDefaults(original);

  assert.equal(runtime.MAONO_ISOCHRONE_V1, "true");
  assert.equal(original.MAONO_ISOCHRONE_V1, "false");

  const explicitlyDisabled = withMapAnalysisRuntimeDefaults({
    GEOAPIFY_API_KEY: "secret",
    MAONO_ISOCHRONE_V1: "true",
    MAONO_ISOCHRONE_KILL_SWITCH: "true",
  });
  assert.equal(explicitlyDisabled.MAONO_ISOCHRONE_V1, "false");
});

test("rotas de contexto e análise usam o mesmo runtime default", () => {
  assert.match(navigationRoute, /withMapAnalysisRuntimeDefaults/);
  assert.match(newMapRoute, /withMapAnalysisRuntimeDefaults/);
  assert.match(isochroneRoute, /withMapAnalysisRuntimeDefaults/);
  assert.match(isochroneRoute, /ensureMapAnalysisRateLimitSchema/);
});

test("schema defensivo da análise usa apenas DDL idempotente", async () => {
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        statements.push(String(sql));
        return {
          async run() {
            return { success: true };
          },
        };
      },
    },
  };

  await ensureMapAnalysisRateLimitSchema(env);

  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS map_analysis_rate_limits/);
  assert.match(statements[1], /CREATE INDEX IF NOT EXISTS idx_map_analysis_rate_limits_expiration/);
  assert.match(statements[2], /CREATE INDEX IF NOT EXISTS idx_map_analysis_rate_limits_org_type/);
});

test("loader tenta novamente apenas falhas transitórias e não reinicia a sessão", () => {
  assert.match(loader, /PROJECT_LOAD_RETRY_DELAYS_MS/);
  assert.match(loader, /status === 429 \|\| status >= 500/);
  assert.match(loader, /setRetryToken\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(loader, /window\.location\.reload/);
});

test("contexto de navegação também possui retry seletivo", () => {
  assert.match(mapPanelApi, /MAP_CONTEXT_RETRY_DELAYS_MS/);
  assert.match(mapPanelApi, /retryableMapContextStatus/);
  assert.match(mapPanelApi, /status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500/);
  assert.match(mapPanelApi, /requestMapContextResponse/);
  assert.match(mapPanelApi, /credentials: "include"/);
});
