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

test('organization and limits show shimmer only before the first real response', () => {
  for (const [source, data, skeleton] of [[organization, 'organization', 'OrganizationSectionSkeleton'], [limits, 'limits', 'LimitsPlansSectionSkeleton']]) {
    assert.match(source, new RegExp(`loading && !${data} \\? <${skeleton}`));
    assert.match(source, new RegExp(`\\{${data} &&`));
    assert.match(source, /useState\(Boolean\(organizationId && permissions.view\)\)/);
    assert.match(source, /aria-busy=\{loading\}/);
    assert.match(source, /className="mm-sr-only" role="status"/);
    assert.doesNotMatch(source, /\{!loading &&|setTimeout|setInterval/);
  }
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

test('users preserve valid rows and metrics during refresh and announce through the existing footer', () => {
  assert.match(users, /loading && !loaded \? <UsersMetricsSkeleton/);
  assert.match(users, /loading && !loaded \? <UsersTableSkeletonRows/);
  assert.match(users, /\{loaded && page.people.map/);
  assert.doesNotMatch(users, /\{!loading && page.people.map|role="status">Carregando pessoas/);
  assert.match(users, /status=\{loading \? loaded \? "Atualizando usuários\."/);
});

test('section geometry uses shared non-interactive aria-hidden shimmer and reduced-motion tokens', () => {
  assert.match(skeletons, /import \{ Skeleton, TableSkeleton \} from "\.\.\/\.\.\/\.\.\/components\/loading\/Skeleton"/);
  assert.match(skeletons, /mm-metrics-grid compact/);
  assert.match(skeletons, /people-skeleton-row/);
  assert.match(skeletons, /aria-hidden="true"/);
  assert.doesNotMatch(skeletons, /<button|<input|role="status"|setTimeout|animation:/);
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
