import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createOrganizationLifecycle, updateOrganizationLifecycle } from "../functions/_lib/organization-lifecycle.js";

function database(t, beforeFirst = () => {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  const env = { DB: { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { beforeFirst(sql, sqlite); return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return { success: true, meta: sqlite.prepare(sql).run(...args) }; },
    };
  } } };
  return { env, sqlite };
}

function seed(sqlite, path = "/projects/cliente") {
  sqlite.prepare(`INSERT INTO organizations (name, slug, dropbox_root_path, active, storage_status, storage_checked_at)
    VALUES ('Cliente', 'cliente', ?, 1, 'READY', '2026-09-19T12:00:00.000Z')`).run(path);
}

test("metadata update cannot reactivate organization disabled by another request", async (t) => {
  let raced = false;
  const { env, sqlite } = database(t, (sql, db) => {
    if (!raced && /UPDATE organizations/.test(sql)) {
      raced = true;
      db.exec("UPDATE organizations SET active = 0, storage_status = 'DISABLED' WHERE id = 1");
    }
  });
  seed(sqlite);
  await assert.rejects(updateOrganizationLifecycle(env, 1, { name: "New name" }), { code: "ORGANIZATION_CONCURRENT_UPDATE" });
  const row = sqlite.prepare("SELECT * FROM organizations WHERE id = 1").get();
  assert.equal(row.active, 0);
  assert.equal(row.storage_status, "DISABLED");
  assert.equal(row.name, "Cliente");
});

test("stale metadata update cannot undo a concurrently changed root", async (t) => {
  let raced = false;
  const { env, sqlite } = database(t, (sql, db) => {
    if (!raced && /UPDATE organizations/.test(sql)) {
      raced = true;
      db.exec("UPDATE organizations SET dropbox_root_path = '/projects/new-root' WHERE id = 1");
    }
  });
  seed(sqlite);
  await assert.rejects(updateOrganizationLifecycle(env, 1, { description: "Metadata" }), { code: "ORGANIZATION_CONCURRENT_UPDATE" });
  assert.equal(sqlite.prepare("SELECT dropbox_root_path FROM organizations").get().dropbox_root_path, "/projects/new-root");
});

test("legacy QA metadata and disabling preserve root and never provision storage", async (t) => {
  const { env, sqlite } = database(t);
  seed(sqlite, "/Apps/MaonoKepler/preview/qa");
  const ensureStorage = async () => assert.fail("metadata/disable must not provision");
  const edited = await updateOrganizationLifecycle(env, 1, { description: "QA" }, { ensureStorage });
  assert.equal(edited.storageReady, false);
  assert.equal(edited.organization.dropbox_root_path, "/Apps/MaonoKepler/preview/qa");
  const disabled = await updateOrganizationLifecycle(env, 1, { active: false }, { ensureStorage });
  assert.equal(disabled.organization.active, 0);
  assert.equal(disabled.organization.storage_status, "DISABLED");
  assert.equal(disabled.organization.dropbox_root_path, "/Apps/MaonoKepler/preview/qa");
});

test("new organization rejects traversal path before persisting anything", async (t) => {
  const { env, sqlite } = database(t);
  await assert.rejects(createOrganizationLifecycle(env, { name: "Unsafe", slug: "unsafe", dropboxRootPath: "/projects/../other" }), { code: "ORGANIZATION_PATH_INVALID" });
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM organizations").get().n, 0);
});

test("creation denominator is recorded before provisioning fails, and resume never duplicates it", async (t) => {
  const { env, sqlite } = database(t);
  const observations = [];
  const observe = async (_, value) => observations.push(value);
  let attempt = 0;
  const ensureStorage = async (_, row, options) => {
    assert.equal(options.telemetrySource, attempt++ ? "operator" : "lifecycle");
    assert.equal(observations.length, 1);
    assert.equal(row.storage_status, "PENDING");
    throw Object.assign(new Error("provider failure"), { code: "DROPBOX_UNAVAILABLE" });
  };
  const payload = { name: "Created", slug: "created" };
  await assert.rejects(createOrganizationLifecycle(env, payload, { observe, ensureStorage }));
  await assert.rejects(createOrganizationLifecycle(env, payload, { observe, ensureStorage }));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM organizations").get().n, 1);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].type, "created");
  assert.equal(observations[0].activeAtCreation, true);
  assert.ok(observations[0].correlationId);
});
