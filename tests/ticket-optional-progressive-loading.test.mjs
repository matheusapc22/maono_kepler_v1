import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { restoreTicketOptionalProgressiveLoading } from './helpers/ticket-optional-progressive-preservation.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL('src/pages/Projects/components/' + name, root), 'utf8');

test('all optional modules require server-confirmed availability before exposing ready controls', async () => {
  const source = `import { renderToStaticMarkup } from 'react-dom/server';
${['Knowledge','Cases','Feedback','Metrics','Exports'].map(name => `import ${name} from './src/pages/Projects/components/Ticket${name}Panel';`).join('\n')}
export const html = [${['Knowledge','Cases','Feedback','Metrics','Exports'].map(name => `renderToStaticMarkup(<${name} organizationId={1} canManage canCreate canDownload onOpen={() => {}} />)`).join(',')}];`;
  const result = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty', '.png': 'dataurl' } });
  const context = { module: { exports: {} }, require: createRequire(import.meta.url), console, URL, TextEncoder, TextDecoder };
  runInNewContext(result.outputFiles[0].text, context);
  const { html } = context.module.exports;
  assert.equal(JSON.stringify(html), JSON.stringify(['', '', '', '', '']));
});

test('error-only availability presentation never creates domain controls', () => {
  const state = read('TicketOptionalPanelState.tsx');
  assert.match(state, /if \(!error\) return null/);
  assert.match(state, /<TicketErrorNotice error=\{error\} onRetry=\{onRetry\}/);
  assert.ok(!/<(?:input|select|textarea|form)\b/.test(state));
  for (const name of ['Knowledge','Cases','Feedback','Metrics','Exports']) {
    const module = read(`Ticket${name}Panel.tsx`);
    assert.match(module, /if \(!available\)/);
    assert.match(module, /setAvailable\((?:value|result)\.enabled === true\)/);
    assert.match(module, /isRegionAccessDenied\(/);
  }
});

test('knowledge and incident surfaces use established dark and focus tokens', () => {
  for (const name of ['ticket-knowledge.css', 'ticket-cases.css']) {
    const css = read(name);
    assert.match(css, /background: var\(--mm-bg-soft\)/);
    assert.match(css, /color: var\(--mm-text\)/);
    assert.match(css, /var\(--maono-focus-ring\)/);
    assert.ok(!/background:\s*(?:white|#fff\b|#ffffff\b)/i.test(css));
  }
});

const reviewedSourceHashes = {
  "TicketKnowledgePanel": "39534b4e785f46541047be158a2f91c87e9b29ac16d542943ada0f88f22df8e5",
  "TicketCasesPanel": "acce1a656c20180c284fa914166ba9348c37f89cdf56a23e07978fa55ac47e51",
  "TicketFeedbackPanel": "5b579255e8a3c425d8efa61d865ab0aedad00956ed0982bff5888e43f5bb8c81",
  "TicketMetricsPanel": "2a17f4004d4a3590f27631536f71204954f09a3e10b72e054e6f4e39e1fc9e1e",
  "TicketExportsPanel": "3045609543d58b2b972502e677dfd8d94939dbfae5f83e182d005e16b0731583"
};

test('optional corrections reverse exactly without loosening original selector contracts', () => {
  for (const [name, hash] of Object.entries(reviewedSourceHashes)) {
    const source = restoreTicketOptionalProgressiveLoading(`${name}.tsx`, read(`${name}.tsx`));
    assert.equal(createHash('sha256').update(source).digest('hex'), hash, name);
  }
});
test('optional inverse cannot conceal API, access or payload mutations', () => {
  for (const [name, before, after] of [
    ['TicketCasesPanel', 'idempotencyKey: crypto.randomUUID()', 'idempotencyKey: "tampered"'],
    ['TicketCasesPanel', '${organizationId}/ticket-cases', '${organizationId}/wrong-endpoint'],
    ['TicketExportsPanel', 'canCreate && canDownload', 'canCreate || canDownload'],
    ['TicketKnowledgePanel', 'reviewerId: Number(reviewer)', 'reviewerId: 0'],
    ['TicketFeedbackPanel', 'value.enabled && canManage', 'value.enabled || canManage'],
    ['TicketMetricsPanel', 'canManage ? <>', 'true ? <>'],
  ]) {
    const source = read(`${name}.tsx`);
    assert.ok(source.includes(before), name);
    let restored;
    try { restored = restoreTicketOptionalProgressiveLoading(`${name}.tsx`, source.replace(before, after)); }
    catch { continue; }
    assert.notEqual(createHash('sha256').update(restored).digest('hex'), reviewedSourceHashes[name], name);
  }
});

test('optional modules consume the owning Central clock without starting independent holds', () => {
  for (const name of Object.keys(reviewedSourceHashes)) {
    const source = read(`${name}.tsx`);
    assert.match(source, /structurePending = false/);
    assert.match(source, /stagePending = false/);
    assert.match(source, /<StaticLoadingText pending=\{presentation.structurePending\}/);
    assert.match(source, /data-ticket-optional-body="" hidden=\{presentation.stagePending\}/);
    assert.doesNotMatch(source, /useInitialLoadingPresentation/);
  }
});

test('manual refresh focus restoration is narrow, cancellable and cleaned up', () => {
  const source = read('useManualRefreshFocus.ts');
  assert.match(source, /target\?\.isConnected && !target\.disabled && document\.activeElement === document\.body/);
  assert.match(source, /useEffect\(\(\) => cancel, \[cancel\]\)/);
  assert.match(source, /document\.activeElement !== target\) return/);
  for (const event of ['pointerdown', 'click', 'keydown', 'focusin']) {
    assert.ok(source.includes(`addEventListener("${event}"`));
    assert.ok(source.includes(`removeEventListener("${event}"`));
  }
  assert.doesNotMatch(source, /setTimeout|setInterval|requestJson|fetch\(/);
  for (const name of ['TicketFeedbackPanel.tsx', 'TicketMetricsPanel.tsx']) {
    assert.equal((read(name).match(/rememberRefreshFocus\(event\.currentTarget\)/g) || []).length, 1);
  }
});
