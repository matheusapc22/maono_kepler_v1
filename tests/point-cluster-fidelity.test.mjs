import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildNativePointClusterFilter,
  NATIVE_CLUSTER_RADIUS_RANGE,
} from "../src/pages/Kepler/clustering/point-cluster-native-data-adapter.ts";
import {
  DEFAULT_CLUSTER_SIZE,
  getAdaptivePointClusterDefaults,
} from "../src/pages/Kepler/clustering/point-cluster-policy.ts";

const adaptiveLayerSource = await readFile(
  new URL(
    "../src/pages/Kepler/clustering/point-cluster-adaptive-layer.ts",
    import.meta.url,
  ),
  "utf8",
);

test("filtro CPU do cluster reproduz o conjunto elegível do filtro da camada", () => {
  const rows = [
    { index: 0, value: 5 },
    { index: 1, value: 10 },
    { index: 2, value: 15 },
    { index: 3, value: 20 },
  ];
  const filter = buildNativePointClusterFilter({
    dataProps: {
      getFilterValue: (row) => [row.value],
      getFiltered: (row) => (row.index === 2 ? 0 : 1),
    },
    gpuFilter: {
      filterRange: [[8, 20]],
    },
  });

  assert.equal(typeof filter, "function");
  assert.deepEqual(rows.filter(filter).map((row) => row.index), [1, 3]);
});

test("predicado nativo já produzido pela camada tem precedência", () => {
  const native = (row) => row.keep === true;
  const filter = buildNativePointClusterFilter({
    dataProps: {
      _filterData: native,
      getFilterValue: () => [999],
    },
    gpuFilter: { filterRange: [[0, 1]] },
  });

  assert.equal(filter, native);
});

test("raio espacial padrão permanece equivalente ao cluster nativo em qualquer volume", () => {
  assert.equal(DEFAULT_CLUSTER_SIZE, 40);
  assert.deepEqual(NATIVE_CLUSTER_RADIUS_RANGE, [1, 40]);

  for (const count of [10, 20_000, 150_000, 350_000]) {
    assert.equal(getAdaptivePointClusterDefaults(count).clusterSize, 40);
  }
});

test("runtime separa topologia do cluster de tamanho visual e não aplica corte de 90%", () => {
  assert.match(adaptiveLayerSource, /buildNativePointClusterFilter/);
  assert.match(adaptiveLayerSource, /radiusRange:\s*NATIVE_CLUSTER_RADIUS_RANGE/);
  assert.match(adaptiveLayerSource, /clusterRadius:\s*policy\.clusterSize/);
  assert.doesNotMatch(adaptiveLayerSource, /valid\.length\s*\/\s*data\.length\s*<\s*0\.9/);
});
