#!/usr/bin/env node
/** Validate the published CC-01 inventory against the working source; no network or D1. */
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES } from '../../functions/_lib/ticket-center.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = resolve(root, process.argv[2] || 'docs/central-chamados/cc-01/contracts.json');
const contract = JSON.parse(await readFile(contractPath, 'utf8'));
assert.deepEqual(contract.actual.ticket.statuses, TICKET_STATUSES, 'Documented statuses drifted from the current source');
assert.deepEqual(contract.actual.ticket.priorities, TICKET_PRIORITIES, 'Documented priorities drifted from the current source');
assert.deepEqual(contract.actual.ticket.categories, TICKET_CATEGORIES, 'Documented categories drifted from the current source');

function sourcePath(path) {
  assert.equal(typeof path, 'string');
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  assert(!isAbsolute(path) && rel !== '..' && !rel.startsWith('../'), `Source escapes repository: ${path}`);
  return absolute;
}

assert(contract.actual.endpoints.length > 0, 'An endpoint inventory is required');
const endpointKeys = new Set();
for (const route of contract.actual.endpoints) {
  const key = `${route.method} ${route.path}`;
  assert(!endpointKeys.has(key), `Duplicate endpoint: ${key}`);
  endpointKeys.add(key);
  assert(['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS'].includes(route.method), `Invalid HTTP method: ${key}`);
  assert(route.path.startsWith('/api/'), `Not an API path: ${key}`);
  const source = await readFile(sourcePath(route.sourceFile), 'utf8');
  assert(/^onRequest(?:Get|Post|Patch|Delete|Put|Head|Options)?$/.test(route.handler), `Invalid handler: ${key}`);
  const expected = `onRequest${route.method[0]}${route.method.slice(1).toLowerCase()}`;
  assert(route.handler === expected || route.handler === 'onRequest', `Method/handler mismatch: ${key}`);
  assert(new RegExp(`export\\s+(?:async\\s+)?function\\s+${route.handler}\\b|export\\s+const\\s+${route.handler}\\b`).test(source), `Missing exported handler ${route.handler}: ${route.sourceFile}`);
  const inferredPath = '/' + route.sourceFile.replace(/^functions\//, '').replace(/\.js$/, '').replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, ':$1');
  assert.equal(route.path, inferredPath, `Source file/path mismatch: ${key}`);
  assert(route.permission && route.request && route.response, `Incomplete HTTP contract: ${key}`);
}
for (const source of contract.sources) await access(sourcePath(source.path));
assert.equal(contract.proposed.status, 'proposed_not_implemented', 'Future contracts must not be presented as shipped behavior');
assert(contract.proposed.invariants.length > 0, 'Future invariants are required');
const ids = new Set();
for (const invariant of contract.proposed.invariants) {
  assert(invariant.id && invariant.rule && invariant.pr, 'Invariant must have an ID, rule and delivery PR');
  assert(!ids.has(invariant.id), `Duplicate invariant: ${invariant.id}`);
  ids.add(invariant.id);
}

const baseline = JSON.parse(await readFile(resolve(root, 'docs/central-chamados/cc-01/baseline.json'), 'utf8'));
assert(/^[a-f0-9]{40}$/.test(baseline.source.sha), 'Baseline source SHA is required');
assert(/^[a-f0-9]{40}$/.test(baseline.defaultBranch.sha), 'Default branch SHA is required');
assert.notEqual(baseline.source.sha, baseline.defaultBranch.sha, 'This captured baseline has divergent heads');
assert.equal(baseline.comparison.status, 'diverged');
assert(baseline.comparison.ahead > 0 && baseline.comparison.behind > 0);
assert.deepEqual(baseline.migrations.newFiles, [], 'CC-01 does not require a migration');
assert.equal(baseline.migrations.remoteApplied, false, 'CC-01 must not claim a remote migration');
assert.equal(baseline.environments.production.status, 'unverified', 'No production acceptance was performed in this baseline');
console.log(`CC-01: ${endpointKeys.size} current endpoint contracts; 3 enums; ${contract.sources.length} source references; ${ids.size} proposed invariants; source/Preview/production separation verified.`);
console.log('This is source consistency evidence. CT-02 human validation, authenticated QA and release approval remain separate gates.');
