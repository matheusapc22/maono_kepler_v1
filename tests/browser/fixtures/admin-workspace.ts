import { expect, type Page } from '@playwright/test';
import { fulfillProjectPreviewMetrics } from './project-preview-metrics';

// Compiled local React and synthetic HTTP only. Every API response is
// intercepted; the two opt-in mutations below never reach a real backend.
export function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

type Options = {
  section?: string; role?: string; path?: string; empty?: boolean;
  visualCounts?: boolean; manyUsers?: boolean; allowUserSave?: boolean; allowLogout?: boolean;
  beforeRead?: (resource: string, attempt: number) => Promise<void>;
  status?: (resource: string, attempt: number) => number;
};
const errors = new WeakMap<Page, string[]>();
const unexpectedWrites = new WeakMap<Page, string[]>();

export async function setupAdmin(page: Page, options: Options = {}) {
  const requests: string[] = [], mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  const attempts = new Map<string, number>();
  const organization = { id: 1, name: 'Organização pronta', slug: 'org-pronta', active: true, fileCount: 7, projectCount: 1, userCount: 1 };
  const organizations = options.empty ? [] : options.visualCounts
    ? [...Array.from({ length: 6 }, (_, index) => ({ ...organization, id: index + 1, name: `Organização ${index + 1}`, slug: `org-${index + 1}`, fileCount: 1 })), { ...organization, id: 99, active: false, fileCount: 4 }]
    : [organization];
  const projects = options.empty ? [] : Array.from({ length: options.visualCounts ? 8 : 1 }, (_, index) => ({
    id: index + 4, name: index ? `Projeto pronto ${index + 1}` : 'Projeto pronto', slug: `projeto-pronto-${index + 1}`,
    active: !options.visualCounts || index < 7, organizationId: 1, accessLevel: 'owner', thumbnailStatus: 'MISSING',
  }));
  const users = options.empty ? [] : Array.from({ length: options.manyUsers ? 40 : options.visualCounts ? 9 : 1 }, (_, index) => ({
    id: index + 2, name: index ? `Pessoa pronta ${index + 1}` : 'Pessoa pronta', email: `pessoa-${index + 1}@example.test`, role: 'viewer',
    active: !options.visualCounts || index < 8, organizations: [{ ...organization, accessLevel: 'viewer' }],
  }));
  let authenticated = true;
  errors.set(page, []); unexpectedWrites.set(page, []);
  page.on('pageerror', error => errors.get(page)!.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    if (await fulfillProjectPreviewMetrics(route)) return;
    if (options.allowUserSave && request.method() === 'PATCH' && path === '/api/admin/users/2') {
      const body = request.postDataJSON();
      mutations.push({ path, body });
      users[0] = { ...users[0], name: String(body.name), email: String(body.email), active: Boolean(body.active) };
      return route.fulfill({ json: { ok: true, user: users[0] } });
    }
    if (options.allowLogout && request.method() === 'POST' && path === '/api/auth/logout') {
      authenticated = false;
      mutations.push({ path, body: {} });
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() !== 'GET') {
      unexpectedWrites.get(page)!.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 403, json: { ok: false } });
    }
    if (path === '/api/session') return route.fulfill({ json: authenticated ? {
      authenticated: true,
      user: { id: 1, name: 'Operador sintético', email: 'qa@example.test', role: options.role ?? 'super_admin', activeOrganizationId: 1 },
      projects: [], organizations: [organization], activeOrganization: organization,
    } : { authenticated: false, user: null, projects: [], organizations: [], activeOrganization: null } });
    const resource = path.match(/^\/api\/admin\/(projects|users|organizations|access)$/)?.[1];
    if (resource) {
      const attempt = (attempts.get(resource) ?? 0) + 1;
      attempts.set(resource, attempt);
      await options.beforeRead?.(resource, attempt);
      const status = options.status?.(resource, attempt) ?? 200;
      if (status !== 200) return route.fulfill({ status, json: { ok: false, error: {
        code: status === 401 ? 'AUTH_SESSION_EXPIRED' : status === 403 ? 'AUTH_PERMISSION_DENIED' : 'INFRASTRUCTURE_UNEXPECTED_ERROR',
        category: status === 401 ? 'AUTH' : status === 403 ? 'PERMISSION' : 'INFRASTRUCTURE', retryable: status >= 500,
      } } });
      const payloads = { projects: { projects }, users: { users }, organizations: { organizations }, access: { access: [] } };
      return route.fulfill({ json: { ok: true, ...payloads[resource as keyof typeof payloads] } });
    }
    if (/^\/api\/admin\/users\/\d+\/organizations$/.test(path)) return route.fulfill({ json: { ok: true, organizations: [] } });
    if (['/api/projects', '/api/projects/recent', '/api/projects/favorites'].includes(path)) return route.fulfill({ json: { ok: true, projects: [] } });
    return route.fulfill({ json: { ok: true, projects: [], users: [], organizations: [], files: [], folders: [], items: [], enabled: false, notifications: [], unreadCount: 0 } });
  });
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto(options.path ?? `/admin?section=${options.section ?? 'overview'}`);
  // Bootstrap skeletons share headings and classes. Observe the real navigation
  // before measuring regions or advancing the frozen presentation clock.
  if (!options.path && (!options.role || options.role === 'super_admin')) await expect(page.locator('.admin-nav button')).toHaveCount(7);
  return { requests, attempts, mutations };
}

export const adminMetric = (page: Page, label: string) => page.locator('.admin-content .metric').filter({
  has: page.locator('span', { hasText: new RegExp(`^${label}$`) }),
});

export async function expectAdminFixtureIntegrity(page: Page) {
  expect(errors.get(page) ?? []).toEqual([]);
  expect(unexpectedWrites.get(page) ?? []).toEqual([]);
}

export async function saveSyntheticUser(page: Page) {
  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Nome completo', { exact: true }).fill('Pessoa pronta — atualizada');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar dados', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.admin-users-table')).toHaveAttribute('aria-busy', 'true');
}
