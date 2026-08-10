import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PROJECT_LIFECYCLE_STATES,
  assertActiveProjectInvariant,
  assertLifecycleTransition,
} from "../functions/_lib/project-lifecycle.js";
import {
  buildProjectConfigArtifact,
  verifyProjectConfigBytes,
} from "../functions/_lib/project-config-integrity.js";
import {
  createProjectConfigStorageRef,
  getProjectConfigRevisionFileName,
  parseProjectConfigStorageRef,
} from "../functions/_lib/project-config-repository.js";
import {
  markProjectConfigRevisionReady,
  publishProjectConfigRevision,
  reserveProjectConfigRevision,
} from "../functions/_lib/project-config-revisions.js";

const migration = await readFile(
  new URL("../migrations/0018_project_lifecycle.sql", import.meta.url),
  "utf8",
);
const schema = await readFile(
  new URL("../schema.sql", import.meta.url),
  "utf8",
);

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
    INSERT INTO users (id, name) VALUES (10, 'Editor');
  `);
  database.exec(migration);
  return database;
}

function envFor(database) {
  return {
    DB: {
      prepare(sql) {
        const statement = database.prepare(sql);
        let parameters = [];
        return {
          bind(...values) {
            parameters = values;
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

test("0018 adiciona lifecycle, integridade e ledger sem backfill destrutivo", () => {
  const database = fixture();
  const projectColumns = database
    .prepare("PRAGMA table_info(projects)")
    .all()
    .map((column) => column.name);

  for (const column of [
    "lifecycle_state",
    "lifecycle_version",
    "config_checksum",
    "config_storage_ref",
    "config_schema",
    "config_schema_version",
    "config_size_bytes",
  ]) {
    assert.ok(projectColumns.includes(column), column);
  }

  const ledgerColumns = database
    .prepare("PRAGMA table_info(project_config_revisions)")
    .all()
    .map((column) => column.name);
  assert.ok(ledgerColumns.includes("checksum"));
  assert.ok(ledgerColumns.includes("storage_provider_hash"));
  assert.ok(ledgerColumns.includes("published_at"));
  assert.match(schema, /project_config_revisions/);
  assert.match(schema, /lifecycle_state/);
});

test("máquina de estados aceita somente o contrato S03", () => {
  const S = PROJECT_LIFECYCLE_STATES;
  for (const [from, to] of [
    [S.DRAFT, S.PREPARING_STORAGE],
    [S.PREPARING_STORAGE, S.CONFIG_READY],
    [S.PREPARING_STORAGE, S.FAILED],
    [S.CONFIG_READY, S.ACTIVE],
    [S.CONFIG_READY, S.FAILED],
    [S.FAILED, S.PREPARING_STORAGE],
    [S.ACTIVE, S.ACTIVE],
  ]) {
    assert.deepEqual(assertLifecycleTransition(from, to), { from, to });
  }

  for (const [from, to] of [
    [S.DRAFT, S.ACTIVE],
    [S.DRAFT, S.CONFIG_READY],
    [S.PREPARING_STORAGE, S.ACTIVE],
    [S.FAILED, S.ACTIVE],
    [S.ACTIVE, S.DRAFT],
    [S.ACTIVE, S.PREPARING_STORAGE],
  ]) {
    assert.throws(
      () => assertLifecycleTransition(from, to),
      (error) => error?.code === "PROJECT_LIFECYCLE_TRANSITION_INVALID",
    );
  }
});

test("ACTIVE exige revision checksum storage schema e size", () => {
  const valid = {
    config_revision: 3,
    config_checksum: "a".repeat(64),
    config_checksum_algorithm: "sha256",
    config_storage_ref: "project-config://1/revisions/3",
    config_schema: "legacy-kepler",
    config_schema_version: 1,
    config_size_bytes: 42,
  };
  assert.equal(assertActiveProjectInvariant(valid), true);

  for (const field of [
    "config_revision",
    "config_checksum",
    "config_storage_ref",
    "config_schema_version",
    "config_size_bytes",
  ]) {
    const broken = { ...valid, [field]: null };
    assert.throws(
      () => assertActiveProjectInvariant(broken),
      (error) =>
        error?.code === "PROJECT_ACTIVE_INVARIANT_VIOLATION" &&
        error?.details?.missing?.includes(field),
    );
  }
});

test("checksum usa os mesmos bytes UTF-8 persistidos", async () => {
  const config = { version: "v1", config: { visState: {} }, datasets: [] };
  const first = await buildProjectConfigArtifact(config);
  const second = await buildProjectConfigArtifact(config);
  const changed = await buildProjectConfigArtifact({
    ...config,
    config: { visState: { layers: [] } },
  });

  assert.equal(first.checksum.length, 64);
  assert.equal(first.checksum, second.checksum);
  assert.notEqual(first.checksum, changed.checksum);
  await assert.doesNotReject(
    verifyProjectConfigBytes(first.bytes, {
      expectedChecksum: first.checksum,
      expectedAlgorithm: "sha256",
    }),
  );
  await assert.rejects(
    verifyProjectConfigBytes(changed.bytes, {
      expectedChecksum: first.checksum,
      expectedAlgorithm: "sha256",
    }),
    (error) => error?.code === "PROJECT_CONFIG_INTEGRITY_MISMATCH",
  );
});

test("storage_ref é opaca e revisionada sem caminho Dropbox público", () => {
  const ref = createProjectConfigStorageRef(84, 18);
  assert.equal(ref, "project-config://84/revisions/18");
  assert.deepEqual(parseProjectConfigStorageRef(ref), {
    projectId: 84,
    revision: 18,
  });
  assert.equal(
    getProjectConfigRevisionFileName("config.kepler.json", 18),
    "config.kepler.r000018.json",
  );
  assert.doesNotMatch(ref, /dropbox/i);
});

test("ledger impede dois conteúdos diferentes na mesma revisão e publica por CAS", async () => {
  const database = fixture();
  database.prepare(`
    INSERT INTO projects (
      id, organization_id, active, config_revision,
      lifecycle_state, lifecycle_version
    ) VALUES (84, 7, 1, 14, 'ACTIVE', 4)
  `).run();
  const env = envFor(database);
  const base = {
    projectId: 84,
    organizationId: 7,
    expectedCurrentRevision: 14,
    checksumAlgorithm: "sha256",
    checksum: "a".repeat(64),
    storageProvider: "dropbox",
    storageRef: "project-config://84/revisions/15",
    schemaName: "legacy-kepler",
    schemaVersion: 1,
    sizeBytes: 120,
    contentType: "application/json; charset=utf-8",
    actorUserId: 10,
    transitionId: "transition-a",
  };

  const reserved = await reserveProjectConfigRevision(env, base);
  assert.equal(reserved.revision.revision, 15);
  assert.equal(reserved.revision.status, "WRITING");

  await assert.rejects(
    reserveProjectConfigRevision(env, {
      ...base,
      checksum: "b".repeat(64),
      transitionId: "transition-b",
    }),
    (error) => error?.code === "PROJECT_CONFIG_REVISION_CONFLICT",
  );

  await markProjectConfigRevisionReady(env, {
    projectId: 84,
    revision: 15,
    checksum: base.checksum,
    storageProviderVersion: "rev-provider-15",
    storageProviderHash: "provider-hash",
  });
  const published = await publishProjectConfigRevision(env, {
    projectId: 84,
    organizationId: 7,
    expectedCurrentRevision: 14,
    revision: 15,
    actor: { id: 10, name: "Editor" },
  });

  assert.equal(published.config_revision, 15);
  assert.equal(published.lifecycle_state, "ACTIVE");
  assert.equal(published.config_checksum, base.checksum);
  assert.equal(published.config_storage_ref, base.storageRef);

  await assert.rejects(
    reserveProjectConfigRevision(env, base),
    (error) =>
      error?.code === "PROJECT_CONFIG_REVISION_CONFLICT" &&
      error?.details?.currentConfigRevision === 15,
  );
});
