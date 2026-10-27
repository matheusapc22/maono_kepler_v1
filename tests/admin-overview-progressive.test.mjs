import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import { overviewMetricPresentation } from '../src/pages/Admin/components/admin-overview-model.ts';
import { restoreApprovedAdminWorkspace, adminWorkspaceBaseline } from './helpers/admin-workspace-preservation.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ready = { loaded: true, pending: false, error: '' };
test('zero requires a loaded, valid count; unavailable never masquerades as zero', () => {
  assert.deepEqual(overviewMetricPresentation({ value: 0, state: ready }), { value: 0, note: '' });
  for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(overviewMetricPresentation({ value, state: ready }).value, null);
  assert.equal(overviewMetricPresentation({ value: 0, available: false, state: ready }).value, null);
  assert.equal(overviewMetricPresentation({ value: 0, state: { ...ready, loaded: false } }).value, null);
});
test('old values are explicitly identified during refresh and transient errors', () => {
  assert.deepEqual(overviewMetricPresentation({ value: 7, state: { ...ready, pending: true } }), { value: 7, note: 'Atualizando dados anteriores' });
  assert.deepEqual(overviewMetricPresentation({ value: 7, state: { ...ready, error: '503' } }), { value: 7, note: 'Dados anteriores - leitura falhou' });
  assert.equal(overviewMetricPresentation({ value: 7, state: { ...ready, loaded: false, error: '403' } }).value, null);
});
test('actual overview integration distinguishes incomplete file/active metadata from valid empty counts', () => {
  const admin = read('src/pages/Admin.tsx');
  const source = admin.slice(admin.indexOf('  function renderOverview()'), admin.indexOf('  function renderOrganizations()'));
  const code = transformSync(source, { loader: 'tsx' }).code;
  function metrics(organizations, projects = [], users = []) {
    const context = {
      React: { createElement: (_component, props) => props }, AdminOverview: 'Overview', structurePending: false, setSection() {},
      organizations, projects, users,
      activeOrganizations: organizations.filter(item => item.active !== false), activeProjects: projects.filter(item => item.active !== false), activeUsers: users.filter(item => item.active !== false),
      totalFiles: organizations.reduce((sum, org) => sum + Number(org.fileCount || 0), 0),
      regions: { projects: ready, organizations: ready, users: ready },
      projectPresentation: { contentPending: false }, organizationPresentation: { contentPending: false }, userPresentation: { contentPending: false },
    };
    return new Function(...Object.keys(context), `${code}\nreturn renderOverview();`)(...Object.values(context)).metrics;
  }
  assert.ok(metrics([]).every(metric => metric.available && metric.value === 0));
  const result = metrics([{ active: true, fileCount: 7 }, { active: false, fileCount: 4 }]);
  assert.equal(result[0].value, 1); assert.equal(result[3].value, 11); assert.equal(result[3].available, true);
  for (const fileCount of [undefined, null, '3', -1, 0.1]) assert.equal(metrics([{ active: true, fileCount }])[3].available, false);
  assert.equal(metrics([{ fileCount: 0 }])[0].available, false);
});
test('strict inverse keeps the historical complete Admin baseline and rejects weaker availability', () => {
  const admin = read('src/pages/Admin.tsx');
  assert.equal(createHash('sha256').update(restoreApprovedAdminWorkspace('src/pages/Admin.tsx', admin)).digest('hex'), adminWorkspaceBaseline);
  assert.throws(() => restoreApprovedAdminWorkspace('src/pages/Admin.tsx', admin.replace('org.fileCount >= 0', 'org.fileCount >= -1')));
  const component = read('src/pages/Admin/components/AdminOverview.tsx');
  assert.match(component, /inclusive inativas/); assert.match(component, /organization_files/);
  assert.doesNotMatch(component, /fetch\(|useEffect|setInterval|localStorage/);
});
