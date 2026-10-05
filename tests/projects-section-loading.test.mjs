import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [organization, limits, users, skeletons, css] = await Promise.all([
  'src/pages/Projects/components/OrganizationSection.tsx',
  'src/pages/Projects/components/LimitsPlansSection.tsx',
  'src/pages/Projects/components/UsersAccessOverviewSection.tsx',
  'src/pages/Projects/components/ProjectSectionSkeletons.tsx',
  'src/components/loading/Skeleton.css',
].map(read));

test('organization and limits stage static labels before volatile values without changing requests', () => {
  for (const [source, data] of [[organization, 'organization'], [limits, 'limits']]) {
    assert.ok(source.includes(`hasData: Boolean(${data})`));
    assert.match(source, /useInitialLoadingPresentation/);
    assert.match(source, /<StaticLoadingText pending=\{structurePending\}/);
    assert.match(source, /contentPending \? <Skeleton/);
    assert.match(source, /useState\(Boolean\(organizationId && permissions.view\)\)/);
    assert.match(source, /aria-busy=\{presentationLoading\}/);
    assert.match(source, /<LoadingStatus loading=\{presentationLoading\} refreshing=\{Boolean\(/);
    assert.doesNotMatch(source, /\{!loading &&|setTimeout|setInterval/);
  }
  for (const label of ['Dados principais', 'Métricas', 'Edição', 'Perfil atual']) assert.ok(organization.includes(label));
  for (const label of ['Plano atual', 'Uso e limites', 'Solicitar upgrade ou aumento', 'Solicitações pendentes']) assert.ok(limits.includes(label));
  assert.doesNotMatch(organization, /OrganizationSectionSkeleton/);
  assert.doesNotMatch(limits, /LimitsPlansSectionSkeleton|\{limits && <>/);
  assert.match(limits, /available=\{Boolean\(limits\?\.\[item.key\]\)\}/);
});

test('organization and limits invalidate reads on unmount and remount authorization contexts', () => {
  for (const source of [organization, limits]) {
    assert.match(source, /contextKey = JSON.stringify/);
    assert.match(source, /key=\{contextKey\}/);
    assert.match(source, /const revision = \+\+requestRef.current/);
    assert.match(source, /if \(revision !== requestRef.current\) return/);
    assert.match(source, /return \(\) => \{ requestRef.current \+= 1; \}/);
  }
});

test('users publish independent dependencies and keep valid rows during auxiliary waits', () => {
  assert.match(users, /listOrganizationUsers\(organizationId\)\.then\(peopleResult/);
  assert.match(users, /getOrganizationLimits\(organizationId\)\.then\(limitResult/);
  assert.match(users, /loadAccessGovernance\(organizationId\)\.then\(governanceResult/);
  assert.equal((users.match(/useInitialLoadingPresentation\(\{/g) || []).length, 3);
  assert.match(users, /const current = \(\) => readRevision === requestRef.current/);
  assert.match(users, /peoplePending \? <UsersTableSkeletonRows/);
  assert.match(users, /\{visiblePeople && page.people.map/);
  assert.doesNotMatch(users, /\{!loading && page.people.map/);
  assert.match(users, /announce=\{false\} visuallyHidden=\{false\}/);
  assert.match(users, /governancePending && !isSuperAdmin/);
  assert.match(users, /limitsPending \? <Skeleton/);
  assert.match(users, /visiblePeople && visibleLimits && <div className="people-capacity-progress"/);
});

test('section geometry uses viewport/page estimates and shared decorative motion tokens', () => {
  assert.match(skeletons, /useSkeletonCount/);
  assert.match(skeletons, /useSkeletonCount\(\{ layout: "table", pageSize: rows/);
  assert.match(skeletons, /people-skeleton-row/);
  assert.match(skeletons, /aria-hidden="true"/);
  assert.doesNotMatch(skeletons, /<button|<input|role="status"|setTimeout|animation:/);
  assert.match(css, /\.mm-section-card \.mm-section-load-region \+ \.mm-card \{\s*margin-top: 14px;/);
  assert.match(css, /animation: mm-shimmer/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the exact loading inverse preserves the original selector contract and rejects business changes', async () => {
  const { createHash } = await import('node:crypto');
  const { restoreLimitsPlansLoading } = await import('./helpers/projects-loading-preservation.mjs');
  const { restoreMaonoSelect } = await import('./helpers/maono-select-preservation.mjs');
  const original = '47987125e6dc7c86e1adf810f3325c8a5b905659f8724d5242596b4eb0564042';
  const verify = source => assert.equal(createHash('sha256').update(restoreMaonoSelect(restoreLimitsPlansLoading(source))).digest('hex'), original);
  verify(limits);
  for (const [before, after] of [
    ['if (isSuperAdmin(user) || hasPlatformScope(user)) return true;', 'if (isSuperAdmin(user) || hasPlatformScope(user)) return false;'],
    ['reason.trim().slice(0, 1000)', 'reason.trim().slice(0, 2000)'],
    ['await createOrganizationLimitRequest(organizationId, payload)', 'await createOrganizationLimitRequest(2, payload)'],
    ['<option value="users_increase">', '<option value="projects_increase">'],
  ]) {
    assert.ok(limits.includes(before), `mutation target exists: ${before}`);
    assert.throws(() => verify(limits.replace(before, after)), `business change rejected: ${before}`);
  }
});
