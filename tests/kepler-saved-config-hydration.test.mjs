import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hydrateSavedKeplerConfig,
  isSavedConfigHydrationError,
} from "../src/pages/Kepler/map-url-loader/saved-config-hydrator.ts";

async function readGoldenFixture(name) {
  const content = await readFile(
    new URL(`./fixtures/maps/golden/${name}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(content);
}

test("SavedDatasetV1 é convertido pelo schema canônico para fields/rows", async () => {
  const saved = await readGoldenFixture("map-point-basic.kepler.json");
  const expectedRows = saved.datasets[0].data.allData;

  const runtime = hydrateSavedKeplerConfig(saved, {
    featureEnabled: false,
  });

  assert.equal(runtime.datasets.length, 1);
  assert.equal(runtime.datasets[0].info.id, "golden-points");
  assert.ok(Array.isArray(runtime.datasets[0].data.fields));
  assert.ok(Array.isArray(runtime.datasets[0].data.rows));
  assert.deepEqual(runtime.datasets[0].data.rows, expectedRows);
  assert.equal("allData" in runtime.datasets[0].data, false);
});

test("hidratação preserva config persistido quando schema não produz config runtime", async () => {
  const saved = await readGoldenFixture("map-point-basic.kepler.json");
  const runtime = hydrateSavedKeplerConfig(saved, {
    featureEnabled: false,
  });

  assert.ok(runtime.config);
  assert.deepEqual(runtime.config.mapState, saved.config.mapState);
  assert.equal(runtime.config.visState.layers[0].config.dataId, "golden-points");
});

test("payload que não vira RuntimeDataset falha fechado com erro não retryable", () => {
  const malformed = {
    version: "v1",
    datasets: [
      {
        version: "v9",
        data: {
          id: "invalid-version",
          label: "Inválido",
          color: [0, 0, 0],
          fields: [],
          allData: [],
        },
      },
    ],
    config: {},
  };

  assert.throws(
    () => hydrateSavedKeplerConfig(malformed),
    (error) => {
      assert.equal(isSavedConfigHydrationError(error), true);
      assert.equal(error.code, "KEPLER_SCHEMA_LOAD_FAILED");
      assert.equal(error.category, "MAP_CONFIG");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});
