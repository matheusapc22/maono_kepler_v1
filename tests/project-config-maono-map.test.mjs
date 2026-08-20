import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectConfigArtifact,
  sha256Hex,
} from "../functions/_lib/project-config-integrity.js";
import {
  isMaonoMapSchemaWriteV1Enabled,
  prepareProjectConfigDocumentForWrite,
} from "../functions/_lib/project-config-service.js";
import { detectSchema } from "../shared/map-document/index.js";

function legacy() {
  return {
    version: "v1",
    datasets: [{ data: { id: "points", label: "Pontos", fields: [], allData: [[-46.6, -23.5]] } }],
    config: {
      visState: { layers: [{ id: "points", type: "point", config: { dataId: "points", label: "Pontos", isVisible: true } }], filters: [] },
      mapState: { latitude: -23.5, longitude: -46.6, zoom: 8 },
      mapStyle: { styleType: "dark" },
    },
    maono: { unknown: { preserved: true } },
  };
}

test("MAONO_MAP_SCHEMA_WRITE_V1 é opt-in e OFF por padrão", () => {
  assert.equal(isMaonoMapSchemaWriteV1Enabled({}), false);
  assert.equal(isMaonoMapSchemaWriteV1Enabled({ MAONO_MAP_SCHEMA_WRITE_V1: "false" }), false);
  assert.equal(isMaonoMapSchemaWriteV1Enabled({ MAONO_MAP_SCHEMA_WRITE_V1: "1" }), true);
  assert.equal(isMaonoMapSchemaWriteV1Enabled({ MAONO_MAP_SCHEMA_WRITE_V1: "ON" }), true);
});

test("write OFF preserva legacy; write ON gera maono-map@1", async () => {
  const source = legacy();
  const off = prepareProjectConfigDocumentForWrite(source, { writeMaonoMapV1: false });
  assert.equal(detectSchema(off).kind, "legacy-kepler@1");

  const on = prepareProjectConfigDocumentForWrite(source, { writeMaonoMapV1: true });
  assert.equal(detectSchema(on).kind, "maono-map@1");
  assert.equal(Object.prototype.hasOwnProperty.call(on.datasets[0], "allData"), false);

  const artifact = await buildProjectConfigArtifact(on);
  assert.equal(artifact.schemaName, "maono-map");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.sizeBytes, artifact.bytes.byteLength);
  assert.equal(artifact.checksum, await sha256Hex(artifact.bytes));
});

test("rollback OFF converte documento maono-map já lido para escrita legacy", () => {
  const source = legacy();
  const maono = prepareProjectConfigDocumentForWrite(source, { writeMaonoMapV1: true });
  const rollback = prepareProjectConfigDocumentForWrite(maono, { writeMaonoMapV1: false });
  assert.deepEqual(rollback, source);
});
