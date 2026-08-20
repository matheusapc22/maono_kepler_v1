import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import {
  canonicalSerialize,
  legacyKeplerToMaonoMapV1,
  toLegacyKeplerDocument,
} from "../shared/map-document/index.js";

function legacy() {
  return {
    version: "v1",
    datasets: [{ version: "v1", data: { id: "bulk", label: "Bulk", fields: [{ name: "lng", type: "real" }, { name: "lat", type: "real" }], allData: [[-46.6, -23.5], [-43.1, -22.9]] } }],
    config: {
      visState: {
        layers: [{ id: "points", type: "point", config: { dataId: "bulk", label: "Pontos", isVisible: true } }],
        filters: [{ id: "f1", dataId: ["bulk"], name: ["lng"], type: "range", value: [-50, -40] }],
      },
      mapState: { latitude: -23.5, longitude: -46.6, zoom: 7 },
      mapStyle: { styleType: "dark" },
    },
    maono: { customUnknownExtension: { enabled: true, mode: "keep-me" } },
  };
}

function sha(text) {
  return createHash("sha256").update(text).digest("hex");
}

test("legacy -> maono -> legacy preserva payload e extensão desconhecida", () => {
  const source = legacy();
  const maono = legacyKeplerToMaonoMapV1(source);
  const restored = toLegacyKeplerDocument(maono);
  assert.deepEqual(restored, source);
  assert.deepEqual(maono.extensions.customUnknownExtension, { enabled: true, mode: "keep-me" });
});

test("dataset volumoso existe uma única vez no documento maono-map", () => {
  const maono = legacyKeplerToMaonoMapV1(legacy());
  assert.equal(Object.prototype.hasOwnProperty.call(maono.datasets[0], "allData"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(maono.datasets[0], "fields"), false);
  assert.deepEqual(maono.engine.payload.datasets[0].data.allData, [[-46.6, -23.5], [-43.1, -22.9]]);
});

test("canonicalSerialize produz bytes determinísticos para mesma semântica", () => {
  const a = legacyKeplerToMaonoMapV1(legacy());
  const b = { extensions: a.extensions, engine: a.engine, analyses: a.analyses, filters: a.filters, layers: a.layers, datasets: a.datasets, map: a.map, version: a.version, schema: a.schema };
  const first = canonicalSerialize(a);
  const second = canonicalSerialize(b);
  assert.equal(first, second);
  assert.equal(sha(first), sha(second));
});
