import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (relativePath) =>
  JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));

const manifest = await readJson("tests/fixtures/maps/manifest.json");
const semantics = await readJson("tests/fixtures/maps/semantic-snapshots.json");
const keplerBaseline = await readJson("docs/architecture/macro-c/kepler-import-baseline.json");

const materialized = manifest.fixtures.filter((fixture) => fixture.materialized === true);

test("C0 materializa pelo menos seis Golden Maps sintéticos", async () => {
  assert.equal(manifest.productionDataAllowed, false);
  assert.ok(materialized.length >= 6);
  assert.ok(materialized.every((fixture) => fixture.synthetic === true));
  assert.ok(materialized.every((fixture) => typeof fixture.goldenFile === "string"));

  for (const fixture of materialized) {
    const document = await readJson(`tests/fixtures/maps/${fixture.goldenFile}`);
    assert.ok(document.version);
    assert.ok(Array.isArray(document.datasets));
    assert.ok(document.config && typeof document.config === "object");
  }
});

test("semantic snapshots cobrem os Golden Maps materializados", () => {
  assert.equal(semantics.schema, "maono-semantic-snapshots");
  assert.equal(semantics.version, 1);
  assert.equal(semantics.deterministic, true);

  const snapshotIds = new Set(semantics.snapshots.map((snapshot) => snapshot.id));
  assert.equal(snapshotIds.size, semantics.snapshots.length);

  for (const fixture of materialized) {
    assert.ok(snapshotIds.has(fixture.id), `snapshot ausente para ${fixture.id}`);
  }

  for (const snapshot of semantics.snapshots) {
    assert.ok(snapshot.viewport && typeof snapshot.viewport === "object");
    assert.ok(Array.isArray(snapshot.layers));
    assert.ok(Array.isArray(snapshot.filters));
    assert.ok(snapshot.style && typeof snapshot.style === "object");
    assert.ok(snapshot.extensions && typeof snapshot.extensions === "object");
  }
});

test("baseline Kepler é snapshot-only e proíbe domínio/aplicação", () => {
  assert.equal(keplerBaseline.schema, "maono-kepler-import-baseline");
  assert.equal(keplerBaseline.mode, "snapshot-only");
  assert.equal(keplerBaseline.officialBoundary.allowedPrefix, "src/pages/Kepler/engine-adapter/");
  assert.deepEqual(keplerBaseline.futureForbiddenZones, ["src/domain/", "src/application/"]);
  assert.ok(keplerBaseline.keplerPackages.includes("@kepler.gl/actions"));
  assert.ok(keplerBaseline.keplerPackages.includes("@kepler.gl/schemas"));
});

test("fixtures C0 não carregam referências de storage ou credenciais", async () => {
  const forbidden = [
    /dropbox_root_path/i,
    /dropbox_path/i,
    /refresh_token/i,
    /access_token/i,
    /authorization/i,
    /cookie/i,
    /geoapify_api_key/i
  ];

  for (const fixture of materialized) {
    const text = await readFile(new URL(`../tests/fixtures/maps/${fixture.goldenFile}`, import.meta.url), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${fixture.id} contém ${pattern}`);
    }
  }
});
