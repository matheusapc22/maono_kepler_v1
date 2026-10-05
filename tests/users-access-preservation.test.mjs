import { isRegionAccessDenied, isRegionAuthenticationError } from "../src/components/loading/region-loading-policy.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { listOrganizationUsers } from '../functions/_lib/organizations.js';
import { createStorageSqliteEnv } from './helpers/storage-sqlite.mjs';
import { assertUsersAccessPreserved, canonical, declaration, digest, nodes, parse, preservedHelpers, preservedValues, usersAccessBaseline } from './helpers/users-access-preservation.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read(usersAccessBaseline.path);
const ast = parse(source);
const compile = contents => ts.transpileModule(contents, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const importTs = async path => import(`data:text/javascript;base64,${Buffer.from(compile(read(path))).toString('base64')}`);
const { profileFromTechnical, accessFromCode } = await importTs('src/pages/Projects/components/user-access-commercial.ts');
const { paginateUsers, reconcileUsersPagination, USERS_PAGE_SIZES } = await importTs('src/pages/Projects/components/users-access-pagination.ts');

function modelFor(inputSource) {
  const root = parse(inputSource);
  const helperCode = preservedHelpers.map(name => declaration(root, name, true).getText()).join('\n');
  const names = preservedValues.filter(name => !['manageMap', 'manageAdditional'].includes(name));
  const values = names.map(name => `const ${declaration(root, name).getText()};`).join('\n');
  const build = new Function('profileFromTechnical', 'accessFromCode', compile(`
    ${helperCode}
    return function ({ user = null, organizationIdProp, people = [], limits = null, governance = null, query = '', status = 'all', profileFilter = 'all' } = {}) {
      const useCallback = value => value, useMemo = value => value();
      ${values}
      return { ${[...preservedHelpers, ...names].join(', ')} };
    };
  `));
  return build(profileFromTechnical, accessFromCode);
}
const currentModel = modelFor(source);
const baselineModel = modelFor(usersAccessBaseline.source);

// The frozen source is from git show 158e2b3, not the redesigned worktree.
test('redesigned overview preserves independently pinned helpers, gates, filters, metrics and manager wiring', () => {
  assertUsersAccessPreserved(source);
});
for (const [path, expected] of Object.entries(usersAccessBaseline.unchangedFiles)) {
  test(`domain source is unchanged from 158e2b3: ${path}`, () => {
    let value=read(path);
    if(path === "src/lib/api.ts") {
      const marker="export function listOrganizationFiles(";
      assert.equal(value.split(marker).length,2);
      assert.doesNotMatch(value,/export function saveProjectConfig/);
      const removed=`/** Mantido por compatibilidade com chamadas existentes. */\nexport function saveProjectConfig(projectSlug: string, config: unknown) {\n  return requestJson<{ ok: boolean; saved: boolean }>(\n    \`/api/projects/\${pathSegment(projectSlug)}/save\`,\n    {\n      method: "POST",\n      body: JSON.stringify({ config }),\n    },\n  );\n}\n\n`;
      value=value.replace(marker,removed+marker);
    }
    assert.equal(digest(value),expected);
  });
}
test('the contract catches mutations instead of accepting newly calculated hashes', () => {
  for (const [before, after] of [
    ['["super_admin", "admin", "owner", "client"].includes(role)', '["super_admin", "admin", "owner", "client", "viewer"].includes(role)'],
    ['governance?.mode === "organization"', 'governance?.mode !== "organization"'],
    ['person.active !== false &&', 'person.active === false &&'],
    ['!sameId(person.id, user?.id)', 'sameId(person.id, user?.id)'],
    ['const active = people.filter', 'const active = filtered.filter'],
    ['if (status === "active" && person.active === false)', 'if (status === "active" && person.active !== false)'],
    ['initialTargetUserId={managementTargetUserId}', 'initialTargetUserId={user?.id}'],
    ['onSaved={load}', 'onSaved={() => {}}'],
    ['managementTargetUserId !== null && delegatedAlternative', 'managementTargetUserId !== null && true'],
    ['mapAccessTargetUserId !== null && (isSuperAdmin || delegatedAlternative)', 'mapAccessTargetUserId !== null && true'],
    ['userId={mapAccessTargetUserId}', 'userId={user?.id}'],
    ['actorUserId={user?.id}', 'actorUserId={managementTargetUserId}'],
    ['mode="delegated"', 'mode="admin"'],
    ['restorePersonActionFocus(managementTargetUserId)', 'restorePersonActionFocus(mapAccessTargetUserId)'],
    ['restorePersonActionFocus(mapAccessTargetUserId)', 'restorePersonActionFocus(managementTargetUserId)'],
    ['setManagementTargetUserId(null); restorePersonActionFocus(managementTargetUserId);', 'setManagementTargetUserId(null);'],
    ['setMapAccessTargetUserId(null); restorePersonActionFocus(mapAccessTargetUserId);', 'setMapAccessTargetUserId(null);'],
    ['hasPermission(user, "limits.view")\n        ? getOrganizationLimits(organizationId)', 'true\n        ? getOrganizationLimits(organizationId)'],
    ['listOrganizationUsers(organizationId).then', 'listOrganizationUsers(2).then'],
    ['if (current()) setGovernance(governanceResult)', 'setGovernance(governanceResult)'],
  ]) {
    assert.ok(source.includes(before), before);
    assert.throws(() => assertUsersAccessPreserved(source.replace(before, after)), undefined, before);
  }
});

test('role normalization, view permission and organization fallback remain identical', () => {
  const roles = [undefined, 'viewer', 'editor', 'owner', 'client', 'admin', 'super_admin', ' SUPER_ADMIN ', 'legacy'];
  const permissions = [undefined, [], ['users.view'], ['limits.view'], ['users.edit'], ['users.view', null, 1]];
  for (const role of roles) for (const granted of permissions) {
    const user = { id: 1, role, permissions: granted };
    const current = currentModel({ user }), old = baselineModel({ user });
    assert.equal(current.canView, old.canView);
    assert.equal(current.isSuperAdmin, old.isSuperAdmin);
    assert.deepEqual(current.userPermissions(user), old.userPermissions(user));
    for (const permission of ['users.view', 'limits.view', 'users.edit', 'users.delete']) assert.equal(current.hasPermission(user, permission), old.hasPermission(user, permission));
  }
  assert.equal(currentModel().canView, false);
  assert.equal(currentModel({ user: { role: 'viewer' } }).canView, false);
  assert.equal(currentModel({ user: { role: 'viewer', permissions: ['users.view'] } }).canView, true);
  for (const user of [null, {}, { activeOrganizationId: 9, organizationId: 8, organization_id: 7 }, { activeOrganizationId: null, organizationId: 8 }, { organization_id: '7' }, { activeOrganizationId: '' }, { activeOrganizationId: 0 }, { activeOrganizationId: {} }]) {
    assert.equal(currentModel({ user }).organizationId, baselineModel({ user }).organizationId);
    assert.equal(currentModel({ user, organizationIdProp: 101 }).organizationId, 101);
  }
});

test('only eligible non-self active people keep Mapa and delegated Gerenciar actions', () => {
  const governances = [null, { mode: 'organization', canManageAdditionalAccesses: false, allowedTargetLevels: ['viewer'] }, { mode: 'organization', canManageAdditionalAccesses: true, allowedTargetLevels: ['viewer', 'editor'] }, { mode: 'super_admin', canManageAdditionalAccesses: true, allowedTargetLevels: ['owner'] }];
  for (const role of ['super_admin', 'owner', 'admin', 'editor', 'viewer']) for (const governance of governances) {
    const input = { user: { id: 7, role }, governance };
    const current = currentModel(input), old = baselineModel(input);
    for (const id of [7, '7', 8, '8']) for (const active of [true, false, undefined]) for (const accessLevel of ['viewer', 'editor', 'owner', ' VIEWER ', 'legacy']) {
      const person = { id, active, accessLevel };
      assert.equal(current.canManageMapPerson(person), old.canManageMapPerson(person));
      assert.equal(current.canManagePerson(person), old.canManagePerson(person));
      if (active === false || String(id) === '7') {
        assert.equal(current.canManageMapPerson(person), false);
        assert.equal(current.canManagePerson(person), false);
      }
    }
  }
  const superAdmin = currentModel({ user: { id: 1, role: 'super_admin' } });
  assert.equal(superAdmin.canManageMapPerson({ id: 2, active: true, accessLevel: 'owner' }), true);
  assert.equal(superAdmin.canManagePerson({ id: 2, active: true, accessLevel: 'owner' }), false);
});

test('filters retain name/email/commercial-access/profile matching and whole-roster metrics', () => {
  const people = Object.freeze([
    Object.freeze({ id: 1, name: 'Ana', email: 'ana@example.test', role: 'owner', accessLevel: 'owner', active: true, permissions: ['document.view'] }),
    Object.freeze({ id: 2, name: 'Bruno', email: 'bruno@example.test', role: 'viewer', accessLevel: 'viewer', active: false, permissions: [] }),
    Object.freeze({ id: 3, name: '', email: 'custom@example.test', role: 'legacy', accessLevel: 'legacy', permissions: ['legacy.permission'] }),
  ]);
  for (const query of ['', 'ANA', '@example', 'documentos', 'responsável', 'personalizado', 'not-found']) for (const status of ['all', 'active', 'suspended']) for (const profileFilter of ['all', 'Responsável', 'Consulta', 'Perfil personalizado']) {
    const input = { people, query, status, profileFilter, limits: { users: { limit: 10 } } };
    const current = currentModel(input), old = baselineModel(input);
    assert.deepEqual(current.filtered, old.filtered);
    for (const key of ['active', 'suspended', 'limit', 'available', 'percent']) assert.equal(current[key], old[key]);
    assert.deepEqual([current.active, current.suspended, current.limit, current.available, current.percent], [2, 1, 10, 8, 20]);
  }
  assert.deepEqual(currentModel({ people, query: 'documentos' }).filtered.map(person => person.id), [1]);
  assert.deepEqual(currentModel({ people, query: 'personalizado' }).filtered.map(person => person.id), [3]);
  for (const [limits, expected] of [[null, [3, 1, 67]], [{ users: { limit: 0 } }, [0, 0, 0]], [{ users: { limit: 1 } }, [1, 0, 100]]]) {
    const model = currentModel({ people, limits });
    assert.deepEqual([model.limit, model.available, model.percent], expected);
  }
});

test('action menu contains exactly the original Mapa/Gerenciar destinations under the original gates', () => {
  const menus = nodes(ast, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'DocumentActionMenu');
  assert.equal(menus.length, 1);
  const actions = menus[0].attributes.properties.find(prop => prop.name?.getText() === 'actions').initializer.expression;
  const expected = parse(`const actions = [
    ...(manageMap ? [{ label: "Mapa", onSelect: () => setMapAccessTargetUserId(person.id) }] : []),
    ...(manageAdditional ? [{ label: "Gerenciar", onSelect: () => setManagementTargetUserId(person.id) }] : []),
  ];`);
  assert.equal(canonical(actions), canonical(declaration(expected, 'actions').initializer));
  assert.match(usersAccessBaseline.source, /manageMap && <button[^>]+onClick=\{\(\) => setMapAccessTargetUserId\(person.id\)\}>Mapa/);
  assert.match(usersAccessBaseline.source, /manageAdditional && <button[^>]+onClick=\{\(\) => setManagementTargetUserId\(person.id\)\}>Gerenciar/);
  assert.doesNotMatch(source, /onSelect:[^\n]*(?:role|active|remove|delete|suspend)/i);
});

for (const size of [10, 25, 50]) for (const count of [0, 1, size - 1, size, size + 1, 113]) {
  test(`client pagination preserves ${count} authorized filtered people at page size ${size}`, () => {
    assert.deepEqual(USERS_PAGE_SIZES, [10, 25, 50]);
    const people = Object.freeze(Array.from({ length: count }, (_, id) => Object.freeze({ id })));
    const pages = Math.max(1, Math.ceil(count / size));
    const combined = [];
    for (let index = 0; index < pages; index += 1) {
      const page = paginateUsers(people, index, size);
      assert.equal(page.total, count); assert.equal(page.totalPages, pages);
      assert.equal(page.pageIndex, index); assert.equal(page.pageSize, size);
      assert.equal(page.canGoPrevious, index > 0); assert.equal(page.canGoNext, index < pages - 1);
      assert.equal(page.people.length, Math.min(size, Math.max(0, count - index * size)));
      combined.push(...page.people);
    }
    assert.deepEqual(combined, people);
  });
}
test('pagination resets for every real filter/organization and clamps refreshes without resurrecting an old page', () => {
  assert.equal(canonical(declaration(ast, 'queryKey').initializer), 'JSON.stringify([organizationId, query, status, profileFilter])');
  assert.equal(canonical(declaration(ast, 'page').initializer), 'paginateUsers(filtered, resolvedPagination.pageIndex, resolvedPagination.pageSize)');
  const key = JSON.stringify([9, '', 'all', 'all']);
  const state = { queryKey: key, pageIndex: 3, pageSize: 25 };
  for (const next of [[10, '', 'all', 'all'], [9, 'Ana', 'all', 'all'], [9, '', 'active', 'all'], [9, '', 'all', 'Consulta']]) {
    const queryKey = JSON.stringify(next);
    assert.deepEqual(reconcileUsersPagination(state, queryKey, 200), { queryKey, pageIndex: 0, pageSize: 25 });
  }
  const clamped = reconcileUsersPagination(state, key, 26);
  assert.deepEqual(clamped, { queryKey: key, pageIndex: 1, pageSize: 25 });
  assert.equal(reconcileUsersPagination(clamped, key, 200), clamped);
  assert.equal(reconcileUsersPagination(clamped, key, 0).pageIndex, 0);
  for (const pageIndex of [NaN, Infinity, -Infinity, -4]) {
    assert.equal(paginateUsers([1, 2], pageIndex, 17).pageIndex, 0);
    assert.deepEqual(reconcileUsersPagination({ queryKey: key, pageIndex, pageSize: 17 }, key, 2), { queryKey: key, pageIndex: 0, pageSize: 10 });
  }
  assert.equal(paginateUsers(Array(51), 999, 25).pageIndex, 2);
});

// GET /api/organizations/:id/users authorizes users.view for that organization,
// then returns { ok, users }. It accepts no paging arguments. The real D1 query
// lists all eligible memberships, retaining suspended users and server ordering.
test('users endpoint keeps its users.view ACL and no server pagination contract', () => {
  const route = read('functions/api/organizations/[id]/users.js');
  const get = declaration(parse(route), 'onRequestGet', true).getText();
  assert.match(get, /await requireOrganizationPermission\(\s*env,\s*request,\s*"users.view",\s*organizationId,/);
  assert.ok(get.indexOf('requireOrganizationPermission') < get.indexOf('await listOrganizationUsers'));
  assert.match(get, /const users = await listOrganizationUsers\(env, organizationId\)/);
  assert.match(get, /return jsonResponse\(\{\s*ok: true,\s*users,/);
  assert.doesNotMatch(get, /searchParams|pageSize|cursor|offset|\.slice\(/);
  const client = declaration(parse(read('src/lib/api.ts')), 'listOrganizationUsers', true).getText();
  assert.match(client, /`\$\{organizationPath\(organizationId\)\}\/users`/);
  assert.doesNotMatch(client, /page|cursor|limit|offset/i);
});

test('real SQL returns more than 50 organization members, suspended people, scoped permissions and stable order', async t => {
  const env = createStorageSqliteEnv([{ id: 1, active: 1, name: 'First' }, { id: 2, active: 1, name: 'Other' }]);
  t.after(() => env.__sqlite.close());
  env.__sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, active INTEGER);
    CREATE TABLE organization_users (organization_id INTEGER, user_id INTEGER, access_level TEXT, active INTEGER);
    CREATE TABLE user_permissions (user_id INTEGER, organization_id INTEGER, permission TEXT, active INTEGER, expires_at TEXT);
    CREATE TABLE user_permission_denials (user_id INTEGER, organization_id INTEGER, permission TEXT);
  `);
  const insertUser = env.__sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)');
  const insertMembership = env.__sqlite.prepare('INSERT INTO organization_users VALUES (?, ?, ?, ?)');
  for (let id = 1; id <= 61; id += 1) {
    insertUser.run(id, `Person ${id}`, `${String(id).padStart(3, '0')}@example.test`, 'viewer', id === 5 ? 0 : 1);
    insertMembership.run(1, id, id === 61 ? 'owner' : id === 60 ? 'editor' : 'viewer', id === 6 ? null : 1);
  }
  for (const [id, organizationId, active] of [[70, 1, 0], [90, 2, 1]]) {
    insertUser.run(id, `Person ${id}`, `${id}@example.test`, 'viewer', 1);
    insertMembership.run(organizationId, id, 'viewer', active);
  }
  env.__sqlite.exec(`INSERT INTO user_permissions VALUES (1, 1, 'document.view', 1, NULL), (1, 2, 'document.delete', 1, NULL), (1, 1, 'document.upload', 0, NULL), (1, 1, 'document.download', 1, '2000-01-01');
    INSERT INTO user_permission_denials VALUES (1, 1, 'project.create'), (1, 2, 'project.save');`);
  const users = await listOrganizationUsers(env, 1);
  assert.equal(users.length, 61);
  assert.deepEqual(users.slice(0, 3).map(user => user.id), [61, 60, 1]);
  assert.deepEqual(users.slice(2).map(user => user.id), Array.from({ length: 59 }, (_, index) => index + 1));
  assert.equal(users.find(user => user.id === 5).active, false);
  assert.ok(users.some(user => user.id === 6));
  assert.ok(users.every(user => user.organizationId === 1 && user.id !== 70 && user.id !== 90));
  assert.deepEqual(users.find(user => user.id === 1).permissions, ['document.view']);
  assert.deepEqual(users.find(user => user.id === 1).deniedPermissions, ['project.create']);
  const query = env.__statements.find(entry => entry.sql.includes('FROM organization_users ou'));
  assert.equal(query.kind, 'all'); assert.deepEqual(query.args, [1]);
  assert.doesNotMatch(query.sql, /\bLIMIT\b|\bOFFSET\b/i);
});

function loadHarness({ user = { id: 1, role: 'owner' }, organizationId = 1, canView = true, limitsError = false, governanceError = false, delayAuxiliary = false } = {}) {
  const calls = [], writes = [], readCalls = [], auxiliary = [];
  const states = new Map();
  const waitAuxiliary = () => delayAuxiliary ? new Promise(resolve => auxiliary.push(resolve)) : Promise.resolve();
  const requestRef = { current: 0 };
  const dependencies = {
    user, organizationId, canView, requestRef, useCallback: fn => fn, isRegionAccessDenied, isRegionAuthenticationError,
    hasPermission: currentModel().hasPermission,
    normalizeUserError: error => ({ message: error.message }),
    listOrganizationUsers: id => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); calls.push({ id, resolve, reject }); return promise; },
    getOrganizationLimits: async id => { readCalls.push(['limits', id]); await waitAuxiliary(); if (limitsError) throw new Error('limits failed'); return { limits: { users: { limit: 20 } } }; },
    loadAccessGovernance: async id => { readCalls.push(['governance', id]); await waitAuxiliary(); if (governanceError) throw new Error('governance failed'); return { mode: 'organization', canManageAdditionalAccesses: true, allowedTargetLevels: ['viewer'] }; },
  };
  for (const name of ['setLoading', 'setLoaded', 'setMessage', 'setPeople', 'setLimits', 'setGovernance', 'setLimitsLoading', 'setGovernanceLoading', 'setManagementTargetUserId', 'setMapAccessTargetUserId']) dependencies[name] = input => { const value = typeof input === 'function' ? input(states.get(name) ?? null) : input; states.set(name, value); writes.push([name, value]); };
  const loadSource = `const ${declaration(ast, 'load').getText()}; return load;`;
  const load = new Function(...Object.keys(dependencies), compile(loadSource))(...Object.values(dependencies));
  return { calls, writes, readCalls, requestRef, load, auxiliary, states };
}
test('newer refresh wins and stale requests cannot replace users or clear the busy state', async () => {
  const harness = loadHarness();
  const oldLoad = harness.load(), latestLoad = harness.load();
  harness.calls[0].resolve({ users: [{ id: 'stale' }] });
  await oldLoad;
  assert.deepEqual(harness.writes.filter(([name]) => ['setPeople', 'setLoading'].includes(name)), [['setLoading', true], ['setLoading', true]]);
  harness.calls[1].resolve({ users: [{ id: 'current' }] });
  await latestLoad;
  assert.deepEqual(harness.writes.filter(([name]) => name === 'setPeople'), [['setPeople', [{ id: 'current' }]]]);
  assert.equal(harness.states.get('setLoading'), false);
});
test('unmount/context replacement invalidates late success and error, and unauthorized contexts never fetch', async () => {
  assert.equal(canonical(declaration(ast, 'contextKey').initializer), 'JSON.stringify([organizationId, user?.id, roleOf(user), userPermissions(user)])');
  assert.match(source, /<UsersAccessWorkspace key=\{contextKey\}/);
  assert.match(source, /return \(\) => \{ requestRef.current \+= 1; \}/);
  for (const outcome of ['resolve', 'reject']) {
    const harness = loadHarness(), pending = harness.load();
    const before = harness.writes.length;
    harness.requestRef.current += 1;
    harness.calls[0][outcome](outcome === 'resolve' ? { users: [{ id: 99 }] } : new Error('stale failure'));
    await pending;
    assert.equal(harness.writes.length, before);
  }
  for (const input of [{ organizationId: null }, { canView: false }]) {
    const harness = loadHarness(input); await harness.load();
    assert.deepEqual(harness.calls, []); assert.deepEqual(harness.writes, []);
  }
});

test('load keeps optional limits permission and fallback behavior without granting governance on failure', async () => {
  for (const input of [{ limitsError: true }, { governanceError: true }, { user: { id: 1, role: 'viewer', permissions: ['users.view'] } }]) {
    const harness = loadHarness(input), pending = harness.load();
    harness.calls[0].resolve({ users: [{ id: 8 }] });
    await pending;
    assert.deepEqual(harness.writes.find(([name]) => name === 'setPeople'), ['setPeople', [{ id: 8 }]]);
    assert.equal(harness.states.get('setLoading'), false);
    if (input.user) assert.deepEqual(harness.readCalls, [['governance', 1]]);
    if (input.limitsError || input.user) assert.equal(harness.writes.some(([name]) => name === 'setLimits'), false, 'unavailable limits never overwrite valid cached limits or fabricate a count');
    if (input.governanceError) {
      assert.deepEqual(harness.writes.find(([name]) => name === 'setGovernance'), ['setGovernance', null]);
      const warning = harness.writes.find(([name, value]) => name === 'setMessage' && value);
      assert.equal(warning[1].kind, 'error');
      assert.match(warning[1].text, /A equipe continua disponível para consulta/);
    }
  }
  const harness = loadHarness(), failed = harness.load();
  harness.calls[0].reject(new Error('roster failed'));
  await failed;
  assert.deepEqual(harness.writes.find(([name, value]) => name === 'setMessage' && value), ['setMessage', { kind: 'error', text: 'roster failed' }]);
  assert.ok(harness.writes.every(([name]) => !['setPeople', 'setLoaded'].includes(name)));
  assert.equal(harness.states.get('setGovernance').mode, 'organization', 'independent authorized metadata can settle without fabricating roster rows');
  assert.equal(harness.states.get('setLoading'), false);
});

test('manager close callbacks clear only their existing target then restore that person action focus', () => {
  for (const [manager, setter, target] of [
    ['OrganizationPermissionManager', 'setManagementTargetUserId', 'managementTargetUserId'],
    ['ProjectMapAccessManager', 'setMapAccessTargetUserId', 'mapAccessTargetUserId'],
  ]) {
    const component = nodes(ast, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === manager)[0];
    const callback = component.attributes.properties.find(prop => prop.name?.getText() === 'onClose').initializer.expression;
    for (const id of [7, '7', 'person-with-special-id']) {
      const calls = [];
      const close = new Function(setter, target, 'restorePersonActionFocus', compile(`return ${callback.getText()};`))(
        value => calls.push(['close', value]), id, value => calls.push(['focus', value]),
      );
      close();
      assert.deepEqual(calls, [['close', null], ['focus', id]]);
    }
  }
});

function focusHarness() {
  const frames = new Map(), cancelled = [], focused = [];
  let sequence = 0;
  const document = { body: { isConnected: true }, activeElement: { isConnected: true } };
  const window = {
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); },
  };
  const rows = [];
  const workspace = {
    isConnected: true, hasDialog: false,
    querySelector(selector) { assert.equal(selector, '[role="dialog"]'); return this.hasDialog ? {} : null; },
    querySelectorAll(selector) { assert.equal(selector, 'tr[data-user-id]'); return rows; },
  };
  const workspaceRef = { current: workspace }, focusReturnFrameRef = { current: null };
  const makeRow = (id, overrides = {}) => {
    const button = {
      isConnected: true, disabled: false,
      getClientRects: () => [1],
      focus(options) { focused.push([id, options]); document.activeElement = this; },
      ...overrides,
    };
    const row = { dataset: { userId: String(id) }, querySelector(selector) { assert.equal(selector, 'button.mm-docs-menu-trigger'); return button; }, button };
    rows.push(row);
    return row;
  };
  const dependencies = { workspaceRef, focusReturnFrameRef, document, window };
  const restore = new Function(...Object.keys(dependencies), compile(`${declaration(ast, 'restorePersonActionFocus', true).getText()}\nreturn restorePersonActionFocus;`))(...Object.values(dependencies));
  const effect = nodes(ast, node => ts.isCallExpression(node) && node.expression.getText() === 'useEffect' && node.getText().includes('cancelAnimationFrame'));
  assert.equal(effect.length, 1, 'one focus-frame cleanup effect');
  assert.equal(canonical(effect[0].arguments[1]), '[]', 'frame cleanup is bound to workspace unmount');
  const unmount = new Function(...Object.keys(dependencies), compile(`return (${effect[0].arguments[0].getText()})();`))(...Object.values(dependencies));
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  return { document, workspace, workspaceRef, focusReturnFrameRef, rows, frames, cancelled, focused, makeRow, restore, unmount, flush };
}

test('focus return resolves the current row after rerender without changing scroll or interpolating the ID into selectors', () => {
  assert.match(source, /<section ref=\{workspaceRef\} className="people-access-section users-access-workspace"/);
  assert.match(source, /<tr key=\{String\(person.id\)\} data-user-id=\{String\(person.id\)\}/);
  for (const id of [7, '7', 'person["special]#id']) {
    const harness = focusHarness();
    const previous = harness.makeRow(id);
    harness.restore(id);
    assert.equal(harness.focused.length, 0, 'wait until React removes the manager');
    previous.button.isConnected = false;
    harness.rows.length = 0;
    const current = harness.makeRow(id);
    harness.document.activeElement = harness.document.body;
    harness.flush();
    assert.deepEqual(harness.focused, [[id, { preventScroll: true }]]);
    assert.equal(harness.document.activeElement, current.button);
    assert.equal(harness.focusReturnFrameRef.current, null);
  }
});

test('focus return never crosses contexts or steals focus from newer actions/dialogs and ignores unavailable triggers', () => {
  const cases = [
    harness => { harness.workspace.isConnected = false; },
    harness => { harness.workspaceRef.current = { ...harness.workspace }; },
    harness => { harness.workspaceRef.current = null; },
    harness => { harness.workspace.hasDialog = true; },
    harness => { harness.document.activeElement = { isConnected: true }; },
    harness => { harness.rows.length = 0; },
    harness => { harness.rows[0].dataset.userId = 'another-user'; },
    harness => { harness.rows[0].button.disabled = true; },
    harness => { harness.rows[0].button.isConnected = false; },
    harness => { harness.rows[0].button.getClientRects = () => []; },
  ];
  for (const change of cases) {
    const harness = focusHarness();
    harness.makeRow(7); harness.restore(7); change(harness); harness.flush();
    assert.deepEqual(harness.focused, []);
    assert.equal(harness.focusReturnFrameRef.current, null);
  }
});

test('repeated close cancels old frames, null targets do not schedule, and unmount cancels pending focus', () => {
  const harness = focusHarness();
  harness.makeRow(7); harness.makeRow(8);
  harness.restore(7);
  const previous = harness.focusReturnFrameRef.current;
  harness.restore(8);
  assert.deepEqual(harness.cancelled, [previous]);
  assert.equal(harness.frames.size, 1);
  harness.flush();
  assert.deepEqual(harness.focused, [[8, { preventScroll: true }]]);
  harness.restore(null);
  assert.equal(harness.frames.size, 0);
  harness.restore(7);
  const pending = harness.focusReturnFrameRef.current;
  harness.unmount(); harness.flush();
  assert.ok(harness.cancelled.includes(pending));
  assert.equal(harness.focused.length, 1);
  const empty = focusHarness(); empty.restore(null); assert.equal(empty.frames.size, 0);
});


test('roster publishes immediately while limits and governance remain pending independently', async () => {
  const harness = loadHarness({ delayAuxiliary: true });
  const pending = harness.load();
  assert.deepEqual(harness.readCalls, [['limits', 1], ['governance', 1]], 'all independent reads start immediately');
  harness.calls[0].resolve({ users: [{ id: 8 }] });
  for (let index = 0; index < 8; index++) await Promise.resolve();
  assert.deepEqual(harness.states.get('setPeople'), [{ id: 8 }]);
  assert.equal(harness.states.get('setLoaded'), true);
  assert.equal(harness.states.get('setLoading'), false);
  assert.equal(harness.states.get('setLimitsLoading'), true);
  assert.equal(harness.states.get('setGovernanceLoading'), true);
  assert.equal(harness.states.has('setGovernance'), false);
  harness.auxiliary.forEach(resolve => resolve());
  await pending;
  assert.equal(harness.states.get('setLimitsLoading'), false);
  assert.equal(harness.states.get('setGovernanceLoading'), false);
});

test('superseded auxiliary responses cannot publish data or clear newer per-region busy flags', async () => {
  const harness = loadHarness({ delayAuxiliary: true });
  const old = harness.load(); const latest = harness.load();
  harness.calls[0].resolve({ users: [{ id: 'old' }] });
  harness.auxiliary[0](); harness.auxiliary[1]();
  await old;
  assert.equal(harness.states.has('setPeople'), false);
  assert.equal(harness.states.has('setLimits'), false);
  assert.equal(harness.states.has('setGovernance'), false);
  assert.equal(harness.states.get('setLimitsLoading'), true);
  assert.equal(harness.states.get('setGovernanceLoading'), true);
  harness.calls[1].resolve({ users: [{ id: 'latest' }] });
  harness.auxiliary[2](); harness.auxiliary[3]();
  await latest;
  assert.deepEqual(harness.states.get('setPeople'), [{ id: 'latest' }]);
  assert.equal(harness.states.get('setLimitsLoading'), false);
  assert.equal(harness.states.get('setGovernanceLoading'), false);
});


test('denied roster clears revealed data and rejects late auxiliary results', async () => {
  const harness = loadHarness({ delayAuxiliary: true });
  harness.states.set('setPeople', [{ id: 99 }]); harness.states.set('setLoaded', true);
  harness.states.set('setLimits', { users: { limit: 99 } });
  harness.states.set('setGovernance', { mode: 'organization' });
  const pending = harness.load();
  harness.calls[0].reject(Object.assign(new Error('Access revoked'), { status: 403, category: 'PERMISSION' }));
  for (let index = 0; index < 8; index++) await Promise.resolve();
  assert.deepEqual(harness.states.get('setPeople'), []);
  assert.equal(harness.states.get('setLoaded'), false);
  assert.equal(harness.states.get('setLimits'), null);
  assert.equal(harness.states.get('setGovernance'), null);
  assert.equal(harness.states.get('setGovernanceLoading'), false);
  assert.equal(harness.states.get('setLimitsLoading'), false);
  harness.auxiliary.forEach(resolve => resolve()); await pending;
  assert.equal(harness.states.get('setLimits'), null);
  assert.equal(harness.states.get('setGovernance'), null);
});
