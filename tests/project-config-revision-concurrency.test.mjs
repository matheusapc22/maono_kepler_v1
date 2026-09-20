import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { saveVersionedProjectConfig, readPublishedProjectConfig } from "../functions/_lib/project-config-service.js";
import {
  reserveProjectConfigRevision,
  markProjectConfigRevisionFailed,
  markProjectConfigRevisionReady,
  publishProjectConfigRevision,
} from "../functions/_lib/project-config-revisions.js";

// Real schema, SQL and storage adapter. Hooks only schedule interleavings.
function fixture(t, hooks = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  db.exec(`CREATE TABLE local_storage_objects (path TEXT PRIMARY KEY, content BLOB,
    content_type TEXT, size_bytes INTEGER, created_at TEXT, updated_at TEXT);
    INSERT INTO organizations (id,name,slug,dropbox_root_path) VALUES (1,'Org','org','/projects/org');
    INSERT INTO projects (id,name,slug,organization_id,dropbox_root_path,lifecycle_state)
      VALUES (1,'Map','map',1,'/projects/org/map','ACTIVE');
    INSERT INTO project_config_revisions
      (project_id,revision,status,checksum_algorithm,checksum,storage_provider,storage_ref,
       schema_name,schema_version,size_bytes,content_type,transition_id,updated_at)
      VALUES (1,1,'FAILED','sha256','old','dropbox','maono:project:1:revision:1',
       'legacy-kepler',1,10,'application/json','old-attempt','2000-01-01 00:00:00');
    INSERT INTO local_storage_objects (path,content,size_bytes)
      VALUES ('/projects/org/map/config.kepler.r000001.json',X'01',1);`);
  t.after(() => db.close());
  const env = { APP_ENV: "local", STORAGE_DRIVER: "local-d1", DB: {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; },
        async first() {
          await hooks.beforeFirst?.(sql, db);
          const row = db.prepare(sql).get(...args) ?? null;
          await hooks.afterFirst?.(sql, row, db);
          return row;
        },
        async run() {
          await hooks.beforeRun?.(sql, db);
          return db.prepare(sql).run(...args);
        },
        async all() { return { results: db.prepare(sql).all(...args) }; },
      };
    },
  } };
  return { db, env, row: () => db.prepare("SELECT * FROM project_config_revisions").get() };
}

function reserve(env, checksum = "new") {
  return reserveProjectConfigRevision(env, {
    projectId: 1, organizationId: 1, expectedCurrentRevision: 0,
    checksumAlgorithm: "sha256", checksum, storageProvider: "dropbox",
    storageRef: "maono:project:1:revision:1", schemaName: "legacy-kepler",
    schemaVersion: 1, sizeBytes: 10, contentType: "application/json",
    transitionId: `attempt-${checksum}`,
  });
}

const publish = (env, checksum = "old", attempts = 1) => publishProjectConfigRevision(env, {
  projectId: 1, organizationId: 1, expectedCurrentRevision: 0, revision: 1,
  checksum, attempts,
  actor: { name: "Editor" },
});

test("recycle reports a concurrent HEAD as a typed 409, without ReferenceError", async (t) => {
  let reads = 0;
  const { env, db } = fixture(t, { beforeFirst(sql, db) {
    if (/SELECT \* FROM projects/.test(sql) && ++reads === 2) {
      db.exec("UPDATE projects SET config_revision = 1");
    }
  } });
  await assert.rejects(reserve(env), (error) => {
    assert.equal(error.code, "PROJECT_CONFIG_REVISION_CONFLICT");
    assert.equal(error.status, 409);
    assert.equal(error.details.currentConfigRevision, 1);
    return true;
  });
  assert.equal(db.prepare("SELECT count(*) AS n FROM local_storage_objects").get().n, 1);
});

