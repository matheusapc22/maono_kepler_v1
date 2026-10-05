import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { projectHeaderBaselineCommit, projectHeaderBaselines, restoreApprovedProjectsHeader } from './helpers/project-header-preservation.mjs';
import { progressiveBaselines, restoreAdminProjectsProgressiveLoading } from './helpers/admin-projects-progressive-preservation.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const hash = source => createHash('sha256').update(source).digest('hex');
const ui = 'src/pages/Projects/components/ProjectPagesUi.tsx';
const css = 'src/pages/Projects/components/ProjectPages.css';
const copy = 'src/pages/Projects/components/project-page-query.ts';
const hasOriginal = spawnSync('git', ['cat-file', '-e', `${projectHeaderBaselineCommit}^{commit}`], { cwd: root, stdio: 'ignore' }).status === 0;

for (const [path, expected] of Object.entries(projectHeaderBaselines)) {
  test(`approved header inverse preserves every other byte of ${path}`, () => {
    const restored = restoreApprovedProjectsHeader(path, read(path));
    assert.equal(hash(restored), expected);
    // The pinned full-file hashes enforce the contract even in shallow CI.
    // Available Git history supplies an additional independent byte comparison.
    if (hasOriginal) {
      const original = execFileSync('git', ['show', `${projectHeaderBaselineCommit}:${path}`], { cwd: root, encoding: 'utf8' });
      assert.equal(hash(original), expected, 'hash independently matches the approved pre-header commit');
      assert.equal(restored, original);
    }
  });
}

test('header normalization precedes the old loading inverse without changing its pinned baseline', () => {
  assert.equal(hash(restoreAdminProjectsProgressiveLoading(ui, read(ui))), progressiveBaselines[ui]);
});

const mutations = [
  [ui, 'name={section === "all" ? "map-pinned" : copy.icon}', 'name={section === "recent" ? "map-pinned" : copy.icon}'],
  [ui, 'm9 5-6 2v15l6-3', 'm9 5-6 2v15l7-3'],
  [ui, '{copy.description ? <p>', '{true ? <p>'],
  [ui, 'pending={structurePending}>{copy.title}', 'pending={false}>{copy.title}'],
  [ui, 'aria-hidden="true"', 'aria-hidden="false"'],
  [ui, 'to="/maps/new/create"', 'to="/projects"'],
  [ui, '{canCreateMap ? <Link', '{true ? <Link'],
  [ui, 'onClick={onNewMap}', 'onClick={onHome}'],
  [ui, 'onApply();', 'onClear();'],
  [ui, 'onPage(page + 1)', 'onPage(page + 2)'],
  [css, 'width: 42px; height: 42px;', 'width: 43px; height: 42px;'],
  [css, 'align-items: center; gap: 14px;', 'align-items: flex-start; gap: 14px;'],
  [css, 'color: var(--maono-accent-bright);', 'color: red;'],
  [css, 'padding: 24px 24px 20px;', 'padding: 30px 24px 20px;'],
  [css, 'grid-template-columns: repeat(4, minmax(0, 1fr));', 'grid-template-columns: repeat(3, minmax(0, 1fr));'],
  [copy, 'description: null, icon: "idea"', 'description: null, icon: "map-pinned"'],
  [copy, 'Veja os projetos acessados ou atualizados recentemente.', 'Novo texto de Recentes.'],
  [copy, 'Encontre rapidamente seus projetos favoritos.', 'Novo texto de Favoritos.'],
  [copy, '[10, 20, 50]', '[10, 25, 50]'],
];
for (const [path, before, after] of mutations) {
  test(`header scope guard rejects unrelated or altered delta: ${path}: ${before}`, () => {
    const original = read(path), mutated = original.replace(before, after);
    assert.notEqual(mutated, original, 'mutation must change actual source');
    assert.throws(() => {
      assert.equal(hash(restoreApprovedProjectsHeader(path, mutated)), projectHeaderBaselines[path]);
    }, assert.AssertionError);
  });
}

test('header inverse rejects missing and duplicated edits instead of accepting partial matches', () => {
  const original = read(css);
  const line = '.mm-project-pages .mm-project-pages__heading.mm-project-pages__heading--all { align-items: center; gap: 14px; }\n';
  const block = original.slice(original.indexOf(line), original.indexOf('.mm-project-pages .mm-project-pages__icon {'));
  assert.ok(block.startsWith(line));
  assert.throws(() => restoreApprovedProjectsHeader(css, original.replace(block, '')), assert.AssertionError);
  assert.throws(() => restoreApprovedProjectsHeader(css, original + block), assert.AssertionError);
});

test('header inverse leaves unrelated paths unchanged', () => {
  for (const path of ['src/pages/ProjectsSidebar.tsx', 'src/pages/Projects/components/ProjectCard.tsx']) {
    const source = read(path);
    assert.equal(restoreApprovedProjectsHeader(path, source), source);
  }
});
