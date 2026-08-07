import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deterministicSampleIndexes } from "../src/pages/Kepler/engine-adapter/dataset-table-reader.ts";
import { buildSmartFilterHistogram } from "../src/pages/Kepler/engine-adapter/filter-histogram-engine.ts";
import {
  histogramRatioToValue,
  histogramValueToRatio,
} from "../src/pages/Kepler/engine-adapter/histogram-strategies.ts";

function stateWith({ rows, fields, filters }) {
  const allIndexes = rows.map((_, index) => index);
  return {
    demo: {
      keplerGl: {
        map: {
          visState: {
            datasets: {
              data: {
                id: "data",
                fields,
                allData: rows,
                allIndexes,
                filteredIndex: allIndexes,
              },
            },
            filters,
          },
        },
      },
    },
  };
}

function rangeFilter(name, domain, value, extra = {}) {
  return {
    id: `filter-${name}`,
    dataId: ["data"],
    name: [name],
    type: "range",
    domain,
    value,
    enabled: true,
    ...extra,
  };
}

test("cross-filter aplica os demais filtros e ignora o próprio range", () => {
  const state = stateWith({
    fields: [
      { name: "valor", type: "integer" },
      { name: "grupo", type: "integer" },
    ],
    rows: [
      [5, 1],
      [50, 1],
      [500, 2],
    ],
    filters: [
      rangeFilter("valor", [0, 600], [0, 10]),
      rangeFilter("grupo", [1, 2], [1, 1]),
    ],
  });

  const histogram = buildSmartFilterHistogram(state, 0);
  const total = histogram.bins.reduce((sum, bin) => sum + bin.count, 0);

  assert.equal(histogram.source, "smart");
  assert.equal(histogram.quality, "exact");
  assert.equal(total, 2, "o valor 50 deve entrar mesmo estando fora do próprio range");
});

test("campos numéricos aceitam números armazenados como texto", () => {
  const state = stateWith({
    fields: [{ name: "valor", type: "integer" }],
    rows: [["100"], [200], ["invalido"]],
    filters: [rangeFilter("valor", [0, 300], [0, 300])],
  });

  const histogram = buildSmartFilterHistogram(state, 0);
  const total = histogram.bins.reduce((sum, bin) => sum + bin.count, 0);

  assert.equal(total, 2);
  assert.equal(histogram.observedCount, 2);
});

test("distribuição extremamente assimétrica ativa eixo logarítmico deslocado", () => {
  const ordinary = Array.from({ length: 100 }, (_, index) => [30_000 + index * 2_000]);
  const state = stateWith({
    fields: [{ name: "valor", type: "number" }],
    rows: [...ordinary, [5_980_306_809]],
    filters: [rangeFilter("valor", [30_000, 5_980_306_809], [30_000, 5_980_306_809])],
  });

  const histogram = buildSmartFilterHistogram(state, 0);

  assert.equal(histogram.axisScale, "log-shifted");
  assert.ok(histogram.bins.length >= 6);
  assert.ok(histogram.bins.length <= 60);
});

test("transformação do eixo do brush é reversível", () => {
  const domain = [30_000, 5_980_306_809];
  const value = 2_000_000;
  const ratio = histogramValueToRatio(value, domain, "log-shifted");
  const restored = histogramRatioToValue(ratio, domain, "log-shifted");

  assert.ok(Math.abs(restored - value) / value < 1e-10);
});

test("amostragem distribuída preserva início, meio e fim", () => {
  const result = deterministicSampleIndexes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
  assert.equal(result.sampled, true);
  assert.deepEqual(result.indexes, [0, 3, 6, 9]);
});

test("filtro incompatível usa bins nativos como fallback", () => {
  const state = stateWith({
    fields: [
      { name: "valor", type: "number" },
      { name: "geom", type: "geojson" },
    ],
    rows: [[10, null], [20, null]],
    filters: [
      rangeFilter("valor", [0, 30], [0, 30], {
        bins: [
          { start: 0, end: 15, count: 1 },
          { start: 15, end: 30, count: 1 },
        ],
      }),
      {
        id: "spatial",
        dataId: ["data"],
        name: ["geom"],
        type: "polygon",
        enabled: true,
        value: null,
      },
    ],
  });

  const histogram = buildSmartFilterHistogram(state, 0);
  assert.equal(histogram.source, "kepler-native");
  assert.equal(histogram.quality, "fallback");
  assert.equal(histogram.bins.length, 2);
});

test("editor remove sliders externos e concentra seleção no brush", async () => {
  const editor = await readFile(
    new URL(
      "../src/pages/Kepler/components/maono-layer-panel/filters/FilterValueEditor.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const histogram = await readFile(
    new URL(
      "../src/pages/Kepler/components/maono-layer-panel/filters/FilterHistogram.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(editor, /type="range"/);
  assert.match(editor, /useSmartFilterHistogram/);
  assert.match(histogram, /beginDrag\("window"/);
  assert.match(histogram, /const amplitude = drag\.startRange\[1\] - drag\.startRange\[0\]/);
  assert.match(histogram, /role="slider"/);
  assert.match(histogram, /onRangeCommit/);
});
