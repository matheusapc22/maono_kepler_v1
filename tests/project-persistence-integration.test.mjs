import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createProjectFromKepler, markCreationFailed } from "../functions/_lib/project-creation-lifecycle-service.js";
import { reserveLargeProjectCreation, finalizeLargeProjectCreation, markLargeProjectCreationFailed } from "../functions/_lib/project-large-creation.js";
import { getActiveOrganizationId } from "../functions/_lib/projects.js";
import { saveProjectConfig, readPublishedProjectConfig } from "../functions/_lib/project-config-service.js";
import { touchProjectAfterConfigSave } from "../functions/_lib/project-service.js";
import { saveLargeProjectConfigStream } from "../functions/_lib/project-large-config-save.js";
import { saveLargeLegacyProjectConfigStream } from "../functions/_lib/project-large-legacy-config-save.js";
import { beginClientSaveAttempt, serializeSaveRequest, buildSaveRequestHeaders } from "../src/pages/Kepler/save-observability.ts";
import { prepareProjectCreateTransport } from "../src/pages/Kepler/project-create-transport.ts";
import { persistenceFixture, interruption, deferred, waitForPause } from "./helpers/project-persistence-fixture.mjs";
const golden = JSON.parse(readFileSync(new URL("./fixtures/maps/golden/map-point-basic.kepler.json", import.meta.url), "utf8"));
const config = value => ({
  ...structuredClone(golden),
  offlineSequence: value
});
const large = value => ({
  ...config(value),
  padding: "x".repeat(8 * 1024 * 1024 + 513),
  unicode: "Maõno 🗺️"
});
const request = () => new Request("http://offline.invalid/api/projects", {
  method: "POST"
});
const creationTransport = (map, key, name) => prepareProjectCreateTransport(beginClientSaveAttempt("create"), {
  name,
  description: "",
  organizationId: 1,
  idempotencyKey: key,
  config: map,
  legacy: null
});
const smallBody = value => JSON.parse(creationTransport(config(value), "offline-create-small-001", "Offline map").requestBody);
const createSmall = (f, value = "initial") => createProjectFromKepler(f.env, request(), f.user, smallBody(value), {
  getActiveOrganizationId
});
const saveSmall = (f, value, expected = f.project().config_revision) => saveProjectConfig(f.env, {
  project: f.project(),
  config: config(value),
  expectedConfigRevision: expected,
  actor: f.user,
  touchProjectAfterConfigSave
});
function streamRequest(map, expectedRevision, {
  chunkSize = 256 * 1024,
  abortAfter = null,
  truncate = 0,
  operation = "update"
} = {}) {
  const attempt = beginClientSaveAttempt(operation);
  const serialized = operation === "create" ? prepareProjectCreateTransport(attempt, {
    name: "Large map",
    description: "",
    organizationId: 1,
    idempotencyKey: "offline-create-large-001",
    config: map,
    legacy: null
  }).configTransport : serializeSaveRequest(attempt, {
    config: map,
    expectedConfigRevision: expectedRevision
  });
  const headers = buildSaveRequestHeaders(attempt);
  assert.equal(headers["X-Maono-Large-Config"], "1", "real frontend selected streaming above 8 MiB");
  const original = new TextEncoder().encode(serialized.body),
    bytes = original.subarray(0, original.length - truncate);
  let offset = 0,
    pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (abortAfter !== null && pulls++ === abortAfter) {
        controller.error(new DOMException("Offline client cancelled", "AbortError"));
        return;
      }
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    }
  });
  const result = new Request("http://offline.invalid/api/projects/map/config", {
    method: "PUT",
    headers,
    body,
    duplex: "half"
  });
  result.json = () => {
    throw new Error("stream must not materialize request.json");
  };
  result.text = () => {
    throw new Error("stream must not materialize request.text");
  };
  return result;
}
async function seedLegacy(f) {
  f.db.exec(`INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path,lifecycle_state,active)
    VALUES(1,'Legacy map','map',1,'/offline/a/map',NULL,1);
    INSERT INTO user_projects(user_id,project_id,access_level) VALUES(1,1,'owner');`);
  await f.store("/offline/a/map/config.kepler.json", new TextEncoder().encode(JSON.stringify(config("legacy-original"))));
}
async function seed(f, mode) {
  if (mode === "legacy") await seedLegacy(f);else await createSmall(f);
}
async function saveStream(f, map, expected, options) {
  const p = f.project();
  const work = p.lifecycle_state == null ? saveLargeLegacyProjectConfigStream : saveLargeProjectConfigStream;
  return work(f.env, {
    project: p,
    user: f.user,
    request: streamRequest(map, expected, options)
  });
}
async function assertReopened(f, map, revision) {
  const p = f.project();
  assert.equal(p.config_revision, revision);
  assert.equal(p.lifecycle_state, "ACTIVE");
  assert.equal(f.ledger(1, revision).status, "READY");
  assert.deepEqual((await readPublishedProjectConfig(f.env, p)).config, map);
}
const largeBody = map => JSON.parse(creationTransport(map, "offline-create-large-001", "Large map").requestBody);
async function createLarge(f, map = large("create"), options = {}) {
  const body = largeBody(map);
  const reserved = await reserveLargeProjectCreation(f.env, request(), f.user, body);
  const req = streamRequest(map, 0, {
    ...options,
    operation: "create"
  });
  try {
    return await saveLargeProjectConfigStream(f.env, {
      request: req,
      project: reserved.project,
      user: f.user,
      operation: "create",
      allowedLifecycleStates: ["PREPARING_STORAGE", "CONFIG_READY", "ACTIVE"],
      expectedLifecycleState: "PREPARING_STORAGE",
      syncOrganizationFile: false,
      afterPublish: ({
        project,
        artifact
      }) => finalizeLargeProjectCreation(f.env, req, f.user, {
        project,
        artifact,
        idempotencyKey: body.idempotencyKey
      })
    });
  } catch (error) {
    await markLargeProjectCreationFailed(f.env, req, f.user, {
      project: reserved.project,
      idempotencyKey: body.idempotencyKey,
      error
    });
    throw error;
  }
}
test("small creation, response-loss retry, save and reopen use one project and one quota", async t => {
  const f = persistenceFixture(t),
    created = await createSmall(f);
  assert.equal(created.status, 201);
  const retry = await createSmall(f);
  assert.equal(retry.idempotent, true);
  await saveSmall(f, "edited", 1);
  await assertReopened(f, config("edited"), 2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM user_projects").get().n, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_resource_reservations WHERE status='COMMITTED'").get().n, 1);
});
test("small creation failure remains inactive and retry recovers the same project", async t => {
  let fail = true;
  const f = persistenceFixture(t, {
    beforeProvider({
      op
    }) {
      if (fail && op === "upload") throw interruption();
    }
  });
  await assert.rejects(createSmall(f), {
    code: "PROJECT_CREATION_FAILED"
  });
  assert.equal(f.project().active, 0);
  assert.equal(f.project().config_revision, 0);
  assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active, 0);
  fail = false;
  await createSmall(f);
  await assertReopened(f, config("initial"), 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n, 1);
});
test("different concurrent small saves publish one content and reject the stale writer", async t => {
  const entered = deferred(),
    release = deferred();
  let pause = false;
  const f = persistenceFixture(t, {
    async beforeProvider({
      op
    }) {
      if (pause && op === "upload") {
        entered.resolve();
        await release.promise;
      }
    }
  });
  await createSmall(f);
  pause = true;
  const first = saveSmall(f, "winner", 1).then(value => ({
    value
  }), error => ({
    error
  }));
  await waitForPause(entered, first);
  try {
    await assert.rejects(saveSmall(f, "loser", 1), {
      code: "PROJECT_CONFIG_REVISION_CONFLICT"
    });
  } finally {
    release.resolve();
  }
  assert.equal((await first).error, undefined);
  await assertReopened(f, config("winner"), 2);
  const retry = await saveSmall(f, "winner", 1);
  assert.equal(retry.idempotent, true);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n, 2);
});
test("small legacy save retains its existing overwrite semantics and can be reopened", async t => {
  const f = persistenceFixture(t);
  await seedLegacy(f);
  const saved = await saveSmall(f, "legacy-edit");
  assert.equal(saved.legacy, true);
  assert.equal(f.project().lifecycle_state, null);
  assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, config("legacy-edit"));
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n, 0);
});
for (const mode of ["versioned", "legacy"]) {
  test(`${mode} streaming round-trip and lost-response retry preserve one revision`, async t => {
    const f = persistenceFixture(t);
    await seed(f, mode);
    const expected = f.project().config_revision,
      map = large(mode);
    const saved = await saveStream(f, map, expected, {
      chunkSize: 4 * 1024 * 1024 + 37
    });
    await assertReopened(f, map, expected + 1);
    if (mode === "legacy") assert.equal(saved.promotedFromLegacy, true);
    const finishes = f.calls.filter(c => c.op === "upload_session/finish").length;
    const retry = await saveStream(f, map, expected);
    assert.equal(retry.idempotent, true);
    assert.equal(f.calls.filter(c => c.op === "upload_session/finish").length, finishes);
    await assertReopened(f, map, expected + 1);
  });
  test(`${mode} interrupted and truncated streams never publish and permit retry`, async t => {
    const f = persistenceFixture(t);
    await seed(f, mode);
    const expected = f.project().config_revision,
      map = large("retry");
    const original = (await readPublishedProjectConfig(f.env, f.project())).config;
    for (const options of [{
      abortAfter: 2
    }, {
      truncate: 17
    }]) {
      await assert.rejects(saveStream(f, map, expected, options));
      assert.equal(f.project().config_revision, expected);
      assert.equal(f.ledger(1, expected + 1), undefined);
      assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, original);
    }
    await saveStream(f, map, expected);
    await assertReopened(f, map, expected + 1);
  });
  for (const operation of ["upload_session/append_v2", "upload_session/finish"]) {
    test(`${mode} reconciles a lost ${operation} acknowledgement without duplicate bytes`, async t => {
      let lost = false;
      const f = persistenceFixture(t, {
        afterProvider({
          op
        }) {
          if (op === operation && !lost) {
            lost = true;
            throw Object.assign(new Error("Lost offline response"), {
              code: "DROPBOX_TIMEOUT",
              status: 504,
              retryable: true
            });
          }
        }
      });
      await seed(f, mode);
      const expected = f.project().config_revision,
        map = large("ack");
      await saveStream(f, map, expected);
      assert.equal(lost, true);
      await assertReopened(f, map, expected + 1);
      if (operation === "upload_session/finish") assert.equal(f.calls.filter(c => c.op === operation).length, 1);
    });
  }
  test(`${mode} provider hash mismatch preserves HEAD and same-content retry reconciles storage`, async t => {
    let corrupt = true;
    const f = persistenceFixture(t, {
      async afterProvider({
        op,
        response
      }) {
        if (corrupt && op === "upload_session/finish") {
          const metadata = await response.json();
          return Response.json({
            ...metadata,
            content_hash: "0".repeat(64)
          });
        }
      }
    });
    await seed(f, mode);
    const expected = f.project().config_revision,
      map = large("hash");
    await assert.rejects(saveStream(f, map, expected), {
      code: "MAP_CONFIG_STORAGE_INTEGRITY_MISMATCH"
    });
    assert.equal(f.project().config_revision, expected);
    assert.equal(f.ledger(1, expected + 1).status, "FAILED");
    corrupt = false;
    await saveStream(f, map, expected);
    await assertReopened(f, map, expected + 1);
    assert.equal(f.ledger(1, expected + 1).attempts, 2);
  });
  test(`${mode} failed publication preserves READY for retry rather than losing stored content`, async t => {
    let fail = false;
    const f = persistenceFixture(t, {
      beforeSql({
        sql
      }) {
        if (fail && /UPDATE projects\s+SET config_revision/.test(sql)) throw interruption();
      }
    });
    await seed(f, mode);
    fail = true;
    const expected = f.project().config_revision,
      map = large("publish");
    await assert.rejects(saveStream(f, map, expected), {
      code: "OFFLINE_INTERRUPTION"
    });
    assert.equal(f.project().config_revision, expected);
    assert.equal(f.ledger(1, expected + 1).status, "READY");
    fail = false;
    await saveStream(f, map, expected);
    await assertReopened(f, map, expected + 1);
  });
}
test("large creation activation and response-loss retry preserve owner, quota and published bytes", async t => {
  const f = persistenceFixture(t),
    map = large("create");
  await createLarge(f, map);
  await assertReopened(f, map, 1);
  const retry = await createLarge(f, map);
  assert.equal(retry.idempotent, true);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n, 1);
  assert.equal(f.db.prepare("SELECT access_level FROM user_projects").get().access_level, "owner");
  assert.equal(f.db.prepare("SELECT count(*) n FROM organization_resource_reservations WHERE status='COMMITTED'").get().n, 1);
  assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active, 1);
});
test("large creation cancelled upload stays unpublished and retry reuses its reservation", async t => {
  const f = persistenceFixture(t),
    map = large("cancel");
  await assert.rejects(createLarge(f, map, {
    abortAfter: 2
  }));
  assert.equal(f.project().config_revision, 0);
  assert.equal(f.project().active, 0);
  assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active, 0);
  await createLarge(f, map);
  await assertReopened(f, map, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n, 1);
});
test("large creation failure after publish resumes finalization without another revision", async t => {
  let fail = true;
  const f = persistenceFixture(t, {
      beforeSql({
        sql
      }) {
        if (fail && /INSERT INTO user_projects/.test(sql)) throw interruption();
      }
    }),
    map = large("finalize");
  await assert.rejects(createLarge(f, map), {
    code: "OFFLINE_INTERRUPTION"
  });
  assert.equal(f.project().config_revision, 1);
  assert.equal(f.ledger().status, "READY");
  assert.equal(f.project().active, 0);
  fail = false;
  await createLarge(f, map);
  await assertReopened(f, map, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n, 1);
});
test("concurrent large creation cannot invalidate an already activated winner", async t => {
  const entered = deferred(),
    release = deferred();
  let firstFinish = true;
  const f = persistenceFixture(t, {
      async beforeProvider({
        op
      }) {
        if (firstFinish && op === "upload_session/finish") {
          firstFinish = false;
          entered.resolve();
          await release.promise;
        }
      }
    }),
    map = large("concurrent");
  const first = createLarge(f, map).then(value => ({
    value
  }), error => ({
    error
  }));
  await waitForPause(entered, first);
  try {
    await createLarge(f, map);
  } finally {
    release.resolve();
  }
  const result = await first;
  if (result.error) assert.equal(result.error.code, "PROJECT_CONFIG_LIFECYCLE_CONFLICT");
  await assertReopened(f, map, 1);
  assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n, 1);
});
for (const mode of ["versioned", "legacy"]) test(`${mode} streaming publication rejects READY metadata replaced after its read`, async t => {
  let armed = false,
    raced = false,
    stopReplacement = false;
  const replacement = large("replacement-before-CAS");
  const f = persistenceFixture(t, {
    async beforeSql({
      sql
    }) {
      if (!armed || !/UPDATE projects\s+SET config_revision/.test(sql)) return;
      if (stopReplacement) throw interruption();
      if (raced) return;
      raced = true;
      // Advance only the fixture's candidate age; production timeout is unchanged.
      f.db.prepare("UPDATE project_config_revisions SET updated_at='2000-01-01 00:00:00' WHERE revision=?").run(expected + 1);
      stopReplacement = true;
      try {
        await assert.rejects(saveStream(f, replacement, expected), {
          code: "OFFLINE_INTERRUPTION"
        });
      } finally {
        stopReplacement = false;
      }
    }
  });
  await seed(f, mode);
  const expected = f.project().config_revision;
  const original = (await readPublishedProjectConfig(f.env, f.project())).config;
  armed = true;
  await assert.rejects(saveStream(f, large("stale-before-CAS"), expected), {
    code: "PROJECT_CONFIG_REVISION_CONFLICT"
  });
  assert.equal(raced, true);
  assert.equal(f.project().config_revision, expected);
  assert.equal(f.ledger(1, expected + 1).status, "READY");
  assert.deepEqual((await readPublishedProjectConfig(f.env, f.project())).config, original);
  await saveStream(f, replacement, expected);
  await assertReopened(f, replacement, expected + 1);
});
for (const mode of ["small", "large"]) test(`${mode} late failure callback preserves an activated project and its committed quota`, async t => {
  const f = persistenceFixture(t);
  await createSmall(f);
  const active = f.project();
  const stale = {
    ...active,
    lifecycle_state: "PREPARING_STORAGE",
    lifecycle_version: 1
  };
  if (mode === "small") await markCreationFailed(f.env, {
    reservationId: active.organization_file_id,
    project: stale,
    organizationId: 1,
    message: "Late offline failure",
    stage: "WRITE",
    errorCode: "LATE",
    transitionId: "offline-late-failure"
  });else await markLargeProjectCreationFailed(f.env, request(), f.user, {
    project: stale,
    idempotencyKey: smallBody().idempotencyKey,
    error: interruption()
  });
  assert.equal(f.db.prepare("SELECT active FROM organization_files").get().active, 1);
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status, "COMMITTED");
  await assertReopened(f, config("initial"), 1);
});
for (const mode of ["small", "large"]) test(`${mode} failure cleanup cannot invalidate a newer reservation between its read and write`, async t => {
  let race = false;
  const map = large("new-attempt");
  const f = persistenceFixture(t, {
    async beforeSql({
      sql
    }) {
      if (race && /UPDATE organization_files\s+SET status = 'ERROR'/.test(sql)) {
        race = false;
        await reserveLargeProjectCreation(f.env, request(), f.user, largeBody(map));
      }
    }
  });
  await assert.rejects(createLarge(f, map, {
    abortAfter: 2
  }));
  const failed = f.project();
  assert.equal(failed.lifecycle_state, "FAILED");
  race = true;
  if (mode === "small") await markCreationFailed(f.env, {
    reservationId: failed.organization_file_id,
    project: failed,
    organizationId: 1,
    message: "Late offline failure",
    stage: "WRITE",
    errorCode: "LATE",
    transitionId: "offline-stale-failure"
  });else await markLargeProjectCreationFailed(f.env, request(), f.user, {
    project: failed,
    idempotencyKey: largeBody(map).idempotencyKey,
    error: interruption()
  });
  assert.equal(f.project().lifecycle_state, "PREPARING_STORAGE");
  assert.equal(f.db.prepare("SELECT status FROM organization_files").get().status, "PROCESSING");
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status, "PROCESSING");
});
test("large failure quota release cannot overtake a retry after the file CAS", async t => {
  let race = false;
  const map = large("quota-retry");
  const f = persistenceFixture(t, {
    async beforeSql({
      sql
    }) {
      if (race && /UPDATE organization_resource_reservations\s+SET status = 'RELEASED'/.test(sql)) {
        race = false;
        await reserveLargeProjectCreation(f.env, request(), f.user, largeBody(map));
      }
    }
  });
  await assert.rejects(createLarge(f, map, {
    abortAfter: 2
  }));
  const failed = f.project();
  assert.equal(failed.lifecycle_state, "FAILED");
  race = true;
  await markLargeProjectCreationFailed(f.env, request(), f.user, {
    project: failed,
    idempotencyKey: largeBody(map).idempotencyKey,
    error: interruption()
  });
  assert.equal(race, false);
  assert.equal(f.project().lifecycle_state, "PREPARING_STORAGE");
  assert.equal(f.db.prepare("SELECT status FROM organization_files").get().status, "PROCESSING");
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status, "PROCESSING");
});
