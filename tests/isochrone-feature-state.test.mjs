import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ISOCHRONE_FEATURE_REASONS,
  resolveIsochroneFeatureState,
  withMapAnalysisRuntimeDefaults,
} from "../functions/_lib/map-analysis-runtime.js";

function enabledEnv(overrides = {}) {
  return {
    MAONO_LAYER_MANAGER_V1: "true",
    MAONO_MAP_OVERLAY_V1: "true",
    GEOAPIFY_API_KEY: "test-secret-not-exposed",
    ...overrides,
  };
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
