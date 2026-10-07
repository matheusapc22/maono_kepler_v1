import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { organizationStoragePathPolicy } from "../functions/_lib/organization-storage-policy.js";
import { readOrganizationStorageReadiness } from "../functions/_lib/organization-storage-readiness.js";

const email = "qa@example.com";
const repoRoot = new URL("../", import.meta.url);

function generate(args = []) {
  return spawnSync(process.execPath, [
    "scripts/preview/build-production-qa-seed.mjs",
    `--user-email=${email}`,
    ...args,
  ], { cwd: repoRoot, encoding: "utf8" });
}

function generatedSql(args = []) {
  const result = generate(args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function database(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'synthetic-fixture-only')").run(email);
  t.after(() => db.close());
  return db;
}

function organization(db, slug = "maono-preview-qa") {
  return db.prepare("SELECT * FROM organizations WHERE slug = ?").get(slug);
}

test("new QA seed uses canonical storage policy and awaits real provider verification", (t) => {
  const db = database(t);
  const sql = generatedSql();
  db.exec(sql);
  const row = organization(db);
  assert.equal(row.dropbox_root_path, "/projects/maono-preview-qa");
  assert.equal(row.storage_status, "PENDING");
  assert.equal(row.storage_error, null);
  assert.equal(row.storage_checked_at, null);
  assert.equal(organizationStoragePathPolicy(row).decisionRequired, false);
  const readiness = readOrganizationStorageReadiness(row);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.busy, false);
  assert.equal(readiness.recoveryRecommended, true);
  assert.deepEqual(db.prepare("SELECT access_level FROM organization_users").all().map((item) => item.access_level), ["owner"]);
  db.exec(sql);
  assert.deepEqual(organization(db), row);
  assert.equal(db.prepare("SELECT count(*) AS count FROM organization_users").get().count, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("custom QA slug derives its own canonical root and SQL values stay escaped", (t) => {
  const db = database(t);
  const name = "QA d'Água";
  db.exec(generatedSql(["--org-slug=qa-storage-2026", `--org-name=${name}`]));
  const row = organization(db, "qa-storage-2026");
  assert.equal(row.name, name);
  assert.equal(row.dropbox_root_path, "/projects/qa-storage-2026");
  assert.equal(organizationStoragePathPolicy(row).decisionRequired, false);
});

test("explicit valid root is normalized but never presented as verified storage", (t) => {
  const db = database(t);
  db.exec(generatedSql(["--dropbox-root=projects/explicit-qa/"]));
  const row = organization(db);
  assert.equal(row.dropbox_root_path, "/projects/explicit-qa");
  assert.equal(row.storage_status, "PENDING");
  assert.equal(row.storage_checked_at, null);
  assert.equal(readOrganizationStorageReadiness(row).ready, false);
  assert.equal(readOrganizationStorageReadiness(row).reason, "STORAGE_PATH_DECISION_REQUIRED");
});

test("new QA slug cannot take another organization's unique storage root or membership", (t) => {
  const db = database(t);
  db.exec(`INSERT INTO organizations (name, slug, dropbox_root_path, storage_status)
    VALUES ('Existing organization', 'existing', '/projects/maono-preview-qa', 'READY');
    INSERT INTO organization_users (organization_id, user_id, access_level) VALUES (1, 1, 'viewer');`);
  const before = organization(db, "existing");
  assert.throws(() => db.exec(generatedSql()), /UNIQUE constraint failed: organizations.dropbox_root_path/);
  db.exec("ROLLBACK");
  assert.equal(organization(db), undefined);
  assert.deepEqual(organization(db, "existing"), before);
  assert.equal(db.prepare("SELECT access_level FROM organization_users").get().access_level, "viewer");
  assert.equal(db.prepare("SELECT count(*) AS count FROM organization_users").get().count, 1);
});

for (const state of [
  { status: "READY", root: "/Apps/MaonoKepler/preview/qa", active: 1, error: null },
  { status: "READY", root: "/projects/verified-qa", active: 1, error: null },
  { status: "PENDING", root: "/projects/pending-qa", active: 1, error: "claim-evidence" },
  { status: "ERROR", root: "/projects/error-qa", active: 1, error: "provider-evidence" },
  { status: "DISABLED", root: "/projects/disabled-qa", active: 0, error: "retained-evidence" },
]) {
  test(`rerun preserves the entire existing ${state.status} organization at ${state.root}`, (t) => {
    const db = database(t);
    db.prepare(`INSERT INTO organizations
      (name, slug, dropbox_root_path, description, active, storage_status, storage_error, storage_checked_at, created_at, updated_at)
      VALUES ('Existing QA', 'maono-preview-qa', ?, 'Retain metadata', ?, ?, ?, '2026-09-06T12:00:00Z', '2026-09-01T12:00:00Z', '2026-09-06T12:00:00Z')`)
      .run(state.root, state.active, state.status, state.error);
    db.exec(`INSERT INTO organizations (name, slug, dropbox_root_path, storage_status)
      VALUES ('Other organization', 'other', '/projects/maono-preview-qa', 'READY');
      INSERT INTO organization_users (organization_id, user_id, access_level)
      VALUES (1, 1, 'viewer'), (2, 1, 'viewer');`);
    const before = db.prepare("SELECT * FROM organizations ORDER BY id").all();
    const sql = generatedSql();
    db.exec(sql);
    db.exec(sql);
    assert.deepEqual(db.prepare("SELECT * FROM organizations ORDER BY id").all(), before);
    assert.deepEqual(db.prepare("SELECT organization_id, access_level FROM organization_users ORDER BY organization_id").all().map((row) => ({ ...row })), [
      { organization_id: 1, access_level: "owner" },
      { organization_id: 2, access_level: "viewer" },
    ]);
  });
}

for (const root of ["", "/Apps/MaonoKepler/preview/qa", "/projects", "/projects/../other", "/projects/./qa", "/projects//qa", "/projects/qa\\other", "/projects/qa\u0001other"]) {
  test(`invalid explicit root ${JSON.stringify(root)} fails before generating SQL`, () => {
    const result = generate([`--dropbox-root=${root}`]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /--dropbox-root/);
  });
}

for (const slug of ["", "../other", "QA", "qa/name", "qa_name", "-qa", "qa-", "qa--name"]) {
  test(`invalid QA slug ${JSON.stringify(slug)} fails before generating SQL`, () => {
    const result = generate([`--org-slug=${slug}`]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /--org-slug/);
  });
}
