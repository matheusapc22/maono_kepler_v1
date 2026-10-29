import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { restorePasswordManagement } from "./helpers/password-management-preservation.mjs";
import { restoreLintModuleExtraction } from "./helpers/lint-module-extraction-preservation.mjs";
import { hashPassword, verifyPassword, sha256Hex } from "../functions/_lib/auth.js";
import { onRequest as adminUser } from "../functions/api/admin/users/[id].js";
import { onRequest as adminUsers } from "../functions/api/admin/users/index.js";
import { onRequestPatch as organizationUser } from "../functions/api/organizations/[id]/users/[userId].js";
import { onRequest as login } from "../functions/api/auth/login.js";

for (const [path, before, after] of [
  ["functions/_lib/organizations.js", 'getActorRole(actor) !== "super_admin"', 'false'],
  ["functions/api/organizations/[id]/users/[userId].js", 'normalizeRole(user.role) !== "super_admin"', 'false'],
  ["src/pages/Admin/components/AdminUserManagerLegacy.tsx", 'if (!selected || !draft || busy || mutationPending.current) return;', 'if (!selected || !draft) return;'],
]) test(`preservation inverse rejects unreviewed password changes: ${path}`, () => {
  const source = restoreLintModuleExtraction(path, readFileSync(new URL("../" + path, import.meta.url), "utf8"));
  assert.notEqual(restorePasswordManagement(path, source), source);
  assert.ok(source.includes(before));
  assert.throws(() => restorePasswordManagement(path, source.replace(before, after)), /exact reviewed password edit/);
});

// Entirely synthetic in-memory SQLite, with D1 batch transaction semantics.
// Never log bind parameters, password hashes or session material.
const oldPassword = "synthetic-old-password";
const newPassword = "synthetic-new-password";
async function fixture(t, targetRole = "viewer") {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, role TEXT,
      active INTEGER DEFAULT 1, password_hash TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY, token_hash TEXT UNIQUE, user_id INTEGER,
      expires_at TEXT, active_organization_id INTEGER);
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, active INTEGER);
    CREATE TABLE organization_users (id INTEGER PRIMARY KEY, organization_id INTEGER, user_id INTEGER,
      access_level TEXT, active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE user_projects (id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER,
      action TEXT, details TEXT, created_at TEXT);
    INSERT INTO organizations VALUES (1, 'Synthetic organization', 'synthetic', 1), (2, 'Other', 'other', 1);
    INSERT INTO organization_users (organization_id, user_id, access_level) VALUES (1, 2, 'viewer');
  `);
  const originalHash = await hashPassword(oldPassword);
  const insert = db.prepare("INSERT INTO users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)");
  insert.run(1, "actor@example.test", "Synthetic actor", "super_admin", originalHash);
  insert.run(2, "target@example.test", "Synthetic target", targetRole, originalHash);
  const expires = new Date(Date.now() + 3600000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,active_organization_id) VALUES (?,1,?,1)")
    .run(await sha256Hex("synthetic-actor-session"), expires);
  db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ('synthetic-target-session',2,?)").run(expires);
  let beforeSessionInsert;
  const env = { DB: {
    prepare(sql) {
      let args = [];
      const execute = () => {
        if (/INSERT INTO sessions/.test(sql) && beforeSessionInsert) {
          const hook = beforeSessionInsert; beforeSessionInsert = null; hook();
        }
        const results = db.prepare(sql).all(...args).map(row => ({ ...row }));
        const meta = db.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get();
        return { success: true, results, meta: { ...meta } };
      };
      return {
        bind(...values) { args = values; return this; },
        async first() { return execute().results[0] ?? null; },
        async all() { return execute(); },
        async run() { return execute(); }, execute,
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try { const results = statements.map(statement => statement.execute()); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } };
  const request = (payload, method = "PATCH") => new Request("https://synthetic.invalid/api/admin/users/2", {
    method, headers: { "Content-Type": "application/json", Cookie: "maono_session=synthetic-actor-session" }, body: JSON.stringify(payload),
  });
  return {
    db, env, originalHash,
    hash: (id = 2) => db.prepare("SELECT password_hash FROM users WHERE id=?").get(id)?.password_hash,
    sessions: (id = 2) => db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id=?").get(id).n,
    admin: (payload, id = "2") => adminUser({ env, request: request(payload), params: { id } }),
    create: payload => adminUsers({ env, request: request(payload, "POST") }),
    org: (payload, id = "1", userId = "2") => organizationUser({ env, request: request(payload), params: { id, userId } }),
    login: password => login({ env, request: request({ email: "target@example.test", password }, "POST") }),
    race: hook => { beforeSessionInsert = hook; },
  };
}

test("hash uses independent salts and verifies exact spaces and Unicode", async () => {
  const value = "  synthetic-ação-🔑  ";
  const a = await hashPassword(value), b = await hashPassword(value);
  assert.equal(a !== b, true);
  assert.equal(await verifyPassword(value, a), true);
  assert.equal(await verifyPassword(value.trim(), a), false);
  assert.equal(await verifyPassword("wrong-value", a), false);
});

test("global password update atomically persists, audits and revokes only target sessions", async t => {
  const f = await fixture(t);
  const response = await f.admin({ password: newPassword });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.passwordChanged, true); assert.equal(result.sessionsInvalidated, true);
  assert.equal(f.sessions(), 0); assert.equal(f.sessions(1), 1);
  assert.equal(await verifyPassword(newPassword, f.hash()), true);
  assert.equal(await verifyPassword(oldPassword, f.hash()), false);
  assert.equal(JSON.stringify(result).includes(newPassword), false);
  assert.equal(JSON.stringify(result).includes(f.hash()), false);
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit_logs WHERE action='admin.users.update'").get().n, 1);
  assert.equal((await f.login(oldPassword)).status, 401);
  assert.equal((await f.login(newPassword)).status, 200);
});

for (const role of ["super_admin", "owner", "client", "viewer"]) test(`unchanged ${role} permits a password update without assigning a role`, async t => {
  const f = await fixture(t, role);
  assert.equal((await f.admin({ password: newPassword, role })).status, 200);
});

test("blank/omitted update password preserves sessions and reports no password change", async t => {
  const f = await fixture(t);
  for (const body of [{ name: "Edited" }, { password: "" }]) {
    const result = await (await f.admin(body)).json();
    assert.equal(result.passwordChanged, false); assert.equal(result.sessionsInvalidated, false);
    assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
  }
});

for (const invalid of ["short", 12345678, {}, [], null]) test(`invalid password type ${typeof invalid} is rejected before any write`, async t => {
  const f = await fixture(t);
  assert.equal((await f.admin({ password: invalid })).status, 400);
  assert.equal((await f.org({ password: invalid })).status, 400);
  assert.equal((await f.create({ name: "New", email: "new@example.test", role: "viewer", password: invalid })).status, 400);
  assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
});

for (const failedStep of ["revocation", "audit"]) test(`global ${failedStep} failure rolls back password and sessions`, async t => {
  const f = await fixture(t);
  f.db.exec(failedStep === "audit"
    ? "CREATE TRIGGER injected_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"
    : "CREATE TRIGGER injected_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.equal((await f.admin({ password: newPassword })).status, 500);
  assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
});

test("creation is atomic with audit, rejects duplicate email, and does not expose hash", async t => {
  const f = await fixture(t);
  const body = { email: "new@example.test", name: "New synthetic user", role: "viewer", password: newPassword };
  f.db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.equal((await f.create(body)).status, 500);
  assert.equal(f.db.prepare("SELECT count(*) n FROM users WHERE email='new@example.test'").get().n, 0);
  f.db.exec("DROP TRIGGER injected_failure");
  const response = await f.create(body); assert.equal(response.status, 201);
  assert.equal(JSON.stringify(await response.json()).includes(newPassword), false);
  assert.equal((await f.create(body)).status, 409);
});

test("password-only organization update validates membership and organization first", async t => {
  const f = await fixture(t);
  assert.equal((await f.org({ password: newPassword }, "2")).status, 404);
  assert.equal((await f.org({ password: newPassword }, "1", "999")).status, 404);
  f.db.exec("UPDATE organizations SET active=0 WHERE id=1");
  assert.equal((await f.org({ password: newPassword })).status, 404);
  assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
});

for (const patch of [{ name: "" }, { active: "invalid" }, { role: "invalid" }, { accessLevel: "invalid" }]) test(`mixed organization patch validates ${Object.keys(patch)[0]} before changing password`, async t => {
  const f = await fixture(t);
  assert.equal((await f.org({ password: newPassword, ...patch })).status, 400);
  assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
});

test("last-owner protection also rolls back password", async t => {
  const f = await fixture(t, "owner");
  f.db.exec("UPDATE organization_users SET access_level='owner'");
  assert.equal((await f.org({ password: newPassword, active: false })).status, 409);
  assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
});

for (const failedStep of ["membership", "revocation", "audit"]) test(`organization ${failedStep} failure cannot partially change password/profile`, async t => {
  const f = await fixture(t);
  const clause = { membership: "UPDATE ON organization_users", revocation: "DELETE ON sessions", audit: "INSERT ON audit_logs" }[failedStep];
  f.db.exec(`CREATE TRIGGER injected_failure BEFORE ${clause} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
  // Existing API logs infrastructure errors; suppress only this injected error.
  t.mock.method(console, "error", () => {});
  assert.equal((await f.org({ password: newPassword, name: "Changed", accessLevel: "editor" })).status, 500);
  assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
  assert.equal(f.db.prepare("SELECT name FROM users WHERE id=2").get().name, "Synthetic target");
});

