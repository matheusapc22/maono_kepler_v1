import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const original = 'ba304ea3875dee6ed33bae1993b1bb247c9e0860';
const hasOriginal = spawnSync('git', ['cat-file', '-e', `${original}^{commit}`], { cwd: root, stdio: 'ignore' }).status === 0;
const requireOriginal = process.env.PROJECT_PAGES_REQUIRE_BASELINE === '1';
if (!hasOriginal) console.info('Original project-pages Git commit is unavailable in this checkout; every current-source SHA-256 is still enforced. The dedicated full-fetch workflow requires the original too.');
test('original Git baseline is available when the strict preservation gate requires it', () => {
  assert.ok(!requireOriginal || hasOriginal, `Missing required original commit ${original}; fetch full history before the strict gate.`);
});
// These hashes were recorded from the approved original before the redesign.
// Verify against both the pinned Git source and the working tree, not a new snapshot.
const preserved = {
  'functions/_lib/project-list.js': '2b23b69507d662c601f84ee8a86894958fb0559e30798c0ff3ac1acb2d209dbf',
  'src/pages/Projects/components/ProjectMapPlaceholder.tsx': 'f260981d2747ffb34f0460b983f3390e35835df1053cd52c6aabee8367cd9380',
  'src/pages/Projects/components/project-preview-presentation.mjs': '7bf63da2c68166c6471d7c609c2439d3a79c50e0f943800d8ef238834c3689a4',
  'src/pages/Projects/components/DocumentsSection.css': '63e76b77979cc356f9512e8e94e8a8ab4708320fea13b17d874168c14e6a2a1d',
  'src/pages/Projects/components/DocumentsSection.tsx': '3ba808d43d1883ec83a9c63a76e7b3c1d608dd8d62ca9d12f3ffa31adf9fc37a',
  'src/pages/Projects/components/ProjectCard.tsx': 'e170bbe69b288dc2c21068a62dc15340703c198516e3610c4c86efdffea14426',
  'src/pages/Projects/components/project-cards.css': '46b441eb5242b3b78e8de8f2a077dead9a9c3a671dfeb0fb6e2e49a7602bf44c',
  'src/pages/Projects/components/project-card-utils.ts': 'cb69b125c61dc8204f5876c63aa8f3698289a100e7cf2db235b1f849083479c7',
  'src/pages/Projects/components/ProjectActionsMenu.tsx': 'f9832c27f0e46004eb7ba92ad9655fef61d7617ab7118f0c6aa54b879bba21f2',
  'src/pages/Projects/components/ProjectMetadataPanel.tsx': '2f49b53dd47e8e9540b027febab2fb6394b0905c8008905edb4a7632c630dbb8',
  'src/pages/Projects/maono-card-list-accent.css': 'aa117f523564c51956d5d683c00a38389ab1672ed8d3aadd11a82d49336dbd69',
  'src/pages/Projects/projects-api.ts': '658b7edb0a98434bbaade6eed1c8a582d5fe73c0397b079967e9bf48e7d5b0a9',
  'src/pages/ProjectsSidebar.tsx': '0a696c4f2068b59e55bad14235e65929a6383a604ce03f5d003e11a318ce2cff',
  'functions/api/projects/index.js': 'e0d4cc187c5e02de4d07009e30c39e02981302a1afa512bf3927d59f2bf03036',
  'functions/api/projects/recent.js': '5899804a88b2cb49f0ae66cc607a3285f0890c5dcb048c592777689b5f176b44',
  'functions/api/projects/favorites.js': '865f51ebd6921535e23176d29672bf5b63cba98520eaa8fa1ff46d4afcb69cbd',
};
const sha256 = text => createHash('sha256').update(text).digest('hex');
for (const [path, expected] of Object.entries(preserved)) {
  test(`preserves original source: ${path}`, () => {
    assert.equal(sha256(read(path)), expected, 'no card, action, sidebar or endpoint edits');
    if (hasOriginal) {
      const fromGit = execFileSync('git', ['show', `${original}:${path}`], { cwd: root, encoding: 'utf8' });
      assert.equal(sha256(fromGit), expected, 'pinned original is independently verified');
    }
  });
}

