import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  VIEWER_MUTATION_POLICY,
  validateViewerLayerDefinitionPayload,
  validateViewerMapBlendingPayload,
  validateViewerTooltipPayload,
} from "../src/pages/Kepler/change-requests/viewer-persistent-mutations.ts";
import {
  compactViewerOperationsForLocalLayerRemoval,
  snapshotViewerLifecycleLayer,
} from "../src/pages/Kepler/change-requests/viewer-layer-lifecycle.ts";
import {
  applyPersistentViewerMutationOperation,
  validatePersistentViewerMutationOperation,
} from "../functions/_lib/project-change-request-persistent-mutation-operations.js";

const ROOT = new URL("../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, ROOT), "utf8");
}

function definition(label = "Leads") {
  return {
    type: "point",
    dataIds: ["data-a"],
    label,
    columns: {
      latitude: "latitude",
      longitude: "longitude",
      geojson: null,
      altitude: null,
    },
    colorField: null,
    colorScale: null,
    colorPalette: [],
    colorPaletteId: null,
    strokeColorField: null,
    strokeColorScale: null,
    strokeColorPalette: [],
    strokeColorPaletteId: null,
    radiusField: null,
    radiusScale: null,
    radiusRange: null,
  };
}

function baseConfig() {
  return {
    datasets: [
      {
        info: { id: "data-a", label: "Leads" },
        data: {
          id: "data-a",
          fields: [
            { name: "latitude", type: "real" },
            { name: "longitude", type: "real" },
            { name: "status", type: "string" },
          ],
          rows: [],
        },
      },
    ],
    config: {
      visState: {
        layers: [
          {
            id: "layer-a",
            type: "point",
            config: {
              dataId: "data-a",
              label: "Leads",
              columns: { lat: "latitude", lng: "longitude" },
              colorField: null,
              colorScale: null,
              strokeColorField: null,
              strokeColorScale: null,
              sizeField: null,
              sizeScale: null,
              visConfig: {},
            },
          },
        ],
        interactionConfig: {
          tooltip: {
            id: "tooltip",
            enabled: true,
            config: { fieldsToShow: {} },
          },
        },
        layerBlending: "normal",
        overlayBlending: "normal",
      },
    },
  };
}

function operation(type, payload, id = `op-${type}`) {
  return {
    id,
    type,
    version: 1,
    sequence: 0,
    payload,
    createdAt: "2026-09-05T22:00:00.000Z",
  };
}

function lifecycleLayer(id = "layer-new") {
  return {
    id,
    type: "point",
    label: "Nova",
    order: 1,
    selected: false,
    isVisible: true,
    dataIds: ["data-a"],
    columns: {
      latitude: "latitude",
      longitude: "longitude",
      geojson: null,
      altitude: null,
    },
    style: {
      fillEnabled: true,
      opacity: 0.8,
      color: [47, 125, 244],
      colorField: null,
      colorScale: null,
      colorPalette: [],
      colorPaletteId: null,
      strokeEnabled: false,
      strokeColor: [47, 125, 244],
      strokeColorField: null,
      strokeColorScale: null,
      strokeColorPalette: [],
      strokeColorPaletteId: null,
      strokeOpacity: 1,
      strokeWidth: 1,
      pointRadius: 10,
      radiusField: null,
      radiusScale: null,
      radiusRange: null,
      clusterRadius: null,
      heatmapRadius: null,
      compatibility: {},
    },
    visualChannels: {
      color: { field: null, scale: null },
      strokeColor: { field: null, scale: null },
      size: { field: null, scale: null },
      height: { field: null, scale: null },
    },
    compatibility: {},
    structure: {},
  };
}

test("Viewer mutation policy classifica todo comando do Engine Adapter", () => {
  const source = read("src/pages/Kepler/engine-adapter/types.ts");
  const section = source.match(/export type KeplerEngineCommands = \{([\s\S]*?)\n\};/)?.[1] || "";
  const commandNames = Array.from(section.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\(/gm), (match) => match[1]);
  assert.ok(commandNames.length > 40, "o gate deve cobrir a superfície real do adapter");
  assert.deepEqual(
    Object.keys(VIEWER_MUTATION_POLICY).sort(),
    [...new Set(commandNames)].sort(),
  );
});

test("Viewer separa mutações persistentes, de sessão e bloqueadas", () => {
  assert.equal(VIEWER_MUTATION_POLICY.renameLayer.kind, "persistent");
  assert.equal(VIEWER_MUTATION_POLICY.setTooltipFields.operation, "tooltip.config.update");
  assert.equal(VIEWER_MUTATION_POLICY.setLayerBlending.operation, "map.blending.update");
  assert.equal(VIEWER_MUTATION_POLICY.updateViewport.kind, "session");
  assert.equal(VIEWER_MUTATION_POLICY.setBasemapStyle.kind, "session");
  assert.equal(VIEWER_MUTATION_POLICY.removeDataset.kind, "blocked");
  assert.equal(VIEWER_MUTATION_POLICY.replaceDataset.kind, "blocked");
  assert.equal(VIEWER_MUTATION_POLICY.openAddDataModal.kind, "blocked");
});

