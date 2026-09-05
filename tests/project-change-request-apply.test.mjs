import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DropboxMapConfigRepository } from "../functions/_lib/dropbox-map-config-repository.js";
import { createMapConfigStorageRef } from "../functions/_lib/map-config-storage-ref.js";
import { buildProjectConfigArtifact } from "../functions/_lib/project-config-integrity.js";
import { saveVersionedProjectConfig } from "../functions/_lib/project-config-service.js";
import { buildProjectChangeProposal } from "../functions/_lib/project-change-request-operations.js";

const lifecycleMigration = await readFile(
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
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
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
  database.exec(lifecycleMigration);
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

function revision184Config() {
  return {
    version: "v1",
    datasets: [
      {
        version: "v1",
        data: {
          id: "leads",
          label: "Leads",
          color: [232, 184, 74],
          allData: [[-46.6333, -23.5505, "Original"]],
          fields: [
            { name: "lng", type: "real", format: "", analyzerType: "FLOAT" },
            { name: "lat", type: "real", format: "", analyzerType: "FLOAT" },
            { name: "name", type: "string", format: "", analyzerType: "STRING" },
          ],
        },
      },
    ],
    config: {
      visState: {
        layers: [
          {
            id: "leads-layer",
            type: "point",
            config: {
              dataId: "leads",
              label: "Leads",
              columns: { lat: "lat", lng: "lng", altitude: null },
              isVisible: true,
              visConfig: { radius: 10, opacity: 0.8, outline: false },
            },
          },
        ],
      },
    },
  };
}

async function insertProjectAt184(database) {
  const artifact = await buildProjectConfigArtifact(revision184Config());
  database
    .prepare(
      `INSERT INTO projects (
         id, slug, organization_id, dropbox_root_path, default_config_file,
         active, config_revision, lifecycle_state, lifecycle_version,
         config_checksum, config_checksum_algorithm,
         config_storage_provider, config_storage_ref,
         config_schema, config_schema_version, config_size_bytes,
         config_content_type
       ) VALUES (42, 'leads-sp', 7, '/project-42', 'config.kepler.json',
         1, 184, 'ACTIVE', 4, ?, ?, 'local-d1', ?, ?, ?, ?, ?)`,
    )
    .run(
      artifact.checksum,
      artifact.checksumAlgorithm,
      createMapConfigStorageRef(42, 184),
      artifact.schemaName,
      artifact.schemaVersion,
      artifact.sizeBytes,
      artifact.contentType,
    );
}

function project(database) {
  return database.prepare("SELECT * FROM projects WHERE id = 42 LIMIT 1").get();
}

test("PR4 golden: REV184 + point.create publica REV185 sem criar projeto nem trocar slug/ID", async () => {
  const database = fixture();
  await insertProjectAt184(database);
  const env = envFor(database);
  const repository = new DropboxMapConfigRepository(env);
  const before = project(database);

  const proposal = buildProjectChangeProposal({
    baseConfig: revision184Config(),
    operations: [
      {
        id: "op-1",
        sequence: 0,
        type: "point.create",
        version: 1,
        createdAt: "2026-09-05T12:00:00.000Z",
        payload: {
          tempId: "tmp-1",
          latitude: -15.78,
          longitude: -47.92,
          targetLayerId: "leads-layer",
          targetDataId: "leads",
          targetLabel: "Leads",
          fieldMap: { latitude: "lat", longitude: "lng", name: "name" },
          properties: { name: "Novo lead" },
          origin: "pin",
        },
      },
    ],
  });

  const saved = await saveVersionedProjectConfig(env, {
    project: before,
    config: proposal.config,
    expectedConfigRevision: 184,
    actor: { id: 10, name: "Editor" },
    mapConfigRepository: repository,
  });

  const after = project(database);
  assert.equal(saved.revision, 185);
  assert.equal(after.config_revision, 185);
  assert.equal(after.id, 42);
  assert.equal(after.slug, "leads-sp");
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM projects").get().total, 1);

  const revision185 = await repository.getRevision({
    project: after,
    revision: 185,
    storageRef: createMapConfigStorageRef(42, 185),
  });
  const persisted = JSON.parse(new TextDecoder().decode(revision185.bytes));
  assert.equal(persisted.datasets[0].data.allData.length, 2);
  assert.equal(persisted.datasets[0].data.allData[1][2], "Novo lead");
});
