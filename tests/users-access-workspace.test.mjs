import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/pages/Projects/components/UsersAccessOverviewSection.tsx');
const css = read('src/pages/Projects/components/users-access-workspace.css');
const sharedCss = read('src/pages/Projects/components/DocumentsSection.css');

test('Users uses a minimal functional breadcrumb and existing Admin action', () => {
  assert.match(source, /<h1><StaticLoadingText pending=\{structurePending\}>Usuários e Acessos<\/StaticLoadingText><\/h1>/);
  assert.match(source, /<Link to="\/projects"[\s\S]*?onHome\?\.\(\)/);
  assert.match(read('src/pages/Projects.tsx'), /<UsersAccessSectionWithProps\s+onHome=\{onHome\}/);
  assert.doesNotMatch(source, /people-eyebrow|VISÃO DA EQUIPE|people-notice governance/);
  assert.match(css, /\.people-access-header \{[^}]*padding: 0 0 12px;[^}]*background: none/);
  assert.match(source, /organizationId && canView && isSuperAdmin &&/);
  assert.match(source, /\/admin\?section=users&organization=/);
});

test('Users has exactly one actual shared quantity footer outside the scroll area', () => {
  assert.equal((source.match(/<DocumentsPagination\b/g) || []).length, 1);
  assert.equal((source.match(/<footer\b/g) || []).length, 1);
  assert.match(source, /Exibindo \$\{page.people.length\}\/\$\{page.total\}/);
  assert.match(source, /paginateUsers\(filtered,/);
  assert.match(source, /page.people.map\(\(person\)/);
  assert.match(source, /page=\{page.pageIndex \+ 1\} pageSize=\{page.pageSize\}/);
  assert.match(source, /onPageSize=\{size => changePage\(0, size\)\}/);
  assert.match(source, /<\/table>\s*<\/div>\s*<footer className="people-pagination"/);
  assert.match(sharedCss, /:is\(\.mm-docs, \.ticket-center-shell, \.roadmap-workspace, \.users-access-workspace\) \.mm-docs-pagination/);
  assert.doesNotMatch(css, /\.mm-docs-pagination\s*\{/);
  assert.match(css, /\.people-table-wrap \{[^}]*max-height:[^}]*overflow: auto/);
});

test('Users reuses branded menu and existing per-person handlers without unsupported actions', () => {
  assert.match(source, /<DocumentActionMenu label=\{`Ações de/);
  assert.match(source, /manageMap \? \[\{ label: "Mapa", onSelect: \(\) => setMapAccessTargetUserId\(person.id\) \}\]/);
  assert.match(source, /manageAdditional \? \[\{ label: "Gerenciar", onSelect: \(\) => setManagementTargetUserId\(person.id\) \}\]/);
  assert.match(source, /disabled aria-label=\{`Nenhuma ação disponível para/);
  assert.doesNotMatch(source, /updateOrganizationUser|deleteOrganizationUser|createOrganizationUser/);
  assert.match(css, /body:has\(\.users-access-workspace\) > \.mm-docs-action-menu button \{ min-height: 44px/);
  assert.match(css, /\.mm-docs-menu-trigger\) \{ min-width: 44px; min-height: 44px/);
});

test('Users rejects stale organization responses, resets context and shows honest loading/error states', () => {
  assert.match(source, /contextKey = JSON.stringify\(\[organizationId, user\?\.id, roleOf\(user\), userPermissions\(user\)\]\)/);
  assert.match(source, /<UsersAccessWorkspace key=\{contextKey\}/);
  assert.match(source, /const readRevision = \+\+requestRef.current/);
  assert.match(source, /const current = \(\) => readRevision === requestRef.current/);
  assert.match(source, /if \(!current\(\)\) return;\s*setPeople\(peopleResult.users \?\? \[\]\);\s*setLoaded\(true\)/);
  assert.match(source, /return \(\) => \{ requestRef.current \+= 1; \}/);
  assert.match(source, /presentationLoading \? <LoadingStatus/);
  assert.match(source, /refreshingLabel=\{loading \? "Atualizando usuários\."/);
  assert.match(source, /disabled=\{loading \|\| !visiblePeople\} disablePageSize=\{loading \|\| !visiblePeople\}/);
  assert.match(source, /loaded \? active : "—"/);
  assert.match(source, /onClick=\{\(\) => void load\(\)\}>Tentar novamente/);
});

test('Users styles preserve scoped dark density and all table columns on mobile', () => {
  assert.match(css, /\.people-toolbar \{ display: grid; grid-template-columns: minmax\(0, 1.6fr\)/);
  assert.match(css, /\.people-table-wrap :is\(th, td\) \{ display: table-cell/);
  assert.match(css, /table-layout: fixed/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@container \(max-width: 560px\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /progress::-webkit-progress-value \{[^}]*background: var\(--maono-accent-bright\)/);
  assert.match(css, /progress::-moz-progress-bar \{[^}]*background: var\(--maono-accent-bright\)/);
  assert.doesNotMatch(css, /!important|linear-gradient|zoom:|translateY\(-\d+px\)/);
});
