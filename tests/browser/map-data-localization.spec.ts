import { isLocalBrowserBlob } from '../helpers/local-browser-url.mjs';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Real application, metadata loaders, Redux ingestion and WebGL. All HTTP
// responses/data are synthetic. The parent runner owns the compiled preview.
// No production catalog, credentials, or account mutations are used.
test.use({ reducedMotion: 'reduce' });
test.setTimeout(60_000);

const style = JSON.parse(readFileSync(new URL('./fixtures/map-fidelity-style.json', import.meta.url), 'utf8'));
const organization = { id: 1, name: 'Organização sintética QA', slug: 'qa-localization', active: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');
const metadataName = 'English Road Names - QA';
const wmsTitle = 'English Weather Service - QA';
const csv = 'name,latitude,longitude\nEnglish Road,-23.5505,-46.6333\n';
const wmsCapabilities = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>${wmsTitle}</Title></Service>
  <Capability>
    <Request><GetCapabilities><Format>text/xml</Format></GetCapabilities><GetMap><Format>image/png</Format></GetMap></Request>
    <Layer><Title>Synthetic weather</Title><CRS>EPSG:4326</CRS><CRS>EPSG:3857</CRS>
      <EX_GeographicBoundingBox><westBoundLongitude>-47</westBoundLongitude><eastBoundLongitude>-46</eastBoundLongitude><southBoundLatitude>-24</southBoundLatitude><northBoundLatitude>-23</northBoundLatitude></EX_GeographicBoundingBox>
      <Layer queryable="1"><Name>qa_weather</Name><Title>English Weather Values</Title><CRS>EPSG:4326</CRS>
        <EX_GeographicBoundingBox><westBoundLongitude>-47</westBoundLongitude><eastBoundLongitude>-46</eastBoundLongitude><southBoundLatitude>-24</southBoundLatitude><northBoundLatitude>-23</northBoundLatitude></EX_GeographicBoundingBox>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

type Capture = { raw: { datasetIds: string[]; layerIds: string[]; layerTypes: string[] } };
type QAWindow = Window & {
  __MAONO_ENGINE_DEBUG__?: { capture(label: string): Capture };
  __MAONO_MAP_LAYOUT_DEBUG__?: { capture(label: string): { check: {
    styleLoaded: boolean; validCanvasCount: number; contextAvailable: boolean;
  } } };
};

async function openMap(page: Page, options: { remoteStatus?: number; remoteGate?: Promise<void>; legacyShell?: boolean } = {}) {
  const requests: string[] = [];
  const writes: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url.href);
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 405, json: { ok: false, error: 'Synthetic test forbids account mutations' } });
    }
    if (url.pathname === '/api/session') return route.fulfill({ json: {
      authenticated: true,
      user: { id: 1, name: 'English User Name - QA', email: 'localization@example.test', role: 'super_admin', activeOrganizationId: 1 },
      organizations: [organization], activeOrganization: organization, projects: [],
    } });
    if (url.pathname === '/api/maps/new/context') return route.fulfill({ json: { ok: true,
      policyVersion: 1, requestedMode: 'create', mode: 'create', assignedMode: 'create', defaultPanel: 'create', allowed: true,
      project: null, organization, availablePanels: { viewer: false, editor: false, create: true },
      capabilities: {
        openCreateWorkspace: true, createProject: true, initializeMap: true, saveMap: true,
        viewMap: true, openLayerPanel: true, viewLayers: true, viewFilters: true,
        editLayers: true, editStyle: true, manageFilters: true, createLayer: true,
        placeAnalysisMarker: true, toggleLegend: true, configureTooltips: true, addData: true, importData: true,
      },
      features: { mapPanelModes: true, mapCreateRoute: true, maonoMapShell: !options.legacyShell, maonoLayerManager: !options.legacyShell, maonoMapOverlay: !options.legacyShell },
    } });
    if (url.pathname === '/__qa/localization/English-Roads.csv') {
      if (options.remoteGate) await options.remoteGate;
      return route.fulfill({ status: options.remoteStatus ?? 200, contentType: 'text/csv', body: options.remoteStatus ? 'Synthetic service unavailable' : csv });
    }
    if (url.pathname === '/__qa/localization/metadata.json') return route.fulfill({ json: {
      tilejson: '2.2.0', name: metadataName, description: 'English dataset values stay unchanged',
      format: 'pbf', minzoom: 0, maxzoom: 1, bounds: [-47, -24, -46, -23], center: [-46.63, -23.55, 1],
      tiles: [`${url.origin}/__qa/localization/tiles/{z}/{x}/{y}.pbf`],
      vector_layers: [{ id: 'English_Roads', fields: { English_Value: 'Number' }, minzoom: 0, maxzoom: 1 }],
    } });
    if (/^\/__qa\/localization\/tiles\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname)) {
      return route.fulfill({ contentType: 'application/vnd.mapbox-vector-tile', body: Buffer.alloc(0) });
    }
    if (url.pathname === '/__qa/localization/English-Raster.json') return route.fulfill({ json: {
      type: 'Feature', stac_version: '1.0.0', id: 'English Raster Values',
      stac_extensions: [
        'https://stac-extensions.github.io/eo/v1.1.0/schema.json',
        'https://stac-extensions.github.io/raster/v1.1.0/schema.json',
      ],
      bbox: [-47, -24, -46, -23],
      geometry: { type: 'Polygon', coordinates: [[[-47, -24], [-46, -24], [-46, -23], [-47, -23], [-47, -24]]] },
      properties: { datetime: '2026-01-01T00:00:00Z' }, links: [],
      assets: { visual: {
        href: `${url.origin}/__qa/localization/English-Raster.tif`, type: 'image/tiff; application=geotiff; profile=cloud-optimized', roles: ['data'],
        'eo:bands': [{ name: 'red', common_name: 'red' }, { name: 'green', common_name: 'green' }, { name: 'blue', common_name: 'blue' }],
        'raster:bands': Array.from({ length: 3 }, () => ({ data_type: 'uint8', statistics: { minimum: 0, maximum: 255 } })),
      } },
    } });
    if (url.pathname === '/__qa/localization/missing-metadata.json') return route.fulfill({ status: 503, body: 'Synthetic metadata unavailable' });
    if (url.pathname === '/__qa/localization/wms') {
      return url.searchParams.get('request')?.toLowerCase() === 'getcapabilities'
        ? route.fulfill({ contentType: 'text/xml', body: wmsCapabilities })
        : route.fulfill({ contentType: 'image/png', body: png });
    }
    // The STAC creation test verifies metadata -> native dataset/layer creation.
    // Raster image rendering is outside this localization test, so no real COG
    // or production tiler is fetched. All synthetic tiler failures are bounded.
    if (url.pathname.startsWith('/__qa/localization/raster-server/')) {
      return route.fulfill({ status: 404, json: { detail: 'Synthetic raster pixels are not part of this fixture' } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, items: [], projects: [] } });
    if (url.href.includes('svg-icons.json')) return route.fulfill({ json: { svgIcons: [] } });
    if ((url.hostname === 'basemaps.cartocdn.com' && /^\/gl\/[^/]+\/style\.json$/.test(url.pathname)) ||
        (url.hostname === 'api.mapbox.com' && /^\/styles\/v1\//.test(url.pathname))) return route.fulfill({ json: style });
    if (isLocalBrowserBlob(url, page.url())) return route.continue();
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto('/maps/new/create?maonoLayoutDebug=1&maonoEngineDebug=1');
  if (options.legacyShell) {
    await expect(page.locator('.kepler-gl')).toBeVisible({ timeout: 30_000 });
    return { requests, writes };
  }
  await expect(page.locator('.maono-map-runtime')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.maono-map-runtime')).toHaveAttribute('data-map-ready', 'true');
  await expect.poll(() => page.evaluate(() => {
    const runtime = window as QAWindow;
    const check = runtime.__MAONO_MAP_LAYOUT_DEBUG__?.capture('localization-ready').check;
    return Boolean(check?.styleLoaded && check.validCanvasCount > 0 && check.contextAvailable && runtime.__MAONO_ENGINE_DEBUG__);
  })).toBe(true);
  await page.locator('.maono-map-sidebar').getByRole('button', { name: 'Adicionar dados', exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
  return { requests, writes };
}

const sidebar = (page: Page) => page.locator('aside#map-add-data-sidebar');
const tab = (page: Page, name: string) => sidebar(page).getByRole('tab', { name, exact: true });
const addTileset = (page: Page) => sidebar(page).getByRole('button', { name: 'Adicionar conjunto', exact: true });
const fileInput = (page: Page) => sidebar(page).locator('input[type=file]').first();
const capture = (page: Page) => page.evaluate(() => {
  const debug = (window as QAWindow).__MAONO_ENGINE_DEBUG__;
  if (!debug) throw new Error('Native engine debug API is unavailable');
  return debug.capture('localization-assertion');
});
const selectTileType = (page: Page, name: string) => sidebar(page).locator('.tileset-type').getByText(name, { exact: true }).click();
async function expectImported(page: Page, layerType?: string) {
  await expect.poll(async () => (await capture(page)).raw.datasetIds.length).toBe(1);
  await expect.poll(async () => (await capture(page)).raw.layerIds.length).toBeGreaterThan(0);
  if (layerType) await expect.poll(async () => (await capture(page)).raw.layerTypes).toContain(layerType);
  await expect(sidebar(page)).toBeHidden();
}
async function expectPortugueseField(page: Page, label: string, placeholder: string) {
  const input = sidebar(page).getByRole('textbox', { name: label, exact: true });
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('placeholder', placeholder);
  return input;
}

// Negative checks target interface phrases only. Never ban all English words:
// names, source URLs, metadata values, formats and protocol identifiers are data.
const englishInterface = /Name your tileset|Tileset metadata URL|Raster tile servers|Supports raster|Limited support|Add Tileset|Enter WMS|For example|Browse Files|Drag and drop|Load your map|click here/;

test('Dados Maõno and Arquivos expose Portuguese text and accessibility labels', async ({ page }) => {
  const { writes } = await openMap(page);
  await expect(sidebar(page)).toHaveAccessibleName('Adicionar Dados ao Mapa');
  await expect(sidebar(page).getByRole('tab')).toHaveText(['Dados Maõno', 'Arquivos', 'Tileset', 'URL']);
  await expect(sidebar(page).getByRole('tablist')).toHaveAccessibleName('Fontes de dados');
  await expect(sidebar(page).getByRole('searchbox', { name: 'Buscar fonte de dados', exact: true })).toHaveAttribute('placeholder', 'Buscar fonte de dados...');
  await expect(sidebar(page).getByRole('button', { name: 'Fechar painel', exact: true })).toBeVisible();
  await expect(sidebar(page)).toContainText('Bases e dados oficiais disponibilizados pela Maõno.');
  await expect(sidebar(page).getByRole('status')).toHaveText('Nenhuma fonte disponível no momento.');
  await tab(page, 'Arquivos').click();
  await expect(sidebar(page)).toContainText('Arraste e solte seus arquivos aqui');
  await expect(sidebar(page).getByRole('button', { name: 'Selecionar arquivo', exact: true })).toBeVisible();
  await expect(sidebar(page)).toContainText('Os arquivos são processados neste navegador para adicionar dados ao mapa.');
  await expect(sidebar(page)).toContainText('formatos de arquivo aceitos');
  await expect(sidebar(page).locator('a[href*="kepler.gl"]')).toHaveCount(0);
  for (const format of ['CSV', 'JSON', 'GeoJSON', 'Arrow', 'Parquet']) await expect(sidebar(page)).toContainText(format);
  await expect(sidebar(page)).not.toContainText(englishInterface);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(writes).toEqual([]);
});

test('all Tileset forms are Portuguese and contain no external Kepler help', async ({ page }, testInfo) => {
  const { writes } = await openMap(page);
  await tab(page, 'Tileset').click();
  await expect(sidebar(page)).toContainText('Tipo de conjunto');
  for (const type of ['Vetorial', 'Matricial', 'WMS']) await expect(sidebar(page).locator('.tileset-type').getByText(type, { exact: true })).toBeVisible();
  await expectPortugueseField(page, 'Nome', 'Nome do conjunto de blocos');
  await expectPortugueseField(page, 'URL do conjunto de blocos', 'URL do conjunto de blocos');
  await expectPortugueseField(page, 'URL dos metadados', 'URL dos metadados');
  await expect(sidebar(page)).toContainText('Requer os marcadores {x}, {y} e {z} na URL ou a extensão .pmtiles.');
  await expect(sidebar(page)).toContainText('Opcional, mas recomendado. Aceita json e txt.');
  await expect(addTileset(page)).toBeDisabled();
  await expect(sidebar(page)).not.toContainText(englishInterface);

  await selectTileType(page, 'Matricial');
  await expectPortugueseField(page, 'Nome', 'Nome do conjunto de blocos');
  await expectPortugueseField(page, 'URL dos metadados', 'URL dos metadados');
  await expectPortugueseField(page, 'Servidores de blocos matriciais', 'URLs dos servidores, separadas por vírgulas');
  await expect(sidebar(page)).toContainText('Aceita .pmtiles matriciais. Suporte limitado a itens e coleções STAC.');
  await expect(sidebar(page)).toContainText('URLs dos servidores de blocos matriciais para conjuntos Cloud Optimized GeoTIFF e elevação.');
  for (const label of ['tile-metadata', 'tileset-raster-servers']) {
    const row = sidebar(page).locator(`label[for="${label}"]`).locator('..');
    await expect(row.locator('a, svg, button')).toHaveCount(0);
  }
  await expect(sidebar(page).getByRole('link')).toHaveCount(0);
  await expect(sidebar(page).locator('[title*="Ajuda"], [aria-label*="documentação"]')).toHaveCount(0);
  await expect(sidebar(page)).not.toContainText(englishInterface);
  await page.screenshot({ path: testInfo.outputPath('localized-raster-form.png') });

  await selectTileType(page, 'WMS');
  await expectPortugueseField(page, 'Nome', 'Nome da camada WMS');
  await expectPortugueseField(page, 'URL do serviço WMS', 'Digite a URL do serviço WMS');
  await expect(sidebar(page)).toContainText('Informe uma URL válida de serviço WMS.');
  await expect(sidebar(page)).toContainText('Por exemplo, use uma URL pública de WMS:');
  await expect(sidebar(page)).toContainText('https://ows.terrestris.de/osm/service');
  await expect(sidebar(page)).toContainText('https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows');
  await expect(sidebar(page)).toContainText('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi');
  await expect(addTileset(page)).toBeDisabled();
  await expect(sidebar(page)).not.toContainText(englishInterface);
  expect(writes).toEqual([]);
});

test('URL copy, accessible field, validation and fetch action are Portuguese', async ({ page }) => {
  const { requests, writes } = await openMap(page);
  await tab(page, 'URL').click();
  const input = await expectPortugueseField(page, 'URL da fonte de dados', 'Cole a URL do arquivo ou mapa');
  await expect(sidebar(page)).toContainText('Carregue uma fonte de dados ou um mapa por URL.');
  await expect(sidebar(page)).toContainText('Formatos aceitos: CSV, JSON e configuração de mapa Maõno em JSON.');
  await expect(sidebar(page)).toContainText('Exemplos:');
  await expect(sidebar(page)).toContainText('O domínio da fonte deve permitir o acesso pela política CORS.');
  await expect(sidebar(page).getByRole('link', { name: 'consulte a documentação', exact: true })).toBeVisible();
  const before = requests.length;
  await input.fill('invalid-English-URL-value');
  await sidebar(page).getByRole('button', { name: 'Carregar', exact: true }).click();
  await expect(sidebar(page)).toContainText('Informe uma URL válida.');
  await expect(input).toHaveValue('invalid-English-URL-value');
  await expect(sidebar(page)).not.toContainText(englishInterface);
  expect(requests.slice(before).filter(url => url.includes('invalid-English-URL-value'))).toEqual([]);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(writes).toEqual([]);
});

test('URL keeps a Portuguese loading status and preserves the source URL through native CSV import', async ({ page }) => {
  let finishFetch!: () => void;
  const remoteGate = new Promise<void>(resolve => { finishFetch = resolve; });
  const { requests, writes } = await openMap(page, { remoteGate });
  await tab(page, 'URL').click();
  const source = new URL('/__qa/localization/English-Roads.csv', page.url()).href;
  const input = sidebar(page).getByRole('textbox', { name: 'URL da fonte de dados', exact: true });
  await input.fill(source);
  try {
    await sidebar(page).getByRole('button', { name: 'Carregar', exact: true }).click();
    await expect.poll(() => requests.filter(url => url === source).length).toBe(1);
    await expect(sidebar(page).getByRole('status')).toHaveText('Carregando dados…');
    await expect(input).toHaveValue(source);
    await expect(sidebar(page).getByRole('button', { name: 'Carregar', exact: true })).toBeDisabled();
  } finally {
    finishFetch();
  }
  await expectImported(page);
  expect(writes).toEqual([]);
});

test('URL HTTP errors render Portuguese and leave import usable', async ({ page }) => {
  const { writes } = await openMap(page, { remoteStatus: 503 });
  await tab(page, 'URL').click();
  const source = new URL('/__qa/localization/English-Roads.csv', page.url()).href;
  await sidebar(page).getByRole('textbox', { name: 'URL da fonte de dados', exact: true }).fill(source);
  await sidebar(page).getByRole('button', { name: 'Carregar', exact: true }).click();
  const notification = page.locator('.notification-item').first();
  await expect(notification).toBeVisible();
  await expect(notification).toContainText(/Não foi possível|Falha ao|indisponível/);
  await expect(notification).not.toContainText(/Error loading|Failed to|Can not process|Service Unavailable/);
  await expect(sidebar(page).getByRole('textbox', { name: 'URL da fonte de dados', exact: true })).toHaveValue(source);
  await expect(sidebar(page).getByRole('button', { name: 'Carregar', exact: true })).toBeEnabled();
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(writes).toEqual([]);
});

test('Arquivos unsupported-file warning is Portuguese while the filename stays verbatim', async ({ page }) => {
  const { writes } = await openMap(page);
  await tab(page, 'Arquivos').click();
  const name = 'English Roads - sample.exe';
  await fileInput(page).setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('Synthetic fixture, not an executable') });
  await expect(sidebar(page)).toContainText(`O arquivo ${name} não é compatível.`);
  await expect(sidebar(page)).not.toContainText(/not supported|unsupported|Upload failed/i);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(writes).toEqual([]);
});

test('Arquivos native malformed-JSON notification stays Portuguese after progress is cleared', async ({ page }) => {
  const { writes } = await openMap(page);
  await tab(page, 'Arquivos').click();
  await fileInput(page).setInputFiles({ name: 'English Road Values.json', mimeType: 'application/json', buffer: Buffer.from('{"broken": [') });
  const notification = page.locator('.notification-item').first();
  await expect(notification).toBeVisible();
  await expect(sidebar(page)).toBeHidden();
  await expect(notification).toContainText(/Não foi possível ler o JSON\. Verifique a sintaxe e tente novamente\.|Formato de arquivo não reconhecido\. Use CSV, JSON, GeoJSON, Arrow ou Parquet\./);
  await expect(notification).not.toContainText(/Can not process|Unexpected|Failed to upload|JSON\.parse|Unterminated/);
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(writes).toEqual([]);
});

test('Vetorial keeps source metadata and data values unchanged during native dataset creation', async ({ page }) => {
  const { writes } = await openMap(page);
  await tab(page, 'Tileset').click();
  const origin = new URL(page.url()).origin;
  const metadata = `${origin}/__qa/localization/metadata.json`;
  const tileUrl = `${origin}/__qa/localization/tiles/{z}/{x}/{y}.pbf`;
  await sidebar(page).getByRole('textbox', { name: 'URL dos metadados', exact: true }).fill(metadata);
  await sidebar(page).getByRole('textbox', { name: 'URL do conjunto de blocos', exact: true }).fill(tileUrl);
  await expect(sidebar(page).getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue(metadataName);
  await expect(sidebar(page).getByRole('textbox', { name: 'URL dos metadados', exact: true })).toHaveValue(metadata);
  await expect(sidebar(page).locator('#json-pretty')).toContainText('English dataset values stay unchanged');
  await expect(sidebar(page).locator('#json-pretty')).toContainText('English_Value');
  await expect(addTileset(page)).toBeEnabled();
  await addTileset(page).click();
  await expectImported(page, 'vectorTile');
  expect(writes).toEqual([]);
});

test('Matricial translates native server validation and still creates a native raster dataset', async ({ page }) => {
  const { writes } = await openMap(page);
  await tab(page, 'Tileset').click();
  await selectTileType(page, 'Matricial');
  const origin = new URL(page.url()).origin;
  const userName = 'English Raster Name - QA';
  await sidebar(page).getByRole('textbox', { name: 'Nome', exact: true }).fill(userName);
  await sidebar(page).getByRole('textbox', { name: 'URL dos metadados', exact: true }).fill(`${origin}/__qa/localization/English-Raster.json`);
  await expect(sidebar(page).getByRole('alert')).toHaveText('Informe URLs válidas de servidores de blocos matriciais para usar STAC e elevação.');
  await expect(addTileset(page)).toBeDisabled();
  await sidebar(page).getByRole('textbox', { name: 'Servidores de blocos matriciais', exact: true }).fill(`${origin}/__qa/localization/raster-server`);
  await expect(sidebar(page).getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue(userName);
  await expect(sidebar(page).locator('#json-pretty')).toContainText('English Raster Values');
  await expect(sidebar(page).locator('#json-pretty')).toContainText('eo:bands');
  await expect(addTileset(page)).toBeEnabled();
  await addTileset(page).click();
  await expectImported(page, 'rasterTile');
  expect(writes).toEqual([]);
});

test('WMS keeps service titles and identifiers unchanged while native capabilities create a WMS layer', async ({ page }) => {
  const { requests, writes } = await openMap(page);
  await tab(page, 'Tileset').click();
  await selectTileType(page, 'WMS');
  const source = new URL('/__qa/localization/wms', page.url()).href;
  await sidebar(page).getByRole('textbox', { name: 'URL do serviço WMS', exact: true }).fill(source);
  await expect(sidebar(page).getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue(wmsTitle);
  await expect(sidebar(page).locator('#json-pretty')).toContainText('English Weather Values');
  await expect(sidebar(page).locator('#json-pretty')).toContainText('qa_weather');
  await expect(addTileset(page)).toBeEnabled();
  await addTileset(page).click();
  await expectImported(page, 'wms');
  expect(requests).toContain(`${source}?service=WMS&request=GetCapabilities`);
  expect(writes).toEqual([]);
});

test('Matricial metadata fetch failure translates the message while preserving the URL', async ({ page }) => {
  const { writes } = await openMap(page);
  await tab(page, 'Tileset').click();
  await selectTileType(page, 'Matricial');
  const source = new URL('/__qa/localization/missing-metadata.json', page.url()).href;
  await sidebar(page).getByRole('textbox', { name: 'Nome', exact: true }).fill('English Failed Dataset');
  await sidebar(page).getByRole('textbox', { name: 'URL dos metadados', exact: true }).fill(source);
  await expect(sidebar(page).getByRole('alert')).toHaveText(`Não foi possível carregar os metadados de ${source}`);
  await expect(sidebar(page).getByRole('textbox', { name: 'URL dos metadados', exact: true })).toHaveValue(source);
  await expect(addTileset(page)).toBeDisabled();
  expect((await capture(page)).raw.datasetIds).toEqual([]);
  expect(writes).toEqual([]);
});


test('legacy map header, uploads and exports omit Kepler help while controls still work', async ({ page }, testInfo) => {
  const { writes } = await openMap(page, { legacyShell: true });
  await expect(page.getByRole('img', { name: 'Logo Maõno', exact: true })).toBeVisible();
  await expect(page.locator('.side-panel__panel-header__action#share-url-only-action')).toBeVisible();
  await expect(page.locator('#docs-action, #bug-action')).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar Dados', exact: true }).click();
  await expect(page.locator('.load-data-modal')).toBeVisible();
  await expect(page.locator('.load-data-modal a[href*="kepler.gl"]')).toHaveCount(0);
  await page.locator('.load-data-modal__tab__item').filter({ hasText: 'Tileset' }).click();
  await page.locator('.tileset-type').getByText('Matricial', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Servidores de blocos matriciais', exact: true })).toBeVisible();
  await expect(page.locator('.load-data-modal a[href*="kepler.gl"]')).toHaveCount(0);
  await page.locator('.modal--close').click();
  await page.locator('.side-panel__panel-header__action#share-url-only-action').click();
  await page.getByText('Exportar Mapa', {exact:true}).click();
  const exportModal = page.locator('.export-map-modal');
  await expect(exportModal).toBeVisible();
  await expect(exportModal.locator('a')).toHaveCount(0);
  await expect(exportModal).toContainText('Se você não fornecer a sua própria chave de acesso');
  const token = exportModal.getByPlaceholder('Cole a sua chave de acesso Mapbox', { exact: true });
  await token.fill('synthetic-qa-token-not-a-real-credential');
  await expect(token).toHaveValue('synthetic-qa-token-not-a-real-credential');
  const editMode = exportModal.getByText('Permitir usuários a editar o mapa', { exact: true }).locator('..');
  await editMode.click();
  await expect(editMode.locator('.checkbox-inner')).toHaveCount(1);
  await exportModal.getByText('json', { exact: true }).click();
  await expect(exportModal.locator('#json-pretty')).toContainText('visState');
  await expect(exportModal.locator('a')).toHaveCount(0);
  await expect(exportModal).toContainText('addDataToMap');
  await exportModal.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(exportModal.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();
  await exportModal.getByText('html', { exact: true }).click();
  await expect(token).toHaveValue('synthetic-qa-token-not-a-real-credential');
  await expect(editMode.locator('.checkbox-inner')).toHaveCount(1);
  await expect(exportModal.locator('a')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('legacy-export-without-kepler-help.png') });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(exportModal).toHaveCount(0);
  await page.locator('.side-panel__panel-header__action#share-url-only-action').click();
  await page.getByText('Exportar Mapa', { exact: true }).click();
  await expect(exportModal).toBeVisible();
  await expect(exportModal.locator('a')).toHaveCount(0);
  await page.locator('.modal--close').click();
  await expect(exportModal).toHaveCount(0);
  expect(writes).toEqual([]);
});
