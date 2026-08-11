import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DropboxMapConfigRepository } from "../functions/_lib/dropbox-map-config-repository.js";
import { MAP_CONFIG_SAVE_MODES } from "../functions/_lib/map-config-repository.js";
import { createMapConfigStorageRef } from "../functions/_lib/map-config-storage-ref.js";
import {
  buildProjectConfigArtifact,
  sha256Hex,
} from "../functions/_lib/project-config-integrity.js";
import { saveVersionedProjectConfig } from "../functions/_lib/project-config-service.js";

const migration = await readFile(
  new URL("../migrations/0018_project_lifecycle.sql", import.meta.url),
  "utf8",
);

function normalizeSqliteValue(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      organization_file_id INTEGER,
      dropbox_root_path TEXT NOT NULL,
      default_config_file TEXT NOT NULL DEFAULT 'config.kepler.json',
      active INTEGER NOT NULL DEFAULT 1,
      config_revision INTEGER NOT NULL DEFAULT 0,
      preview_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      preview_revision INTEGER,
      preview_updated_at TEXT,
      preview_attempts INTEGER NOT NULL DEFAULT 0,
      preview_last_error TEXT,
      preview_capture_method TEXT,
      updated_by INTEGER,
      updated_by_name_snapshot TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE local_storage_objects (
      path TEXT PRIMARY KEY,
      content BLOB NOT NULL,
      content_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, name) VALUES (10, 'Editor');
  `);
  database.exec(migration);
  return database;
}

function envFor(database) {
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

function config(label) {
  return {
    version: "v1",
    config: { visState: { label } },
    datasets: [],
  };
}

async function insertActiveProject(database, projectId = 84) {
  const initial = await buildProjectConfigArtifact(config("revision-1"));
  database
    .prepare(
      `INSERT INTO projects (
         id, organization_id, dropbox_root_path, default_config_file,
         active, config_revision, lifecycle_state, lifecycle_version,
         config_checksum, config_checksum_algorithm,
         config_storage_provider, config_storage_ref,
         config_schema, config_schema_version, config_size_bytes,
         config_content_type
       ) VALUES (?, 7, ?, 'config.kepler.json', 1, 1, 'ACTIVE', 4,
         ?, ?, 'local-d1', ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      `/project-${projectId}`,
      initial.checksum,
      initial.checksumAlgorithm,
      createMapConfigStorageRef(projectId, 1),
      initial.schemaName,
      initial.schemaVersion,
      initial.sizeBytes,
      initial.contentType,
    );
  return initial;
}

function readProject(database, projectId = 84) {
  return database
    .prepare("SELECT * FROM projects WHERE id = ? LIMIT 1")
    .get(projectId);
}

test("S05: mesma revisão aceita retry idempotente e rejeita conteúdo diferente", async () => {
  const database = fixture();
  await insertActiveProject(database);
  const env = envFor(database);
  const repository = new DropboxMapConfigRepository(env);
  const project = readProject(database);
  const ref = createMapConfigStorageRef(84, 2);
  const first = await buildProjectConfigArtifact(config("A"));
  const other = await buildProjectConfigArtifact(config("B"));

  const created = await repository.saveRevision({
    project,
    revision: 2,
    storageRef: ref,
    bytes: first.bytes,
    contentType: first.contentType,
    mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
  });
  assert.equal(created.createdNew, true);
  assert.equal(created.idempotent, false);

  const retried = await repository.saveRevision({
    project,
    revision: 2,
    storageRef: ref,
    bytes: first.bytes,
    contentType: first.contentType,
    mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
  });
  assert.equal(retried.createdNew, false);
  assert.equal(retried.idempotent, true);
  assert.equal(retried.contentVerified, true);

  await assert.rejects(
    repository.saveRevision({
      project,
      revision: 2,
      storageRef: ref,
      bytes: other.bytes,
      contentType: other.contentType,
      mode: MAP_CONFIG_SAVE_MODES.IMMUTABLE,
    }),
    (error) => error?.code === "MAP_CONFIG_REVISION_IMMUTABILITY_VIOLATION",
  );

  const stored = await repository.getRevision({
    project,
    revision: 2,
    storageRef: ref,
  });
  assert.equal(await sha256Hex(stored.bytes), first.checksum);
});

