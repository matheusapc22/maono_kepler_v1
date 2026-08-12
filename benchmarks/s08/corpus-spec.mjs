export const S08_BENCHMARK_VERSION = "s08-benchmark-v1";
export const S08_GENERATOR_VERSION = "s08-generator-v1";

export const DEVICE_CLASSES = Object.freeze([
  "ENTRY_NOTEBOOK",
  "STANDARD_NOTEBOOK",
  "HIGH_END_DESKTOP",
  "SUPPORTED_MOBILE",
]);

export const REQUIRED_GEOMETRY_PROFILES = Object.freeze([
  "Point",
  "LineString",
  "Polygon",
  "MultiPolygon",
  "PolygonHoles",
  "GeometryCollection",
]);

export const REQUIRED_LAYER_COUNTS = Object.freeze([1, 3, 5, 10, 20]);
export const REQUIRED_BYTE_TARGETS_MIB = Object.freeze([2, 5, 10, 20, 40]);
export const REQUIRED_FEATURE_COUNTS = Object.freeze([
  10_000,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
]);
export const REQUIRED_POSITION_COUNTS = Object.freeze([
  100_000,
  250_000,
  500_000,
  1_000_000,
  2_000_000,
  5_000_000,
]);
export const REQUIRED_MAX_FEATURE_POSITIONS = Object.freeze([
  10_000,
  50_000,
  100_000,
  250_000,
  500_000,
]);

const MIB = 1024 * 1024;

function fixture({
  fixtureId,
  family,
  geometryProfile,
  featureCount,
  coordinatePositionCount,
  layerCount = 1,
  targetSizeBytes = null,
  maxFeaturePositionCount = null,
  seed = 8017,
}) {
  return Object.freeze({
    fixtureId,
    family,
    geometryProfile,
    featureCount,
    coordinatePositionCount,
    layerCount,
    targetSizeBytes,
    maxFeaturePositionCount,
    seed,
  });
}

const byteSweep = REQUIRED_BYTE_TARGETS_MIB.map((mib) =>
  fixture({
    fixtureId: `bytes-${String(mib).padStart(2, "0")}mib`,
    family: "bytes",
    geometryProfile: "LineString",
    featureCount: 1_000,
    coordinatePositionCount: 100_000,
    targetSizeBytes: mib * MIB,
  }),
);

const featureSweep = REQUIRED_FEATURE_COUNTS.map((count) =>
  fixture({
    fixtureId: `features-${String(count).padStart(7, "0")}`,
    family: "features",
    geometryProfile: "Point",
    featureCount: count,
    coordinatePositionCount: count,
  }),
);

const positionSweep = REQUIRED_POSITION_COUNTS.map((count) =>
  fixture({
    fixtureId: `positions-${String(count).padStart(7, "0")}`,
    family: "positions",
    geometryProfile: "LineString",
    featureCount: 1_000,
    coordinatePositionCount: count,
  }),
);

const geometrySweep = REQUIRED_GEOMETRY_PROFILES.map((geometryProfile) => {
  const isPoint = geometryProfile === "Point";
  return fixture({
    fixtureId: `geometry-${geometryProfile.toLowerCase()}`,
    family: "geometry",
    geometryProfile,
    featureCount: isPoint ? 500_000 : 1_000,
    coordinatePositionCount: 500_000,
  });
});

const layerSweep = REQUIRED_LAYER_COUNTS.map((count) =>
  fixture({
    fixtureId: `layers-${String(count).padStart(2, "0")}`,
    family: "layers",
    geometryProfile: "LineString",
    featureCount: 1_000,
    coordinatePositionCount: 250_000,
    layerCount: count,
  }),
);

const maxFeatureSweep = REQUIRED_MAX_FEATURE_POSITIONS.map((count) =>
  fixture({
    fixtureId: `max-feature-${String(count).padStart(6, "0")}`,
    family: "max-feature",
    geometryProfile: "PolygonHoles",
    featureCount: 10,
    coordinatePositionCount: count + 100_000,
    maxFeaturePositionCount: count,
  }),
);

export const S08_CORPUS = Object.freeze([
  ...byteSweep,
  ...featureSweep,
  ...positionSweep,
  ...geometrySweep,
  ...layerSweep,
  ...maxFeatureSweep,
]);

export const S08_SMOKE_CORPUS = Object.freeze([
  fixture({
    fixtureId: "smoke-point-100",
    family: "smoke",
    geometryProfile: "Point",
    featureCount: 100,
    coordinatePositionCount: 100,
  }),
  fixture({
    fixtureId: "smoke-polygon-holes-1000",
    family: "smoke",
    geometryProfile: "PolygonHoles",
    featureCount: 10,
    coordinatePositionCount: 1_000,
    layerCount: 3,
  }),
]);

export function getCorpus(profile = "full") {
  if (profile === "smoke") return S08_SMOKE_CORPUS;
  if (profile === "full") return S08_CORPUS;
  throw new Error(`Perfil de corpus S08 desconhecido: ${profile}`);
}
