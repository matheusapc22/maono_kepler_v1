import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';

// Render the actual component and its production CSS, without Kepler or a full
// application build. Mouse-only replay matches the native headed-Firefox trace:
// mouseover/enter/move are delivered, but no corresponding pointer events.
let javascript = '';
let stylesheet = '';
const trigger = '.maono-panel-hint__trigger';
const popup = '.maono-panel-hint__popover';
const text = 'Os agrupamentos são uma representação interna da mesma camada. A visibilidade, a ordem e o estilo lógico permanecem únicos no painel.';

test.use({ viewport: { width: 320, height: 480 }, hasTouch: true, contextOptions: { reducedMotion: 'reduce' } });

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import PanelHint from './src/pages/Kepler/components/maono-layer-panel/PanelHint';
        createRoot(document.getElementById('root')).render(
          <section className="maono-layer-panel">
            <header id="outside">Camadas</header>
            <div className="maono-detail-view__scroll">
              <button id="before">Antes</button>
              <PanelHint label="Sobre o agrupamento espacial">{${JSON.stringify(text)}}</PanelHint>
              <button id="after">Depois</button>
            </div>
          </section>);`,
      sourcefile: 'panel-hint-compatibility-fixture.tsx',
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    outfile: 'panel-hint-compatibility-fixture.js',
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  javascript = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  stylesheet = result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;padding:12px;background:#0a0f18;color:#f7f2e8;font:13px system-ui}
      #outside{padding:16px 0}.maono-detail-view__scroll{height:200px;overflow:auto}
      .maono-panel-hint{margin:12px}button{font:inherit}${stylesheet}</style><div id="root"></div>`);
  await page.evaluate(() => {
    document.documentElement.dataset.hintOpens = '0';
    document.documentElement.dataset.shellEscapes = '0';
    document.addEventListener('maono-panel-hint-open', () => {
      document.documentElement.dataset.hintOpens = String(Number(document.documentElement.dataset.hintOpens) + 1);
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') document.documentElement.dataset.shellEscapes = String(Number(document.documentElement.dataset.shellEscapes) + 1);
    });
  });
  await page.addScriptTag({ content: javascript });
  await expect(page.locator(trigger)).toBeVisible();
});

async function mouseOnlyMove(page: Page, from: string, to: string) {
  await page.evaluate(({ from, to }) => {
    const previous = document.querySelector(from)!;
    const next = document.querySelector(to)!;
    previous.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: next }));
    next.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: previous }));
    next.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  }, { from, to });
}

test('mouse-only panel help opens, bridges to its portal and dismisses without pointer events', async ({ page }) => {
  await mouseOnlyMove(page, '#outside', trigger);
  await expect(page.locator(popup)).toBeVisible();
  await expect(page.locator(popup)).toHaveText(text);
  await mouseOnlyMove(page, trigger, popup);
  await page.waitForTimeout(220); // Exceed the 160ms gap timer, with the mouse inside the portal.
  await expect(page.locator(popup)).toBeVisible();
  await mouseOnlyMove(page, popup, '#outside');
  await expect(page.locator(popup)).toHaveCount(0);

  await mouseOnlyMove(page, '#outside', trigger);
  await expect(page.locator(popup)).toBeVisible();
  // A non-focusable header gets no focusin event. The mouse fallback must close
  // it even when the browser omits pointerdown, as it omitted pointerenter.
  await page.locator('#outside').dispatchEvent('mousedown');
  await expect(page.locator(popup)).toHaveCount(0);

  await page.locator(trigger).focus();
  await expect(page.locator(popup)).toBeVisible();
  await page.locator('#outside').dispatchEvent('touchstart');
  await expect(page.locator(popup)).toHaveCount(0);
});

test('mouse-only panel help preserves focus, Escape, click and repeated touch toggles', async ({ page }) => {
  const button = page.locator(trigger);
  const tooltip = page.locator(popup);
  await page.locator('#before').focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-shell-escapes', '0');
  await button.press('Enter');
  await expect(tooltip).toBeVisible();
  await button.press('Enter');
  await expect(tooltip).toHaveCount(0);
  await button.press('Space');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#after')).toBeFocused();
  await expect(tooltip).toHaveCount(0);

  await button.click();
  await expect(tooltip).toBeVisible();
  await button.click();
  await expect(tooltip).toHaveCount(0);
  await page.locator('#after').focus();
  await page.mouse.move(310, 470);
  await button.tap();
  await expect(tooltip).toBeVisible();
  await button.tap();
  await expect(tooltip).toHaveCount(0);
  await button.tap();
  await expect(tooltip).toBeVisible();
  await tooltip.tap();
  await page.waitForTimeout(220);
  await expect(tooltip).toBeVisible();
  await page.locator('#outside').tap();
  await expect(tooltip).toHaveCount(0);
});

test('mouse-only panel help deduplicates pointer plus mouse and ignores identified touch compatibility hover', async ({ page }) => {
  await page.locator(trigger).evaluate(element => {
    const event = new MouseEvent('mouseover', { bubbles: true });
    Object.defineProperty(event, 'sourceCapabilities', { value: { firesTouchEvents: true } });
    element.dispatchEvent(event);
  });
  await expect(page.locator(popup)).toHaveCount(0);
  await page.locator(trigger).evaluate(element => {
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await expect(page.locator(popup)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-hint-opens', '1');
  await page.locator(trigger).evaluate(element => {
    const outside = document.querySelector('#outside');
    element.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: outside }));
    element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: outside }));
  });
  await expect(page.locator(popup)).toHaveCount(0);
});
