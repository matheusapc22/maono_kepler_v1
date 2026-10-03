import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dataImportErrorMessage,
  importErrorText,
  isNativeImportError,
  localizeImportProgress,
} from '../src/pages/Kepler/components/load-data-modal/data-import-messages.ts';
import { localizeTilesetError } from '../src/pages/Kepler/components/load-data-modal/tilesets/localize-tileset-error.ts';

test('import presentation translates native errors and retains technical format names', () => {
  assert.equal(dataImportErrorMessage(new Error('Unknown file format')),
    'Formato de arquivo não reconhecido. Use CSV, JSON, GeoJSON, Arrow ou Parquet.');
  assert.equal(dataImportErrorMessage(new SyntaxError('Unexpected end of JSON input')),
    'Não foi possível ler o JSON. Verifique a sintaxe e tente novamente.');
  assert.equal(dataImportErrorMessage('arrow type not supported: List<Float64>'),
    'Um tipo de campo não é compatível com este formato.');
  assert.equal(dataImportErrorMessage('Error loading https://example.test/data.csv: 503'),
    'Não foi possível obter os dados. Verifique a URL, a conexão e a política CORS do servidor.');
  assert.equal(dataImportErrorMessage('no rows'), 'O arquivo não contém registros compatíveis.');
  assert.equal(dataImportErrorMessage(new Error('An unfamiliar server response')),
    'Não foi possível importar os dados. Verifique o arquivo ou a fonte e tente novamente.');
});

test('the reviewed import diagnostic boundary never exposes arbitrary native error text', () => {
  const privateDetail = 'private-server-detail https://example.test/?token=synthetic-secret <script>private-content</script>';
  for (const diagnostic of [
    privateDetail,
    `arrow type not supported: ${privateDetail}`,
    `Unknown file format: ${privateDetail}`,
    `Unexpected end of JSON input: ${privateDetail}`,
    `Error loading https://example.test/${privateDetail}`,
    `no rows: ${privateDetail}`,
  ]) {
    const nativeError = Object.freeze(new Error(diagnostic));
    const localized = dataImportErrorMessage(nativeError);
    assert.equal(localized.includes(privateDetail), false, diagnostic);
    assert.equal(localized.includes(diagnostic), false, diagnostic);
    assert.equal(nativeError.message, diagnostic);
    const progress = localizeImportProgress({ file: { error: nativeError } });
    assert.equal(progress.file.error.message, localized);
  }
});

test('native import recognition does not classify ordinary save and account notifications', () => {
  for (const message of [
    'Can not process uploaded file Synthetic Roads.json',
    'Failed to upload files',
    'Error loading https://example.test/data.csv: 503',
    'Unexpected end of JSON input',
    'JSON.parse: expected property name',
    'arrow type not supported: Int64',
  ]) assert.equal(isNativeImportError(message), true, message);
  for (const message of ['Map saved successfully', 'Failed to save project', 'Access denied', 'Unknown file format']) {
    assert.equal(isNativeImportError(message), false, message);
  }
  assert.equal(importErrorText(null), '');
  assert.equal(importErrorText(new Error('Native error')), 'Native error');
});

test('progress translation is presentation-only and preserves filenames, values and native errors', () => {
  const nativeError = Object.freeze(new SyntaxError('Unexpected end of JSON input'));
  const data = Object.freeze({ name: 'English Road Names', url: 'https://example.test/Roads.json', values: ['Road', 'City'] });
  const input = Object.freeze({
    'English Roads.json': Object.freeze({ message: 'processing...', error: nativeError, fileName: 'English Roads.json', data, percent: 42 }),
    'Cities.csv': Object.freeze({ message: 'loading...', error: null, data }),
    'Ready.arrow': Object.freeze({ message: 'Done', error: undefined, data }),
    'Custom.csv': Object.freeze({ message: 'User-provided value', data }),
  });
  const output = localizeImportProgress(input);
  assert.notEqual(output, input);
  assert.deepEqual(Object.keys(output), Object.keys(input));
  assert.equal(output['English Roads.json'].message, 'Processando arquivo…');
  assert.equal(output['Cities.csv'].message, 'Carregando arquivo…');
  assert.equal(output['Ready.arrow'].message, 'Concluído');
  assert.equal(output['Custom.csv'].message, 'User-provided value');
  assert.equal(output['English Roads.json'].fileName, 'English Roads.json');
  assert.equal(output['English Roads.json'].percent, 42);
  assert.equal(output['English Roads.json'].data, data);
  assert.equal(output['English Roads.json'].error.message,
    'Não foi possível ler o JSON. Verifique a sintaxe e tente novamente.');
  assert.equal(input['English Roads.json'].message, 'processing...');
  assert.equal(input['English Roads.json'].error, nativeError);
  assert.equal(nativeError.message, 'Unexpected end of JSON input');
  assert.deepEqual(localizeImportProgress(undefined), {});
});

test('tileset metadata errors translate without changing URLs or technical identifiers', () => {
  const url = 'https://example.test/English%20Roads/metadata.json?name=MyDataset';
  assert.equal(localizeTilesetError(`Failed Fetch ${url}`), `Não foi possível carregar os metadados de ${url}`);
  assert.equal(localizeTilesetError('Metadata loading failed: 503 Service Unavailable'),
    'Não foi possível carregar os metadados (HTTP 503).');
  assert.equal(localizeTilesetError('Provide valid raster tile server urls to support STAC and elevations.'),
    'Informe URLs válidas de servidores de blocos matriciais para usar STAC e elevação.');
  assert.equal(localizeTilesetError('For .pmtiles in mvt format, please use the Vector Tile form.'),
    'Para arquivos .pmtiles no formato MVT, use o formulário Vetorial.');
  assert.equal(localizeTilesetError('At least one STAC asset must have both eo:bands and raster:bands data.'),
    'Pelo menos um recurso STAC deve conter dados de eo:bands e raster:bands.');
  assert.equal(localizeTilesetError('Unexpected end of JSON input'),
    'Os metadados recebidos não contêm JSON válido.');
  assert.equal(localizeTilesetError('Unexpected private server detail'),
    'Não foi possível carregar os metadados. Verifique a URL, o formato e as permissões de acesso.');
  assert.equal(localizeTilesetError(undefined), null);
});
