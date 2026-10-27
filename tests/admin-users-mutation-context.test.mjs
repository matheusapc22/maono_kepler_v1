import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const path = 'src/pages/Admin/components/AdminUserManagerLegacy.tsx';
const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found, name); return found.getText(ast);
}
function harness(name) {
  const calls = [], messages = [], writes = [], pending = [];
  const mounted = { current: true }, selection = { current: { id: 2 } }, selectionVersion = { current: 1 }, mutationPending = { current: false };
  const dependencies = {
    selected: { id: 2, email: 'synthetic@example.test' }, busy: false, mutationPending, mounted, selection, selectionVersion,
    headers: {}, delegationEditor: null, accessEditor: null,
    confirm: () => true, json: response => response.json(),
    normalizeUserError: () => ({ message: 'Falha controlada.' }),
    fetch: (url, init) => { calls.push({ url, method: init.method }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    onMessage: (...args) => messages.push(args),
    onRefresh: async () => { writes.push(['refresh']); return true; },
    setBusy: value => writes.push(['busy', value]),
    setMemberships: updater => writes.push(['memberships', updater([{ id: 1, assigned: false }])]),
    setSelected: value => { selection.current = value; selectionVersion.current++; writes.push(['selected', value]); },
    setDelegationEditor: value => writes.push(['delegation', value]), setAccessEditor: value => writes.push(['access', value]),
  };
  const compiled = ts.transpileModule(`${declaration('selectionIsCurrent')}\n${declaration('refreshAfterSave')}\n${declaration(name)}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const action = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  return { action: () => name === 'remove' ? action() : action({ id: 1, accessLevel: 'viewer' }, true), calls, messages, writes, pending, mounted, selection, selectionVersion, mutationPending };
}

for (const name of ['remove', 'updateMembership']) {
  test(`${name} rejects repeated calls in the same event turn`, async () => {
    const f = harness(name);
    const first = f.action(); const repeated = f.action();
    assert.equal(f.calls.length, 1);
    await repeated;
    f.pending[0].resolve(Response.json({ ok: true, assigned: true, removed: true, accessLevel: 'viewer' }));
    await first;
    assert.equal(f.mutationPending.current, false);
    assert.equal(f.writes.filter(([kind]) => kind === 'refresh').length, 1);
  });
  for (const outcome of ['success', 'error']) for (const context of ['other user', 'same user reopened', 'unmount']) test(`${name} ignores late ${outcome} after ${context}`, async () => {
    const f = harness(name), action = f.action();
    if (context === 'unmount') f.mounted.current = false;
    else { f.selectionVersion.current++; if (context === 'other user') f.selection.current = { id: 3 }; }
    if (outcome === 'success') f.pending[0].resolve(Response.json({ ok: true }));
    else f.pending[0].reject(new Error('private diagnostic'));
    await action;
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.writes.filter(([kind]) => kind !== 'busy'), []);
    assert.equal(f.mutationPending.current, false);
  });
}

test('identity remounts the manager and incidental callbacks cannot erase a draft', () => {
  const shell = readFileSync(new URL('../src/pages/Admin/components/AdminUserManager.tsx', import.meta.url), 'utf8');
  assert.match(shell, /key=\{JSON.stringify\(\[props.currentUserId, props.isSuperAdmin\]\)\}/);
  assert.match(source, /\}, \[selected, isSuperAdmin\]\);/);
  assert.doesNotMatch(source, /\[selected, isSuperAdmin, onMessage\]/);
});
