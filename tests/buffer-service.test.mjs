import assert from "node:assert/strict";
import test from "node:test";

import {
  generateRadialBuffer,
  isBufferFeatureEnabled,
} from "../functions/_lib/geoprocessing/buffer-service.js";

const user = {
  id: 10,
  email: "qa@maono.test",
  role: "super_admin",
  activeOrganizationId: 7,
};
const project = {
  id: 42,
  slug: "demo-maono",
  name: "Demo Maono",
  organization_id: 7,
  active: 1,
};
const rawInput = {
  projectSlug: "demo-maono",
  origin: { latitude: -21.764, longitude: -43.35 },
  unit: "km",
  ranges: [0.5, 1.25],
};
const noAudit = async () => {};

function options() {
  return { user, project, auditImpl: noAudit };
}

test("feature gate do buffer é explícito", () => {
  assert.equal(isBufferFeatureEnabled({ GEOPROCESSING_BUFFER_V1: "true" }), true);
  assert.equal(isBufferFeatureEnabled({ GEOPROCESSING_BUFFER_V1: "false" }), false);
  assert.equal(isBufferFeatureEnabled({}), false);
});

test("service gera GeoJSON e permite persistência em Production para usuário autorizado", async () => {
  const result = await generateRadialBuffer(
    {
      GEOPROCESSING_BUFFER_V1: "true",
      MAONO_RUNTIME_ENV: "production",
    },
    new Request("https://maps.maono.test/api/maps/buffers"),
    rawInput,
    options(),
  );

  assert.equal(result.geojson.type, "FeatureCollection");
  assert.equal(result.geojson.features.length, 2);
  assert.deepEqual(result.metadata.rangesMeters, [500, 1250]);
  assert.equal(result.metadata.inputUnit, "km");
  assert.equal(result.metadata.engine, "maono-radial-geodesic-v2");
  assert.equal(result.metadata.antimeridianSplitCount, 0);
  assert.equal(result.metadata.canPersist, true);
});

test("service mantém análise executável mas canPersist=false em Preview read-only", async () => {
  const result = await generateRadialBuffer(
    {
      GEOPROCESSING_BUFFER_V1: "true",
      MAONO_RUNTIME_ENV: "preview",
      MAONO_PREVIEW_MUTATIONS_ENABLED: "false",
    },
    new Request("https://branch.maono-kepler-v1.pages.dev/api/maps/buffers"),
    rawInput,
    options(),
  );

  assert.equal(result.geojson.features.length, 2);
  assert.equal(result.metadata.canPersist, false);
});

test("service expõe apenas contagem segura quando cruza antimeridiano", async () => {
  const result = await generateRadialBuffer(
    {
      GEOPROCESSING_BUFFER_V1: "true",
      MAONO_RUNTIME_ENV: "production",
    },
    new Request("https://maps.maono.test/api/maps/buffers"),
    {
      ...rawInput,
      origin: { latitude: 0, longitude: 179.9 },
      ranges: [20],
    },
    options(),
  );

  assert.equal(result.geojson.features[0].geometry.type, "MultiPolygon");
  assert.equal(result.metadata.antimeridianSplitCount, 1);
});

test("service recusa execução quando feature está desligada", async () => {
  await assert.rejects(
    generateRadialBuffer(
      { GEOPROCESSING_BUFFER_V1: "false" },
      new Request("https://maps.maono.test/api/maps/buffers"),
      rawInput,
      options(),
    ),
    (error) =>
      error?.status === 503 && error?.code === "BUFFER_FEATURE_DISABLED",
  );
});

test("service exige organização ativa no fluxo sem projeto", async () => {
  await assert.rejects(
    generateRadialBuffer(
      {
        GEOPROCESSING_BUFFER_V1: "true",
        MAONO_RUNTIME_ENV: "production",
      },
      new Request("https://maps.maono.test/api/maps/buffers"),
      {
        origin: rawInput.origin,
        unit: "m",
        ranges: [500],
      },
      {
        user: { ...user, activeOrganizationId: null, organizationId: null },
        auditImpl: noAudit,
      },
    ),
    (error) =>
      error?.status === 409 &&
      error?.code === "ACTIVE_ORGANIZATION_REQUIRED",
  );
});

test("service audita sucesso sem incluir geometria completa", async () => {
  const events = [];
  await generateRadialBuffer(
    {
      GEOPROCESSING_BUFFER_V1: "true",
      MAONO_RUNTIME_ENV: "production",
    },
    new Request("https://maps.maono.test/api/maps/buffers"),
    rawInput,
    {
      user,
      project,
      auditImpl: async (_env, event) => events.push(event),
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].action, "projects.map.buffer.preview");
  assert.equal(events[0].result, "success");
  assert.deepEqual(events[0].metadata.rangesMeters, [500, 1250]);
  assert.equal(events[0].metadata.antimeridianSplitCount, 0);
  assert.equal("geojson" in events[0].metadata, false);
});
