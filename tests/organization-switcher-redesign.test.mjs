import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const switcher = read('src/pages/Projects/components/OrganizationWorkspaceSwitcher.tsx');
const css = postcss.parse(read('src/pages/Projects/projects.css'));
const bundle = await build({ entryPoints: [new URL('src/pages/Projects/components/organization-switcher-position.ts', root).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { organizationMenuPosition } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

for (const expanded of [true, false]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }, { width: 240, height: 220 }]) {
    test(`organization popover clamps independently of sidebar at ${viewport.width}px, expanded=${expanded}`, () => {
      for (const rect of [
        { left: 12, right: 228, top: 170, bottom: 214 },
        { left: viewport.width - 56, right: viewport.width - 12, top: viewport.height - 70, bottom: viewport.height - 20 },
      ]) {
        const result = organizationMenuPosition(rect, viewport, expanded, 526);
        assert.equal(result.width, Math.min(340, viewport.width - 16));
        assert.ok(result.left >= 8 && result.left + result.width <= viewport.width - 8);
        assert.ok(result.top >= 8);
        assert.ok(result.top + Math.min(result.maxHeight, 526) <= viewport.height - 8);
      }
    });
  }
}

test('expanded organization panel flips upward when there is more room above', () => {
  const result = organizationMenuPosition({ left: 12, right: 228, top: 680, bottom: 724 }, { width: 1440, height: 800 }, true, 500);
  assert.equal(result.top, 172);
  assert.equal(result.width, 340);
});

