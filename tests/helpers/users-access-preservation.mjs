import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { restoreMaonoSelect } from './maono-select-preservation.mjs';
import { restoreUsersProgressiveRead } from './users-progressive-preservation.mjs';

export const usersAccessBaseline = JSON.parse(readFileSync(new URL('../fixtures/users-access-baseline.json', import.meta.url), 'utf8'));
export const preservedHelpers = ['roleOf', 'userPermissions', 'hasPermission', 'canViewTeam', 'fallbackOrganizationId', 'profileLabel', 'targetLevel', 'sameId', 'formatDate'];
export const preservedValues = ['organizationId', 'canView', 'isSuperAdmin', 'delegatedAlternative', 'canManagePerson', 'canManageMapPerson', 'active', 'suspended', 'limit', 'available', 'percent', 'filtered', 'manageAdditional', 'manageMap'];
export const digest = source => createHash('sha256').update(source).digest('hex');
export const parse = source => ts.createSourceFile('overview.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });
export const canonical = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
export function nodes(root, predicate) {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return found;
}
export function declaration(root, name, isFunction = false) {
  const found = nodes(root, node => (isFunction ? ts.isFunctionDeclaration(node) : ts.isVariableDeclaration(node)) && node.name?.getText() === name);
  assert.equal(found.length, 1, `one preserved ${isFunction ? 'function' : 'declaration'}: ${name}`);
  return found[0];
}
const tag = node => (ts.isJsxSelfClosingElement(node) ? node.tagName : ts.isJsxElement(node) ? node.openingElement.tagName : null)?.getText();
const attrs = node => (ts.isJsxSelfClosingElement(node) ? node.attributes : node.openingElement.attributes).properties;
const attribute = (node, name) => attrs(node).find(prop => ts.isJsxAttribute(prop) && prop.name.getText() === name)?.initializer;
function one(root, predicate, label) { const found = nodes(root, predicate); assert.equal(found.length, 1, label); return found[0]; }
function enclosingExpression(node) {
  while (node && !ts.isJsxExpression(node)) node = node.parent;
  assert.ok(node, 'manager retains a conditional JSX expression');
  return node;
}

/** Replace only the overview's old whole-presentation hash. The independent
 * pre-redesign fixture pins business logic and management props while allowing
 * a new visual layout, client paging and cancellation of stale read requests. */
export function assertUsersAccessPreserved(source) {
  source = restoreUsersProgressiveRead(source);
  assert.equal(usersAccessBaseline.revision, '158e2b3c1d05dbe69589d610167754ac72787215');
  assert.equal(digest(usersAccessBaseline.source), '155f6988a2402f25fe7cf226f201dcf8031af956732638b66d3eaf8fc4d409c1');
  // This is the exact migration hash retired for this one consumer, proving
  // the replacement contract was built from its original reviewed source.
  assert.equal(digest(restoreMaonoSelect(usersAccessBaseline.source)), 'a6c92f5228ec6387512d712e1e11629e23e9ff7ff966320ff905b5881b667a8e');
  const baseline = parse(usersAccessBaseline.source);
  const actual = parse(source);
  for (const name of preservedHelpers) assert.equal(declaration(actual, name, true).getText(), declaration(baseline, name, true).getText(), `unchanged helper bytes: ${name}`);
  for (const name of preservedValues) assert.equal(canonical(declaration(actual, name)), canonical(declaration(baseline, name)), `unchanged logic AST: ${name}`);
  for (const state of ['[people, setPeople]', '[limits, setLimits]', '[governance, setGovernance]', '[managementTargetUserId, setManagementTargetUserId]', '[mapAccessTargetUserId, setMapAccessTargetUserId]', '[query, setQuery]', '[status, setStatus]', '[profileFilter, setProfileFilter]', '[message, setMessage]']) {
    assert.equal(canonical(declaration(actual, state)), canonical(declaration(baseline, state)), `unchanged initial domain state: ${state}`);
  }
  for (const module of ['../../../lib/api', '../../../lib/user-error-catalog', '../../../components/access/OrganizationPermissionManager', '../../../components/access/ProjectMapAccessManager', './user-access-commercial']) {
    const findImport = root => one(root, node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === module, `one domain import: ${module}`);
    assert.equal(canonical(findImport(actual)), canonical(findImport(baseline)), `unchanged domain imports: ${module}`);
  }
  const readBatch = root => one(root, node => ts.isCallExpression(node) && node.expression.getText() === 'Promise.all' && node.getText().includes('listOrganizationUsers'), 'one unchanged authorized read batch');
  assert.equal(canonical(readBatch(actual)), canonical(readBatch(baseline)), 'read endpoints, limits permission and graceful governance fallback unchanged');
  for (const setter of ['setPeople(peopleResult.users ?? [])', 'setLimits(limitResult?.limits ?? null)', 'setGovernance(governanceResult)', 'normalizeUserError(error)']) {
    assert.equal(nodes(actual, node => ts.isCallExpression(node) && node.getText() === setter).length, 1, `unchanged successful load assignment/error mapping: ${setter}`);
  }
  for (const [manager, target, setter] of [
    ['OrganizationPermissionManager', 'managementTargetUserId', 'setManagementTargetUserId'],
    ['ProjectMapAccessManager', 'mapAccessTargetUserId', 'setMapAccessTargetUserId'],
  ]) {
    const findManager = root => one(root, node => tag(node) === manager, `one manager: ${manager}`);
    const currentManager = findManager(actual), previousManager = findManager(baseline);
    const close = attribute(currentManager, 'onClose');
    const approvedClose = declaration(parse(`const close = () => { ${setter}(null); restorePersonActionFocus(${target}); };`), 'close').initializer;
    assert.equal(canonical(close?.expression), canonical(approvedClose), `${manager} onClose only dismisses its original target and restores that person's action focus`);
    // Reverse only this exact presentation-only callback extension. The full
    // conditional manager expression, including all other props, stays pinned.
    const expression = enclosingExpression(currentManager).expression;
    const start = expression.getStart();
    const restored = expression.getText().slice(0, close.getStart() - start)
      + attribute(previousManager, 'onClose').getText()
      + expression.getText().slice(close.getEnd() - start);
    const restoredExpression = declaration(parse(`const manager = ${restored};`), 'manager').initializer;
    assert.equal(canonical(restoredExpression), canonical(enclosingExpression(previousManager).expression), `unchanged ${manager} visibility, target ID, organization, mode and onSaved`);
  }
  for (const value of ['query', 'status', 'profileFilter']) {
    const findControl = root => one(root, node => ['input', 'MaonoSelect'].includes(tag(node)) && attribute(node, 'value')?.getText() === `{${value}}`, `one filter control: ${value}`);
    const current = findControl(actual), previous = findControl(baseline);
    assert.equal(canonical(attribute(current, 'onChange')), canonical(attribute(previous, 'onChange')), `unchanged ${value} change handler`);
    if (value !== 'query') assert.equal(canonical(current), canonical(previous), `unchanged ${value} options and values`);
  }
  const findAdmin = root => one(root, node => tag(node) === 'a' && attribute(node, 'href')?.getText().includes('/admin?section=users&organization='), 'one Admin action');
  assert.equal(canonical(attribute(findAdmin(actual), 'href')), canonical(attribute(findAdmin(baseline), 'href')), 'unchanged encoded Admin destination');
  assert.match(enclosingExpression(findAdmin(actual)).getText(), /isSuperAdmin\s*&&/);
  assert.doesNotMatch(source, /\b(?:fetch|requestJson|createOrganizationUser|updateOrganizationUser|deleteOrganizationUserMembership|grantOrganizationUserPermission|revokeOrganizationUserPermission)\s*\(/, 'overview must not add direct domain writes');
}
