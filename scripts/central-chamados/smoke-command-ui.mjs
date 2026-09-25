#!/usr/bin/env node
/** Real React components + real API client; local HTTP mocks only, not authenticated QA. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = resolve(process.env.CC03_EVIDENCE_DIR || resolve(root, 'docs/central-chamados/cc-03/evidence'));
const directory = await mkdtemp(resolve(tmpdir(), 'cc03-ui-'));
await mkdir(evidence, { recursive: true });
await build({ entryPoints: [resolve(root, 'scripts/central-chamados/command-ui-harness.tsx')], bundle: true,
  outfile: resolve(directory, 'bundle.js'), jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
await writeFile(resolve(directory, 'index.html'), '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script></html>');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path === '/bundle.js' ? 'bundle.js' : path === '/bundle.css' ? 'bundle.css' : 'index.html';
  res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(resolve(directory, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
page.setDefaultTimeout(8000);
const errors = [], external = [], commands = [], creations = [], results = {};
const now = '2026-09-25T18:00:00.000Z';
function initialTicket() { return { id: 901, organizationId: 1, code: 'TKT-QA-901', subject: 'Atendimento fictício para QA local',
  description: 'Verificação dos formulários reais com respostas HTTP simuladas.', status: 'open', priority: 'normal', category: 'map',
  attachmentsCount: 0, assignedTo: { id: 7, name: 'Atendente QA' }, createdBy: { id: 7, name: 'Atendente QA' },
  createdAt: now, updatedAt: now, dueAt: '2026-10-05T18:34:56.000Z', version: 1, etag: '"cc03-local-v1"',
  cycle: { number: 1, origin: 'created', openedAt: now, openedBy: 7 }, nextAction: 'Analisar a evidência.', wait: null, closure: null }; }
let ticket = initialTicket(), history = [], eventId = 1, events = [], failNextCommand = false, loseNextCreate = false;
let committedCreations = 0;
const intents = new Map();
function envelope() { return { ok: true, lifecycleEnabled: true, triageEnabled: false, hasPendingChange: true,
  ticket, closureHistory: history, events, attachments: [], assignees: [{ id: 7, name: 'Atendente QA' }],
  attachmentLimits: { maxFiles: 5, maxFileBytes: 80 * 1024 ** 2, maxTicketBytes: 150 * 1024 ** 2, chunkBytes: 8 * 1024 ** 2 } }; }
function bump() { ticket = { ...ticket, version: ticket.version + 1, etag: `"cc03-local-v${ticket.version + 1}"` }; }
function event(type, metadata) { events.push({ id: eventId++, type, metadata, createdAt: now, actor: { id: 7, name: 'Atendente QA' } }); }
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  const respond = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (request.method() === 'GET' && path.endsWith('/tickets/901')) return respond(200, envelope());
  if (request.method() === 'POST' && path.endsWith('/tickets')) {
    const payload = request.postDataJSON(), key = request.headers()['idempotency-key'];
    creations.push({ payload, key });
    if (!key) return respond(428, { ok: false, code: 'TICKET_IDEMPOTENCY_REQUIRED', error: 'Idempotency-Key ausente.' });
    if (!intents.has(key)) { intents.set(key, { ...payload, id: 902, organizationId: 1, code: 'TKT-QA-902', status: 'new', attachmentsCount: 0, version: 1, etag: '"cc03-created-v1"' }); committedCreations += 1; }
    if (loseNextCreate) { loseNextCreate = false; return route.abort('failed'); }
    return respond(201, { ok: true, ticket: intents.get(key) });
  }
  if (request.method() === 'POST' && /\/tickets\/901\/(transitions|waits|reopen)$/.test(path)) {
    const payload = request.postDataJSON(), etag = request.headers()['if-match'];
    commands.push({ path: path.split('/').at(-1), payload, etag });
    if (failNextCommand) { failNextCommand = false; bump(); ticket.nextAction = 'Uma pessoa atualizou a investigação.'; }
    if (etag !== ticket.etag) return respond(412, { ok: false, code: 'TICKET_VERSION_CONFLICT', error: 'O chamado foi alterado. Confira a versão atual.' });
    if (path.endsWith('/waits')) {
      if (payload.action === 'start') ticket.wait = { id: 'wait-1', reason: payload.reason, responsibleId: payload.responsibleId, nextAction: payload.nextAction, startedAt: now, expectedAt: payload.expectedAt || null };
      else ticket.wait = null;
      ticket.nextAction = payload.nextAction;
      event(payload.action === 'start' ? 'ticket.wait.started' : 'ticket.wait.ended', payload);
    } else if (path.endsWith('/reopen')) {
      history.push(ticket.closure);
      ticket = { ...ticket, status: 'open', closure: null, closedAt: null, nextAction: payload.nextAction,
        cycle: { number: ticket.cycle.number + 1, origin: 'reopened', openedAt: now, openedBy: 7 } };
      event('ticket.reopened', payload);
    } else {
      ticket.status = payload.status;
      if (payload.status === 'closed') { ticket.closure = { ...payload.closure, closedAt: now, closedBy: 7, cycleNumber: ticket.cycle.number }; ticket.closedAt = now; ticket.wait = null; }
      else ticket.nextAction = payload.nextAction;
      event(payload.status === 'closed' ? 'ticket.closed' : 'ticket.transitioned', payload);
    }
    bump();
    return respond(200, { ok: true, ticket });
  }
  return route.abort();
});
async function waitForAction() { await page.locator('#ticket-command-action').waitFor({ state: 'visible' }); }
async function screenshot(name) { await page.screenshot({ path: resolve(evidence, name), fullPage: true }); }
try {
  await page.goto(base); await waitForAction();
  await page.locator('#ticket-command-action').selectOption('wait_start');
  await page.locator('#ticket-command-reason').fill('Aguardando evidência do solicitante.');
  await page.locator('#ticket-command-nextAction').fill('Atendente QA verificará o retorno amanhã.');
  await page.locator('#ticket-command-responsibleId').selectOption('7');
  await page.getByRole('button', { name: 'Registrar espera', exact: true }).click();
  await page.getByText('Espera em andamento', { exact: true }).waitFor();
  assert.equal(ticket.status, 'open'); assert.equal(commands.at(-1).etag, '"cc03-local-v1"');
  await page.locator('#ticket-command-action').selectOption('wait_end');
  await page.locator('#ticket-command-nextAction').fill('Conferir a evidência recebida.');
  await page.getByRole('button', { name: 'Encerrar espera', exact: true }).click();
  await page.getByText('Espera em andamento', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(ticket.wait, null); assert.equal(ticket.status, 'open');
  results.waitResume = 'passed: preserves canonical status and records next actions';

  await page.locator('#ticket-command-action').selectOption('transition');
  await page.locator('#ticket-command-status').selectOption('closed');
  await page.locator('#ticket-command-summary').fill('Consulta explicada ao solicitante.');
  await page.locator('#ticket-command-evidence').fill('Resposta registrada com exemplo reproduzível.');
  await page.locator('#ticket-command-communication').fill('Orientação registrada no chamado.');
  const beforeAcknowledgement = commands.length;
  await page.getByRole('button', { name: 'Registrar conclusão', exact: true }).click();
  await page.getByText('Confirme que o trabalho de mudança permanece independente desta conclusão.', { exact: true }).waitFor();
  assert.equal(commands.length, beforeAcknowledgement);
  await page.locator('#ticket-command-pendingChangeAcknowledged').check();
  await page.getByRole('button', { name: 'Registrar conclusão', exact: true }).click();
  await page.getByRole('button', { name: 'Reabrir chamado', exact: true }).waitFor();
  assert.equal(ticket.status, 'closed'); assert.equal(commands.at(-1).payload.closure.pendingChangeAcknowledged, true);
  await page.locator('#ticket-command-reason').fill('O mesmo problema reapareceu durante nova consulta.');
  await page.locator('#ticket-command-nextAction').fill('Comparar a nova evidência com a conclusão anterior.');
  await page.getByRole('button', { name: 'Reabrir chamado', exact: true }).click();
  await page.getByText('Conclusões dos ciclos anteriores', { exact: true }).waitFor();
  assert.equal(ticket.status, 'open'); assert.equal(ticket.cycle.number, 2);
  await page.getByText('Conclusões dos ciclos anteriores', { exact: true }).click();
  assert(await page.getByText('Consulta explicada ao solicitante.', { exact: true }).isVisible());
  assert.equal(history.length, 1);
  results.closeReopen = 'passed: explicit change acknowledgement, cycle 2 and previous conclusion preserved';

  await page.locator('#ticket-command-status').selectOption('in_progress');
  const draft = 'Rascunho preservado após concorrência.';
  await page.locator('#ticket-command-nextAction').fill(draft);
  const conflictExpected = commands.length + 1, oldEtag = ticket.etag;
  failNextCommand = true;
  await page.getByRole('button', { name: 'Confirmar mudança de situação', exact: true }).click();
  await page.getByText('Seu rascunho foi preservado.', { exact: true }).waitFor();
  assert.equal(commands.length, conflictExpected);
  assert.equal(await page.locator('#ticket-command-nextAction').inputValue(), draft);
  assert(await page.getByRole('button', { name: 'Confirmar mudança de situação', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Consultar versão atual', exact: true }).click();
  await page.getByRole('button', { name: 'Usar versão atual e manter rascunho', exact: true }).waitFor();
  assert.equal(commands.length, conflictExpected, 'Reload does not retry the rejected command');
  assert.equal(await page.locator('#ticket-command-nextAction').inputValue(), draft);
  await page.locator('.ticket-command-conflict').scrollIntoViewIfNeeded();
  await screenshot('command-conflict-desktop.png');
  await page.getByRole('button', { name: 'Usar versão atual e manter rascunho', exact: true }).click();
  assert.equal(commands.length, conflictExpected, 'Explicit rebase does not submit');
  await page.getByRole('button', { name: 'Confirmar mudança de situação', exact: true }).click();
  await page.getByText('Ação registrada no chamado. Nenhuma alteração vinculada foi aprovada ou aplicada.', { exact: true }).waitFor();
  assert.equal(commands.length, conflictExpected + 1);
  assert.equal(commands.at(-2).etag, oldEtag); assert.notEqual(commands.at(-1).etag, oldEtag);
  assert.equal(commands.at(-1).payload.nextAction, draft);
  results.conflict412 = 'passed: draft retained, no retry on reload or explicit rebase, new confirmation uses new If-Match';

  await page.goto(`${base}/?manage=0`);
  await page.getByText('Acompanhamento do atendimento', { exact: true }).waitFor();
  assert.equal(await page.locator('#ticket-command-action').count(), 0);
  assert.equal(await page.getByRole('button', { name: /Registrar espera|Reabrir chamado|Registrar conclusão/ }).count(), 0);
  results.viewer = 'passed: lifecycle readable, commands absent';

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base); await waitForAction();
  await page.locator('#ticket-command-action').selectOption('wait_start');
  await page.locator('#ticket-command-reason').fill('Aguardando informação adicional.');
  await page.locator('#ticket-command-nextAction').fill('Atendente verificará a próxima informação recebida.');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page horizontal overflow at 390px');
  assert(await page.locator('.ticket-lifecycle input, .ticket-lifecycle textarea, .ticket-lifecycle select').evaluateAll(controls => controls.every(control => {
    const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth + 1;
  })), 'Lifecycle fields fit mobile viewport');
  await page.locator('#ticket-command-action').scrollIntoViewIfNeeded();
  await screenshot('command-mobile.png');
  results.mobile390 = 'passed: no horizontal overflow and controls contained';

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/?view=create`);
  await page.getByLabel(/^Assunto/).fill('Intenção preservada após resposta perdida');
  await page.getByLabel(/^Descrição/).fill('Teste local de criação com resposta simuladamente perdida.');
  loseNextCreate = true;
  await page.getByRole('button', { name: 'Criar chamado', exact: true }).click();
  await page.getByRole('button', { name: 'Repetir criação com os mesmos dados', exact: true }).waitFor();
  assert.equal(creations.length, 1); assert.equal(committedCreations, 1);
  assert(await page.getByLabel(/^Assunto/).isDisabled());
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Abrir formulário', exact: true }).click();
  assert.equal(await page.getByLabel(/^Assunto/).inputValue(), 'Intenção preservada após resposta perdida');
  assert(await page.getByLabel(/^Assunto/).isDisabled());
  assert.equal(creations.length, 1);
  await screenshot('command-create-uncertain.png');
  await page.getByRole('button', { name: 'Repetir criação com os mesmos dados', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#qa-result')?.textContent.length > 0);
  assert.equal(creations.length, 2); assert.equal(committedCreations, 1);
  assert.equal(creations[0].key, creations[1].key); assert.ok(creations[0].key);
  assert.deepEqual(creations[0].payload, creations[1].payload);
  results.lostCreateResponse = 'passed: same key and payload across close/reopen/retry, one simulated server commit';
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { test: 'CC-03 real React components with mocked local HTTP', executedAt: new Date().toISOString(), browser: browser.version(),
    result: 'passed', locale: 'pt-BR', timezone: 'America/Sao_Paulo', cases: results, commandRequests: commands.length, creationRequests: creations.length,
    simulatedCreationCommits: committedCreations, pageErrors: errors, externalRequests: external,
    authenticatedQA: 'not_run', remoteMigration: 'not_run', limitations: 'Browser check uses fictional responses and does not replace API/SQLite tests or authenticated D1/Preview acceptance.' };
  await writeFile(resolve(evidence, 'command-ui-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ failed: error.message, commands, creations, committedCreations, body: (await page.locator('body').innerText()).slice(-6000), errors }, null, 2));
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
}
