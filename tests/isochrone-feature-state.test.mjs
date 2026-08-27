import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ISOCHRONE_FEATURE_REASONS,
  resolveIsochroneFeatureState,
  withMapAnalysisRuntimeDefaults,
} from "../functions/_lib/map-analysis-runtime.js";
import { onRequest as handleIsochroneRequest } from "../functions/api/maps/isochrones.js";
import {
  ISOCHRONE_FEATURE_REASON,
  describeIsochroneAvailability,
  normalizeIsochroneFeatureState,
} from "../src/pages/Kepler/map-panel/isochrone-feature-diagnostic.ts";

function enabledEnv(overrides = {}) {
  return {
    MAONO_LAYER_MANAGER_V1: "true",
    MAONO_MAP_OVERLAY_V1: "true",
    GEOAPIFY_API_KEY: "test-secret-not-exposed",
    ...overrides,
  };
}

function validIsochroneRequest() {
  return new Request("https://maps.maono.test/api/maps/isochrones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: { latitude: -23.55, longitude: -46.63 },
      type: "time",
      mode: "drive",
      ranges: [15],
    }),
  });
}

test("estado da isócrona tem uma única ordem de decisão", () => {
  assert.deepEqual(
    resolveIsochroneFeatureState(
      enabledEnv({ MAONO_MAP_OVERLAY_V1: "false" }),
    ),
    {
      enabled: false,
      reason: ISOCHRONE_FEATURE_REASONS.OVERLAY_DISABLED,
    },
  );

  assert.deepEqual(
    resolveIsochroneFeatureState(
      enabledEnv({ MAONO_ISOCHRONE_KILL_SWITCH: "true" }),
    ),
    {
      enabled: false,
      reason: ISOCHRONE_FEATURE_REASONS.KILL_SWITCH_ACTIVE,
    },
  );

  assert.deepEqual(
    resolveIsochroneFeatureState(enabledEnv({ GEOAPIFY_API_KEY: "" })),
    {
      enabled: false,
      reason: ISOCHRONE_FEATURE_REASONS.PROVIDER_NOT_CONFIGURED,
    },
  );
});

test("flag legada MAONO_ISOCHRONE_V1 não desliga mais a feature", () => {
  const state = resolveIsochroneFeatureState(
    enabledEnv({ MAONO_ISOCHRONE_V1: "false" }),
  );

  assert.deepEqual(state, {
    enabled: true,
    reason: ISOCHRONE_FEATURE_REASONS.ENABLED,
  });
});

test("compatibilidade legada deriva do mesmo resolver", () => {
  const enabled = withMapAnalysisRuntimeDefaults(
    enabledEnv({ MAONO_ISOCHRONE_V1: "false" }),
  );
  const killed = withMapAnalysisRuntimeDefaults(
    enabledEnv({ MAONO_ISOCHRONE_KILL_SWITCH: "true" }),
  );

  assert.equal(enabled.MAONO_ISOCHRONE_V1, "true");
  assert.equal(killed.MAONO_ISOCHRONE_V1, "false");
});

test("endpoint retorna motivo seguro quando a feature está indisponível", async () => {
  const providerMissing = await handleIsochroneRequest({
    request: validIsochroneRequest(),
    env: enabledEnv({ GEOAPIFY_API_KEY: "" }),
  });
  const providerMissingBody = await providerMissing.json();

  assert.equal(providerMissing.status, 503);
  assert.equal(providerMissingBody.error.code, "ISOCHRONE_FEATURE_DISABLED");
  assert.deepEqual(providerMissingBody.error.details, {
    reason: ISOCHRONE_FEATURE_REASONS.PROVIDER_NOT_CONFIGURED,
  });

  const killed = await handleIsochroneRequest({
    request: validIsochroneRequest(),
    env: enabledEnv({ MAONO_ISOCHRONE_KILL_SWITCH: "true" }),
  });
  const killedBody = await killed.json();

  assert.equal(killed.status, 503);
  assert.deepEqual(killedBody.error.details, {
    reason: ISOCHRONE_FEATURE_REASONS.KILL_SWITCH_ACTIVE,
  });
});

