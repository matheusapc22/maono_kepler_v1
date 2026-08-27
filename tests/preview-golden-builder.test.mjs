import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

test("builder Golden gera MapConfig v1 e manifesto reproduzível a partir de GeoJSON", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "maono-preview-golden-"));
  const sourcePath = path.join(temp, "golden.geojson");
  const outDir = path.join(temp, "out");
  const fixture = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "area-1", value: 100, active: true },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-46.7, -23.6],
              [-46.6, -23.6],
              [-46.6, -23.5],
              [-46.7, -23.5],
              [-46.7, -23.6],
            ],
          ],
        },
      },
    ],
  };

  await writeFile(sourcePath, JSON.stringify(fixture));

  const run = spawnSync(
    process.execPath,
    [
      "scripts/preview/build-golden-project.mjs",
      sourcePath,
      `--out-dir=${outDir}`,
      "--slug=qa-geojson-golden",
      "--label=QA Golden",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);

  const config = JSON.parse(
    await readFile(path.join(outDir, "config.kepler.r000001.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(path.join(outDir, "manifest.json"), "utf8"),
  );

  assert.equal(config.version, "v1");
  assert.equal(config.datasets.length, 1);
  assert.equal(config.datasets[0].data.allData.length, 1);
  assert.ok(
    config.datasets[0].data.fields.some(
      (field) => field.name === "__geometry" && field.type === "geojson",
    ),
  );
  assert.equal(config.config.visState.layers[0].type, "geojson");
  assert.equal(
    config.config.visState.layers[0].config.columns.geojson,
    "__geometry",
  );

  assert.equal(manifest.slug, "qa-geojson-golden");
  assert.equal(manifest.source.featureCount, 1);
  assert.deepEqual(manifest.source.geometryTypes, ["Polygon"]);
  assert.equal(manifest.source.coordinateCount, 5);
  assert.deepEqual(manifest.source.bbox, [-46.7, -23.6, -46.6, -23.5]);
  assert.match(manifest.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.mapConfig.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.mapConfig.fileName, "config.kepler.r000001.json");
  assert.ok(manifest.mapConfig.sizeBytes > 0);
});
