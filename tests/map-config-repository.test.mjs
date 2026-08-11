import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DropboxMapConfigRepository } from "../functions/_lib/dropbox-map-config-repository.js";
import {
  MAP_CONFIG_REPOSITORY_METHODS,
  MAP_CONFIG_SAVE_MODES,
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

const [serviceSource, reconcilerSource, adapterSource, compatibilitySource] =
  await Promise.all([
    readFile(
      new URL("../functions/_lib/project-config-service.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../functions/_lib/project-lifecycle-reconciler.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../functions/_lib/dropbox-map-config-repository.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../functions/_lib/project-config-repository.js", import.meta.url),
      "utf8",
    ),
  ]);

function fakeRepository(overrides = {}) {
  return {
    provider: "fake",
    async load() {
      throw new Error("load não configurado");
    },
    async saveRevision() {
      throw new Error("saveRevision não configurado");
    },
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

test("porta S04 exige load saveRevision getRevision e getMetadata", () => {
  assert.deepEqual(MAP_CONFIG_REPOSITORY_METHODS, [
    "load",
    "saveRevision",
    "getRevision",
    "getMetadata",
  ]);
  assert.equal(assertMapConfigRepository(fakeRepository()).provider, "fake");
  assert.throws(
    () => assertMapConfigRepository({ provider: "fake", load() {} }),
    (error) =>
      error?.code === "MAP_CONFIG_REPOSITORY_INVALID" &&
      error?.details?.missing?.includes("saveRevision"),
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

test("Application de MapConfig não importa primitivas Dropbox", () => {
  assert.doesNotMatch(serviceSource, /from ["']\.\/dropbox\.js["']/);
  assert.doesNotMatch(reconcilerSource, /from ["']\.\/dropbox\.js["']/);
  assert.doesNotMatch(compatibilitySource, /from ["']\.\/dropbox\.js["']/);
  assert.match(adapterSource, /from ["']\.\/dropbox\.js["']/);
  assert.match(serviceSource, /repository\.saveRevision\(/);
  assert.match(serviceSource, /repository\.getRevision\(/);
  assert.match(reconcilerSource, /repository\.load\(/);
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
    dropbox_root_path: "/project-84",
    default_config_file: "config.kepler.json",
  };
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: "v1", config: {}, datasets: [] }),
  );
  const storageRef = createMapConfigStorageRef(84, 1);

  const saved = await repository.saveRevision({
    project,
    revision: 1,
    storageRef,
    bytes,
    contentType: "application/json; charset=utf-8",
    mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
  });
  assert.equal(saved.storageRef, storageRef);
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