test("organization update commits password, metadata, membership and revocation together", async t => {
  const f = await fixture(t);
  const response = await f.org({ password: newPassword, name: "Changed", accessLevel: "editor" });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.passwordChanged, true); assert.equal(result.sessionsInvalidated, true);
  assert.equal(result.user.name, "Changed"); assert.equal(result.user.accessLevel, "editor");
  assert.equal(await verifyPassword(newPassword, f.hash()), true); assert.equal(f.sessions(), 0);
  assert.equal(JSON.stringify(result).includes(f.hash()), false);
});

test("permissions remain enforced and a role promotion cannot be disguised as a reset", async t => {
  const f = await fixture(t);
  assert.equal((await f.admin({ role: "super_admin", password: newPassword })).status, 400);
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1");
  assert.equal((await f.admin({ password: newPassword })).status, 403);
  assert.equal((await f.org({ password: newPassword })).status, 403);
  assert.equal(f.hash() === f.originalHash, true); assert.equal(f.sessions(), 1);
});

test("login verified before a concurrent reset cannot recreate an old-password session", async t => {
  const f = await fixture(t);
  const nextHash = await hashPassword(newPassword);
  f.race(() => {
    f.db.prepare("UPDATE users SET password_hash=? WHERE id=2").run(nextHash);
    f.db.exec("DELETE FROM sessions WHERE user_id=2");
  });
  const response = await f.login(oldPassword);
  assert.equal(response.status, 401); assert.equal(response.headers.has("Set-Cookie"), false);
  assert.equal(f.sessions(), 0);
});

test("guarded login preserves the existing normalization of stored legacy hashes", async t => {
  const f = await fixture(t);
  f.db.prepare("UPDATE users SET password_hash=? WHERE id=2").run(`  ${f.originalHash}  `);
  assert.equal((await f.login(oldPassword)).status, 200);
});