test('search filters only the existing accessible list and uses unchanged switch operation', () => {
  assert.match(switcher, /organizations\.filter\(\(organization\) => organization\.active !== false\)/);
  assert.match(switcher, /search\.trim\(\)\.toLocaleLowerCase\(\)/);
  assert.match(switcher, /\.toLocaleLowerCase\(\)\.includes\(query\)/);
  assert.match(switcher, /await onSwitch\(organization\.id\)/);
  assert.equal((switcher.match(/await onSwitch\(/g) || []).length, 1);
  assert.doesNotMatch(switcher, /\bfetch\(|window\.alert|localStorage/);
  assert.match(switcher, /selectionPendingRef\.current = true/);
  assert.match(switcher, /epoch === menuEpochRef\.current/);
  assert.match(switcher, /onDismissError\?\.\(\)/);
});

test('popover has one search outside its scrollable list, active semantics and portal', () => {
  assert.match(switcher, /createPortal\(/);
  assert.match(switcher, /document\.body/);
  assert.match(switcher, /role="dialog"/);
  assert.match(switcher, /role="listbox"/);
  assert.match(switcher, /aria-selected=\{selected\}/);
  assert.match(switcher, /Selecione um contexto de trabalho/);
  assert.match(switcher, /placeholder="Buscar organização\.\.\."/);
  assert.match(switcher, /Nenhuma organização encontrada/);
  const declarations = selector => {
    const rule = css.nodes.find(node => node.type === 'rule' && node.selector === selector);
    return Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  };
  assert.equal(declarations('.mm-organization-menu').overflow, 'hidden');
  assert.equal(declarations('.mm-organization-options')['overflow-y'], 'auto');
  assert.equal(declarations('.mm-organization-options')['max-height'], '380px');
  assert.equal(declarations('.mm-organization-option')['min-height'], '56px');
  assert.equal(declarations('.mm-organization-option').border, '1px solid transparent');
});

// The revision only changes two presentation components. Freeze their callers,
// organization/session/permission implementation and existing page chrome independently.
const preserved = {
  'src/pages/Projects.tsx': 'e7158f587b6e5ad64f1998e34c076a3c490cf9db490430bd87861d039ad3f479',
  'src/pages/ProjectsSidebar.tsx': '7693f4946859773bb32d7b049e8daf733bf2e2e5e91cc2c4ebd9d14e21626fdc',
  'src/pages/Projects/components/ProjectsSection.tsx': '050c9def25565a1a734f66bbe5f3d7782c9862c72fb038db1f42b9af02ac3c67',
  'src/pages/Projects/components/ProjectPagesUi.tsx': '59ed8bb3a1be8890f526626dc0aa70017da27d9d8a9db2249f2d13157d8b6769',
  'src/pages/Projects/components/ProjectPages.css': 'e3209cd406d33a84e8cf960c3bc3abda0179931c1cf34b0db33a952dfd18b9a3',
  'src/auth/session.tsx': '57e2f47d3831c6564e85c8ede8c3cf1eb3724ae6501e5dddbea9b2dbc03a2d09',
  'src/platform-density.css': '18ca17d6a9a4b0394ba9cff2352ac8d8b9617c11e32d6488937cc49e29360152',
};
for (const [path, hash] of Object.entries(preserved)) {
  test(`card/switcher revision preserves ${path}`, () => {
    assert.equal(createHash('sha256').update(read(path)).digest('hex'), hash);
  });
}

test('card preview lifecycle is unchanged by the new root interaction', () => {
  const card = read('src/pages/Projects/components/ProjectCard.tsx');
  const preview = source => source.slice(source.indexOf('  const thumbnailStatus ='), source.includes('  const openProject =') ? source.indexOf('  const openProject =') : source.indexOf('  const cardClassName ='))
    .replace(/  const accessLevel = normalizeProjectAccessLevel\(project\.accessLevel\);\n  const isOwner = accessLevel === "owner";\n/, '');
  const expected = '5ff89d56f48d3354446a2caaee1e554b3afd23dd34588754f71dd38674c0b8b0';
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(preview(card)), expected, 'preview lifecycle stays byte-identical');
  const original = 'f22863de68f4f86e75bebea8f399f8b3d28d9e2e';
  const hasOriginal = spawnSync('git', ['cat-file', '-e', original], { cwd: root, stdio: 'ignore' }).status === 0;
  assert.ok(hasOriginal || process.env.PROJECT_PAGES_REQUIRE_BASELINE !== '1', 'strict project gate must fetch the original');
  if (hasOriginal) {
    const old = execFileSync('git', ['show', original + ':src/pages/Projects/components/ProjectCard.tsx'], { cwd: root, encoding: 'utf8' });
    assert.equal(hash(preview(old)), expected, 'independently verified against approved original');
  }
});


test('organization chevron is a single rotating vector; every other trigger and popover operation is unchanged', () => {
  assert.doesNotMatch(switcher, /open \? "⌃" : "⌄"/);
  assert.equal((switcher.match(/className="mm-organization-chevron-icon"/g) || []).length, 1);
  const withoutVector = switcher.replace(/<svg\s+className="mm-organization-chevron-icon"[\s\S]*?<\/svg>/, '<span aria-hidden="true">{open ? "⌃" : "⌄"}</span>');
  assert.equal(createHash('sha256').update(withoutVector).digest('hex'), '2242ef1796384ed87b00e5919af05c4f52b670a910a601dd0338dafaf73b9729');
  const icon = css.nodes.find(node => node.type === 'rule' && node.selector === '.mm-organization-chevron-icon');
  const declarations = Object.fromEntries(icon.nodes.map(node => [node.prop, node.value]));
  assert.equal(declarations['transform-origin'], 'center');
  assert.equal(declarations.transform, 'rotate(0deg)');
  assert.ok(!declarations.background && !declarations.border);
  const open = css.nodes.find(node => node.type === 'rule' && node.selector === '.mm-organization-trigger[aria-expanded="true"] .mm-organization-chevron-icon');
  assert.equal(open.nodes.find(node => node.prop === 'transform').value, 'rotate(180deg)');
  const reduced = css.nodes.find(node => node.type === 'atrule' && node.params === '(prefers-reduced-motion: reduce)' && node.nodes.some(rule => rule.selector === '.mm-organization-chevron-icon'));
  assert.ok(reduced);
});


test('chevron refinement preserves every unrelated style declaration', () => {
  const entries = [];
  css.walkDecls(node => {
    if (node.parent.selector?.includes('.mm-organization-chevron')) return;
    entries.push([node.parent.selector, node.parent.parent.type === 'atrule' ? node.parent.parent.params : null, node.prop, node.value, node.important || false]);
  });
  assert.equal(createHash('sha256').update(JSON.stringify(entries)).digest('hex'), '8761d6bc79031f3ccf7137e60addc27a24e75c98b9aa730cce2503568e0d9b75');
});
