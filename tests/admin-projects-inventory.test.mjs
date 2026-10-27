import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { filterProjects, formatAdminProjectDate, paginateProjects, projectLifecycle, projectUnavailableReason, readProjectQuery } from '../src/pages/Admin/components/admin-projects-model.ts';
import { restoreAdminProjectsInventory } from './helpers/admin-projects-inventory-preservation.mjs';
import { restoreApprovedAdminWorkspace, adminWorkspaceBaseline } from './helpers/admin-workspace-preservation.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const admin = read('src/pages/Admin.tsx');
const project = { id: 1, name: 'Mapa Árvores', slug: 'mapa-arvores', description: 'Parques', organizationId: 1, organization: { id: 1, name: 'Floresta' }, active: true, lifecycle: { state: 'ACTIVE', version: 3 } };
const organizations = [{ id: 1, name: 'Floresta', active: true }, { id: 2, name: 'Outra', active: true }, { id: 3, name: 'Inativa', active: false }];

test('reproduces the former limited table and preserves the independently pinned Admin business code', () => {
  const before = restoreAdminProjectsInventory('src/pages/Admin.tsx', admin);
  assert.match(before, /headers=\{\["Projeto", "Slug", "JSON", "Pasta", "Acessos", "Status"\]\}/);
  assert.match(before, /project\.defaultConfigFile \|\| "config.kepler.json"/);
  assert.equal(createHash('sha256').update(restoreApprovedAdminWorkspace('src/pages/Admin.tsx', admin)).digest('hex'), adminWorkspaceBaseline);
  assert.notEqual(createHash('sha256').update(restoreApprovedAdminWorkspace('src/pages/Admin.tsx', admin.replace('revision === requestRef.current', 'revision !== requestRef.current'))).digest('hex'), adminWorkspaceBaseline);
  assert.throws(() => restoreAdminProjectsInventory('src/pages/Admin.tsx', admin.replace('user={user} structurePending', 'user={null} structurePending')));
});

test('URL filters are bounded, unknown values remain restrictive, page sizes are enumerated', () => {
  assert.deepEqual(readProjectQuery(new URLSearchParams('projectPage=-1&projectPageSize=999')), { search: '', organization: 'all', lifecycle: 'all', page: 1, pageSize: 10 });
  const query = readProjectQuery(new URLSearchParams('projectOrganization=unknown&projectLifecycle=SOMETHING&projectPage=1e99'));
  assert.equal(query.page, 1);
  assert.equal(filterProjects([project], query).length, 0);
});

test('search, organization and lifecycle intersect without mutating collection or trusting active as lifecycle', () => {
  const draft = { ...project, id: 2, active: true, lifecycle: { state: 'DRAFT' } };
  const source = [project, draft, { ...project, id: 3, organizationId: 2 }];
  assert.deepEqual(filterProjects(source, { search: 'PARQUES', organization: '1', lifecycle: 'DRAFT' }), [draft]);
  assert.equal(projectLifecycle({ ...project, lifecycle: null }), 'LEGACY');
  assert.equal(projectLifecycle({ ...project, lifecycle: undefined }), 'UNKNOWN');
  assert.equal(source.length, 3);
  assert.equal(filterProjects(source, { search: 'Floresta', organization: 'all', lifecycle: 'all' }).length, 3);
});

test('pagination clamps deep links and shrinking filtered collections, with exact zero and no page-derived total', () => {
  const source = Array.from({ length: 27 }, (_, i) => i);
  const page = paginateProjects(source, 999, 10);
  assert.deepEqual(page, { items: [20, 21, 22, 23, 24, 25, 26], page: 3, pages: 3, start: 21, end: 27 });
  assert.deepEqual(paginateProjects([], 999, 10), { items: [], page: 1, pages: 1, start: 0, end: 0 });
  assert.equal(paginateProjects([1], 999, 10).page, 1);
});

test('navigation uses the lifecycle authority and fails closed for unavailable or unknown publication', () => {
  const reason = value => projectUnavailableReason(value, 1, organizations, true);
  assert.equal(reason(project), null);
  assert.equal(reason({ ...project, active: false }), null, 'managed ACTIVE is the server publication authority');
  assert.equal(reason({ ...project, lifecycle: null }), null, 'explicit legacy null uses true active');
  for (const state of ['DRAFT', 'PREPARING_STORAGE', 'CONFIG_READY', 'FAILED', 'PENDING', 'UNRECOGNIZED']) assert.ok(reason({ ...project, lifecycle: { state } }), state);
  assert.ok(reason({ ...project, lifecycle: undefined }));
  assert.ok(reason({ ...project, lifecycle: null, active: false }));
  assert.ok(reason({ ...project, slug: '' }));
});

test('global inventory never grants navigation into another organization or unknown organizational availability', () => {
  assert.match(projectUnavailableReason(project, 2, organizations, true), /Ative esta organização/);
  assert.match(projectUnavailableReason(project, null, organizations, true), /Ative esta organização/);
  assert.match(projectUnavailableReason(project, 1, organizations, false), /não confirmada/);
  assert.match(projectUnavailableReason(project, 1, [], true), /não confirmada/);
  assert.match(projectUnavailableReason({ ...project, organizationId: 3 }, 3, organizations, true), /inativa/);
  assert.match(projectUnavailableReason({ ...project, organizationId: null, organization: null }, 1, organizations, true), /não informada/);
});

test('dates handle D1 UTC and honest missing fields', () => {
  assert.match(formatAdminProjectDate('2026-10-27 10:35:00'), /27\/10\/2026.*10:35 UTC/);
  assert.equal(formatAdminProjectDate('invalid'), 'Não informada');
  assert.equal(formatAdminProjectDate(), 'Não informada');
  const component = read('src/pages/Admin/components/AdminProjects.tsx');
  assert.doesNotMatch(component, /fetch\(|config\.kepler\.json|\/review\/\$|setActiveOrganization/);
  assert.match(component, /can\(user, "project.view", context\)/);
  assert.match(component, /encodeURIComponent\(project.slug\)/);
});
