import { expect, test } from '@playwright/test';
import { expectAdminFixtureIntegrity, setupAdmin } from './fixtures/admin-workspace';

// The development gate explicitly sets VITE_ORGANIZATION_MANAGEMENT_V1=false.
// The compiled enabled suite runs separately; neither case changes deployed flags.
test('flag OFF preserves legacy organizations and never calls management API', async ({ page }) => {
  const fixture = await setupAdmin(page, { section: 'organizations' });
  await expect(page.getByRole('heading', { level: 1, name: 'Gestão de Organizações', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Organização pronta', exact: true })).toBeVisible();
  await expect(page.locator('.admin-organizations-workspace')).toHaveCount(0);
  await expect(page.locator('#admin-organizations-actions')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova organização', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Importar', exact: true })).toHaveCount(0);
  // React.StrictMode mounts effects twice in this development server; each
  // invocation still issues exactly the four original authorized reads.
  expect(fixture.requests.filter(path => /^GET \/api\/admin\/(projects|users|organizations|access)$/.test(path)).sort()).toEqual([
    'GET /api/admin/access', 'GET /api/admin/organizations', 'GET /api/admin/projects', 'GET /api/admin/users',
  ].flatMap(path => [path, path]));
  expect(fixture.requests.filter(path => path.includes('/api/admin/organization-management'))).toEqual([]);
  expect(fixture.mutations).toEqual([]);
  await expectAdminFixtureIntegrity(page);
});
