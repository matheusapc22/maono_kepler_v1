import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { enrichIsochroneResult } from "../functions/api/maps/isochrones.js";

const [service, clientApi, overlay, previewHook, store] = await Promise.all([
  readFile(
    new URL("../functions/_lib/isochrone-service.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/map-panel/isochrone-api.ts",
      import.meta.url,
    ),
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
    new URL(
      "../src/pages/Kepler/components/map-overlay/useIsochronePreview.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("../src/store.ts", import.meta.url), "utf8"),
]);

test("endpoint acrescenta propriedades amigáveis sem perder o contrato GeoJSON", () => {
  const result = enrichIsochroneResult({
    metadata: {
      type: "time",
      mode: "drive_traffic",
      ranges: [30],
      featureCount: 2,
      provider: "geoapify",
      canPersist: true,
    },
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: {
            maono_analysis: "isochrone",
            range: 30,
            unit: "minutes",
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-46.63, -23.55] },
          properties: {
            maono_analysis: "isochrone_origin",
            label: "Origem",
          },
        },
      ],
    },
  });

  assert.equal(result.geojson.features[0].properties.range, 30);
  assert.equal(result.geojson.features[0].properties.range_label, "30 min");
  assert.equal(
    result.geojson.features[0].properties.mode_label,
    "Carro com trânsito",
  );
  assert.equal(
    result.geojson.features[0].properties.analysis_label,
    "Área alcançável",
  );
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
});

test("Manter promove isócrona localmente e não dispara salvamento", () => {
  const keepBlock = previewHook.match(/const keep = useCallback\([\s\S]*?return true;\n  },/s)?.[0] || "";
  assert.match(keepBlock, /markLayerPersistent\(preview\.dataId,\s*"isochrone"\)/);
  assert.match(keepBlock, /capabilities\?\.persistIsochrone/);
  assert.match(keepBlock, /map_isochrone_kept/);
  assert.match(keepBlock, /Salve o projeto para gravar as alterações/);
  assert.match(keepBlock, /setPreview\(null\)/);
  assert.match(keepBlock, /resetMarkerRef\.current\(\)/);
  assert.doesNotMatch(previewHook, /dispatchMapSaveRequest/);
  assert.doesNotMatch(previewHook, /MAONO_MAP_SAVE_RESULT_EVENT/);
  assert.doesNotMatch(previewHook, /saveRequestId/);
  assert.doesNotMatch(previewHook, /canPersist/);
});

test("troca de projeto ou organização remove apenas preview ainda transitório", () => {
  assert.match(previewHook, /const scopeKey =/);
  assert.match(previewHook, /previousScopeKeyRef/);
  assert.match(previewHook, /requestRef\.current\?\.abort\(\)/);
  assert.match(
    previewHook,
    /if \(current\)(?:\s*\{)?[\s\S]*removeTransientLayer\(current\.dataId,\s*"isochrone"\)/,
  );
  assert.match(previewHook, /resetMarkerRef\.current\(\)/);
});

test("overlay usa Manter para isócrona e não expõe salvamento individual", () => {
  assert.match(overlay, /isochrone\.keep/);
  assert.match(overlay, /capabilities\?\.persistIsochrone/);
  assert.match(overlay, />\s*Manter\s*</);
  assert.doesNotMatch(overlay, /isochrone\.persist/);
  assert.doesNotMatch(overlay, /Salvar no projeto/);
  assert.doesNotMatch(overlay, /Salvando…/);
});

test("store não recria reducer paralelo de pin", () => {
  assert.doesNotMatch(store, /TOGGLE_PIN_MODE|MAP_CLICK|LAYER_CLICK/);
  assert.doesNotMatch(store, /isPinModeActive|clickedCoordinate/);
});