test("navegação, create e endpoint usam o mesmo diagnóstico seguro", async () => {
  const [navigationRoute, createRoute, isochroneRoute] = await Promise.all([
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
  ]);

  for (const source of [navigationRoute, createRoute, isochroneRoute]) {
    assert.match(source, /resolveIsochroneFeatureState/);
  }

  assert.match(navigationRoute, /maonoIsochroneState/);
  assert.match(createRoute, /maonoIsochroneState/);
  assert.match(isochroneRoute, /ISOCHRONE_FEATURE_DISABLED/);
  assert.match(isochroneRoute, /\{ reason: state\.reason \}/);
  assert.doesNotMatch(
    navigationRoute + createRoute + isochroneRoute,
    /GEOAPIFY_API_KEY\s*[:=]\s*["'][^"']+["']/,
  );
});

test("cliente preserva o motivo seguro em vez de reduzi-lo a booleano", () => {
  assert.deepEqual(
    normalizeIsochroneFeatureState({
      enabled: false,
      reason: "PROVIDER_NOT_CONFIGURED",
    }),
    {
      enabled: false,
      reason: ISOCHRONE_FEATURE_REASON.PROVIDER_NOT_CONFIGURED,
    },
  );

  assert.deepEqual(normalizeIsochroneFeatureState(undefined, true), {
    enabled: true,
    reason: ISOCHRONE_FEATURE_REASON.ENABLED,
  });

  assert.deepEqual(normalizeIsochroneFeatureState(undefined, false), {
    enabled: false,
    reason: ISOCHRONE_FEATURE_REASON.UNKNOWN,
  });
});

test("mensagem da UI distingue configuração, kill switch e permissão", () => {
  assert.match(
    describeIsochroneAvailability(
      { enabled: false, reason: ISOCHRONE_FEATURE_REASON.PROVIDER_NOT_CONFIGURED },
      false,
    ),
    /provedor não configurado/i,
  );
  assert.match(
    describeIsochroneAvailability(
      { enabled: false, reason: ISOCHRONE_FEATURE_REASON.KILL_SWITCH_ACTIVE },
      false,
    ),
    /temporariamente desativadas/i,
  );
  assert.match(
    describeIsochroneAvailability(
      { enabled: true, reason: ISOCHRONE_FEATURE_REASON.ENABLED },
      false,
    ),
    /modo ou permissão/i,
  );
});

test("Pin permanece visível, mas fail-closed quando previewIsochrone é negado", async () => {
  const [apiClient, overlay, types] = await Promise.all([
    readFile(
      new URL("../src/pages/Kepler/map-panel/map-panel-api.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/pages/Kepler/map-panel/types.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(apiClient, /normalizeIsochroneFeatureState/);
  assert.match(apiClient, /context\.features\?\.maonoIsochroneState/);
  assert.match(apiClient, /isochroneFeatureState,/);
  assert.match(types, /isochroneFeatureState:\s*IsochroneFeatureState/);

  assert.match(overlay, /disabled=\{!isochroneCapabilityEnabled\}/);
  assert.match(overlay, /if \(!isochroneCapabilityEnabled\) return/);
  assert.match(overlay, /data-isochrone-state/);
  assert.match(overlay, /describeIsochroneAvailability/);
  assert.doesNotMatch(
    overlay,
    /capabilities\?\.previewIsochrone && !isochrone\.preview \? \(/,
  );
});

test("fallback legado também satisfaz o contrato de diagnóstico da isócrona", async () => {
  const provider = await readFile(
    new URL(
      "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    provider,
    /import\s+\{\s*normalizeIsochroneFeatureState\s*\}\s+from\s+["']\.\/isochrone-feature-diagnostic["']/,
  );

  assert.match(
    provider,
    /isochroneFeatureState:\s*normalizeIsochroneFeatureState\(\s*undefined\s*,\s*false\s*\)/,
  );
});