test("novos contratos v1 validam snapshots pequenos e rejeitam propriedades arbitrárias", () => {
  assert.doesNotThrow(() =>
    validateViewerLayerDefinitionPayload({
      targetLayerId: "layer-a",
      before: definition("Leads"),
      after: definition("Prospects"),
    }),
  );
  assert.throws(
    () =>
      validateViewerLayerDefinitionPayload({
        targetLayerId: "layer-a",
        before: definition("Leads"),
        after: { ...definition("Prospects"), allData: [[1, 2, 3]] },
      }),
    /WORKING_COPY_OPERATION_INVALID/,
  );
  assert.doesNotThrow(() =>
    validateViewerTooltipPayload({
      before: { enabled: true, fieldsByDataset: {} },
      after: {
        enabled: true,
        fieldsByDataset: { "data-a": [{ name: "status", format: null }] },
      },
    }),
  );
  assert.doesNotThrow(() =>
    validateViewerMapBlendingPayload({
      before: { layers: "normal", overlays: "normal" },
      after: { layers: "additive", overlays: "screen" },
    }),
  );
});

test("backend aplica definição, tooltip e blending com before/after autoritativo", () => {
  const config = baseConfig();
  const before = definition("Leads");
  const after = {
    ...definition("Prospects"),
    colorField: "status",
    colorScale: "ordinal",
  };
  const definitionOp = operation("layer.definition.update", {
    targetLayerId: "layer-a",
    before,
    after,
  });
  assert.doesNotThrow(() => validatePersistentViewerMutationOperation(definitionOp));
  applyPersistentViewerMutationOperation(config, definitionOp);
  assert.equal(config.config.visState.layers[0].config.label, "Prospects");
  assert.equal(config.config.visState.layers[0].config.colorField, "status");

  applyPersistentViewerMutationOperation(
    config,
    operation("tooltip.config.update", {
      before: { enabled: true, fieldsByDataset: {} },
      after: {
        enabled: true,
        fieldsByDataset: { "data-a": [{ name: "status", format: null }] },
      },
    }),
  );
  assert.equal(
    config.config.visState.interactionConfig.tooltip.config.fieldsToShow["data-a"][0].name,
    "status",
  );

  applyPersistentViewerMutationOperation(
    config,
    operation("map.blending.update", {
      before: { layers: "normal", overlays: "normal" },
      after: { layers: "additive", overlays: "screen" },
    }),
  );
  assert.equal(config.config.visState.layerBlending, "additive");
  assert.equal(config.config.visState.overlayBlending, "screen");
});

test("backend falha fechado quando definição referencia campo ausente", () => {
  const config = baseConfig();
  const after = {
    ...definition("Prospects"),
    colorField: "missing-field",
    colorScale: "ordinal",
  };
  assert.throws(
    () =>
      applyPersistentViewerMutationOperation(
        config,
        operation("layer.definition.update", {
          targetLayerId: "layer-a",
          before: definition("Leads"),
          after,
        }),
      ),
    (error) => error?.code === "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
  );
});

test("create local + definition + remove compacta para no-op", () => {
  const snapshot = snapshotViewerLifecycleLayer(lifecycleLayer());
  assert.ok(snapshot);
  const operations = [
    operation("layer.create", { layer: snapshot, insertIndex: 1 }, "op-create"),
    operation(
      "layer.definition.update",
      {
        targetLayerId: "layer-new",
        before: definition("Nova"),
        after: definition("Nova renomeada"),
      },
      "op-definition",
    ),
  ];
  assert.deepEqual(
    compactViewerOperationsForLocalLayerRemoval(operations, "layer-new"),
    [],
  );
});

test("coverage mantém fail-closed e Review large-map-safe", () => {
  const legacyRuntime = read(
    "src/pages/Kepler/change-requests/ViewerWorkingCopyRuntimeLegacy.tsx",
  );
  const reviewServer = read("functions/_lib/project-change-request-review.js");
  const reviewApi = read("src/pages/Kepler/change-requests/review-api.ts");
  const policy = read("src/pages/Kepler/change-requests/viewer-mutation-policy.ts");

  assert.match(legacyRuntime, /untrackedLatchedRef\.current = true/);
  assert.match(policy, /kind === "blocked"/);
  assert.doesNotMatch(reviewServer, /base:\s*\{[\s\S]{0,300}config:/);
  assert.doesNotMatch(reviewApi, /review\.base\.config/);
});