test("only one recycler can delete the candidate while storage is delayed", async (t) => {
  let releaseDelete;
  let reachedDelete;
  const reached = new Promise((resolve) => { reachedDelete = resolve; });
  const released = new Promise((resolve) => { releaseDelete = resolve; });
  let deletions = 0;
  const { env, row } = fixture(t, { async beforeRun(sql) {
    if (/DELETE FROM local_storage_objects/.test(sql)) {
      deletions++;
      if (deletions === 1) { reachedDelete(); await released; }
    }
  } });
  const first = reserve(env, "A");
  // Handle both outcomes immediately even when a regression makes the loser win.
  const firstResult = first.then((value) => ({ value }), (error) => ({ error }));
  await reached;
  try {
    await assert.rejects(reserve(env, "B"), { code: "PROJECT_CONFIG_REVISION_CONFLICT" });
    assert.equal(deletions, 1);
  } finally { releaseDelete(); }
  const result = await firstResult;
  assert.equal(result.error, undefined);
  assert.equal(row().checksum, "a");
  assert.equal(row().status, "WRITING");
});

test("a READY ledger read before recycling cannot publish stale storage metadata", async (t) => {
  let raced = false;
  let env;
  const f = fixture(t, { async beforeFirst(sql) {
    if (!raced && /UPDATE projects\s+SET config_revision/.test(sql)) {
      raced = true;
      const replacement = await reserve(env, "replacement");
      await markProjectConfigRevisionReady(env, { projectId: 1, revision: 1, checksum: "replacement", attempts: replacement.revision.attempts });
    }
  } });
  env = f.env;
  f.db.exec("UPDATE project_config_revisions SET status = 'READY'");
  await assert.rejects(publish(env), { code: "PROJECT_CONFIG_REVISION_CONFLICT" });
  assert.equal(f.db.prepare("SELECT config_revision FROM projects").get().config_revision, 0);
  assert.equal(f.row().checksum, "replacement");
});

test("published HEAD protects READY lineage even if its auxiliary stamp was lost", async (t) => {
  let raced = false;
  const { env, db, row } = fixture(t, { afterFirst(sql, result, db) {
    if (!raced && /SELECT \*/.test(sql) && /FROM project_config_revisions/.test(sql)) {
      raced = true;
      db.exec("UPDATE projects SET config_revision = 1, config_checksum = 'old'");
    }
  } });
  db.exec("UPDATE project_config_revisions SET status = 'READY'");
  await assert.rejects(reserve(env), { code: "PROJECT_CONFIG_REVISION_CONFLICT" });
  assert.equal(row().status, "READY");
  assert.equal(db.prepare("SELECT count(*) AS n FROM local_storage_objects").get().n, 1);
});

test("publication between HEAD read and abandoned-READY claim cannot be reclaimed", async (t) => {
  let raced = false;
  const { env, db, row } = fixture(t, { beforeFirst(sql, db) {
    if (!raced && /UPDATE project_config_revisions/.test(sql) && /PROJECT_CONFIG_READY_ABANDONED/.test(sql)) {
      raced = true;
      db.exec("UPDATE projects SET config_revision = 1, config_checksum = 'old'");
    }
  } });
  db.exec("UPDATE project_config_revisions SET status = 'READY'");
  await assert.rejects(reserve(env), { code: "PROJECT_CONFIG_REVISION_CONFLICT" });
  assert.equal(raced, true);
  assert.equal(row().status, "READY");
  assert.equal(db.prepare("SELECT count(*) AS n FROM local_storage_objects").get().n, 1);
});

test("a delayed failure cannot mark a different reservation attempt FAILED", async (t) => {
  const { env, row } = fixture(t);
  await reserve(env, "replacement");
  await markProjectConfigRevisionFailed(env, {
    projectId: 1, revision: 1, checksum: "old", attempts: 1,
    errorCode: "OLD_TIMEOUT", errorStage: "WRITE",
  });
  assert.equal(row().status, "WRITING");
  assert.equal(row().checksum, "replacement");
});

