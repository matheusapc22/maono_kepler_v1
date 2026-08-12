import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  S08_GENERATOR_VERSION,
  getCorpus,
} from "../corpus-spec.mjs";

const OUTPUT_ROOT = path.resolve(process.cwd(), ".benchmark-data/s08");

function parseArgs(argv) {
  const options = { profile: "full", fixtureId: null, output: OUTPUT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") options.profile = argv[++index] || "full";
    else if (arg === "--fixture") options.fixtureId = argv[++index] || null;
    else if (arg === "--output") options.output = path.resolve(argv[++index] || OUTPUT_ROOT);
  }
  return options;
}

function minimumPositions(profile) {
  switch (profile) {
    case "Point": return 1;
    case "LineString": return 2;
    case "Polygon": return 4;
    case "PolygonHoles": return 8;
    case "MultiPolygon": return 8;
    case "GeometryCollection": return 7;
    default: throw new Error(`Geometria S08 não suportada: ${profile}`);
  }
}

function coordinate(index, seed = 8017) {
  const x = ((index + seed) % 19) - 9;
  const y = ((index * 7 + seed) % 17) - 8;
  return `[${x},${y}]`;
}

function lineCoordinates(count, seedOffset) {
  const values = new Array(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = coordinate(seedOffset + index);
  }
  return `[${values.join(",")}]`;
}

function ringCoordinates(count, seedOffset) {
  if (count < 4) throw new Error("Ring requer ao menos 4 posições.");
  const first = coordinate(seedOffset);
  const values = [first];
  for (let index = 1; index < count - 1; index += 1) {
    values.push(coordinate(seedOffset + index));
  }
  values.push(first);
  return `[${values.join(",")}]`;
}

export function geometryJson(profile, positionCount, featureIndex = 0, seed = 8017) {
  const min = minimumPositions(profile);
  if (positionCount < min) {
    throw new Error(`${profile} requer ${min} posições; recebido ${positionCount}.`);
  }
  const offset = seed + featureIndex * 97;

  switch (profile) {
    case "Point":
      if (positionCount !== 1) throw new Error("Point deve possuir exatamente 1 posição.");
      return `{"type":"Point","coordinates":${coordinate(offset, seed)}}`;
    case "LineString":
      return `{"type":"LineString","coordinates":${lineCoordinates(positionCount, offset)}}`;
    case "Polygon":
      return `{"type":"Polygon","coordinates":[${ringCoordinates(positionCount, offset)}]}`;
    case "PolygonHoles": {
      const outerCount = Math.max(4, Math.floor(positionCount * 0.65));
      const holeCount = positionCount - outerCount;
      if (holeCount < 4) {
        return `{"type":"Polygon","coordinates":[${ringCoordinates(positionCount, offset)}]}`;
      }
      return `{"type":"Polygon","coordinates":[${ringCoordinates(outerCount, offset)},${ringCoordinates(holeCount, offset + outerCount)}]}`;
    }
    case "MultiPolygon": {
      const firstCount = Math.max(4, Math.floor(positionCount / 2));
      const secondCount = positionCount - firstCount;
      if (secondCount < 4) {
        return `{"type":"Polygon","coordinates":[${ringCoordinates(positionCount, offset)}]}`;
      }
      return `{"type":"MultiPolygon","coordinates":[[${ringCoordinates(firstCount, offset)}],[${ringCoordinates(secondCount, offset + firstCount)}]]}`;
    }
    case "GeometryCollection": {
      const lineCount = Math.max(2, Math.floor((positionCount - 1) * 0.45));
      const polygonCount = positionCount - 1 - lineCount;
      if (polygonCount < 4) throw new Error("GeometryCollection não possui posições suficientes.");
      return `{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":${coordinate(offset, seed)}},{"type":"LineString","coordinates":${lineCoordinates(lineCount, offset + 1)}},{"type":"Polygon","coordinates":[${ringCoordinates(polygonCount, offset + 1 + lineCount)}]}]}`;
    }
    default:
      throw new Error(`Geometria S08 não suportada: ${profile}`);
  }
}

