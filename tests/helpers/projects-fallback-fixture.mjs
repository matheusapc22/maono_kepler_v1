import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Synthetic DOM: proves CSS scope, NOT React routing, authorization, D1 or storage.
export const legacySelector = '#root > main:not(.maono-login-page)';
export const scopedSelector = '#root > main:not(.maono-login-page, .mm-projects-page)';
export const widths = [320, 390, 768, 1024, 1280, 1440, 1920];
export const fallbackSource = readFileSync(new URL('../../src/fallback-ui-styles.ts', import.meta.url), 'utf8');
const cssMatch = /const fallbackCss = `([\s\S]*?)`;/.exec(fallbackSource);
assert.ok(cssMatch, 'Fallback stylesheet must remain inspectable');
export const fallbackCss = cssMatch[1];
// Frozen by SHA-256 in projects-fallback-scope.test.mjs before it is used as baseline.
export const previousCss = fallbackCss.replaceAll(scopedSelector, legacySelector);
const neutralCss = previousCss.slice(0, previousCss.indexOf('#root > main'));

// Deliberately small, deterministic stylesheet, not a screenshot of the real app.
const fixtureCss = `
  html { font-size: 16px; } body { background: #08090b; }
  * { box-sizing: border-box; }
  .fixture { padding: 18px; background: #08090b; color: #f4f1e8; }
  .fixture header { border: 0; padding: 8px; background: #11151c; }
  .fixture header > div { display: block; min-height: 36px; }
  .fixture h1 { font-size: 24px; } .fixture p { color: #c6c0b1; }
  .fixture section { margin: 12px 0; padding: 14px; border: 1px solid #252b35; border-radius: 8px; }
  .fixture form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .fixture label { display: grid; min-width: 0; gap: 6px; }
  .fixture label > span { color: #c6c0b1; font-size: 11px; }
  .fixture input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),
  .fixture select, .fixture textarea {
    width: 100%; min-width: 0; min-height: 38px; padding: 8px 10px;
    border: 1px solid #333a46; border-radius: 7px;
    background: #0e1116; color: #f4f1e8; font: inherit;
  }
  .fixture input[type=checkbox], .fixture input[type=radio] { width: 18px; height: 18px; }
  .fixture input[type=range] { width: 90px; } .fixture input[type=file] { max-width: 100%; }
  .fixture button, .fixture a { min-height: 34px; padding: 7px 10px; color: #f2c766; background: #16140d; border: 1px solid #8a6a2f; border-radius: 6px; }
  .fixture .folder { display: flex; justify-content: space-between; width: 100%; }
  .fixture button:disabled { opacity: .58; } .fixture button:hover { background: #1e1a10; }
  .fixture :is(input, select, textarea, button, a):focus-visible { outline: 2px solid #f2c766; outline-offset: 2px; }
  .fixture table { width: 100%; border-collapse: collapse; }
  .fixture th, .fixture td { padding: 10px 12px; color: #e0e5ed; font-size: 12px; }
  .fixture strong { color: #f2c766; } .fixture ul { margin-top: 4px; }
  @media (max-width: 760px) { .fixture form { grid-template-columns: 1fr; } }
`;
const markup = `<div id="root"><main class="fixture mm-projects-page">
  <header><div><h1>AD-VIS-01 / fixture de isolamento</h1><p>Dados sintéticos. Não representa aceite da aplicação.</p></div></header>
  <aside><label><span>Busca lateral</span><input id="sidebar" type="search" placeholder="Buscar"></label></aside>
  <section><div><section>
    <h2>Arquivos e Documentos</h2><h3>Pastas</h3><h4>Contexto</h4>
    <button class="folder" type="button"><span>Pasta de teste</span><span>2</span></button>
    <form><label><span>Buscar</span><input id="search" type="search" value="Documento de teste"></label>
      <label><span>Tipo</span><select id="type"><option>Todos</option><option>PDF</option></select></label>
      <label><span>De</span><input id="date" type="date" value="2026-10-01"></label>
      <label><span>Descrição</span><textarea id="description">Teste de CSS</textarea></label>
      <button id="submit" type="submit">Aplicar</button><button id="disabled" disabled>Indisponível</button>
    </form>
    <label><input id="checkbox" type="checkbox">Selecionar</label>
    <label><input id="radio" type="radio" name="example">Opção</label>
    <label><span>Escala</span><input id="range" type="range"></label>
    <label><span>Arquivo</span><input id="file" type="file"></label>
    <a id="link" href="#fixture">Link de teste</a><strong>Metadado</strong>
    <div class="overflow-x-auto max-h-72"><table><thead><tr><th>Documento</th><th>Ações</th></tr></thead>
      <tbody><tr><td>exemplo.pdf</td><td><button type="button">Baixar</button></td></tr></tbody></table></div>
    <ul><li class="text-red-100">Erro</li><li class="text-emerald-100">Sucesso</li>
      <li class="text-yellow-100">Aviso</li><li class="text-blue-200">Informação</li></ul>
  </section></div><section><form><label><span>Outro formulário</span><input id="other"></label></form></section></section>
</main></div>`;

