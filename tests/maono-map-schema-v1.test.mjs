import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_DOCUMENT_KIND,
  MapDocumentValidationError,
  detectSchema,
  legacyKeplerToMaonoMapV1,
  validateDocument,
} from "../shared/map-document/index.js";

function legacy() {
  return {
    version: "v1",
    datasets: [{ data: { id: "points", label: "Pontos", fields: [], allData: [[1, 2]] } }],
    config: {
      visState: { layers: [{ id: "layer-1", type: "point", config: { dataId: "points", label: "Pontos" } }], filters: [] },
      mapState: { latitude: -23.5, longitude: -46.6, zoom: 8 },
      mapStyle: { styleType: "dark" },
    },
  };
}

test("detectSchema cobre legacy, maono-map, future e invalid", () => {
  assert.equal(detectSchema(legacy()).kind, MAP_DOCUMENT_KIND.LEGACY_KEPLER_V1);
  const maono = legacyKeplerToMaonoMapV1(legacy());
  assert.equal(detectSchema(maono).kind, MAP_DOCUMENT_KIND.MAONO_MAP_V1);
  assert.equal(detectSchema({ ...maono, version: 2 }).kind, MAP_DOCUMENT_KIND.FUTURE);
  assert.equal(detectSchema({ nope: true }).kind, MAP_DOCUMENT_KIND.INVALID);
});

test("maono-map@1 exige versão numérica literal e não aceita string permissiva", () => {
  const maono = legacyKeplerToMaonoMapV1(legacy());
  const invalid = { ...maono, version: "1" };
  assert.equal(detectSchema(invalid).kind, MAP_DOCUMENT_KIND.INVALID);
  assert.throws(
    () => validateDocument(invalid),
    (error) => error instanceof MapDocumentValidationError && error.code === "MAP_DOCUMENT_VERSION_INVALID" && error.path === "$.version",
  );
});

test("maono-map@1 exige envelope canônico e payload Kepler válido", () => {
  const maono = legacyKeplerToMaonoMapV1(legacy());
  assert.deepEqual(validateDocument(maono), { kind: MAP_DOCUMENT_KIND.MAONO_MAP_V1, schemaName: "maono-map", schemaVersion: 1 });
  assert.throws(
    () => validateDocument({ ...maono, engine: { type: "kepler", payload: {} } }),
    (error) => error instanceof MapDocumentValidationError && error.code === "LEGACY_KEPLER_VERSION_REQUIRED" && error.path === "$.version",
  );
});

test("future version falha fechada antes de qualquer engine bridge", () => {
  const maono = legacyKeplerToMaonoMapV1(legacy());
  assert.throws(
    () => validateDocument({ ...maono, version: 2 }),
    (error) => error.code === "MAP_DOCUMENT_FUTURE_VERSION" && error.path === "$.version",
  );
});

test("metadata de ledger divergente do conteúdo é rejeitada", () => {
  const maono = legacyKeplerToMaonoMapV1(legacy());
  assert.throws(
    () => validateDocument(maono, { expectedSchemaName: "legacy-kepler", expectedSchemaVersion: 1 }),
    (error) => error.code === "MAP_DOCUMENT_SCHEMA_METADATA_MISMATCH",
  );
});
