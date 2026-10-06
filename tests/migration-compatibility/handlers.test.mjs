import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { persistenceFixture } from '../helpers/project-persistence-fixture.mjs';
import { createSession, sha256Hex } from '../../functions/_lib/auth.js';
import { onRequest as projects } from '../../functions/api/projects/index.js';
import { onRequest as configHandler } from '../../functions/api/projects/[slug]/config.js';
import { onRequest as middleware } from '../../functions/api/projects/[slug]/_middleware.js';
import { onRequest as thumbnail } from '../../functions/api/projects/[slug]/thumbnail/index.js';
import { onRequest as adminUser } from '../../functions/api/admin/users/[id].js';
import { onRequest as adminOrganization } from '../../functions/api/admin/organizations/[id].js';
import { onRequest as adminProject } from '../../functions/api/admin/projects/[id].js';
import { assertSaveDeployCompatibility } from '../../functions/_lib/save-deploy-contract.js';
import { can } from '../../functions/_lib/permissions.js';
import { beginClientSaveAttempt, serializeSaveRequest, buildSaveRequestHeaders } from '../../src/pages/Kepler/save-observability.ts';
import { prepareProjectCreateTransport } from '../../src/pages/Kepler/project-create-transport.ts';
import { migrationStage, assertCompatibilityInvariants } from './migrations.mjs';
const golden = JSON.parse(readFileSync(new URL('../fixtures/maps/golden/map-point-basic.kepler.json', import.meta.url)));
const map = value => ({
  ...structuredClone(golden),
  compatValue: value
});
const large = value => ({
  ...map(value),
  padding: 'x'.repeat(8 * 1024 * 1024 + 513),
  unicode: 'Maõno 🗺️'
});
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6D7QAAAAASUVORK5CYII=', 'base64'));
async function setup(t, hooks = {}) {
  const f = persistenceFixture(t, hooks);
  // D1 batch executes the unchanged old admin handler SQL in a real SQLite transaction.
  f.env.DB.batch = async statements => {
    f.db.exec('BEGIN');
    try {
      const out = [];
      for (const stmt of statements) out.push(await stmt.run());
      f.db.exec('COMMIT');
      return out;
    } catch (e) {
      f.db.exec('ROLLBACK');
      throw e;
    }
  };
  f.cookie = async (id, org = 1) => {
    const s = await createSession(f.env, id);
    f.db.prepare('UPDATE sessions SET active_organization_id=? WHERE token_hash=?').run(org, await sha256Hex(s.token));
    return `maono_session=${s.token}`;
  };
  f.owner = await f.cookie(1);
  f.other = await f.cookie(2, 2);
  f.request = (path, method = 'GET', body, headers = {}, cookie = f.owner) => new Request(`https://offline.invalid${path}`, {
    method,
    headers: {
      ...(cookie ? {
        Cookie: cookie
      } : {}),
      ...headers
    },
    ...(body === undefined ? {} : {
      body,
      duplex: 'half'
    })
  });
  f.context = (request, slug = f.project()?.slug) => ({
    env: f.env,
    params: {
      slug
    },
    request
  });
  f.call = async (method = 'GET', body, headers = {}, cookie = f.owner, slug = f.project()?.slug) => {
    const context = f.context(f.request(`/api/projects/${slug}/config`, method, body, headers, cookie), slug);
    return middleware({
      ...context,
      next: () => configHandler(context)
    });
  };
  f.create = async (value = 'one', key = 'compat-create-inline-0001') => {
    const transport = prepareProjectCreateTransport(beginClientSaveAttempt('create'), {
      name: 'Compat map',
      description: 'Synthetic fixture',
      organizationId: 1,
      idempotencyKey: key,
      config: map(value),
      legacy: null
    });
    return projects({
      env: f.env,
      request: f.request('/api/projects', 'POST', transport.requestBody, {
        'Content-Type': 'application/json',
        'X-Maono-Client-Contract': '1'
      })
    });
  };
  f.save = async (value, revision = f.project().config_revision, options = {}) => f.call('PUT', JSON.stringify({
    config: map(value),
    expectedConfigRevision: revision,
    ...options
  }), {
    'Content-Type': 'application/json',
    'X-Maono-Client-Contract': '1'
  });
  f.image = async (method = 'GET', rev = f.project().config_revision, body, cookie = f.owner) => thumbnail(f.context(f.request(`/api/projects/${f.project().slug}/thumbnail?${method === 'GET' ? 'v' : 'revision'}=${rev}`, method, body, method === 'PUT' ? {
    'Content-Type': 'image/png'
  } : {}, cookie)));
  f.stream = async (value, operation = 'update', transport = null) => {
    const attempt = beginClientSaveAttempt(operation);
    const serialized = transport?.configTransport || serializeSaveRequest(attempt, {
      config: large(value),
      expectedConfigRevision: f.project().config_revision
    });
    const headers = transport ? buildSaveRequestHeaders(transport.attempt || attempt) : buildSaveRequestHeaders(attempt);
    if (transport) Object.assign(headers, transport.configHeaders || {});
    const req = f.request(`/api/projects/${f.project().slug}/config`, 'PUT', serialized.body, headers);
    req.json = () => {
      throw Error('stream cannot use request.json');
    };
    req.text = () => {
      throw Error('stream cannot use request.text');
    };
    return middleware({
      ...f.context(req),
      next: () => {
        throw Error('expected streaming middleware');
      }
    });
  };
  return f;
}
async function ok(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(body.ok, true);
  return body;
}
async function code(response, status, expected) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(body.error.code, expected);
  return body;
}
async function assertRead(f, value) {
  const result = await ok(await f.call());
  assert.deepEqual(result.config, value);
}
test(`stage ${migrationStage}: actual old inline create/update/retry, schema19, JSON/PNG and project hard-delete`, async t => {
  const f = await setup(t);
  const created = await ok(await f.create(), 201);
  assert.equal(created.configRevision, 1);
  assert.equal(created.deploy.dbSchema, 19);
  const retried = await ok(await f.create(), 200);
  assert.equal(retried.project.id, created.project.id);
  await ok(await f.save('two'));
  assert.equal(f.project().config_revision, 2);
  await assertRead(f, map('two'));
  await code(await f.save('stale', 1), 409, 'PROJECT_CONFIG_REVISION_CONFLICT');
  await assertRead(f, map('two'));
  await ok(await f.save('two', 1));
  assert.equal(f.project().config_revision, 2);
  const image = await ok(await f.image('PUT', 2, png));
  assert.equal(image.status, 'READY');
  const imageRead = await f.image('GET', 2);
  assert.equal(imageRead.status, 200);
  assert.equal(imageRead.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(new Uint8Array(await imageRead.arrayBuffer()), png);
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  await code(await adminProject({
    env: f.env,
    params: {
      id: '1'
    },
    request: f.request('/api/admin/projects/1?deactivate=true', 'DELETE')
  }), 409, 'PROJECT_LIFECYCLE_DEACTIVATION_UNSUPPORTED');
  await ok(await adminProject({
    env: f.env,
    params: {
      id: '1'
    },
    request: f.request('/api/admin/projects/1', 'DELETE')
  }));
  assert.equal(f.project(), undefined);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM project_config_revisions').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_projects').get().n, 0);
  await code(await f.call('GET', undefined, {}, f.owner, created.project.slug), 404, 'PROJECT_NOT_FOUND');
});
test(`stage ${migrationStage}: actual old large update middleware preserves JSON content`, async t => {
  const f = await setup(t);
  await ok(await f.create(), 201);
  await ok(await f.stream('large-update'));
  await assertRead(f, large('large-update'));
  assert.equal(f.project().config_revision, 2);
  assert.ok(f.calls.some(c => c.op === 'upload_session/finish'));
});
test(`stage ${migrationStage}: actual old metadata-first create and streaming finalization`, async t => {
  const f = await setup(t);
  const attempt = beginClientSaveAttempt('create');
  const tr = prepareProjectCreateTransport(attempt, {
    name: 'Compat large',
    description: '',
    organizationId: 1,
    idempotencyKey: 'compat-create-large-0001',
    config: large('large-create'),
    legacy: null
  });
  const reserved = await ok(await projects({
    env: f.env,
    request: f.request('/api/projects', 'POST', tr.requestBody, buildSaveRequestHeaders(attempt))
  }), 202);
  assert.equal(reserved.creation.transport, 'stream');
  assert.equal(f.project().active, 0);
  const headers = {
    ...buildSaveRequestHeaders(attempt),
    'X-Maono-Creation-Key': 'compat-create-large-0001'
  };
  const req = f.request(`/api/projects/${f.project().slug}/config`, 'PUT', tr.configTransport.body, headers);
  req.json = () => {
    throw Error('stream cannot use request.json');
  };
  req.text = () => {
    throw Error('stream cannot use request.text');
  };
  await ok(await middleware({
    ...f.context(req),
    next: () => {
      throw Error('expected streaming middleware');
    }
  }), 201);
  assert.equal(f.project().active, 1);
  assert.equal(f.project().config_revision, 1);
  await assertRead(f, large('large-create'));
});
test(`stage ${migrationStage}: actual old legacy overwrite, canonical PNG and streamed promotion`, async t => {
  const f = await setup(t);
  f.db.exec("INSERT INTO projects(id,name,slug,organization_id,dropbox_root_path,lifecycle_state) VALUES(1,'Legacy','legacy',1,'/offline/a/legacy',NULL);INSERT INTO user_projects(user_id,project_id,access_level) VALUES(1,1,'owner');");
  await f.store('/offline/a/legacy/config.kepler.json', new TextEncoder().encode(JSON.stringify(map('legacy'))));
  await f.store('/offline/a/legacy/config.kepler.png', png);
  await assertRead(f, map('legacy'));
  const image = await f.image('GET', 0);
  assert.equal(image.status, 200, await image.clone().text());
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
  await ok(await f.save('legacy-edited', 0));
  assert.equal(f.project().lifecycle_state, null);
  await assertRead(f, map('legacy-edited'));
  const saved = await ok(await f.stream('promoted'));
  assert.equal(saved.promotedFromLegacy, true);
  assert.equal(f.project().lifecycle_state, 'ACTIVE');
  await assertRead(f, large('promoted'));
});
test(`stage ${migrationStage}: real sessions/ACL deny anonymous, cross-tenant, viewer, explicit denial and revoked membership before storage`, async t => {
  const f = await setup(t);
  await ok(await f.create(), 201);
  let count = f.calls.length;
  await code(await f.call('GET', undefined, {}, ''), 401, 'UNAUTHORIZED');
  await code(await f.call('GET', undefined, {}, f.other), 404, 'PROJECT_NOT_FOUND');
  await code(await f.image('GET', 1, undefined, ''), 401, 'UNAUTHORIZED');
  await code(await f.image('GET', 1, undefined, f.other), 404, 'PROJECT_NOT_FOUND');
  assert.equal(f.calls.length, count);
  f.db.exec("INSERT INTO users(id,email,role,password_hash)VALUES(3,'viewer@offline.invalid','viewer','not-a-login');INSERT INTO organization_users(organization_id,user_id,access_level)VALUES(1,3,'viewer');INSERT INTO user_projects(user_id,project_id,access_level)VALUES(3,1,'viewer');");
  const viewer = await f.cookie(3);
  await ok(await f.call('GET', undefined, {}, viewer));
  count = f.calls.length;
  const denied = await f.call('PUT', JSON.stringify({
    config: map('viewer'),
    expectedConfigRevision: 1
  }), {
    'Content-Type': 'application/json'
  }, viewer);
  assert.equal(denied.status, 403);
  const deniedImage = await f.image('PUT', 1, png, viewer);
  assert.equal(deniedImage.status, 403);
  assert.equal(f.calls.length, count);
  assert.equal((await can(f.env, {
    id: 3,
    role: 'viewer',
    activeOrganizationId: 1
  }, 'project.save', {
    projectId: 1,
    organizationId: 1
  })).allowed, false);
  f.db.exec("INSERT INTO user_permission_denials(user_id,organization_id,permission,denied_by)VALUES(1,1,'project.save',1)");
  await code(await f.save('denied'), 403, 'FORBIDDEN');
  assert.equal(f.calls.length, count);
  assert.equal(f.project().config_revision, 1);
  f.db.exec("INSERT INTO user_permission_denials(user_id,organization_id,permission,denied_by)VALUES(1,1,'project.view',1)");
  await code(await f.call(), 403, 'FORBIDDEN');
  assert.equal((await f.image('GET', 1)).status, 403);
  assert.equal(f.calls.length, count);
  f.db.exec("DELETE FROM user_permission_denials WHERE user_id=1;DELETE FROM organization_users WHERE user_id=1");
  await code(await f.call(), 404, 'PROJECT_NOT_FOUND');
  assert.equal(f.calls.length, count);
});
test(`stage ${migrationStage}: old schema19 contract accepts legacy headers and rejects incompatible clients/schema`, async t => {
  const f = await setup(t);
  for (const headers of [{}, {
    'X-Maono-Client-Contract': '1'
  }]) assert.equal((await assertSaveDeployCompatibility(f.env, f.request('/api/projects', 'GET', undefined, headers))).actualDbSchema, 19);
  await assert.rejects(assertSaveDeployCompatibility(f.env, f.request('/api/projects', 'GET', undefined, {
    'X-Maono-Client-Contract': '2'
  })), {
    code: 'SAVE_CLIENT_CONTRACT_UNSUPPORTED'
  });
  f.db.exec('UPDATE app_schema_metadata SET schema_version=20 WHERE id=1');
  await assert.rejects(assertSaveDeployCompatibility(f.env, f.request('/api/projects')), {
    code: 'SAVE_DB_SCHEMA_MISMATCH'
  });
  f.db.exec('UPDATE app_schema_metadata SET schema_version=19 WHERE id=1');
});
test(`stage ${migrationStage}: old actor/organization deletion and optional ACL grant/revoke preserve empty journals`, async t => {
  const f = await setup(t);
  await ok(await f.create(), 201);
  if (migrationStage >= 39) {
    const generation = f.db.prepare('SELECT version FROM project_save_authorization_generation').get().version;
    f.db.exec("INSERT INTO role_permissions(role,permission,scope_type)VALUES('viewer','project.save','project');UPDATE role_permissions SET active=0;DELETE FROM role_permissions;INSERT INTO user_permissions(user_id,permission,organization_id,project_id)VALUES(2,'project.save',1,1);UPDATE user_permissions SET active=0;DELETE FROM user_permissions;");
    assert.ok(f.db.prepare('SELECT version FROM project_save_authorization_generation').get().version > generation);
  }
  f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
  await ok(await adminUser({
    env: f.env,
    params: {
      id: '2'
    },
    request: f.request('/api/admin/users/2', 'DELETE')
  }));
  assert.equal(f.db.prepare('SELECT * FROM users WHERE id=2').get(), undefined);
  await ok(await adminOrganization({
    env: f.env,
    params: {
      id: '2'
    },
    request: f.request('/api/admin/organizations/2', 'DELETE')
  }));
  assert.equal(f.db.prepare('SELECT active FROM organizations WHERE id=2').get().active, 0);
  await code(await adminOrganization({
    env: f.env,
    params: {
      id: '1'
    },
    request: f.request('/api/admin/organizations/1', 'DELETE')
  }), 409, 'ORGANIZATION_HAS_ACTIVE_PROJECTS');
  // The existing quota FK already retains creators; additive migrations must not change it.
  assert.throws(() => f.db.exec('DELETE FROM users WHERE id=1'), /FOREIGN KEY constraint failed/);
  assert.ok(f.project());
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM organization_resource_reservations').get().n, 1);
  // Physical deletion of an unreferenced organization exercises the new empty-journal trigger.
  f.db.exec('DELETE FROM organizations WHERE id=2');
  await ok(await adminProject({
    env: f.env,
    params: {
      id: '1'
    },
    request: f.request('/api/admin/projects/1', 'DELETE')
  }));
  await ok(await adminOrganization({
    env: f.env,
    params: {
      id: '1'
    },
    request: f.request('/api/admin/organizations/1', 'DELETE')
  }));
  assert.equal(f.db.prepare('SELECT active FROM organizations WHERE id=1').get().active, 0);
  assertCompatibilityInvariants(f.db);
});
test(`stage ${migrationStage}: populated product schema upgrades 0039 then 0040 preserve old rows, grants, JSON and PNG`, async t => {
  const f = await setup(t, {
    compatibilityStage: 0
  });
  await ok(await f.create(), 201);
  await ok(await f.image('PUT', 1, png));
  // Historical installs can already contain these optional grant tables. Preserve exact rows.
  f.db.exec(`CREATE TABLE user_permissions(id INTEGER PRIMARY KEY,user_id INTEGER,permission TEXT,organization_id INTEGER,project_id INTEGER,expires_at TEXT,active INTEGER);
 CREATE TABLE role_permissions(role TEXT,permission TEXT,scope_type TEXT,active INTEGER);
 INSERT INTO user_permissions VALUES(1,1,'project.save',1,1,NULL,1);
 INSERT INTO role_permissions VALUES('owner','project.view','project',1);`);
  const oldColumns = f.db.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
  const snapshot = () => JSON.stringify({
    project: f.db.prepare(`SELECT ${oldColumns.join(',')} FROM projects`).all(),
    revisions: f.db.prepare('SELECT id,project_id,revision,status,checksum,storage_ref FROM project_config_revisions').all(),
    grants: f.db.prepare('SELECT * FROM user_permissions').all(),
    roles: f.db.prepare('SELECT * FROM role_permissions').all(),
    schema: f.db.prepare('SELECT * FROM app_schema_metadata').all()
  });
  let revision = 1;
  for (const name of ['0039_project_save_operations.sql', '0040_project_preview_operations.sql']) {
    const before = snapshot();
    f.db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    assert.equal(snapshot(), before, `${name} preserves all populated legacy data`);
    await assertRead(f, map(revision === 1 ? 'one' : 'after-0039_project_save_operations.sql'));
    const image = await f.image('GET', revision);
    assert.equal(image.status, 200);
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
    await ok(await f.save(`after-${name}`));
    revision++;
    assert.equal(f.project().config_revision, revision);
    await assertRead(f, map(`after-${name}`));
    await ok(await f.image('PUT', revision, png));
  }
  assertCompatibilityInvariants(f.db, 40);
});
