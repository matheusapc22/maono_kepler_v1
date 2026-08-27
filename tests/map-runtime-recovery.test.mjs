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
  configStreamRoute,
  savedConfigHydrator,
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
  readFile(
    new URL(
      "../functions/api/projects/[slug]/config-stream.js",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/map-url-loader/saved-config-hydrator.ts",
      import.meta.url,
    ),
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

test("loader de projeto pesado mantém streaming e hidratação canônica", () => {
  assert.match(loader, /\/config-stream/);
  assert.match(loader, /X-Maono-Config-Transport/);
  assert.match(loader, /LARGE_CONFIG_UI_YIELD_BYTES/);
  assert.match(loader, /hydrateSavedKeplerConfig/);
  assert.match(loader, /await response\.json\(\)/);
  assert.match(loader, /centerMap: false/);
  assert.match(loader, /yieldToBrowser/);
  assert.match(loader, /recordMapLoadEvent\("MIGRATED"/);
  assert.doesNotMatch(loader, /LARGE_CONFIG_FAST_PATH_BYTES/);
  assert.doesNotMatch(loader, /isCurrentKeplerDocument/);
  assert.doesNotMatch(loader, /directKeplerPayload/);
  assert.doesNotMatch(loader, /response\.ok && attempt < PROJECT_LOAD_RETRY_DELAYS_MS\.length/);
});

test("hydrator usa schema oficial e exige contrato fields/rows", () => {
  assert.match(savedConfigHydrator, /@kepler\.gl\/schemas/);
  assert.match(savedConfigHydrator, /resolveKeplerSchemaManager/);
  assert.match(savedConfigHydrator, /schemaManager\.load\(prepared\.savedConfig\)/);
  assert.match(savedConfigHydrator, /dataset\.data\.fields/);
  assert.match(savedConfigHydrator, /dataset\.data\.rows/);
  assert.match(savedConfigHydrator, /KEPLER_SCHEMA_LOAD_FAILED/);
  assert.match(savedConfigHydrator, /retryable = false/);
  assert.doesNotMatch(savedConfigHydrator, /directKeplerPayload/);
});

test("config-stream mantém autorização e entrega bytes sem parse server-side", () => {
  assert.match(configStreamRoute, /requireSession/);
  assert.match(configStreamRoute, /getAuthorizedProject/);
  assert.match(configStreamRoute, /can\(env, user, "project\.view"/);
  assert.match(configStreamRoute, /assertActiveProjectInvariant/);
  assert.match(configStreamRoute, /assertMapConfigStorageRef/);
  assert.match(configStreamRoute, /downloadDropboxBinaryFile/);
  assert.match(configStreamRoute, /upstream\.body/);
  assert.match(configStreamRoute, /X-Maono-Config-Transport/);
  assert.match(configStreamRoute, /PROJECT_CONFIG_SIZE_MISMATCH/);
  assert.doesNotMatch(configStreamRoute, /JSON\.parse/);
  assert.doesNotMatch(configStreamRoute, /readPublishedProjectConfig/);
});

test("contexto de navegação também possui retry seletivo", () => {
  assert.match(mapPanelApi, /MAP_CONTEXT_RETRY_DELAYS_MS/);
  assert.match(mapPanelApi, /retryableMapContextStatus/);
  assert.match(mapPanelApi, /status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500/);
  assert.match(mapPanelApi, /requestMapContextResponse/);
  assert.match(mapPanelApi, /credentials: "include"/);
});