export async function prepare(page, width, shell = 'mm-projects-page', media = {}) {
  await page.setViewportSize({ width, height: 1100 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce', forcedColors: 'none', ...media });
  await page.setContent(markup);
  await page.mouse.move(0, 0);
  await page.evaluate(name => { document.querySelector('main').className = `fixture ${name}`; }, shell);
  await page.addStyleTag({ content: fixtureCss });
  await page.addStyleTag({ content: neutralCss });
}

export async function styleSnapshot(page) {
  return page.locator('main, main *').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    const properties = [
      'background-color', 'color', '-webkit-text-fill-color', 'caret-color', 'display',
      'width', 'height', 'min-height', 'max-height', 'padding', 'margin', 'border-radius',
      'border-top-width', 'border-top-color', 'border-bottom-width', 'border-bottom-color',
      'font-family', 'font-size', 'font-weight', 'line-height', 'justify-content', 'align-items',
      'grid-template-columns', 'gap', 'outline-color', 'outline-style', 'outline-width',
      'outline-offset', 'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'box-sizing',
    ];
    return Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)]));
  }));
}

async function allStates(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => { document.activeElement?.blur(); });
  const idle = await styleSnapshot(page);
  await page.locator('#search').focus();
  const focus = await styleSnapshot(page);
  await page.locator('#submit').hover();
  const hover = await styleSnapshot(page);
  return { idle, focus, hover };
}

export async function verifyProjectScope(page, width, media = {}) {
  await prepare(page, width, 'mm-projects-page', media);
  const withoutFallback = await allStates(page);
  await page.addStyleTag({ content: fallbackCss });
  assert.deepEqual(await allStates(page), withoutFallback, 'Fallback must not change Projects or descendants');
  const rules = await page.evaluate(() => {
    const found = [];
    function visit(list) {
      for (const rule of list) {
        if (rule.selectorText?.includes('#root > main')) found.push(rule.selectorText);
        if (rule.cssRules) visit(rule.cssRules);
      }
    }
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
    return { count: found.length, matches: found.filter(selector => document.querySelector(selector)) };
  });
  assert.ok(rules.count > 30, 'Non-vacuous: CSSOM must contain the fallback rules');
  assert.deepEqual(rules.matches, [], 'No presentation selector may match the Projects fixture');
}

export async function verifyLegacyParity(page, width, shell = 'legacy-page') {
  await prepare(page, width, shell);
  const style = await page.addStyleTag({ content: previousCss });
  // Equal-specificity sentinel: adding another :not(.class) would break this check.
  await page.addStyleTag({ content: '#root > main[data-sentinel] button { color: rgb(30, 40, 50); }' });
  await page.locator('main').evaluate(element => element.setAttribute('data-sentinel', ''));
  const before = await allStates(page);
  await style.evaluate((element, css) => { element.textContent = css; }, fallbackCss);
  assert.deepEqual(await allStates(page), before, `Legacy changed: ${shell} at ${width}px`);
}

export async function verifyReproduction(page) {
  await prepare(page, 1440);
  const style = await page.addStyleTag({ content: previousCss });
  assert.equal(await page.locator('#search').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.locator('.folder').evaluate(el => getComputedStyle(el).justifyContent), 'center');
  assert.equal(await page.locator('#submit').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(59, 130, 246)');
  await style.evaluate((element, css) => { element.textContent = css; }, fallbackCss);
  assert.equal(await page.locator('#search').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(14, 17, 22)');
  assert.equal(await page.locator('.folder').evaluate(el => getComputedStyle(el).justifyContent), 'space-between');
  assert.equal(await page.locator('#submit').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(22, 20, 13)');
}

export async function verifyShellTransition(page) {
  await prepare(page, 1024, 'legacy-page');
  await page.addStyleTag({ content: fallbackCss });
  for (const [shell, color] of [
    ['legacy-page', 'rgb(255, 255, 255)'],
    ['mm-projects-page', 'rgb(14, 17, 22)'],
    ['maono-login-page', 'rgb(14, 17, 22)'],
    ['mm-projects-page extra-class', 'rgb(14, 17, 22)'],
    ['legacy-page', 'rgb(255, 255, 255)'],
  ]) {
    await page.locator('main').evaluate((el, value) => { el.className = `fixture ${value}`; }, shell);
    assert.equal(await page.locator('#search').evaluate(el => getComputedStyle(el).backgroundColor), color);
  }
}
