#!/usr/bin/env node
/** Exercises real React components with fictional HTTP responses. No remote QA. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = await mkdtemp(resolve(tmpdir(), 'cc02-ui-'));
await build({ entryPoints: [resolve(root, 'scripts/central-chamados/triage-ui-harness.tsx')], bundle: true,
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const errors = [], payloads = [], external = [];
let failNextCreate = false;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
await page.route('**/api/**', async route => {
  if (route.request().method() !== 'POST' || !route.request().url().endsWith('/tickets')) return route.abort();
  const payload = route.request().postDataJSON(); payloads.push(payload);
  if (failNextCreate) {
    failNextCreate = false;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Indisponibilidade temporária de teste.', message: 'Indisponibilidade temporária de teste.' }) });
  }
  await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true,
    ticket: { ...payload, id: 902, organizationId: 1, code: 'TKT-QA-902', status: 'new', attachmentsCount: 0 } }) });
});
const screenshotDirectory = process.env.CC02_EVIDENCE_DIR;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const questions = { question_request: [], incident: ['startedAt', 'impactDescription'], defect: ['stepsToReproduce', 'actualResult', 'affectedVersion'], improvement_change: ['problemToSolve', 'expectedBenefit'], recurring_problem: ['recurrenceFrequency', 'relatedContext'] };
async function triage(nature) {
  await page.locator('select[id$="-demandNature"]').selectOption(nature);
  await page.locator('textarea[id$="-expectedResult"]').fill('Concluir a atividade fictícia com resultado verificável.');
  await page.locator('select[id$="-impact"]').selectOption('team');
  await page.locator('select[id$="-urgency"]').selectOption('soon');
  for (const key of questions[nature]) await page.locator(`textarea[id$="-${key}"]`).fill(`Evidência fictícia: ${key}`);
}
try {
  for (const nature of Object.keys(questions)) for (const category of ['map', 'export']) {
    await page.goto(`${base}/?enabled=1`);
    await page.getByLabel(/^Assunto/).fill('Teste fictício de triagem');
    await page.getByLabel(/^Descrição/).fill('Contexto mínimo para teste local.');
    await triage(nature);
    await page.getByLabel(/Domínio|Categoria/).selectOption(category);
    const previous = payloads.length;
    await page.getByRole('button', { name: 'Criar chamado', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#qa-result')?.textContent.length > 0);
    assert.equal(payloads.length, previous + 1);
    const payload = payloads.at(-1);
    assert.equal(payload.demandNature, nature); assert.equal(payload.category, category);
    assert.equal(payload.triageFormVersion, 1);
    assert.deepEqual(Object.keys(payload.triageAnswers).sort(), questions[nature].slice().sort());
  }
  await page.goto(`${base}/?enabled=0`);
  assert.equal(await page.locator('select[id$="-demandNature"]').count(), 0, 'Capability off hides triage');
  await page.getByLabel(/^Assunto/).fill('Cliente legado');
  await page.getByLabel(/^Descrição/).fill('Formulário antigo sem novos campos.');
  await page.getByRole('button', { name: 'Criar chamado', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#qa-result')?.textContent.length > 0);
  assert.equal('demandNature' in payloads.at(-1), false);
  await page.goto(`${base}/?enabled=1&view=detail&manage=0`);
  assert((await page.locator('body').innerText()).includes('Classificação pendente'));
  assert.equal(await page.locator('select[id$="-demandNature"]').count(), 0, 'Read-only profile has no triage editor');
  await page.goto(`${base}/?enabled=1&view=detail`);
  await page.getByRole('button', { name: 'Classificar chamado', exact: true }).click();
  await triage('defect');
  await page.getByRole('button', { name: /Salvar alterações/ }).click();
  await page.waitForFunction(() => document.querySelector('#qa-result')?.textContent.length > 0);
  const classified = JSON.parse(await page.locator('#qa-result').innerText());
  assert.equal(classified.demandNature, 'defect');
  for (const unchanged of ['dueAt', 'status', 'assignedTo', 'priority', 'category']) {
    assert.equal(unchanged in classified, false, `Triage alone preserves ${unchanged}`);
  }
  await page.goto(`${base}/?enabled=1&view=detail`);
  await page.getByLabel(/^Domínio afetado/).selectOption('export');
  await page.getByRole('button', { name: /Salvar alterações/ }).click();
  assert.equal(await page.locator('#qa-result').innerText(), '', 'Domain requires a reason');
  await page.locator('#ticket-priority-change-reason').fill('Reclassificado após conferir a operação afetada.');
  await page.getByRole('button', { name: /Salvar alterações/ }).click();
  await page.waitForFunction(() => document.querySelector('#qa-result')?.textContent.length > 0);
  const changedDomain = JSON.parse(await page.locator('#qa-result').innerText());
  assert.equal(changedDomain.category, 'export');
  assert(changedDomain.priorityReason);
  assert.equal('demandNature' in changedDomain, false);
  assert.equal('dueAt' in changedDomain, false);
  await page.goto(`${base}/?enabled=1`);
  await page.getByLabel(/^Assunto/).fill('Rascunho preservado');
  await page.getByLabel(/^Descrição/).fill('Falha controlada e nova tentativa.');
  await triage('question_request');
  failNextCreate = true;
  const response = page.waitForResponse(r => r.url().endsWith('/tickets') && r.status() === 503);
  await page.getByRole('button', { name: 'Criar chamado', exact: true }).click();
  await response;
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Criar chamado' && !b.disabled));
  assert.equal(await page.getByLabel(/^Assunto/).inputValue(), 'Rascunho preservado');
  assert.equal(await page.locator('select[id$="-demandNature"]').inputValue(), 'question_request');
  await page.getByRole('button', { name: 'Criar chamado', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#qa-result')?.textContent.length > 0);
  await page.goto(`${base}/?enabled=1`);
  await triage('defect');
  await page.locator('select[id$="-demandNature"]').selectOption('question_request');
  assert(await page.getByRole('button', { name: 'Trocar e limpar respostas' }).isVisible());
  await page.getByRole('button', { name: 'Trocar e limpar respostas' }).click();
  assert.equal(await page.locator('textarea[id$="-stepsToReproduce"]').count(), 0);
  assert(await page.locator('textarea[id$="-expectedResult"]').inputValue());
  await page.locator('select[id$="-demandNature"]').scrollIntoViewIfNeeded();
  if (screenshotDirectory) await page.screenshot({ path: resolve(screenshotDirectory, 'triage-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/?enabled=1`);
  await triage('incident');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
  assert(await page.locator('.ticket-triage select, .ticket-triage textarea').evaluateAll(controls => controls.every(control => {
    const bounds = control.getBoundingClientRect(), label = control.closest('label').getBoundingClientRect();
    return bounds.left >= label.left - 1 && bounds.right <= label.right + 1;
  })), 'Triage fields fit their labels');
  await page.locator('select[id$="-demandNature"]').scrollIntoViewIfNeeded();
  if (screenshotDirectory) await page.screenshot({ path: resolve(screenshotDirectory, 'triage-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ test: 'CC-02 real React components with mocked HTTP', executedAt: new Date().toISOString(), browser: browser.version(), combinations: 10,
    legacyCapability: 'passed', readOnlyProfile: 'passed', legacyClassification: 'passed', unchangedTicketFields: 'preserved', domainReason: 'required', failedRequestDraft: 'preserved and retried', natureSwitchClearsAnswers: 'passed', mobileWidth: 390,
    pageErrors: errors.length, externalRequests: external.length, authenticatedQA: 'not_run', result: 'passed' }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
