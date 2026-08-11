import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { uploadLocalStorageFile } from "../functions/_lib/local-storage.js";
import { sha256Hex } from "../functions/_lib/project-config-integrity.js";
import { reconcileLegacyProjectLifecycle } from "../functions/_lib/project-lifecycle-reconciler.js";

const migration = await readFile(
  new URL("../migrations/0018_project_lifecycle.sql", import.meta.url),
  "utf8",
);

function normalizeSqliteValue(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
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
      active INTEGER NOT NULL DEFAULT 0,
      config_revision INTEGER NOT NULL DEFAULT 0,
      preview_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      preview_attempts INTEGER NOT NULL DEFAULT 0,
      preview_last_error TEXT,
      preview_capture_method TEXT,
      updated_by INTEGER,
      updated_by_name_snapshot TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE organization_files (
      id INTEGER PRIMARY KEY,
      size_bytes INTEGER,
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      active INTEGER NOT NULL DEFAULT 1,
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
    INSERT INTO users (id, name) VALUES (10, 'Super Admin');
  `);
  database.exec(migration);
  return database;
}

function readProject(database, projectId) {
  return database
    .prepare("SELECT * FROM projects WHERE id = ? LIMIT 1")
    .get(projectId);
}

test("backfill calcula SHA-256 dos bytes legados reais e cria cópia imutável", async () => {
  const database = fixture();
  database.prepare(`
    INSERT INTO projects (
      id, organization_id, dropbox_root_path,
      default_config_file, active, config_revision
    ) VALUES (84, 7, '/legacy-project', 'config.kepler.json', 1, 0)
  `).run();
  const env = envFor(database);
  const legacyText = '{\n  "version": "v1",\n  "config": {"visState": {}},\n  "datasets": []\n}\n';
  const legacyBytes = new TextEncoder().encode(legacyText);

  await uploadLocalStorageFile(
    env,
    "/legacy-project",
    "config.kepler.json",
    legacyBytes,
    "application/json; charset=utf-8",
  );

  const result = await reconcileLegacyProjectLifecycle(
    env,
    {
      ...readProject(database, 84),
      dropbox_root_path: "/legacy-project",
      default_config_file: "config.kepler.json",
    },
    { actorUserId: 10, transitionId: "reconcile-84" },
  );

  const expectedChecksum = await sha256Hex(legacyBytes);
  const project = readProject(database, 84);
  const ledger = database
    .prepare(
      "SELECT * FROM project_config_revisions WHERE project_id = 84 AND revision = 1",
    )
    .get();
  const versionedObject = database
    .prepare(
      "SELECT * FROM local_storage_objects WHERE path = '/legacy-project/config.kepler.r000001.json'",
    )
    .get();
  const originalObject = database
    .prepare(
      "SELECT * FROM local_storage_objects WHERE path = '/legacy-project/config.kepler.json'",
    )
    .get();

  assert.equal(result.revision, 1);
  assert.equal(result.checksum, expectedChecksum);
  assert.equal(project.lifecycle_state, "ACTIVE");
  assert.equal(project.config_revision, 1);
  assert.equal(project.config_checksum, expectedChecksum);
  assert.equal(project.config_storage_ref, "project-config://84/revisions/1");
  assert.equal(project.config_schema, "legacy-kepler");
  assert.equal(project.config_schema_version, 1);
  assert.equal(project.config_size_bytes, legacyBytes.byteLength);
  assert.equal(ledger.status, "READY");
  assert.equal(ledger.checksum, expectedChecksum);
  assert.ok(ledger.published_at);
  assert.ok(versionedObject);
  assert.ok(originalObject);
  assert.equal(versionedObject.size_bytes, legacyBytes.byteLength);
});

test("backfill reconciliado é idempotente e não cria revisão extra", async () => {
  const database = fixture();
  database.prepare(`
    INSERT INTO projects (
      id, organization_id, dropbox_root_path,
      default_config_file, active, config_revision
    ) VALUES (85, 7, '/legacy-idempotent', 'config.kepler.json', 1, 0)
  `).run();
  const env = envFor(database);
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: "v1", config: {}, datasets: [] }),
  );
  await uploadLocalStorageFile(
    env,
    "/legacy-idempotent",
    "config.kepler.json",
    bytes,
    "application/json; charset=utf-8",
  );

  const first = await reconcileLegacyProjectLifecycle(
    env,
    readProject(database, 85),
    { actorUserId: 10, transitionId: "reconcile-85-a" },
  );
  const second = await reconcileLegacyProjectLifecycle(
    env,
    readProject(database, 85),
    { actorUserId: 10, transitionId: "reconcile-85-b" },
  );

  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(second.idempotent, true);
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS total FROM project_config_revisions WHERE project_id = 85",
      )
      .get().total,
    1,
  );
});

test("active=0 legado permanece não resolvido sem classificação automática FAILED", async () => {
  const database = fixture();
  database.prepare(`
    INSERT INTO projects (
      id, organization_id, dropbox_root_path,
      default_config_file, active, config_revision
    ) VALUES (86, 7, '/legacy-inactive', 'config.kepler.json', 0, 0)
  `).run();
  const env = envFor(database);

  await assert.rejects(
    reconcileLegacyProjectLifecycle(env, readProject(database, 86), {
      actorUserId: 10,
      transitionId: "reconcile-86",
    }),
    (error) => error?.code === "LEGACY_INACTIVE_PROJECT_UNRESOLVED",
  );

  const project = readProject(database, 86);
  assert.equal(project.lifecycle_state, null);
  assert.equal(project.active, 0);
});
