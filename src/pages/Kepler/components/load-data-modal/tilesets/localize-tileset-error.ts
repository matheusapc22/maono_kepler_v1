/**
 * Translate native validation messages only at the presentation boundary.
 * The original errors, metadata, URLs and dataset payloads remain untouched.
 */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'For .pmtiles in mvt format, please use the Vector Tile form.':
    'Para arquivos .pmtiles no formato MVT, use o formulário Vetorial.',
  'For .pmtiles in raster format, please use the Raster Tile form.':
    'Para arquivos .pmtiles no formato matricial, use o formulário Matricial.',
  'Provide valid raster tile server urls to support STAC and elevations.':
    'Informe URLs válidas de servidores de blocos matriciais para usar STAC e elevação.',
  'Failed to fetch metadata': 'Não foi possível carregar os metadados.',
  'Failed to fetch': 'Não foi possível acessar a URL. Verifique a conexão e as permissões de acesso.',
  'Load failed': 'Não foi possível carregar os metadados.',
  'NetworkError when attempting to fetch resource.':
    'Não foi possível acessar a URL. Verifique a conexão e as permissões de acesso.',
  'Metadata must be an object.': 'Os metadados devem ser um objeto.',
  'Custom STAC Collections and Catalogs are not supported.':
    'Coleções e catálogos STAC personalizados não são aceitos.',
  'STAC versions before 1.0.0 not supported.':
    'Versões do STAC anteriores à 1.0.0 não são aceitas.',
  'Not a STAC Item or Collection.': 'Os dados não são um item ou uma coleção STAC.',
  'EO and Raster STAC extensions are required.':
    'As extensões EO e Raster do STAC são obrigatórias.',
  'item-assets STAC extension is required.':
    'A extensão item-assets do STAC é obrigatória.',
  'STAC object is missing asset information.':
    'O objeto STAC não contém informações sobre os recursos.',
  'At least one STAC asset must have both eo:bands and raster:bands data.':
    'Pelo menos um recurso STAC deve conter dados de eo:bands e raster:bands.',
  'Latitude out of range. Must be between -85.0511 and 85.0511.':
    'Latitude fora do intervalo. O valor deve estar entre -85.0511 e 85.0511.',
  'Zoom level must be a non-negative integer.':
    'O nível de zoom deve ser um número inteiro maior ou igual a zero.',
  'Unknown error': 'Ocorreu um erro desconhecido ao carregar os metadados.'
};

export function localizeTilesetError(message: string | null | undefined): string | null {
  if (!message) return null;
  if (ERROR_MESSAGES[message]) return ERROR_MESSAGES[message];

  if (message.startsWith('Failed Fetch ')) {
    // The URL is a user/server value, so display it verbatim.
    return `Não foi possível carregar os metadados de ${message.slice('Failed Fetch '.length)}`;
  }

  const httpFailure = /^Metadata loading failed: (\d{3})(?:\s|$)/.exec(message);
  if (httpFailure) {
    return `Não foi possível carregar os metadados (HTTP ${httpFailure[1]}).`;
  }

  if (/Unexpected (?:token|end)|JSON\.parse|not valid JSON/i.test(message)) {
    return 'Os metadados recebidos não contêm JSON válido.';
  }

  // Third-party parsers can introduce new or remote English messages. Do not
  // rewrite their data or guess a translated detail: show a localized fallback.
  return 'Não foi possível carregar os metadados. Verifique a URL, o formato e as permissões de acesso.';
}
