import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { getAuthorizedProject, listProjectsForUser } from "../functions/_lib/projects.js";
import { can } from "../functions/_lib/permissions.js";
import { decideProjectGeoJsonAccess, filterVisibleOrganizationFiles } from "../functions/_lib/geojson-access.js";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  // Legacy optional permission tables are queried by the real permission engine.
  db.exec(`CREATE TABLE user_permissions (id INTEGER PRIMARY KEY, user_id INTEGER,
    permission TEXT, organization_id INTEGER, project_id INTEGER, expires_at TEXT, active INTEGER);
    CREATE TABLE role_permissions (role TEXT, permission TEXT, scope_type TEXT, active INTEGER);`);
  db.exec(`INSERT INTO users (id,email,password_hash,role) VALUES (1,'fixture@example.invalid','unused','viewer');
    INSERT INTO organizations (id,name,slug,dropbox_root_path) VALUES
      (1,'A','a','/projects/a'),(2,'B','b','/projects/b');
    INSERT INTO projects (id,name,slug,organization_id,dropbox_root_path,lifecycle_state) VALUES
      (1,'A','a',1,'/projects/a/a','ACTIVE'),(2,'B','b',2,'/projects/b/b','ACTIVE');
    INSERT INTO organization_users (organization_id,user_id,access_level) VALUES (1,1,'viewer'),(2,1,'viewer');
    INSERT INTO user_projects (project_id,user_id,access_level) VALUES (1,1,'viewer'),(2,1,'viewer');`);
  t.after(() => db.close());
  const env = { DB: { prepare(sql) {
    let args=[];
    return {
      bind(...values) { args=values;return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return db.prepare(sql).run(...args); },
    };
  } } };
  return { db, env, user: { id:1, role:"viewer", activeOrganizationId:1 } };
}

test("project lookup follows active workspace even when the user belongs to both organizations", async (t) => {
  const { env, user }=fixture(t);
  for (const organizationId of [1,2,1]) {
    const context={...user,activeOrganizationId:organizationId};
    assert.deepEqual((await listProjectsForUser(env,context)).map(p=>p.id),[organizationId]);
    assert.equal((await getAuthorizedProject(env,context,organizationId===1?'a':'b')).id,organizationId);
    assert.equal(await getAuthorizedProject(env,context,organizationId===1?'b':'a'),null);
  }
});

test("revoked organization membership and inactive organizations hide existing project links", async (t) => {
  const { env, user, db }=fixture(t);
  db.exec("DELETE FROM organization_users WHERE organization_id=1");
  assert.equal(await getAuthorizedProject(env,user,'a'),null);
  assert.deepEqual(await listProjectsForUser(env,user),[]);
  db.exec("UPDATE organizations SET active=0 WHERE id=1");
  assert.equal(await getAuthorizedProject(env,{...user,role:'super_admin'},'a'),null);
});

test("document access and project membership do not imply GeoJSON permission", async (t) => {
  const { env,user,db }=fixture(t);
  const decision=await decideProjectGeoJsonAccess(env,user,1,1);
  assert.equal(decision.allowed,false);
  const rows=[{id:1,project_id:1,name:'secret.geojson'},{id:2,name:'manual.pdf'}];
  assert.deepEqual((await filterVisibleOrganizationFiles(env,null,user,1,rows)).map(f=>f.id),[2]);
  assert.equal((await decideProjectGeoJsonAccess(env,{...user,role:'super_admin'},1,2)).allowed,false);
  db.exec("INSERT INTO user_permissions (user_id,permission,organization_id,active) VALUES (1,'organization.projects.geojson.view',1,1)");
  assert.equal((await decideProjectGeoJsonAccess(env,user,1,1)).allowed,true);
  assert.equal((await decideProjectGeoJsonAccess(env,user,2,2)).allowed,false);
  db.exec("UPDATE user_permissions SET active=0");
  assert.equal((await decideProjectGeoJsonAccess(env,user,1,1)).allowed,false);
});

test("viewer save and cross-workspace permissions remain denied", async (t) => {
  const { env,user }=fixture(t);
  assert.equal((await can(env,user,'project.save',{projectId:1,organizationId:1})).allowed,false);
  assert.equal((await can(env,{...user,role:'owner'},'project.create',{organizationId:2})).allowed,false);
});