function positionPlan(spec) {
  const min = minimumPositions(spec.geometryProfile);
  if (spec.geometryProfile === "Point") {
    if (spec.coordinatePositionCount !== spec.featureCount) {
      throw new Error(`${spec.fixtureId}: Point exige featureCount igual a coordinatePositionCount.`);
    }
    return new Array(spec.featureCount).fill(1);
  }

  const minimumTotal = min * spec.featureCount;
  if (spec.coordinatePositionCount < minimumTotal) {
    throw new Error(`${spec.fixtureId}: posições insuficientes para ${spec.featureCount} features.`);
  }

  const plan = new Array(spec.featureCount).fill(min);
  let remaining = spec.coordinatePositionCount - minimumTotal;

  if (spec.maxFeaturePositionCount != null) {
    const requested = Math.max(min, Number(spec.maxFeaturePositionCount));
    const extra = requested - min;
    if (extra > remaining) {
      throw new Error(`${spec.fixtureId}: maxFeaturePositionCount excede o total disponível.`);
    }
    plan[0] += extra;
    remaining -= extra;
  }

  const cursor = spec.maxFeaturePositionCount != null ? 1 : 0;
  const distributable = spec.featureCount - cursor;
  if (distributable > 0) {
    const each = Math.floor(remaining / distributable);
    const remainder = remaining % distributable;
    for (let index = cursor; index < spec.featureCount; index += 1) {
      plan[index] += each + (index - cursor < remainder ? 1 : 0);
    }
    remaining = 0;
  }

  if (remaining !== 0) throw new Error(`${spec.fixtureId}: falha ao distribuir posições.`);
  return plan;
}

function maxOfPlan(plan) {
  let max = 0;
  for (const value of plan) if (value > max) max = value;
  return max;
}

function layerConfig(datasetId, layerIndex) {
  return {
    id: `s08-layer-${layerIndex + 1}`,
    type: "geojson",
    config: {
      dataId: datasetId,
      label: `S08 layer ${layerIndex + 1}`,
      color: [202, 164, 74],
      columns: { geojson: "_geojson" },
      isVisible: true,
      visConfig: {
        opacity: 0.8,
        thickness: 0.5,
        strokeColor: [255, 248, 225],
        radius: 10,
        sizeRange: [0, 10],
        radiusRange: [0, 50],
        heightRange: [0, 500],
        elevationScale: 5,
        stroked: true,
        filled: true,
        enable3d: false,
        wireframe: false,
      },
      textLabel: [],
    },
    visualChannels: {
      colorField: null,
      colorScale: "quantile",
      sizeField: null,
      sizeScale: "linear",
      strokeColorField: null,
      strokeColorScale: "quantile",
      heightField: null,
      heightScale: "linear",
      radiusField: null,
      radiusScale: "linear",
    },
  };
}

function configJson(spec, datasetId) {
  const layers = Array.from({ length: spec.layerCount }, (_, index) =>
    layerConfig(datasetId, index),
  );
  return JSON.stringify({
    visState: {
      filters: [],
      layers,
      interactionConfig: {
        tooltip: { fieldsToShow: { [datasetId]: ["id"] }, enabled: false },
        brush: { enabled: false },
        geocoder: { enabled: false },
      },
      layerBlending: "normal",
    },
    mapState: {
      latitude: 0,
      longitude: 0,
      zoom: 2,
      bearing: 0,
      pitch: 0,
    },
    mapStyle: { styleType: "dark" },
  });
}

function createWriter(stream) {
  const hash = createHash("sha256");
  let bytesWritten = 0;

  async function write(chunk) {
    const text = String(chunk);
    bytesWritten += Buffer.byteLength(text);
    hash.update(text);
    if (!stream.write(text)) await once(stream, "drain");
  }

  return {
    write,
    get bytesWritten() { return bytesWritten; },
    digest() { return hash.digest("hex"); },
  };
}

async function writePadding(writer, count) {
  const chunk = "x".repeat(64 * 1024);
  let remaining = Math.max(0, count);
  while (remaining > 0) {
    const size = Math.min(remaining, chunk.length);
    await writer.write(size === chunk.length ? chunk : chunk.slice(0, size));
    remaining -= size;
  }
}

