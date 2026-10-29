/** Contracts shared by the management service and its deterministic tests. */
export const PLAN_LABELS = Object.freeze({ free: 'Básico', pro: 'Profissional', enterprise: 'Empresarial' });
export const MAX_ITEMS = 100;
export const MAX_CSV_BYTES = 128 * 1024;
export class ManagementError extends Error {
  constructor(message, status = 400, code = 'ORGANIZATION_MANAGEMENT_INVALID', retryable = false) {
    super(message); this.name = 'ManagementError'; this.status = status; this.code = code; this.retryable = retryable;
  }
}
export function check(condition, message, status = 400, code, retryable = false) {
  if (!condition) throw new ManagementError(message, status, code, retryable);
}
export function object(value, allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Informe um objeto válido.');
  for (const key of Object.keys(value)) check(allowed.includes(key), `Campo não permitido: ${key}.`);
  return value;
}
export function integer(value, label = 'ID', min = 1, max = Number.MAX_SAFE_INTEGER) {
  check(['number','string'].includes(typeof value) && String(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max, `${label} inválido.`);
  return Number(value);
}
export function text(value, label, min = 0, max = 160) {
  check(typeof value === 'string', `${label} deve ser texto.`);
  const result = value.trim();
  check(result.length >= min && result.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result), `${label}: use entre ${min} e ${max} caracteres.`);
  return result;
}
export function plan(value) {
  check(Object.hasOwn(PLAN_LABELS, value), 'Plano inválido.'); return value;
}
export function createInput(input) {
  object(input, ['name', 'slug', 'description', 'plan', 'ownerEmail']);
  const slug = text(input.slug, 'Identificador', 1, 64);
  check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), 'Identificador: letras minúsculas, números e hífens.');
  const email = text(input.ownerEmail, 'E-mail do responsável', 3, 254).toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'E-mail do responsável inválido.');
  return { name: text(input.name, 'Nome', 1, 160), slug, description: text(input.description ?? '', 'Descrição', 0, 3000), plan: plan(input.plan ?? 'free'), ownerEmail: email };
}
export function changeInput(input) {
  object(input, ['id', 'version', 'name', 'description', 'active', 'ownerId', 'plan', 'projectLimit', 'reason']);
  const output = { id: integer(input.id), version: integer(input.version, 'Versão', 0), reason: text(input.reason ?? '', 'Justificativa', 5, 500) };
  if ('name' in input) output.name = text(input.name, 'Nome', 1, 160);
  if ('description' in input) output.description = text(input.description, 'Descrição', 0, 3000);
  if ('active' in input) { check(typeof input.active === 'boolean', 'Estado inválido.'); output.active = input.active; }
  if ('ownerId' in input) output.ownerId = integer(input.ownerId, 'Responsável');
  if ('plan' in input) output.plan = plan(input.plan);
  if ('projectLimit' in input) output.projectLimit = input.projectLimit === null ? null : integer(input.projectLimit, 'Limite de projetos', 1, 1000000);
  check(Object.keys(output).length > 3, 'Nenhuma alteração informada.');
  const metadata = 'name' in output || 'description' in output || 'active' in output;
  const policy = 'ownerId' in output || 'plan' in output || 'projectLimit' in output;
  check(!(metadata && policy), 'Salve dados gerais e política em operações separadas.');
  return output;
}
export function queryInput(url) {
  const p = new URL(url).searchParams;
  const status = p.get('status') || 'all';
  check(['all', 'active', 'paused'].includes(status), 'Filtro de status inválido.');
  const selectedPlan = p.get('plan') || 'all'; if (selectedPlan !== 'all') plan(selectedPlan);
  const sort = p.get('sort') || 'newest';
  check(['newest', 'name', 'updated'].includes(sort), 'Ordenação inválida.');
  const size = integer(p.get('size') || 10, 'Itens por página', 1, 50); check([10, 20, 50].includes(size), 'Use 10, 20 ou 50 itens por página.');
  return { q: text(p.get('q') || '', 'Busca', 0, 160), status, plan: selectedPlan, sort, page: integer(p.get('page') || 1, 'Página', 1, 100000), size };
}
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function requestHash(value) {
  const bytes = new TextEncoder().encode(stableJson(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** RFC4180-style parsing, no spreadsheet evaluation and no network access. */
export function parseImportCsv(csv) {
  check(typeof csv === 'string' && new TextEncoder().encode(csv).length <= MAX_CSV_BYTES, 'CSV excede 128 KiB.');
  csv = csv.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) { if (c === '"') { if (csv[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; continue; }
    if (c === '"') { check(!field && !closed, 'Aspas inválidas no CSV.'); quoted = true; continue; }
    if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (c === '\r' && csv[i + 1] === '\n') i++; if (row.some(v => v !== '')) rows.push(row); row = []; }
      check(rows.length <= MAX_ITEMS + 1, 'O CSV admite até 100 organizações.');
      continue;
    }
    check(!closed, 'Conteúdo após fechamento de aspas.'); field += c;
  }
  check(!quoted, 'Aspas não fechadas no CSV.'); row.push(field); if (row.some(v => v !== '')) rows.push(row);
  check(rows.length >= 2 && rows.length <= MAX_ITEMS + 1, 'Informe de 1 a 100 linhas de dados.');
  check(rows[0].join(',') === 'nome,slug,descricao,plano,responsavel_email', 'Cabeçalho esperado: nome,slug,descricao,plano,responsavel_email');
  return rows.slice(1).map((cells, index) => {
    try { check(cells.length === 5, 'A linha precisa ter cinco colunas.'); return { line: index + 2, input: createInput({ name: cells[0], slug: cells[1], description: cells[2], plan: cells[3], ownerEmail: cells[4] }) }; }
    catch (e) { return { line: index + 2, error: e.message }; }
  });
}
export function safeCsvCell(value) {
  let s = String(value ?? ''); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function exportCsv(rows) {
  return '\uFEFF' + [['id','nome','slug','plano','status','projetos','usuarios','arquivos'], ...rows.map(r => [r.id,r.name,r.slug,r.plan,r.active ? 'Ativa' : 'Pausada',r.projectCount,r.userCount,r.fileCount])].map(r => r.map(safeCsvCell).join(',')).join('\r\n');
}
