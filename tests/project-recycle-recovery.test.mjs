import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { saveVersionedProjectConfig, readPublishedProjectConfig } from "../functions/_lib/project-config-service.js";
import { markProjectConfigRevisionFailed, markProjectConfigRevisionReady } from "../functions/_lib/project-config-revisions.js";
import { getDropboxMetadata } from "../functions/_lib/dropbox.js";
import { getMapConfigRevisionFileName } from "../functions/_lib/map-config-storage-ref.js";
import { persistenceFixture, interruption, deferred, waitForPause } from "./helpers/project-persistence-fixture.mjs";
const repairSql = readFileSync(new URL("../scripts/project-revisions/recover-verified-absent.sql", import.meta.url), "utf8");
const config = value => ({
  version: "v1",
  config: {
    visState: {
      layers: []
    },
    value
  },
  datasets: []
});
function setup(t, hooks = {}) {
  const f = persistenceFixture(t, hooks);
  f.db.exec(`INSERT INTO projects (id,name,slug,organization_id,dropbox_root_path,lifecycle_state)
    VALUES (1,'Map','map',1,'/offline/a/map','ACTIVE')`);
  f.save = value => saveVersionedProjectConfig(f.env, {
    project: f.project(),
    config: config(value),
    expectedConfigRevision: Number(f.project().config_revision),
    actor: f.user
  });
  f.repairArgs = () => {
    const p = f.project(),
      r = f.ledger(1, 2);
    return [p.organization_id, p.id, r.revision, p.config_revision, r.checksum, r.attempts, r.transition_id, r.storage_ref, p.dropbox_root_path, p.default_config_file, "offline-incident-02", p.lifecycle_state];
  };
  return f;
}
async function interruptedRecycle(t, when = "after") {
  let failReady = false,
    failDelete = false;
  const hooks = {
    beforeSql({
      sql
    }) {
      if (failReady && /SET status = 'READY'/.test(sql)) throw interruption();
    },
    beforeProvider({
      op
    }) {
      if (failDelete && when === "before" && op === "delete_v2") throw interruption();
    },
    afterProvider({
      op
    }) {
      if (failDelete && when === "after" && op === "delete_v2") throw interruption();
    }
  };
  const f = setup(t, hooks);
  await f.save("published");
  failReady = true;
  await assert.rejects(f.save("old-candidate"), {
    code: "OFFLINE_INTERRUPTION"
  });
  failReady = false;
  failDelete = true;
  await assert.rejects(f.save("replacement"), {
    code: "OFFLINE_INTERRUPTION"
  });
  failDelete = false;
  assert.equal(f.ledger(1, 2).error_stage, "RECYCLE");
  return f;
}
test("interrupted recycle before deletion preserves the object and blocks all retries", async t => {
  const f = await interruptedRecycle(t, "before");
  const p = f.project();
  const metadata = await getDropboxMetadata(f.env, p.dropbox_root_path, getMapConfigRevisionFileName(p.default_config_file, 2));
  assert.ok(metadata.id);
  const deletes = f.calls.filter(c => c.op === "delete_v2").length;
  for (const candidate of ["old-candidate", "replacement", "other"]) {
    await assert.rejects(f.save(candidate), {
      code: "PROJECT_CONFIG_REVISION_CONFLICT"
    });
  }
  assert.equal(f.calls.filter(c => c.op === "delete_v2").length, deletes);
  assert.equal(f.project().config_revision, 1);
  assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, config("published"));
});
for (const next of ["old-candidate", "replacement"]) test(`verified absent recovery resumes ${next} through the normal save pipeline`, async t => {
  const f = await interruptedRecycle(t);
  const args = f.repairArgs(),
    old = f.ledger(1, 2),
    p = f.project();
  await assert.rejects(getDropboxMetadata(f.env, p.dropbox_root_path, getMapConfigRevisionFileName(p.default_config_file, 2)), {
    code: "DROPBOX_PATH_NOT_FOUND"
  });
  // In this isolated rehearsal the rejected producer has terminated; no other
  // provider calls or writers exist. A remote not_found alone is insufficient.
  const repaired = f.db.prepare(repairSql).all(...args);
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].status, "FAILED");
  assert.equal(repaired[0].attempts, old.attempts + 1);
  assert.equal(f.project().config_revision, 1);
  await markProjectConfigRevisionFailed(f.env, {
    projectId: 1,
    revision: 2,
    checksum: old.checksum,
    attempts: old.attempts,
    errorCode: "LATE",
    errorStage: "WRITE"
  });
  await assert.rejects(markProjectConfigRevisionReady(f.env, {
    projectId: 1,
    revision: 2,
    checksum: old.checksum,
    attempts: old.attempts
  }), {
    code: "PROJECT_CONFIG_REVISION_READY_CONFLICT"
  });
  assert.equal(f.ledger(1, 2).error_stage, "RECOVERY");
  const saved = await f.save(next);
  assert.equal(saved.revision, 2);
  assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, config(next));
  assert.equal(f.ledger(1, 2).status, "READY");
  assert.equal(f.db.prepare(repairSql).all(...args).length, 0, "old repair snapshot cannot be replayed");
});
test("recovery CAS refuses drift in tenant, token, attempt, path, lifecycle or published HEAD", async t => {
  const f = await interruptedRecycle(t),
    args = f.repairArgs();
  for (const [index, value] of [[0, 2], [2, 3], [4, "wrong-checksum"], [5, 99], [6, "other-token"], [7, "other-ref"], [8, "/offline/b/map"], [9, "other.json"], [10, args[6]], [11, "DELETED"]]) {
    const stale = args.slice();
    stale[index] = value;
    assert.equal(f.db.prepare(repairSql).all(...stale).length, 0, `guard ${index + 1}`);
    assert.equal(f.ledger(1, 2).error_stage, "RECYCLE");
  }
  f.db.prepare("UPDATE projects SET config_revision=2, config_storage_ref=? WHERE id=1").run(args[7]);
  assert.equal(f.db.prepare(repairSql).all(...args).length, 0);
  assert.equal(f.ledger(1, 2).error_stage, "RECYCLE");
});
test("late deletion stays fenced until its producer terminates; timeout age never unlocks it", async t => {
  const started = deferred(),
    finish = deferred();
  let pause = false,
    failReady = false;
  const f = setup(t, {
    beforeSql({
      sql
    }) {
      if (failReady && /SET status = 'READY'/.test(sql)) throw interruption();
    },
    async beforeProvider({
      op
    }) {
      if (pause && op === "delete_v2") {
        started.resolve();
        await finish.promise;
        throw interruption();
      }
    }
  });
  await f.save("published");
  failReady = true;
  await assert.rejects(f.save("candidate"), {
    code: "OFFLINE_INTERRUPTION"
  });
  failReady = false;
  pause = true;
  const producer = f.save("replacement").then(value => ({
    value
  }), error => ({
    error
  }));
  await waitForPause(started, producer);
  try {
    f.db.exec("UPDATE project_config_revisions SET updated_at='2000-01-01 00:00:00' WHERE revision=2");
    await assert.rejects(f.save("replacement"), {
      code: "PROJECT_CONFIG_REVISION_CONFLICT"
    });
    assert.equal(f.ledger(1, 2).error_stage, "RECYCLE");
  } finally {
    finish.resolve();
  }
  assert.equal((await producer).error.code, "OFFLINE_INTERRUPTION");
  assert.equal(f.ledger(1, 2).error_stage, "RECYCLE");
});
