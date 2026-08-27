import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(3).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : fallback;
}

function sanitizeId(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function inferField(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (!present.length) {
    return { type: "string", analyzerType: "STRING" };
  }

  if (present.every((value) => typeof value === "boolean")) {
    return { type: "boolean", analyzerType: "BOOLEAN" };
  }

  if (
    present.every(
      (value) => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value),
    )
  ) {
    return { type: "integer", analyzerType: "INT" };
  }

  if (
    present.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return { type: "real", analyzerType: "FLOAT" };
  }

  return { type: "string", analyzerType: "STRING" };
}

function normalizePropertyValue(value) {
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function visitCoordinates(value, stats) {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  ) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    stats.coordinateCount += 1;
    stats.minLongitude = Math.min(stats.minLongitude, longitude);
    stats.maxLongitude = Math.max(stats.maxLongitude, longitude);
    stats.minLatitude = Math.min(stats.minLatitude, latitude);
    stats.maxLatitude = Math.max(stats.maxLatitude, latitude);
    return;
  }
  for (const child of value) visitCoordinates(child, stats);
}

function visitGeometry(geometry, stats) {
  if (!geometry || typeof geometry !== "object") return;
  if (geometry.type) stats.geometryTypes.add(String(geometry.type));
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries || []) visitGeometry(child, stats);
    return;
  }
  visitCoordinates(geometry.coordinates, stats);
}

function centerAndZoom(bbox) {
  if (!bbox) {
    return { latitude: 0, longitude: 0, zoom: 2 };
  }
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const span = Math.max(Math.abs(maxLon - minLon), Math.abs(maxLat - minLat));
  let zoom = 11;
  if (span > 60) zoom = 2;
  else if (span > 20) zoom = 3;
  else if (span > 10) zoom = 4;
  else if (span > 5) zoom = 5;
  else if (span > 2) zoom = 6;
  else if (span > 1) zoom = 7;
  else if (span > 0.5) zoom = 8;
  else if (span > 0.2) zoom = 9;
  else if (span > 0.1) zoom = 10;

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    zoom,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error(
    "Uso: node scripts/preview/build-golden-project.mjs arquivo.geojson --out-dir=/tmp/maono-golden",
  );
  process.exit(1);
}

const outDir = path.resolve(argument("out-dir", "./tmp/preview-golden"));
const slug = sanitizeId(argument("slug", "qa-geojson-golden"), "qa-geojson-golden");
const label = argument("label", "QA — GeoJSON Golden");
const datasetId = `${slug}-dataset`;
const layerId = `${slug}-layer`;

const sourceBuffer = await readFile(sourcePath);
const sourceInfo = await stat(sourcePath);
let geojson;
try {
  geojson = JSON.parse(sourceBuffer.toString("utf8"));
} catch (error) {
  console.error(`GeoJSON inválido: ${error.message}`);
  process.exit(1);
}

if (geojson?.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
  console.error("A fixture Golden deve ser um GeoJSON FeatureCollection.");
  process.exit(1);
}

const propertyNames = new Set();
const stats = {
  geometryTypes: new Set(),
  coordinateCount: 0,
  minLongitude: Infinity,
  maxLongitude: -Infinity,
  minLatitude: Infinity,
  maxLatitude: -Infinity,
};

for (const feature of geojson.features) {
  for (const key of Object.keys(feature?.properties || {})) propertyNames.add(key);
  visitGeometry(feature?.geometry, stats);
}

const orderedProperties = [...propertyNames].sort((left, right) => left.localeCompare(right));
const propertyValues = new Map(
  orderedProperties.map((name) => [name, []]),
);

for (const feature of geojson.features) {
  const properties = feature?.properties || {};
  for (const name of orderedProperties) {
    propertyValues.get(name).push(normalizePropertyValue(properties[name]));
  }
}

const fields = orderedProperties.map((name) => {
  const inferred = inferField(propertyValues.get(name));
  return {
    name,
    type: inferred.type,
    format: "",
    analyzerType: inferred.analyzerType,
  };
});
fields.push({
  name: "__geometry",
  type: "geojson",
  format: "",
  analyzerType: "GEOMETRY",
});

const allData = geojson.features.map((feature) => [
  ...orderedProperties.map((name) =>
    normalizePropertyValue(feature?.properties?.[name]),
  ),
  JSON.stringify(feature?.geometry || null),
]);

const bbox = Number.isFinite(stats.minLongitude)
  ? [
      stats.minLongitude,
      stats.minLatitude,
      stats.maxLongitude,
      stats.maxLatitude,
    ]
  : null;
const mapState = centerAndZoom(bbox);
const tooltipFields = orderedProperties.slice(0, 12).map((name) => ({
  name,
  format: null,
}));

const mapConfig = {
  version: "v1",
  datasets: [
    {
      version: "v1",
      data: {
        id: datasetId,
        label,
        color: [247, 231, 178],
        allData,
        fields,
      },
    },
  ],
  config: {
    visState: {
      filters: [],
      layers: [
        {
          id: layerId,
          type: "geojson",
          config: {
            dataId: datasetId,
            label,
            color: [247, 231, 178],
            columns: { geojson: "__geometry" },
            isVisible: true,
            visConfig: {
              opacity: 0.65,
              strokeOpacity: 0.9,
              thickness: 1,
              stroked: true,
              filled: true,
              enable3d: false,
            },
          },
        },
      ],
      interactionConfig: {
        tooltip: {
          fieldsToShow: {
            [datasetId]: tooltipFields,
          },
          enabled: true,
        },
      },
      layerBlending: "normal",
      splitMaps: [],
    },
    mapState: {
      bearing: 0,
      dragRotate: false,
      latitude: mapState.latitude,
      longitude: mapState.longitude,
      pitch: 0,
      zoom: mapState.zoom,
    },
    mapStyle: {
      styleType: "dark",
      topLayerGroups: {},
      visibleLayerGroups: {
        label: true,
        road: true,
        border: false,
        building: true,
        water: true,
        land: true,
        "3d building": false,
      },
      threeDBuildingColor: [9, 20, 26.2],
      mapStyles: {},
    },
  },
};

const configText = JSON.stringify(mapConfig);
const configBuffer = Buffer.from(configText, "utf8");
const manifest = {
  fixtureVersion: 1,
  slug,
  label,
  source: {
    fileName: path.basename(sourcePath),
    sha256: sha256(sourceBuffer),
    sizeBytes: sourceInfo.size,
    featureCount: geojson.features.length,
    geometryTypes: [...stats.geometryTypes].sort(),
    coordinateCount: stats.coordinateCount,
    bbox,
    propertyCount: orderedProperties.length,
    properties: orderedProperties,
  },
  mapConfig: {
    fileName: "config.kepler.r000001.json",
    schema: "legacy-kepler",
    schemaVersion: 1,
    sha256: sha256(configBuffer),
    sizeBytes: configBuffer.byteLength,
    datasetId,
    layerId,
  },
};

await mkdir(outDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outDir, "config.kepler.r000001.json"), configBuffer),
  writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  ),
]);

console.log(JSON.stringify({ outDir, ...manifest }, null, 2));