export async function generateFixture(spec, outputRoot = OUTPUT_ROOT) {
  const fixturesDir = path.join(outputRoot, "fixtures");
  await mkdir(fixturesDir, { recursive: true });
  const fileName = `${spec.fixtureId}.json`;
  const finalPath = path.join(fixturesDir, fileName);
  const tempPath = `${finalPath}.tmp`;
  await rm(tempPath, { force: true });

  const stream = createWriteStream(tempPath, { encoding: "utf8" });
  const writer = createWriter(stream);
  const datasetId = `s08-${spec.fixtureId}`;
  const plan = positionPlan(spec);

  try {
    await writer.write(`{"version":"v1","datasets":[{"version":"v1","data":{"id":${JSON.stringify(datasetId)},"label":${JSON.stringify(spec.fixtureId)},"color":[202,164,74],"allData":[`);

    for (let index = 0; index < spec.featureCount; index += 1) {
      if (index > 0) await writer.write(",");
      const geometry = geometryJson(spec.geometryProfile, plan[index], index, spec.seed);
      await writer.write(`[${index},${geometry}]`);
    }

    await writer.write(`],"fields":[{"name":"id","type":"integer"},{"name":"_geojson","type":"geojson"}]}}],"config":${configJson(spec, datasetId)},"benchmark":{"generatorVersion":${JSON.stringify(S08_GENERATOR_VERSION)},"fixtureId":${JSON.stringify(spec.fixtureId)},"family":${JSON.stringify(spec.family)},"geometryProfile":${JSON.stringify(spec.geometryProfile)},"featureCount":${spec.featureCount},"coordinatePositionCount":${spec.coordinatePositionCount},"layerCount":${spec.layerCount},"maxFeaturePositionCount":${spec.maxFeaturePositionCount ?? "null"},"seed":${spec.seed},"padding":"`);

    const closing = `"}}`;
    if (spec.targetSizeBytes != null) {
      const remaining = spec.targetSizeBytes - writer.bytesWritten - Buffer.byteLength(closing);
      if (remaining < 0) {
        throw new Error(`${spec.fixtureId}: fixture base (${writer.bytesWritten} bytes) excede target ${spec.targetSizeBytes}.`);
      }
      await writePadding(writer, remaining);
    }

    await writer.write(closing);
    stream.end();
    await once(stream, "finish");
    const sha256 = writer.digest();
    await rename(tempPath, finalPath);
    const fileStat = await stat(finalPath);

    return {
      fixtureId: spec.fixtureId,
      family: spec.family,
      fileName,
      generatorVersion: S08_GENERATOR_VERSION,
      seed: spec.seed,
      geometryProfile: spec.geometryProfile,
      featureCount: spec.featureCount,
      coordinatePositionCount: spec.coordinatePositionCount,
      maxFeaturePositionCount: maxOfPlan(plan),
      layerCount: spec.layerCount,
      targetSizeBytes: spec.targetSizeBytes,
      sizeBytes: fileStat.size,
      sha256,
    };
  } catch (error) {
    stream.destroy();
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputRoot = options.output;
  const corpus = getCorpus(options.profile).filter(
    (entry) => !options.fixtureId || entry.fixtureId === options.fixtureId,
  );
  if (corpus.length === 0) throw new Error("Nenhum fixture S08 corresponde aos argumentos.");

  await mkdir(path.join(outputRoot, "fixtures"), { recursive: true });
  const manifest = [];
  for (const spec of corpus) {
    process.stdout.write(`[S08] Gerando ${spec.fixtureId}... `);
    const result = await generateFixture(spec, outputRoot);
    manifest.push(result);
    process.stdout.write(`${(result.sizeBytes / 1024 / 1024).toFixed(2)} MiB\n`);
  }

  const manifestPath = path.join(outputRoot, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify({ generatorVersion: S08_GENERATOR_VERSION, profile: options.profile, fixtures: manifest }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`[S08] Manifesto: ${manifestPath}\n`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  main().catch((error) => {
    console.error("[S08] Falha ao gerar corpus:", error);
    process.exitCode = 1;
  });
}
