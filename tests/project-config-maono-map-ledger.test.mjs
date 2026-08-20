import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DropboxMapConfigRepository } from "../functions/_lib/dropbox-map-config-repository.js";
import { createMapConfigStorageRef } from "../functions/_lib/map-config-storage-ref.js";
import {
  buildProjectConfigArtifact,
  sha256Hex,
} from "../functions/_lib/project-config-integrity.js";
import {
  readPublishedProjectConfig,
  saveVersionedProjectConfig,
} from "../functions/_lib/project-config-service.js";
import {
  canonicalSerialize,
  detectSchema,
  toLegacyKeplerDocument,
} from "../shared/map-document/index.js";

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
    INSERT INTO users (id, name) VALUES (10, 'Editor S17');
  `);
  database.exec(migration);
  return database;
}

function envFor(database, writeFlag = "ON") {
  return {
    APP_ENV: "local",
    STORAGE_DRIVER: "local-d1",
    MAONO_MAP_SCHEMA_WRITE_V1: writeFlag,
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

function legacyConfig(label = "S17 point") {
  return {
    version: "v1",
    datasets: [
      {
        version: "v1",
        data: {
          id: "s17-points",
          label: "Pontos S17",
          fields: [
            { name: "lng", type: "real" },
            { name: "lat", type: "real" },
          ],
          allData: [[-46.63, -23.55], [-43.17, -22.9]],
        },
      },
    ],
    config: {
      visState: {
        layers: [
          {
            id: "s17-layer",
            type: "point",
            config: {
              dataId: "s17-points",
              label,
              isVisible: true,
              columns: { lng: "lng", lat: "lat" },
            },
          },
        ],
        filters: [],
      },
      mapState: { latitude: -23.5, longitude: -46.6, zoom: 7 },
      mapStyle: { styleType: "dark" },
    },
    maono: { unknownS17Extension: { keep: true } },
  };
}

async function insertActiveProject(database, projectId = 117) {
  const initial = await buildProjectConfigArtifact(legacyConfig("revision-1"));
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
         ?, ?, 'local-d1', ?, ?, ?, ?, ?)`
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

function readProject(database, projectId = 117) {
  return database
    .prepare("SELECT * FROM projects WHERE id = ? LIMIT 1")
    .get(projectId);
}

test("S17: write ON publica maono-map@1 no ledger, storage e HEAD sem migration nova", async () => {
  const database = fixture();
  await insertActiveProject(database);
  const env = envFor(database, "ON");
  const repository = new DropboxMapConfigRepository(env);
  const source = legacyConfig("revision-2");

  const saved = await saveVersionedProjectConfig(env, {
    project: readProject(database),
    config: source,
    expectedConfigRevision: 1,
    actor: { id: 10, name: "Editor S17" },
    mapConfigRepository: repository,
  });

  assert.equal(saved.revision, 2);
  assert.equal(saved.artifact.schemaName, "maono-map");
  assert.equal(saved.artifact.schemaVersion, 1);
  assert.equal(saved.artifact.sizeBytes, saved.artifact.bytes.byteLength);
  assert.equal(saved.artifact.checksum, await sha256Hex(saved.artifact.bytes));

  const head = readProject(database);
  assert.equal(head.config_revision, 2);
  assert.equal(head.config_schema, "maono-map");
  assert.equal(head.config_schema_version, 1);
  assert.equal(head.config_checksum, saved.artifact.checksum);
  assert.equal(head.config_size_bytes, saved.artifact.sizeBytes);

  const ledger = database
    .prepare(
      `SELECT revision, status, checksum, schema_name, schema_version, size_bytes, published_at
         FROM project_config_revisions
        WHERE project_id = 117 AND revision = 2`
    )
    .get();
  assert.equal(ledger.status, "READY");
  assert.equal(ledger.schema_name, "maono-map");
  assert.equal(ledger.schema_version, 1);
  assert.equal(ledger.checksum, saved.artifact.checksum);
  assert.equal(ledger.size_bytes, saved.artifact.sizeBytes);
  assert.ok(ledger.published_at);

  const stored = await repository.getRevision({
    project: head,
    revision: 2,
    storageRef: head.config_storage_ref,
  });
  const storedText = new TextDecoder().decode(stored.bytes);
  const storedDocument = JSON.parse(storedText);
  assert.equal(detectSchema(storedDocument).kind, "maono-map@1");
  assert.equal(storedText, canonicalSerialize(storedDocument));
  assert.equal(await sha256Hex(stored.bytes), head.config_checksum);

  const reloaded = await readPublishedProjectConfig(env, head, {
    mapConfigRepository: repository,
  });
  assert.equal(detectSchema(reloaded.config).kind, "maono-map@1");
  assert.deepEqual(toLegacyKeplerDocument(reloaded.config), source);
  assert.deepEqual(
    reloaded.config.extensions.unknownS17Extension,
    { keep: true },
  );
});
