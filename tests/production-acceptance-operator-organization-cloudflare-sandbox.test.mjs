import assert from 'node:assert/strict';
import test from 'node:test';
import { account, cloudflareSandbox, fixtures, rehearse } from '../scripts/acceptance/organization-cloudflare-sandbox.mjs';

const sha = 'a'.repeat(40);
function sandbox() {
  const live = fixtures.map(f => f.a);
  const posts = [];
  const events = [];
  const overrides = new Map();
  let failAfterSelect;
  let badMarker;
  const fake = async (url, options) => {
    const { hostname, pathname } = new URL(url);
    assert.equal(options.redirect, 'error');
    if (hostname !== 'api.cloudflare.com') {
      assert.equal(options.headers?.Authorization, undefined);
      const index = fixtures.findIndex(f => hostname.startsWith(f.name + '.'));
      assert.ok(index >= 0);
      const marker = live[index] === fixtures[index].a ? 'B1-A' : 'B1-B';
      if (marker === 'B1-B' && index === badMarker) return new Response('bad');
      return new Response(index === 0 ? '<title>' + marker + '</title><p>' + marker + '</p>' : marker);
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    const ok = result => Response.json({ success: true, result });
    if (pathname === '/client/v4/zones') {
      assert.equal(new URL(url).searchParams.get('account.id'), account);
      return ok(overrides.get(pathname) || []);
    }
    const base = '/client/v4/accounts/' + account;
    assert.ok(pathname.startsWith(base + '/'));
    if (pathname === base + '/workers/domains') return ok(overrides.get(pathname) || []);
    const index = fixtures.findIndex(f => pathname.includes('/' + f.name));
    assert.ok(index >= 0);
    const f = fixtures[index];
    const tail = pathname.split(f.name)[1];
    const makePages = id => ({ id, project_id: 'project', project_name: f.name, environment: 'production',
      latest_stage: { name: 'deploy', status: 'success' }, is_skipped: false, uses_functions: false,
      url: 'https://' + id.slice(0,8) + '.' + f.name + '.pages.dev', env_vars: {}, build_config: {} });
    if (options.method === 'POST') {
      const id = f.type === 'pages' ? tail.split('/')[2] : JSON.parse(options.body).versions[0].version_id;
      assert.ok([f.a, f.b].includes(id));
      assert.equal(tail, f.type === 'pages' ? '/deployments/' + id + '/rollback' : '/deployments');
      if (f.type === 'worker') assert.deepEqual(JSON.parse(options.body),
        { strategy: 'percentage', versions: [{ version_id: id, percentage: 100 }] });
      posts.push([index, id]);
      live[index] = id;
      if (index === failAfterSelect && id === f.b) throw Error('indeterminate post');
      return ok({ id });
    }
    assert.equal(options.method,'GET');
    if (overrides.has(pathname)) return ok(overrides.get(pathname));
    if (tail === '') return ok({ id: 'project', name: f.name, subdomain: f.name + '.pages.dev', production_branch: 'main',
      deployment_configs: { production: { env_vars: {} } }, canonical_deployment: makePages(live[index]) });
    if (tail === '/domains') return ok([]);
    if (tail === '/subdomain') return ok({ enabled: true });
    if (tail === '/schedules') return ok({ schedules: [] });
    if (tail === '/deployments') return ok({ deployments: [{ strategy: 'percentage',
      versions: [{ version_id: live[index], percentage: 100 }] }] });
    const id = tail.split('/')[2];
    assert.ok([f.a, f.b].includes(id));
    if (tail.startsWith('/deployments/')) return ok(makePages(id));
    assert.equal(tail,'/versions/' + id);
    return ok({ id, resources: { bindings: [], script: { handlers: ['fetch'], etag: id },
      script_runtime: { compatibility_date: '2026-11-26' } } });
  };
  const invoke = (mode, expectedDigest, commit = sha) => rehearse({ mode, sha: commit, expectedDigest,
    transport: cloudflareSandbox('fixture', fake), record: async e => { events.push(e); }, pause: async () => {} });
  return { live, posts, events, overrides, invoke, loseReply: i => { failAfterSelect = i; }, wrongMarker: i => { badMarker = i; } };
}

test('protected preflight reads A, then the same SHA/configuration exercises all three B and restores A', async () => {
  const s = sandbox();
  const digest = await s.invoke('preflight');
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(s.posts.length, 0);
  await s.invoke('run', digest);
  assert.deepEqual(s.live, fixtures.map(f => f.a));
  assert.equal(s.posts.length, 6);
  for (const phase of ['staged','final']) assert.ok(s.events.find(e => e.phase === phase).observations.every(o => o.ok));
  await s.invoke('closure', digest);
  assert.equal(s.posts.length, 6);
});

test('refuses drift, wrong commit or a missing digest before writes', async () => {
  const s = sandbox();
  const digest = await s.invoke('preflight');
  await assert.rejects(s.invoke('run',digest,'c'.repeat(40)), /UNAPPROVED_DIGEST/);
  await assert.rejects(s.invoke('run',undefined), /UNAPPROVED_DIGEST/);
  s.live[2] = 'other-version';
  await assert.rejects(s.invoke('run',digest), /WORKER_TRAFFIC/);
  assert.equal(s.posts.length, 0);
});

test('an uncertain staging write and a broken B response both trigger reconciliation from the live states', async () => {
  for (const setup of ['loseReply','wrongMarker']) {
    const s = sandbox();
    const digest = await s.invoke('preflight');
    s[setup](1);
    await assert.rejects(s.invoke('run',digest));
    assert.deepEqual(s.live, fixtures.map(f => f.a));
    assert.equal(s.posts.length, 4);
    assert.ok(s.events.some(e => e.phase === 'final'));
  }
});

test('foreign binding, custom domain, and split traffic each block the whole window', async () => {
  const f = fixtures[1];
  const base = '/client/v4/accounts/' + account;
  for (const [route, bad] of [
    ['/workers/domains', [{service: f.name}]],
    ['/workers/scripts/' + f.name + '/deployments', { deployments: [{ strategy:'percentage', versions: [
      { version_id: f.a, percentage: 99 }, { version_id: f.b, percentage: 1 }] }] }],
    ['/workers/scripts/' + f.name + '/versions/' + f.b, { id:f.b, resources: { bindings: [{type:'d1'}] } }],
  ]) {
    const s = sandbox();
    s.overrides.set(base + route, bad);
    await assert.rejects(s.invoke('preflight'), /B1_/);
    assert.equal(s.posts.length,0);
  }
});

test('provider adapter rejects caller-selected accounts, arbitrary targets and unrelated versions', async () => {
  const adapter = cloudflareSandbox('fixture', () => assert.fail('unexpected network'));
  await assert.rejects(adapter.select({ ...fixtures[0], name:'other' }, fixtures[0].b), /B1_TARGET/);
  await assert.rejects(adapter.select(fixtures[0], fixtures[1].b), /B1_TARGET/);
});

test('standalone closure recovers a mixed A/B state, including a broken public B marker', async () => {
  const s = sandbox();
  const digest = await s.invoke('preflight');
  s.live[2] = fixtures[2].b;
  s.wrongMarker(2);
  await s.invoke('closure', digest);
  assert.deepEqual(s.posts, [[2, fixtures[2].a]]);
  assert.deepEqual(s.live, fixtures.map(f => f.a));
});

test('changed effective configuration on the same versions invalidates a previously observed baseline', async () => {
  const s = sandbox();
  const digest = await s.invoke('preflight');
  s.overrides.set('/client/v4/accounts/' + account + '/workers/scripts/' + fixtures[1].name + '/subdomain',
    { enabled: true, previews_enabled: true });
  await assert.rejects(s.invoke('run', digest), /UNAPPROVED_DIGEST/);
  assert.equal(s.posts.length,0);
});
