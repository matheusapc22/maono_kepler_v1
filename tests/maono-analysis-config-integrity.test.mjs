import assert from "node:assert/strict";
import test from "node:test";

import {
  findMissingMaonoAnalysisDatasetIds,
  validateProjectConfig,
} from "../functions/_lib/project-config-integrity.js";
import {
  recoverOrphanedMaonoAnalysisReferences,
} from "../src/pages/Kepler/map-url-loader/saved-config-hydrator.ts";

function layer(id, dataId) {
  return {
    id,
    type: "geojson",
    config: {
      dataId,
      label: id,
    },
  };
}

function baseConfig({ datasets = [], layers = [], filters = [], fieldsToShow = {} } = {}) {
  return {
    version: "v1",
    datasets,
    config: {
      visState: {
        layers,
        filters,
        interactionConfig: {
          tooltip: {
            id: "tooltip",
            config: {
              fieldsToShow,
            },
          },
        },
      },
    },
  };
}

test("MapConfig aceita análise Maõno quando layer e dataset são persistidos juntos", () => {
  const dataId = "maono_analysis_buffer_valid";
  const config = baseConfig({
    datasets: [{ info: { id: dataId } }],
    layers: [layer("buffer-valid", dataId)],
  });

  assert.deepEqual(findMissingMaonoAnalysisDatasetIds(config), []);
  assert.equal(validateProjectConfig(config), true);
});

test("MapConfig bloqueia Buffer órfão antes de publicar nova revisão", () => {
  const dataId = "maono_analysis_buffer_missing";
  const config = baseConfig({
    layers: [layer("buffer-missing", dataId)],
  });

  assert.deepEqual(findMissingMaonoAnalysisDatasetIds(config), [dataId]);
  assert.throws(
    () => validateProjectConfig(config),
    (error) => {
      assert.equal(error?.code, "PROJECT_CONFIG_ANALYSIS_DATASET_MISSING");
      assert.equal(error?.status, 400);
      assert.equal(error?.details?.missingDatasetCount, 1);
      assert.deepEqual(error?.details?.missingDatasetIds, [dataId]);
      return true;
    },
  );
});

test("MapConfig bloqueia isócrona Maõno órfã com a mesma barreira", () => {
  const dataId = "maono_analysis_isochrone_missing";
  const config = baseConfig({
    layers: [layer("isochrone-missing", dataId)],
  });

  assert.throws(
    () => validateProjectConfig(config),
    (error) => error?.code === "PROJECT_CONFIG_ANALYSIS_DATASET_MISSING",
  );
});

test("barreira Maõno não remove nem rejeita referência externa por heurística", () => {
  const config = baseConfig({
    layers: [layer("external", "external_dataset_missing")],
  });

  assert.deepEqual(findMissingMaonoAnalysisDatasetIds(config), []);
  assert.equal(validateProjectConfig(config), true);
});

test("recuperação remove somente referências órfãs de análises Maõno", () => {
  const bufferId = "maono_analysis_buffer_orphan";
  const isochroneId = "maono_analysis_isochrone_orphan";
  const externalId = "external_dataset_missing";
  const mainId = "main-dataset";
  const config = baseConfig({
    datasets: [{ info: { id: mainId } }],
    layers: [
      layer("main", mainId),
      layer("buffer-orphan", bufferId),
      layer("isochrone-orphan", isochroneId),
      layer("external", externalId),
    ],
    filters: [
      { id: "buffer-filter", dataId: [bufferId] },
      { id: "external-filter", dataId: [externalId] },
    ],
    fieldsToShow: {
      [mainId]: [{ name: "name", format: null }],
      [bufferId]: [{ name: "radius_label", format: null }],
      [isochroneId]: [{ name: "range", format: null }],
      [externalId]: [{ name: "value", format: null }],
    },
  });

  const recovered = recoverOrphanedMaonoAnalysisReferences(config);
  const visState = recovered.savedConfig.config.visState;

  assert.deepEqual(
    new Set(recovered.recoveredDatasetIds),
    new Set([bufferId, isochroneId]),
  );
  assert.deepEqual(
    visState.layers.map((item) => item.id),
    ["main", "external"],
  );
  assert.deepEqual(
    visState.filters.map((item) => item.id),
    ["external-filter"],
  );
  assert.equal(bufferId in visState.interactionConfig.tooltip.config.fieldsToShow, false);
  assert.equal(isochroneId in visState.interactionConfig.tooltip.config.fieldsToShow, false);
  assert.equal(mainId in visState.interactionConfig.tooltip.config.fieldsToShow, true);
  assert.equal(externalId in visState.interactionConfig.tooltip.config.fieldsToShow, true);
});

test("recuperação preserva Buffer quando o dataset correspondente existe", () => {
  const dataId = "maono_analysis_buffer_present";
  const config = baseConfig({
    datasets: [{ info: { id: dataId } }],
    layers: [layer("buffer-present", dataId)],
    fieldsToShow: {
      [dataId]: [{ name: "radius_label", format: null }],
    },
  });

  const recovered = recoverOrphanedMaonoAnalysisReferences(config);

  assert.deepEqual(recovered.recoveredDatasetIds, []);
  assert.equal(recovered.savedConfig, config);
  assert.equal(recovered.savedConfig.config.visState.layers.length, 1);
});
