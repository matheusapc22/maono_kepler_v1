import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { adminTicketDestination } from '../src/pages/Admin/components/admin-request-navigation.ts';
import { restoreApprovedAdminWorkspace, adminWorkspaceBaseline } from './helpers/admin-workspace-preservation.mjs';

const user = { id: 1, role: 'super_admin', email: 'qa@example.test' };
const organization = { id: 12, name: 'Organização sintética', active: true };
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('ticket shortcut uses only the active, session-confirmed organization', () => {
  assert.deepEqual(adminTicketDestination(user, organization, [organization]), {
    href: '/projects?cc_org=12&cc_view=list', organizationName: 'Organização sintética',
  });
  assert.equal(adminTicketDestination(user, { ...organization, id: 99 }, [organization]), null);
  assert.equal(adminTicketDestination(user, organization, []), null);
  assert.equal(adminTicketDestination(user, null, [organization]), null);
  assert.equal(adminTicketDestination(null, organization, [organization]), null);
  for (const role of ['viewer', 'editor', 'owner', 'admin']) assert.equal(adminTicketDestination({ ...user, role }, organization, [organization]), null);
});

test('inactive and malformed contexts never produce a destination', () => {
  for (const id of [0, -1, '01', '12&cc_org=99', '../13', '1e2', 9007199254740992, null, undefined]) {
    const invalid = { ...organization, id };
    assert.equal(adminTicketDestination(user, invalid, [invalid]), null);
  }
  assert.equal(adminTicketDestination(user, { ...organization, active: false }, [organization]), null);
  assert.equal(adminTicketDestination(user, organization, [{ ...organization, active: false }]), null);
});

test('requests extraction preserves full historical Admin authorization and loading baseline', () => {
  const source = read('src/pages/Admin.tsx');
  const restored = restoreApprovedAdminWorkspace('src/pages/Admin.tsx', source);
  assert.equal(createHash('sha256').update(restored).digest('hex'), adminWorkspaceBaseline);
  const weakened = source.replace('sessionAvailable={!error}', 'sessionAvailable={true}');
  assert.notEqual(weakened, source);
  assert.throws(() => restoreApprovedAdminWorkspace('src/pages/Admin.tsx', weakened));
});

test('navigation panel discloses limits, separates workflows and performs no reads or mutations', () => {
  const component = read('src/pages/Admin/components/AdminRequests.tsx');
  assert.match(component, /não consolida contagens/);
  assert.match(component, /Central de Chamados/);
  assert.match(component, /Revisões de mapas/);
  assert.match(component, /sessionAvailable && authenticated && !loading/);
  assert.match(component, /available \? adminTicketDestination/);
  assert.doesNotMatch(component, /fetch\(|localStorage|sessionStorage|setInterval|useEffect|dangerouslySetInnerHTML/);
  assert.doesNotMatch(component, /<strong>0<\/strong>|api\/admin|projects\.map|organizations\.map/);
  const projects = read('src/pages/Projects.tsx');
  assert.match(projects, /searchParams.get\('cc_org'\)/);
  assert.match(projects, /!organizations.some\(org => String\(org.id\) === target\)/);
  assert.match(projects, /setSidebarSection\('requests'\)/);
});
