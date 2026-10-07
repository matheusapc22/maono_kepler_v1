import { dropboxContentHashHex } from "../functions/_lib/dropbox-content-hash.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DropboxMapConfigRepository } from "../functions/_lib/dropbox-map-config-repository.js";
import {
  MAP_CONFIG_REPOSITORY_METHODS,
  assertMapConfigRepository,
} from "../functions/_lib/map-config-repository.js";
import {
  createMapConfigStorageRef,
  getMapConfigRevisionFileName,
  parseMapConfigStorageRef,
} from "../functions/_lib/map-config-storage-ref.js";
import {
  buildProjectConfigArtifact,
} from "../functions/_lib/project-config-integrity.js";
import {
  readPublishedProjectConfig,
} from "../functions/_lib/project-config-service.js";

function fakeRepository(overrides = {}) {
  return {
    provider: "fake",
    async load() {
      throw new Error("load não configurado");
    },
    async loadLegacyStream() {},
    async uploadOperationPayload() {},
    async verifyOperationPayload() {},
    async recoverOperationPayload() {},
    async getRevision() {
      throw new Error("getRevision não configurado");
    },
    async getMetadata() {
      return {};
    },
    ...overrides,
  };
}

function normalizeSqliteValue(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

function localEnv() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE local_storage_objects (
      path TEXT PRIMARY KEY,
      content BLOB NOT NULL,
      content_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return {
    APP_ENV: "local",
    STORAGE_DRIVER: "local-d1",
    DB: {
      prepare(sql) {
        const statement = database.prepare(sql);
        let parameters = [];
        return {
          bind(...values) {
            parameters = values.map(normalizeSqliteValue);
            return this;
          },
          first() {
            return statement.get(...parameters) ?? null;
          },
          run() {
            return statement.run(...parameters);
          },
          all() {
            return { results: statement.all(...parameters) };
          },
        };
      },
    },
  };
}

test("porta durável exige operações imutáveis e leitores compatíveis", () => {
  assert.deepEqual(MAP_CONFIG_REPOSITORY_METHODS, [
    "load",
    "loadLegacyStream",
    "uploadOperationPayload",
    "verifyOperationPayload",
    "recoverOperationPayload",
    "getRevision",
    "getMetadata",
  ]);
  assert.equal(assertMapConfigRepository(fakeRepository()).provider, "fake");
  assert.throws(
    () => assertMapConfigRepository({ provider: "fake", load() {} }),
    (error) =>
      error?.code === "MAP_CONFIG_REPOSITORY_INVALID" &&
      error?.details?.missing?.includes("uploadOperationPayload"),
  );
});

test("storage_ref continua opaca e independente do Dropbox", () => {
  const storageRef = createMapConfigStorageRef(84, 18);
  assert.equal(storageRef, "project-config://84/revisions/18");
  assert.deepEqual(parseMapConfigStorageRef(storageRef), {
    projectId: 84,
    revision: 18,
  });
  assert.equal(
    getMapConfigRevisionFileName("config.kepler.json", 18),
    "config.kepler.r000018.json",
  );
  assert.doesNotMatch(storageRef, /dropbox/i);
});

test("Application pode carregar legado usando FakeMapConfigRepository sem Dropbox", async () => {
  const config = { version: "v1", config: { visState: {} }, datasets: [] };
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  const repository = fakeRepository({
    async load() {
      return {
        bytes,
        contentType: "application/json; charset=utf-8",
        sizeBytes: bytes.byteLength,
        source: "legacy",
      };
    },
  });

  const loaded = await readPublishedProjectConfig(
    {},
    {
      id: 84,
      lifecycle_state: null,
      active: 1,
      config_revision: 0,
    },
    { mapConfigRepository: repository },
  );

  assert.equal(loaded.legacy, true);
  assert.deepEqual(loaded.config, config);
});

test("Application carrega revisão ACTIVE e verifica integridade fora do adapter", async () => {
  const config = { version: "v1", config: { visState: {} }, datasets: [] };
  const artifact = await buildProjectConfigArtifact(config);
  const storageRef = createMapConfigStorageRef(84, 3);
  const repository = fakeRepository({
    async getRevision() {
      return {
        bytes: artifact.bytes,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
        storageRef,
        source: "revision",
      };
    },
  });

  const loaded = await readPublishedProjectConfig(
    {},
    {
      id: 84,
      lifecycle_state: "ACTIVE",
      lifecycle_version: 4,
      active: 1,
      config_revision: 3,
      config_checksum: artifact.checksum,
      config_checksum_algorithm: artifact.checksumAlgorithm,
      config_storage_ref: storageRef,
      config_schema: artifact.schemaName,
      config_schema_version: artifact.schemaVersion,
      config_size_bytes: artifact.sizeBytes,
    },
    { mapConfigRepository: repository },
  );

  assert.equal(loaded.legacy, false);
  assert.deepEqual(loaded.config, config);
});

test("DropboxMapConfigRepository preserva adapter local-d1 e revisões imutáveis", async () => {
  const env = localEnv();
  const repository = new DropboxMapConfigRepository(env);
  assert.equal(repository.provider, "local-d1");
  assertMapConfigRepository(repository);

  const project = {
    id: 84,
    organization_id: 1,
    dropbox_root_path: "/project-84",
    default_config_file: "config.kepler.json",
  };
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: "v1", config: {}, datasets: [] }),
  );
  const operation = {
    id: "server-local-test", operation_id: "client-local-test", project_id: 84, organization_id: 1, upload_epoch: 1,
    checksum: await dropboxContentHashHex(bytes), size_bytes: bytes.byteLength, checksum_algorithm: "dropbox-content-hash",
    serialization_version: 1, schema_name: "legacy-kepler", schema_version: 1,
  };
  const saved = await repository.uploadOperationPayload({ project, operation, body: bytes });
  const storageRef = saved.storageRef;
  assert.equal(saved.contentVerified, true);
  assert.equal(repository.saveRevision, undefined);
  assert.equal(saved.sizeBytes, bytes.byteLength);

  const loaded = await repository.getRevision({
    project,
    revision: 1,
    storageRef,
  });
  assert.deepEqual(Array.from(loaded.bytes), Array.from(bytes));

  const metadata = await repository.getMetadata({
    project,
    revision: 1,
    storageRef,
  });
  assert.equal(metadata.sizeBytes, bytes.byteLength);
  assert.equal(metadata.storageRef, storageRef);
});