test("S05: cada save publica N+1 sem apagar revisões anteriores", async () => {
  const database = fixture();
  await insertActiveProject(database);
  const env = envFor(database);
  const repository = new DropboxMapConfigRepository(env);

  const save2 = await saveVersionedProjectConfig(env, {
    project: readProject(database),
    config: config("revision-2"),
    expectedConfigRevision: 1,
    actor: { id: 10, name: "Editor" },
    mapConfigRepository: repository,
  });
  assert.equal(save2.revision, 2);
  assert.equal(save2.revisionHead.previousRevision, 1);
  assert.equal(save2.revisionHead.currentRevision, 2);
  assert.equal(readProject(database).config_revision, 2);

  const save3 = await saveVersionedProjectConfig(env, {
    project: readProject(database),
    config: config("revision-3"),
    expectedConfigRevision: 2,
    actor: { id: 10, name: "Editor" },
    mapConfigRepository: repository,
  });
  assert.equal(save3.revision, 3);
  assert.equal(save3.revisionHead.currentRevision, 3);

  const head = readProject(database);
  assert.equal(head.config_revision, 3);
  assert.equal(head.config_checksum, save3.artifact.checksum);
  assert.equal(head.config_size_bytes, save3.artifact.sizeBytes);
  assert.equal(head.config_schema_version, save3.artifact.schemaVersion);

  const ledger = database
    .prepare(
      `SELECT revision, status, checksum, published_at
         FROM project_config_revisions
        WHERE project_id = 84
        ORDER BY revision`,
    )
    .all();
  assert.deepEqual(
    ledger.map((row) => [row.revision, row.status]),
    [[2, "READY"], [3, "READY"]],
  );
  assert.ok(ledger.every((row) => row.published_at));

  const revision2 = await repository.getRevision({
    project: head,
    revision: 2,
    storageRef: createMapConfigStorageRef(84, 2),
  });
  const revision3 = await repository.getRevision({
    project: head,
    revision: 3,
    storageRef: createMapConfigStorageRef(84, 3),
  });
  assert.notEqual(await sha256Hex(revision2.bytes), await sha256Hex(revision3.bytes));
});

test("S05: checksum pós-write divergente marca FAILED e preserva o HEAD", async () => {
  const database = fixture();
  await insertActiveProject(database);
  const env = envFor(database);
  const tampered = await buildProjectConfigArtifact(config("candidate-B"));
  const repository = {
    provider: "fake",
    async load() {
      throw new Error("não usado");
    },
    async saveRevision() {
      return {
        provider: "fake",
        providerVersion: "fake-v2",
        providerHash: "provider-hash",
        sizeBytes: tampered.sizeBytes,
      };
    },
    async getRevision() {
      return {
        bytes: tampered.bytes,
        sizeBytes: tampered.sizeBytes,
        contentType: tampered.contentType,
      };
    },
    async getMetadata() {
      return {};
    },
  };

  await assert.rejects(
    saveVersionedProjectConfig(env, {
      project: readProject(database),
      config: config("candidate-A"),
      expectedConfigRevision: 1,
      actor: { id: 10, name: "Editor" },
      mapConfigRepository: repository,
    }),
    (error) =>
      error?.code === "PROJECT_CONFIG_INTEGRITY_MISMATCH" &&
      error?.details?.stage === "VERIFY",
  );

  assert.equal(readProject(database).config_revision, 1);
  const failed = database
    .prepare(
      `SELECT status, error_stage, error_code
         FROM project_config_revisions
        WHERE project_id = 84 AND revision = 2`,
    )
    .get();
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.error_stage, "VERIFY");
  assert.equal(failed.error_code, "PROJECT_CONFIG_INTEGRITY_MISMATCH");
});

test("S05: atestação do repository confirma save sem segundo download", async () => {
  const database = fixture();
  await insertActiveProject(database);
  const env = envFor(database);
  let readbacks = 0;
  const repository = {
    provider: "dropbox",
    async load() {
      throw new Error("não usado");
    },
    async saveRevision({ bytes }) {
      return {
        provider: "dropbox",
        providerVersion: "provider-rev-2",
        providerHash: "provider-content-hash",
        sizeBytes: bytes.byteLength,
        contentVerified: true,
        verificationMethod: "provider-content-hash",
        idempotent: false,
      };
    },
    async getRevision() {
      readbacks += 1;
      throw new Error("readback não deveria ser necessário");
    },
    async getMetadata() {
      return {};
    },
  };

  const saved = await saveVersionedProjectConfig(env, {
    project: readProject(database),
    config: config("provider-attested"),
    expectedConfigRevision: 1,
    actor: { id: 10, name: "Editor" },
    mapConfigRepository: repository,
  });

  assert.equal(saved.revision, 2);
  assert.equal(saved.revisionHead.currentRevision, 2);
  assert.equal(readProject(database).config_revision, 2);
  assert.equal(readbacks, 0);
});

test("S05: pipeline mantém write/verify antes do publish CAS e create-only no Dropbox", async () => {
  const [source, dropboxSource, adapterSource] = await Promise.all([
    readFile(
      new URL("../functions/_lib/project-config-service.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../functions/_lib/dropbox.js", import.meta.url), "utf8"),
    readFile(
      new URL("../functions/_lib/dropbox-map-config-repository.js", import.meta.url),
      "utf8",
    ),
  ]);
  const serialize = source.indexOf("serializeProjectConfigBytes(config)");
  const validate = source.indexOf("validateProjectConfig(config");
  const write = source.indexOf("repository.saveRevision({", validate);
  const verify = source.indexOf("verifyPersistedRevision(repository", write);
  const publish = source.indexOf("publishProjectConfigRevision(env", verify);
  assert.ok(serialize >= 0 && validate > serialize);
  assert.ok(write > validate);
  assert.ok(verify > write);
  assert.ok(publish > verify);
  assert.match(dropboxSource, /mode:\s*createOnly \? "add" : "overwrite"/);
  assert.match(dropboxSource, /strict_conflict:\s*createOnly/);
  assert.match(
    adapterSource,
    /mode === MAP_CONFIG_SAVE_MODES\.IMMUTABLE \? "create" : "overwrite"/,
  );
});
