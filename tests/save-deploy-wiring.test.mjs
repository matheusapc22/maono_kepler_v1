import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("frontend envia contrato e build em toda tentativa de save", async () => {
  const client = await source("src/pages/Kepler/save-observability.ts");
  assert.match(client, /X-Maono-Client-Contract/);
  assert.match(client, /X-Maono-Client-Build/);
  assert.match(client, /MAONO_SAVE_CLIENT_CONTRACT\s*=\s*1/);
});

test("save moderno valida drift antes da primeira persistência", async () => {
  const endpoint = await source("functions/api/projects/[slug]/config.js");
  const guard = endpoint.indexOf("assertSaveDeployCompatibility(env, request)");
  const persistence = endpoint.indexOf("const saved = await saveProjectConfig(env");
  assert.ok(guard >= 0, "guard ausente no PUT /config");
  assert.ok(persistence >= 0, "persistência moderna não localizada");
  assert.ok(guard < persistence, "guard deve executar antes de saveProjectConfig");
});

test("criação valida drift antes de criar registros do projeto", async () => {
  const endpoint = await source("functions/api/projects/index.js");
  const guard = endpoint.indexOf("assertSaveDeployCompatibility(env, request)");
  const persistence = endpoint.indexOf("const result = await createProjectFromKepler(");
  assert.ok(guard >= 0, "guard ausente no POST /projects");
  assert.ok(persistence >= 0, "criação persistente não localizada");
  assert.ok(guard < persistence, "guard deve executar antes de createProjectFromKepler");
});

test("endpoint legado valida drift antes do upload persistente", async () => {
  const endpoint = await source("functions/api/projects/[slug]/save.js");
  const guard = endpoint.indexOf("assertSaveDeployCompatibility(env, request)");
  const persistence = endpoint.indexOf("const dropboxResult = await uploadDropboxTextFile(");
  assert.ok(guard >= 0, "guard ausente no POST /save legado");
  assert.ok(persistence >= 0, "upload persistente não localizado");
  assert.ok(guard < persistence, "guard deve executar antes do upload legado");
});

test("migration 0019 estabelece schema de aplicação versão 19", async () => {
  const migration = await source("migrations/0019_save_deploy_contract.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS app_schema_metadata/);
  assert.match(migration, /VALUES \(1, 19, CURRENT_TIMESTAMP\)/);
});
