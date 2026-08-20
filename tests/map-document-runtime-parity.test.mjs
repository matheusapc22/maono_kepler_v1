import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAP_DOCUMENT_KIND,
  detectSchema,
  validateDocument,
} from "../shared/map-document/index.js";
import {
  buildProjectConfigArtifact,
  validateProjectConfig,
} from "../functions/_lib/project-config-integrity.js";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/maps/schema/${name}`, import.meta.url), "utf8"));
}

test("browser bridge e Functions usam o mesmo core ESM compartilhado", async () => {
  const [integritySource, loaderSource] = await Promise.all([
    readFile(new URL("../functions/_lib/project-config-integrity.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Kepler/map-url-loader/index.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(integritySource, /shared\/map-document\/index\.js/);
  assert.match(loaderSource, /shared\/map-document\/index\.js/);
  assert.match(loaderSource, /toLegacyKeplerDocument/);
  assert.doesNotMatch(loaderSource, /function\s+detectSchema\s*\(/);
});

test("validator do core e boundary backend concordam com maono-map@1", async () => {
  const valid = await fixture("maono-map-v1.valid.json");
  assert.equal(detectSchema(valid).kind, MAP_DOCUMENT_KIND.MAONO_MAP_V1);
  assert.equal(validateDocument(valid).schemaName, "maono-map");
  assert.equal(validateProjectConfig(valid).schemaName, "maono-map");

  const artifact = await buildProjectConfigArtifact(valid);
  assert.equal(artifact.schemaName, "maono-map");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.sizeBytes, artifact.bytes.byteLength);
});

test("future version é fail-closed também no boundary backend", async () => {
  const future = await fixture("maono-map-v2.future.json");
  assert.throws(
    () => validateProjectConfig(future),
    (error) => error.code === "PROJECT_CONFIG_SCHEMA_VERSION_UNSUPPORTED" && error.details?.validationCode === "MAP_DOCUMENT_FUTURE_VERSION",
  );
});
