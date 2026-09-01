import test from "node:test";
import assert from "node:assert/strict";

import {
  SAVE_API_CONTRACT_VERSION,
  SAVE_EXPECTED_DB_SCHEMA_VERSION,
  assertSaveDeployCompatibility,
  getSaveClientMetadata,
  getSaveDeploymentMetadata,
  saveDeployResponseHeaders,
} from "../functions/_lib/save-deploy-contract.js";

function request(headers = {}) {
  return new Request("https://maono.test/api/projects/demo/save", { headers });
}

function envWithSchema(schemaVersion, build = "api-build-b") {
  return {
    MAONO_API_BUILD_ID: build,
    DB: {
      prepare(sql) {
        assert.match(sql, /app_schema_metadata/);
        return {
          async first() {
            return { schema_version: schemaVersion };
          },
        };
      },
    },
  };
}

test("cliente legacy sem header permanece aceito durante rollout", async () => {
  const result = await assertSaveDeployCompatibility(
    envWithSchema(SAVE_EXPECTED_DB_SCHEMA_VERSION),
    request(),
  );
  assert.equal(result.legacy, true);
  assert.equal(result.clientContract, null);
});

test("builds diferentes não bloqueiam quando o contrato é compatível", async () => {
  const result = await assertSaveDeployCompatibility(
    envWithSchema(SAVE_EXPECTED_DB_SCHEMA_VERSION, "api-build-b"),
    request({
      "X-Maono-Client-Contract": "1",
      "X-Maono-Client-Build": "frontend-build-a",
    }),
  );
  assert.equal(result.clientBuild, "frontend-build-a");
  assert.equal(result.apiBuild, "api-build-b");
  assert.equal(result.apiContract, SAVE_API_CONTRACT_VERSION);
});

test("contrato de frontend incompatível falha antes da consulta ao D1", async () => {
  let dbTouched = false;
  const env = {
    DB: {
      prepare() {
        dbTouched = true;
        throw new Error("não deveria consultar");
      },
    },
  };

  await assert.rejects(
    () => assertSaveDeployCompatibility(
      env,
      request({ "X-Maono-Client-Contract": "999" }),
    ),
    (error) => {
      assert.equal(error.code, "SAVE_CLIENT_CONTRACT_UNSUPPORTED");
      assert.equal(error.status, 409);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(dbTouched, false);
});

test("schema D1 incompatível é detectado antes da persistência do projeto", async () => {
  await assert.rejects(
    () => assertSaveDeployCompatibility(
      envWithSchema(SAVE_EXPECTED_DB_SCHEMA_VERSION - 1),
      request({ "X-Maono-Client-Contract": "1" }),
    ),
    (error) => {
      assert.equal(error.code, "SAVE_DB_SCHEMA_MISMATCH");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      assert.equal(error.details.expectedDbSchema, SAVE_EXPECTED_DB_SCHEMA_VERSION);
      assert.equal(error.details.actualDbSchema, SAVE_EXPECTED_DB_SCHEMA_VERSION - 1);
      return true;
    },
  );
});

test("metadados e headers expõem contrato/schema, não exigem SHA igual", () => {
  const deployment = getSaveDeploymentMetadata({ MAONO_API_BUILD_ID: "api-123" });
  const client = getSaveClientMetadata(request({
    "X-Maono-Client-Contract": "1",
    "X-Maono-Client-Build": "client-456",
  }));
  const headers = saveDeployResponseHeaders({
    ...deployment,
    ...client,
    actualDbSchema: SAVE_EXPECTED_DB_SCHEMA_VERSION,
  });

  assert.equal(headers["X-Maono-Api-Contract"], String(SAVE_API_CONTRACT_VERSION));
  assert.equal(headers["X-Maono-Api-Build"], "api-123");
  assert.equal(headers["X-Maono-Db-Schema"], String(SAVE_EXPECTED_DB_SCHEMA_VERSION));
});