const bundle = await build({ entryPoints: [new URL('src/pages/Projects/components/project-page-query.ts', root).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { filterAndSortProjects, projectPage, PROJECT_PAGE_COPY, DEFAULT_PROJECT_FILTERS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sample = Array.from({ length: 173 }, (_, i) => ({
  id: i + 1, name: `Projeto ${String(i + 1).padStart(3, '0')}`, slug: `projeto-${i + 1}`,
  description: i === 172 ? 'Marcador fora da primeira página' : 'Descrição', active: i % 3 !== 0,
  accessLevel: 'viewer', organizationId: 7, updatedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
}));
const filters = overrides => ({ ...DEFAULT_PROJECT_FILTERS, ...overrides });

test('exact approved copy and icons are shared by all three sections', () => {
  assert.deepEqual(Object.keys(PROJECT_PAGE_COPY), ['all', 'recent', 'favorites']);
  assert.deepEqual(Object.values(PROJECT_PAGE_COPY).map(item => [item.title, item.description, item.icon]), [
    ['Todos os Projetos', 'Visualize e gerencie todos os seus projetos.', 'idea'],
    ['Recentes', 'Veja os projetos acessados ou atualizados recentemente.', 'clock'],
    ['Favoritos', 'Encontre rapidamente seus projetos favoritos.', 'star'],
  ]);
});

test('filters and sorts the full endpoint set before paging, without mutating input', () => {
  const before = structuredClone(sample);
  const filtered = filterAndSortProjects(sample, filters({ status: 'inactive', order: 'oldest' }));
  assert.equal(filtered.length, 58);
  assert.deepEqual(filtered.map(item => item.id), sample.filter(item => !item.active).map(item => item.id));
  assert.deepEqual(projectPage(filtered, 6, 10).items.map(item => item.id), filtered.slice(50).map(item => item.id));
  assert.equal(projectPage(filtered, 6, 10).total, 58);
  assert.deepEqual(sample, before);
  assert.notEqual(filtered, sample);
});

test('search trims/case-folds and preserves existing searchable sidebar fields', () => {
  for (const query of ['  PROJETO 173  ', 'projeto-173', 'marcador fora da primeira página']) {
    assert.deepEqual(filterAndSortProjects(sample, filters({ search: query })).map(item => item.id), [173]);
  }
  assert.equal(filterAndSortProjects(sample, filters({ search: 'viewer' })).length, 173);
  assert.equal(filterAndSortProjects(sample, filters({ search: 'sem resultado' })).length, 0);
});

test('active/inactive uses real active field, independent of favorite or save access', () => {
  const items = [
    { ...sample[0], id: 1, active: false, favorite: true, accessLevel: 'owner' },
    { ...sample[0], id: 2, active: true, favorite: false, accessLevel: 'viewer' },
    { ...sample[0], id: 3, active: undefined, favorite: true, accessLevel: 'editor' },
  ];
  assert.deepEqual(filterAndSortProjects(items, filters({ status: 'inactive' })).map(item => item.id), [1]);
  assert.deepEqual(filterAndSortProjects(items, filters({ status: 'active' })).map(item => item.id).sort(), [2, 3]);
});

test('ordering is deterministic with createdAt fallback, invalid dates last, and name/slug ties', () => {
  const items = [
    { ...sample[0], id: 1, name: 'B', updatedAt: '2026-01-02T00:00:00Z' },
    { ...sample[0], id: 2, name: 'A', updatedAt: '2026-01-02T00:00:00Z', slug: 'z' },
    { ...sample[0], id: 3, name: 'A', updatedAt: '2026-01-02T00:00:00Z', slug: 'a' },
    { ...sample[0], id: 4, name: 'Unknown', updatedAt: 'invalid' },
    { ...sample[0], id: 5, updatedAt: '', createdAt: '2026-01-01T00:00:00Z' },
  ];
  assert.deepEqual(filterAndSortProjects(items, filters({ order: 'recent' })).map(item => item.id), [3, 2, 1, 5, 4]);
  assert.deepEqual(filterAndSortProjects(items, filters({ order: 'oldest' })).map(item => item.id), [5, 3, 2, 1, 4]);
});

test('page size choices and true total remain correct through the last page', () => {
  for (const size of [10, 20, 50]) {
    const pageCount = Math.ceil(sample.length / size);
    const last = projectPage(sample, pageCount, size);
    assert.equal(last.total, 173); assert.equal(last.pageCount, pageCount);
    assert.equal(last.items.length, 173 - size * (pageCount - 1));
    assert.deepEqual(last.items, sample.slice(size * (pageCount - 1)));
    assert.equal(projectPage(sample, pageCount + 100, size).page, pageCount);
  }
  assert.equal(projectPage(sample, 1, 25).pageSize, 10);
});

test('empty, invalid pages and removing the only final-page item clamp before slicing', () => {
  assert.deepEqual(projectPage([], 9, 20), { items: [], total: 0, page: 1, pageCount: 1, pageSize: 20 });
  for (const invalid of [-3, 0, NaN]) assert.equal(projectPage(sample, invalid, 10).page, 1);
  assert.equal(projectPage(sample, 1.9, 10).page, 1);
  const page = projectPage(sample.slice(0, 10), 2, 10);
  assert.equal(page.page, 1); assert.equal(page.items.length, 10); assert.equal(page.total, 10);
});

test('new styles are scoped to project pages and only the grid container affects cards', () => {
  const css = read('src/pages/Projects/components/ProjectPages.css');
  const parsed = postcss.parse(css);
  parsed.walkRules(rule => {
    for (const selector of rule.selectors) assert.ok(/^\.mm-project-pages(?:[.#:[\s]|$)/.test(selector), selector);
    assert.ok(!rule.selector.includes('.mm-project-card'), 'no card internals restyled');
  });
  parsed.walkDecls(declaration => {
    assert.equal(Boolean(declaration.important), false, 'no !important scope escapes');
    assert.notEqual(declaration.prop, 'zoom');
    assert.ok(!/^--(?:project|maono)/.test(declaration.prop), 'no inherited card token edits');
  });
  assert.match(css, /@container project-pages/);
  for (const columns of [4, 3, 2]) assert.ok(css.includes(`repeat(${columns}, minmax(0, 1fr))`));
});

test('native accessible controls, footer live count and new-map permission wiring remain explicit', () => {
  const ui = read('src/pages/Projects/components/ProjectPagesUi.tsx');
  for (const token of ['aria-label="Caminho da página"', 'aria-label="Filtros de projetos"', 'Nome do projeto...', 'Todos os status', 'Mais recentes', 'Mais antigos', 'Limpar filtros', 'aria-label="Paginação dos projetos"', 'Itens por página', 'Exibindo {visibleCount}/{total}.', 'aria-current="page"', 'aria-live="polite"', 'canCreateMap ?']) assert.ok(ui.includes(token), token);
  const section = read('src/pages/Projects/components/ProjectsSection.tsx');
  assert.ok(section.includes('filterAndSortProjects(')); assert.ok(section.includes('projectPage('));
  for (const token of ['prepareProjectMapDestination(', 'fetchProjectThumbnailStatus(', '<ProjectMetadataPanel', 'onFavoriteToggle={onFavoriteToggle}', 'visibleProjects.map(']) assert.ok(section.includes(token), token);
  const shell = read('src/pages/Projects.tsx');
  for (const token of ['PERMISSION.PROJECT_CREATE', 'setProjectFavorite(', 'requestOrganizationKey !== activeOrganizationKeyRef.current']) assert.ok(shell.includes(token), token);
});
