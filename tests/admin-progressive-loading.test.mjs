import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import { restoreAdminProjectsProgressiveLoading, progressiveBaselines } from './helpers/admin-projects-progressive-preservation.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const admin = read('src/pages/Admin.tsx');
const projects = read('src/pages/Projects.tsx');
const grid = read('src/pages/Projects/components/ProjectsSection.tsx');
const card = read('src/pages/Projects/components/ProjectCard.tsx');
const ui = read('src/pages/Projects/components/ProjectPagesUi.tsx');
const policy = transformSync(read('src/components/loading/region-loading-policy.ts'), { loader: 'ts', format: 'esm' }).code;
const { isRegionAccessDenied, isRegionAuthenticationError } = await import(`data:text/javascript;base64,${Buffer.from(policy).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function compileCallback(source, start, end, context) {
  const expression = source.slice(source.indexOf(start) + start.length, source.indexOf(end, source.indexOf(start)));
  const { code } = transformSync(`const callback = ${expression};`, { loader: 'ts', target: 'es2022' });
  return new Function(...Object.keys(context), `${code}\nreturn callback;`)(...Object.values(context));
}
function adminHarness() {
  const state = { projects: [], users: [], organizations: [], access: [], error: '', usersAccessEpoch: 0, regions: Object.fromEntries(['projects', 'users', 'organizations', 'access'].map(key => [key, { pending: true, loaded: false, error: '' }])) };
  const requests = [], requestRef = { current: 0 }, controllerRef = { current: null };
  const set = key => next => { state[key] = typeof next === 'function' ? next(state[key]) : next; };
  const refresh = compileCallback(admin, 'const refreshAdminData = useCallback(', ', []);', {
    requestRef, controllerRef, AbortController, isRegionAccessDenied, isRegionAuthenticationError, setUsersAccessEpoch: set('usersAccessEpoch'),
    setError: set('error'), setRegions: set('regions'), setProjects: set('projects'), setUsers: set('users'), setOrganizations: set('organizations'), setAccess: set('access'),
    readJson: response => response,
    normalizeUserError: error => ({ message: error.message || 'Falha simulada' }),
    fetch: (path, options) => { const gate = deferred(); requests.push({ path, options, ...gate }); return gate.promise; },
  });
  return { state, requests, refresh, requestRef, controllerRef, resolve(index, data) { requests[index].resolve(data); } };
}
function settleBatch(h, start, suffix = '') {
  h.resolve(start, { projects: [{ id: 1, name: `Projeto${suffix}` }] });
  h.resolve(start + 1, { access: [{ id: 1 }], users: [{ id: 9 }] });
  h.resolve(start + 2, { users: [{ id: 2, name: `Usuário${suffix}` }] });
  h.resolve(start + 3, { organizations: [{ id: 3, name: `Organização${suffix}` }] });
}

test('Admin starts all four original authorized GETs immediately and reveals each result independently', async () => {
  const h = adminHarness(), finished = h.refresh();
  assert.deepEqual(h.requests.map(request => request.path), ['/api/admin/projects', '/api/admin/access', '/api/admin/users', '/api/admin/organizations']);
  assert.ok(h.requests.every(request => request.options.credentials === 'include' && request.options.signal));
  h.resolve(0, { projects: [{ id: 1 }] }); await tick();
  assert.equal(h.state.regions.projects.loaded, true); assert.equal(h.state.regions.projects.pending, false);
  assert.equal(h.state.regions.organizations.pending, true); assert.equal(h.state.regions.users.pending, true);
  h.resolve(2, { users: [{ id: 5 }] }); await tick();
  assert.deepEqual(h.state.users, [{ id: 5 }]); assert.equal(h.state.regions.access.pending, true);
  h.requests[3].reject(new Error('Organizações indisponíveis')); h.resolve(1, { access: [] }); await finished;
  assert.equal(h.state.regions.organizations.pending, false); assert.match(h.state.regions.organizations.error, /indisponíveis/);
  assert.equal(h.state.projects.length, 1); assert.equal(h.state.users.length, 1);
});

test('successful users response retains authoritative empty arrays and only falls back when users are omitted', async () => {
  for (const usersData of [{ users: [] }, {}]) {
    const h = adminHarness(), finished = h.refresh();
    h.resolve(0, { projects: [] }); h.resolve(3, { organizations: [] });
    h.resolve(2, usersData); await tick();
    if (!usersData.users) assert.equal(h.state.regions.users.pending, true);
    else assert.equal(h.state.regions.users.loaded, true);
    h.resolve(1, { users: [{ id: 9 }], access: [] }); await finished;
    assert.deepEqual(h.state.users, usersData.users || [{ id: 9 }]);
  }
  const h = adminHarness(), finished = h.refresh();
  h.resolve(0, { projects: [] }); h.resolve(1, { users: [{ id: 9 }] }); h.resolve(3, { organizations: [] });
  h.requests[2].reject(new Error('Users request failed')); await finished;
  assert.deepEqual(h.state.users, []); assert.equal(h.state.regions.users.loaded, false);
});

test('refresh preserves valid data on transient failure but denied regions discard it', async () => {
  const h = adminHarness(), first = h.refresh(); settleBatch(h, 0); await first;
  const second = h.refresh();
  assert.equal(h.state.projects[0].name, 'Projeto'); assert.equal(h.state.regions.projects.loaded, true);
  h.requests[4].reject(Object.assign(new Error('Service unavailable'), { status: 503 }));
  h.resolve(5, { access: [] }); h.requests[6].reject(Object.assign(new Error('Forbidden'), { status: 403 })); h.resolve(7, { organizations: [] });
  await second;
  assert.equal(h.state.projects.length, 1); assert.equal(h.state.regions.projects.pending, false);
  assert.deepEqual(h.state.users, []); assert.equal(h.state.regions.users.loaded, false); assert.equal(h.state.regions.users.pending, false);
});

test('Admin authentication loss invalidates companions so their late successes cannot restore private data', async () => {
  const h = adminHarness(), first = h.refresh(); settleBatch(h, 0); await first;
  const next = h.refresh();
  h.requests[6].reject(Object.assign(new Error('Session expired'), { status: 401, code: 'AUTH_SESSION_EXPIRED' }));
  await tick();
  assert.ok(h.requests.slice(4).every(request => request.options.signal.aborted));
  assert.ok(Object.values(h.state.regions).every(region => !region.pending && !region.loaded));
  h.resolve(4, { projects: [{ id: 99 }] }); h.resolve(5, { access: [{ id: 99 }] }); h.resolve(7, { organizations: [{ id: 99 }] });
  await next;
  for (const key of ['projects', 'users', 'organizations', 'access']) assert.deepEqual(h.state[key], []);
  assert.equal(h.state.usersAccessEpoch, 1);
  assert.match(admin, /onMessage=\{handleMessage\}/);
  assert.match(admin, /const handleMessage = useCallback/);
});

test('a newer refresh wins even if an aborted old request subsequently resolves', async () => {
  const h = adminHarness(), old = h.refresh(), latest = h.refresh();
  assert.equal(h.requests[0].options.signal.aborted, true);
  settleBatch(h, 4, ' novo'); await latest;
  const expected = structuredClone(h.state);
  settleBatch(h, 0, ' antigo'); await old;
  assert.deepEqual(h.state, expected);
});

test('unmount or authorization-context invalidation prevents pending reads from publishing', async () => {
  const h = adminHarness(), pending = h.refresh();
  h.requestRef.current += 1; h.controllerRef.current.abort();
  const before = structuredClone(h.state); settleBatch(h, 0); await pending;
  assert.deepEqual(h.state, before);
  assert.match(admin, /return <AdminWorkspace key=\{contextKey\}/);
  for (const field of ['user?.id', 'user?.role', 'user?.activeOrganizationId', 'user?.permissions', 'user?.deniedPermissions']) assert.ok(admin.includes(field));
});

function projectHarness() {
  const state = { items: [], all: [], dataKey: null, loaded: null, error: null, loading: false };
  const requests = [], sequence = { current: 0 }, controller = { current: null }, org = { current: '1' }, dataKeyRef = { current: null };
  const setter = key => next => { state[key] = next; if (key === 'dataKey') dataKeyRef.current = next; };
  const refresh = compileCallback(projects, 'const loadProjectSection = useCallback(\n    ', ',\n    [activeOrganizationId]', {
    activeOrganizationId: 1, projectsRequestSequenceRef: sequence, projectsRequestControllerRef: controller,
    activeOrganizationKeyRef: org, projectDataKeyRef: dataKeyRef, favoriteOverridesRef: { current: new Map() },
    AbortController, DOMException, isRegionAccessDenied, setAllProjects: setter('all'), setAllProjectsReadState: setter('allReadState'), setProjectItems: setter('items'), setProjectDataKey: setter('dataKey'), setLoadedProjectSection: setter('loaded'), setProjectsLoading: setter('loading'), setProjectsError: setter('error'), setProjectsContextKey: () => {},
    fetchProjects: (_section, options) => { const gate = deferred(); requests.push({ options, ...gate }); return gate.promise; },
    normalizeUserError: error => ({ message: error.message || 'Falha simulada' }), sameProject: (a, b) => a.id === b.id,
  });
  return { state, refresh, requests, org };
}

test('Projects preserves same-region successful results on transient errors and clears 403 results', async () => {
  const h = projectHarness(), first = h.refresh('all'); h.requests[0].resolve([{ id: 1, slug: 'mapa' }]); await first;
  const second = h.refresh('all'); h.requests[1].reject(Object.assign(new Error('Retryable'), { status: 503 })); await second;
  assert.equal(h.state.items.length, 1); assert.equal(h.state.dataKey, '["1","all"]'); assert.equal(h.state.loading, false);
  const denied = h.refresh('all'); h.requests[2].reject(Object.assign(new Error('Denied'), { status: 403 })); await denied;
  assert.deepEqual(h.state.items, []); assert.deepEqual(h.state.all, []); assert.equal(h.state.dataKey, null);
});

test('Projects never reuses another section result or accepts an old context response', async () => {
  const h = projectHarness(), first = h.refresh('all'); h.requests[0].resolve([{ id: 1 }]); await first;
  const differentSection = h.refresh('recent'); h.requests[1].reject(Object.assign(new Error('Retryable'), { status: 503 })); await differentSection;
  assert.deepEqual(h.state.items, []); assert.equal(h.state.dataKey, null);
  const obsolete = h.refresh('all'), latest = h.refresh('favorites'); h.requests[3].resolve([{ id: 5, favorite: true }]); await latest;
  h.requests[2].resolve([{ id: 6 }]); await obsolete; assert.equal(h.state.items[0].id, 5);
  const oldOrganization = h.refresh('all'); h.org.current = '2'; h.requests[4].resolve([{ id: 9 }]); await oldOrganization; assert.equal(h.state.items[0].id, 5);
});

test('sidebar counts distinguish unknown session defaults, valid cached counts, authoritative zero and denied access', () => {
  const start = projects.indexOf('  const currentAllProjectsRead =');
  const end = projects.indexOf('\n\n  useEffect(', start);
  const code = transformSync(projects.slice(start, end), { loader: 'ts', target: 'es2022' }).code;
  const count = new Function('allProjectsReadState', 'activeOrganizationKey', 'projectContextIsCurrent', 'allProjects', 'sessionProjects', 'useMemo', `${code}; return activeProjectsCount;`);
  const get = (readState, all, session, organizationKey = '1') => count(readState, organizationKey, true, all, session, callback => callback());
  assert.equal(get(null, [], []), null);
  assert.equal(get(null, [], [{ active: true }, { active: false }]), 1);
  assert.equal(get({ organizationKey: '1', status: 'ready' }, [], [{ active: true }]), 0);
  assert.equal(get({ organizationKey: '1', status: 'ready' }, [{ active: true }], []), 1);
  assert.equal(get({ organizationKey: '1', status: 'denied' }, [], [{ active: true }]), null);
  assert.equal(get({ organizationKey: '1', status: 'ready' }, [{ active: true }], [], '2'), null);
});

test('pending footer does not invent totals and resolved grid/filter controls stay mounted', () => {
  assert.match(grid, /ProjectGridSkeleton pageSize=\{pageSize\} announce=\{false\}/);
  assert.match(grid, /loading && !loaded/); assert.match(grid, /disabled=\{false\}/);
  assert.match(ui, /refreshing \? `Exibindo \$\{visibleCount\}\/\$\{total\}\. Atualizando projetos\.` : "Carregando projetos\."/);
  assert.match(ui, /<LoadingStatus loading=\{loading\}/);
  assert.doesNotMatch(admin, /!hasLoaded|admin-main" aria-busy/);
});

test('thumbnail loading is scoped to preview, with decode/error guards and ready content preserved', () => {
  const article = card.slice(card.indexOf('<article'), card.indexOf('>\n      <div', card.indexOf('<article')));
  assert.doesNotMatch(article, /aria-busy/);
  assert.match(card, /className="mm-project-card__preview"\s+aria-busy=\{previewBusy\}/);
  assert.match(card, /if \(displayedSourceRef.current !== failedUrl\) return/);
  assert.match(card, /return \(\) => \{ displayedSourceRef.current = null; \}/);
  assert.match(card, /presentation === "loading-neutral" \? <Skeleton/);
  assert.match(card, /<LoadingStatus loading=\{previewBusy\}/);
});

test('strict inverses preserve all prior Admin user controls, project selectors and shell business code', () => {
  for (const [path, hash] of Object.entries(progressiveBaselines)) {
    const source = read(path), restored = restoreAdminProjectsProgressiveLoading(path, source);
    assert.equal(createHash('sha256').update(restored).digest('hex'), hash, path);
  }
  const path = 'src/pages/Admin/components/AdminUserManagerLegacy.tsx', source = read(path);
  const mutated = source.replace('onClick={() => setCreating(true)}', 'onClick={() => setCreating(false)}');
  assert.notEqual(mutated, source);
  let rejected = false;
  try { rejected = createHash('sha256').update(restoreAdminProjectsProgressiveLoading(path, mutated)).digest('hex') !== progressiveBaselines[path]; }
  catch (error) { assert.ok(error instanceof assert.AssertionError); rejected = true; }
  assert.equal(rejected, true, 'unrelated creation behavior must not be accepted as a loading delta');
});

const presentationCode = transformSync(read('src/components/loading/initial-loading-presentation.ts'), { loader: 'ts', format: 'esm' }).code;
const { advanceInitialLoadingPresentation: advancePresentation, readInitialLoadingPresentation: presentationState } = await import(`data:text/javascript;base64,${Buffer.from(presentationCode).toString('base64')}`);

test('Admin fast responses update real data immediately while titles precede volatile presentation at80/260ms', async () => {
  const h = adminHarness();
  const input = () => ({ scopeKey: 'admin-projects', pending: h.state.regions.projects.pending, hasData: h.state.regions.projects.loaded, failed: Boolean(h.state.regions.projects.error) });
  let visual = advancePresentation(null, input(), 0);
  const done = h.refresh(); settleBatch(h, 0); await done;
  assert.equal(h.state.regions.projects.pending, false);
  assert.equal(h.state.projects[0].name, 'Projeto');
  visual = advancePresentation(visual, input(), 30);
  assert.deepEqual(presentationState(visual), { structurePending: true, contentPending: true });
  visual = advancePresentation(visual, input(), 80);
  assert.deepEqual(presentationState(visual), { structurePending: false, contentPending: true });
  visual = advancePresentation(visual, input(), 259);
  assert.equal(presentationState(visual).contentPending, true);
  visual = advancePresentation(visual, input(), 260);
  assert.deepEqual(presentationState(visual), { structurePending: false, contentPending: false });
  assert.match(admin, /pending: regions\.projects\.pending, hasData: regions\.projects\.loaded/);
  assert.match(admin, /contentPending=\{projectPresentation\.contentPending\}/);
  assert.match(admin, /<h1><StaticLoadingText pending=\{structurePending\}>\{sectionTitle\(section\)\}/);
});

test('Projects slow responses reveal immediately after total minimum; valid refresh snapshots never replay stages', async () => {
  const h = projectHarness(), done = h.refresh('all');
  const input = () => ({ scopeKey: '1:all', pending: h.state.loading, hasData: h.state.dataKey === '["1","all"]', failed: Boolean(h.state.error) });
  let visual = advancePresentation(null, input(), 0);
  visual = advancePresentation(visual, input(), 500);
  assert.deepEqual(presentationState(visual), { structurePending: false, contentPending: true });
  h.requests[0].resolve([{ id: 1, slug: 'ready' }]); await done;
  visual = advancePresentation(visual, input(), 500);
  assert.deepEqual(presentationState(visual), { structurePending: false, contentPending: false });
  const refresh = h.refresh('all'); visual = advancePresentation(visual, input(), 510);
  assert.deepEqual(presentationState(visual), { structurePending: false, contentPending: false });
  assert.deepEqual(presentationState(advancePresentation(null, input(), 510)), { structurePending: false, contentPending: false });
  h.requests[1].resolve([]); await refresh;
  assert.match(grid, /style=\{contentPending \? \{ display: "none" \} : undefined\}/);
  assert.match(grid, /contentPending && !loaded \|\| !loaded && error/);
  assert.match(grid, /refreshing=\{loaded && !contentPending\}/);
  assert.match(grid, /initialPresentationPending=\{contentPending && index < initialPreviewCount\}/);
  assert.match(grid, /initialPreviewCount = useSkeletonCount\(\{ layout: "grid", pageSize \}\)/);
  assert.match(card, /loading=\{initialPresentationPending \|\| showGenerationSvg \? "eager" : "lazy"\}/);
  assert.doesNotMatch(projects.slice(projects.indexOf('const loadProjectSection = useCallback('), projects.indexOf('    [activeOrganizationId],')), /setTimeout|structurePending|contentPending/);
});

test('initial presentation inverses reject changed permissions, payloads, destinations and timer settings', () => {
  for (const [path, before, after] of [
    ['src/pages/Projects.tsx', 'PERMISSION.PROJECT_CREATE,', 'PERMISSION.PROJECT_EDIT,'],
    ['src/pages/ProjectsSidebar.tsx', 'return isSuperAdmin(user);', 'return true;'],
    ['src/pages/Admin/components/AdminUserManagerLegacy.tsx', 'method: "PATCH",', 'method: "POST",'],
    ['src/pages/Projects/components/ProjectPagesUi.tsx', 'to="/maps/new/create"', 'to="/projects"'],
    ['src/pages/Projects.tsx', 'scopeKey: JSON.stringify([user?.id, activeOrganizationKey, sidebarSection])', 'scopeKey: projectsLoading'],
  ]) {
    const original = read(path), mutated = original.replace(before, after);
    assert.notEqual(original, mutated, path);
    let rejected = false;
    try { rejected = createHash('sha256').update(restoreAdminProjectsProgressiveLoading(path, mutated)).digest('hex') !== progressiveBaselines[path]; }
    catch (error) { assert.ok(error instanceof assert.AssertionError); rejected = true; }
    assert.equal(rejected, true, `${path}: ${before}`);
  }
});

test('Admin loading announcements distinguish first partial/held results from refreshes of revealed regions', () => {
  const expression = admin.match(/<LoadingStatus loading=\{isRefreshing \|\| presentationPending\} refreshing=\{([^}]+)\}/)?.[1];
  assert.ok(expression);
  const refreshing = new Function('regions', 'projectPresentation', 'organizationPresentation', 'userPresentation', `return (${expression});`);
  const pending = { pending: true, loaded: false }, ready = { pending: false, loaded: true }, updating = { pending: true, loaded: true };
  const held = { contentPending: true }, shown = { contentPending: false };
  assert.equal(refreshing({ projects: ready, organizations: pending, users: pending }, shown, held, held), false, 'one revealed initial result is not a refresh of other pending regions');
  assert.equal(refreshing({ projects: ready, organizations: ready, users: ready }, held, held, held), false, 'fast ready data still in initial presentation is not updating');
  assert.equal(refreshing({ projects: updating, organizations: ready, users: ready }, shown, shown, shown), true, 'a real refresh of mounted data is updating');
  assert.equal(refreshing({ projects: ready, organizations: ready, users: updating }, shown, shown, shown), true);
});