test("successful recycle, verify, publish and response-loss retry preserve one HEAD", async (t) => {
  const { env, db, row } = fixture(t);
  const reserved = await reserve(env, "replacement");
  assert.equal(row().attempts, 2);
  assert.equal(row().error_stage, null);
  await markProjectConfigRevisionReady(env, {
    projectId: 1, revision: 1, checksum: "replacement", attempts: reserved.revision.attempts,
  });
  const result = await publish(env, "replacement", reserved.revision.attempts);
  assert.equal(result.config_checksum, "replacement");
  assert.equal(row().status, "READY");
  const recovered = await reserve(env, "replacement");
  assert.equal(recovered.alreadyPublished, true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM project_config_revisions").get().n, 1);
});

test("ambiguous cleanup failure remains fenced and cannot trigger another deletion", async (t) => {
  let deletions = 0;
  const { env, row } = fixture(t, { beforeRun(sql) {
    if (/DELETE FROM local_storage_objects/.test(sql)) {
      deletions++;
      throw Object.assign(new Error("controlled storage interruption"), { code: "STORAGE_INTERRUPTED" });
    }
  } });
  await assert.rejects(reserve(env), { code: "STORAGE_INTERRUPTED" });
  assert.equal(row().error_stage, "RECYCLE");
  for (const checksum of ["new", "old", "other"]) {
    await assert.rejects(reserve(env, checksum), { code: "PROJECT_CONFIG_REVISION_CONFLICT" });
  }
  assert.equal(deletions, 1);
});

test("late ready and failure callbacks cannot release an in-progress cleanup", async (t) => {
  const { env, db, row } = fixture(t);
  db.exec("UPDATE project_config_revisions SET error_stage = 'RECYCLE'");
  await assert.rejects(markProjectConfigRevisionReady(env, {
    projectId: 1, revision: 1, checksum: "old", attempts: 1,
  }), { code: "PROJECT_CONFIG_REVISION_READY_CONFLICT" });
  await markProjectConfigRevisionFailed(env, {
    projectId: 1, revision: 1, checksum: "old", attempts: 1,
    errorStage: "WRITE", errorCode: "OLD_TIMEOUT",
  });
  assert.equal(row().error_stage, "RECYCLE");
});

test("a stale caller cannot publish a replacement already READY before publication starts", async (t) => {
  const { env } = fixture(t);
  const reserved = await reserve(env, "replacement");
  await markProjectConfigRevisionReady(env, {
    projectId: 1, revision: 1, checksum: "replacement", attempts: reserved.revision.attempts,
  });
  await assert.rejects(publish(env), { code: "PROJECT_CONFIG_REVISION_CONFLICT" });
});

test("same-content retry still fences callbacks from the previous attempt", async (t) => {
  const { env, row } = fixture(t);
  const retried = await reserve(env, "old");
  assert.equal(retried.revision.attempts, 2);
  await assert.rejects(markProjectConfigRevisionReady(env, {
    projectId: 1, revision: 1, checksum: "old", attempts: 1,
  }), { code: "PROJECT_CONFIG_REVISION_READY_CONFLICT" });
  await markProjectConfigRevisionFailed(env, {
    projectId: 1, revision: 1, checksum: "old", attempts: 1,
    errorStage: "WRITE", errorCode: "OLD_TIMEOUT",
  });
  assert.equal(row().status, "WRITING");
});

test("golden maps survive recycle, sequential saves and verified reads without content loss", async (t) => {
  const { env, db } = fixture(t);
  let expected = 0;
  for (const name of ["map-point-basic", "map-geojson-polygon", "map-filters-smart-histogram", "map-isochrone-persisted", "map-point-cluster-v2-current", "map-empty"]) {
    const config = JSON.parse(readFileSync(new URL(`./fixtures/maps/golden/${name}.kepler.json`, import.meta.url), "utf8"));
    const project = db.prepare("SELECT * FROM projects WHERE id = 1").get();
    const saved = await saveVersionedProjectConfig(env, {
      project, config, expectedConfigRevision: expected, actor: { name: "Editor" },
    });
    assert.equal(saved.revision, ++expected, name);
    const reopened = await readPublishedProjectConfig(env, saved.project);
    assert.deepEqual(reopened.config, config, name);
    assert.equal(db.prepare("SELECT count(*) AS n FROM project_config_revisions WHERE status = 'READY'").get().n, expected);
  }
});
