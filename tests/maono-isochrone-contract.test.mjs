import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createIsochroneApiClient,
  normalizeIsochroneResponse,
} from "../src/pages/Kepler/map-panel/isochrone-api.ts";

const [service, clientApi, overlay, previewHook, store] = await Promise.all([
  readFile(
    new URL("../functions/_lib/geoprocessing/isochrone-service.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/map-panel/isochrone-api.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/components/map-overlay/MapOverlayControls.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/components/map-overlay/useIsochronePreview.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/store.ts", import.meta.url),
    "utf8",
  ),
]);

test("cliente normaliza FeatureCollection e propriedades amigáveis", async () => {
  const payload = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          range: 600,
          range_input: 10,
          range_label: "10 min",
          mode: "drive",
          mode_label: "Carro",
          type: "time",
          type_label: "Tempo",
          provider: "geoapify",
        },
        geometry: {
          type: "Polygon",
          coordinates: [[[-47, -15], [-46, -15], [-47, -14], [-47, -15]]],
        },
      },
      {
        type: "Feature",
        properties: {
          feature_type: "origin",
          range_label: "Origem",
        },
        geometry: {
          type: "Point",
          coordinates: [-47, -15],
        },
      },
    ],
  };

  const result = normalizeIsochroneResponse({
    geojson: payload,
    metadata: {
      rangeUnit: "seconds",
      rangeInputUnit: "minutes",
      provider: "geoapify",
    },
  });

  assert.equal(result.geojson.type, "FeatureCollection");
  assert.equal(result.geojson.features.length, 2);
  assert.equal(result.geojson.features[0].properties.range_label, "10 min");
  assert.equal(result.geojson.features[1].properties.range_label, "Origem");
});

test("trânsito não volta à heurística de reduzir o range em 25%", () => {
  assert.match(service, /mode === "drive_traffic" \? "drive" : mode/);
  assert.match(service, /return "approximated"/);
  assert.doesNotMatch(service, /0\.75|75\s*%/);
  assert.match(service, /range \* multiplier/);
});

test("credencial do provedor permanece exclusivamente no backend", () => {
  assert.match(service, /GEOAPIFY_API_KEY/);
  assert.match(clientApi, /\/api\/maps\/isochrones/);
  assert.doesNotMatch(clientApi, /api\.geoapify\.com/);
  assert.doesNotMatch(clientApi, /GEOAPIFY_API_KEY|apiKey=/i);
  assert.doesNotMatch(overlay, /api\.geoapify\.com|GEOAPIFY_API_KEY|apiKey=/i);
});

test("ciclo de preview sai do componente visual e usa o Engine Adapter", () => {
  assert.match(overlay, /useIsochronePreview/);
  assert.doesNotMatch(overlay, /requestIsochrone/);
  assert.doesNotMatch(overlay, /AbortController/);
  assert.doesNotMatch(overlay, /dispatchMapSaveRequest/);
  assert.match(previewHook, /requestIsochrone/);
  assert.match(previewHook, /commands\.addGeoJsonLayer/);
  assert.match(previewHook, /transient:\s*true/);
  assert.match(previewHook, /commandsRef\.current\.removeTransientLayer/);
  assert.match(previewHook, /dispatchMapSaveRequest/);
  assert.match(previewHook, /MAONO_MAP_SAVE_RESULT_EVENT/);
});

test("troca de projeto ou organização remove apenas preview transitório não salvo", () => {
  assert.match(previewHook, /const scopeKey =/);
  assert.match(previewHook, /previousScopeKeyRef/);
  assert.match(previewHook, /requestRef\.current\?\.abort\(\)/);
  assert.match(
    previewHook,
    /if \(current && !current\.saveRequestId\) \{[\s\S]*removeTransientLayer\(current\.dataId,\s*"isochrone"\)/,
  );
  assert.match(previewHook, /resetMarkerRef\.current\(\)/);
});

test("store não recria reducer paralelo de pin", () => {
  assert.doesNotMatch(store, /TOGGLE_PIN_MODE|MAP_CLICK|LAYER_CLICK/);
  assert.doesNotMatch(store, /isPinModeActive|clickedCoordinate/);
});