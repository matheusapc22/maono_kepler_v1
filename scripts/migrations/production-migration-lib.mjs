import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const WRANGLER_VERSION = '4.140.0';
export const PRODUCTION_DATABASE_NAME = 'maono_maps';
export const PRODUCTION_DATABASE_ID = '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
export const APPROVAL_PREFIX = 'MAONO_PROD_MIGRATION_APPROVED';
export const REPORT_VERSION = 1;
export const DEFAULT_MIGRATIONS_DIR = resolve('migrations');
export const DEFAULT_REPORT_DIR = resolve('.tmp', 'production-migrations');

const MIGRATION_NAME = /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/i;
const HEX_40 = /^[0-9a-f]{40}$/i;
const HEX_64 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MigrationGateError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'MigrationGateError';
    this.code = code;
    this.details = details;
  }
}

export function gateError(code, message, details = null) {
  return new MigrationGateError(code, message, details);
}

export function normalizeMigrationName(value) {
  const name = String(value || '').trim();
  if (!name || name !== basename(name) || !MIGRATION_NAME.test(name)) {
    throw gateError(
      'MIGRATION_NAME_INVALID',
      'Informe somente o nome do arquivo de migration no formato 0000_nome.sql, sem diretórios.',
    );
  }
  return name;
}

export function requireCloudflareEnvironment(env = process.env) {
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!token) {
    throw gateError('CLOUDFLARE_TOKEN_MISSING', 'CLOUDFLARE_API_TOKEN não está disponível no ambiente do executor.');
  }
  if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    throw gateError('CLOUDFLARE_ACCOUNT_INVALID', 'CLOUDFLARE_ACCOUNT_ID está ausente ou não tem o formato esperado.');
  }
  return { token, accountId };
}

export async function sha256File(path) {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function stripSqlForInspection(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .replace(/\s+/g, ' ')
    .trim();
}

export function analyzeMigrationSql(sql) {
  const clean = stripSqlForInspection(sql);
  const operations = [];
  const push = (label, regex, source = clean) => {
    if (regex.test(source)) operations.push(label);
  };

  push('CREATE_TABLE', /\bCREATE\s+TABLE\b/i);
  push('CREATE_INDEX', /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
  push('CREATE_TRIGGER', /\bCREATE\s+TRIGGER\b/i);

  const alterStatements = clean.match(/\bALTER\s+TABLE\b[^;]*/gi) || [];
  if (alterStatements.some((statement) => /\bADD\s+(?:COLUMN\s+)?/i.test(statement))) operations.push('ALTER_TABLE_ADD');
  if (alterStatements.some((statement) => !/\bADD\s+(?:COLUMN\s+)?/i.test(statement))) operations.push('ALTER_TABLE_OTHER');

  // Trigger bodies can legitimately contain UPDATE/INSERT/DELETE that are not
  // executed while the migration is installed. Remove them before identifying
  // direct data rewrites performed by the migration itself.
  const withoutTriggerBodies = clean.replace(/\bCREATE\s+TRIGGER\b[\s\S]*?\bEND\s*;/gi, ' ');
  push('INSERT', /\bINSERT\s+INTO\b/i, withoutTriggerBodies);
  push('UPDATE', /\bUPDATE\s+[a-z0-9_"`\[]/i, withoutTriggerBodies);
  push('DELETE', /\bDELETE\s+FROM\b/i, withoutTriggerBodies);
  push('REPLACE', /\bREPLACE\s+INTO\b/i, withoutTriggerBodies);
  push('DROP', /\bDROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)\b/i, withoutTriggerBodies);
  push('PRAGMA', /\bPRAGMA\b/i, withoutTriggerBodies);
  push('TRANSACTION_CONTROL', /\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i, withoutTriggerBodies);

  const destructive = operations.some((operation) =>
    ['DELETE', 'REPLACE', 'DROP', 'ALTER_TABLE_OTHER'].includes(operation),
  );
  const writesExistingRows = operations.some((operation) =>
    ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(operation),
  );
  const complex = operations.some((operation) =>
    ['CREATE_TRIGGER', 'PRAGMA', 'TRANSACTION_CONTROL'].includes(operation),
  );

  let risk = 'LOW';
  if (destructive || writesExistingRows) risk = 'HIGH';
  else if (complex || operations.includes('ALTER_TABLE_ADD')) risk = 'MEDIUM';

  return {
    operations: [...new Set(operations)],
    destructive,
    writesExistingRows,
    risk,
  };
}

export function rowsFromD1Json(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.every((entry) => entry && Array.isArray(entry.results))) {
      return value.flatMap((entry) => entry.results);
    }
    if (value.every((entry) => entry && Array.isArray(entry.result?.results))) {
      return value.flatMap((entry) => entry.result.results);
    }
  }
  if (value && Array.isArray(value.results)) return value.results;
  if (value && Array.isArray(value.result?.results)) return value.result.results;
  throw gateError('D1_JSON_SHAPE_UNEXPECTED', 'O Wrangler devolveu JSON em formato inesperado para a consulta D1.');
}

export function extractD1Identity(info) {
  const candidate = Array.isArray(info) ? info[0] : info;
  const name = candidate?.name || candidate?.database_name || null;
  const id = candidate?.uuid || candidate?.database_id || candidate?.id || null;
  if (typeof name !== 'string' || !UUID.test(String(id || ''))) {
    throw gateError('D1_IDENTITY_UNREADABLE', 'Não foi possível confirmar nome e UUID do D1 retornado pelo Wrangler.');
  }
  return { name, id: String(id) };
}

export function extractBookmark(info) {
  const candidate = Array.isArray(info) ? info[0] : info;
  const bookmark = candidate?.bookmark || candidate?.result?.bookmark || null;
  if (typeof bookmark !== 'string' || !/^[a-zA-Z0-9._:-]{10,200}$/.test(bookmark)) {
    throw gateError('D1_BOOKMARK_UNAVAILABLE', 'O D1 Time Travel não retornou um bookmark válido; a operação foi bloqueada.');
  }
  return bookmark;
}

export async function listLocalMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const names = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && MIGRATION_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
  return names;
}

export function computePendingState(localMigrations, appliedNames, selectedMigration) {
  const selected = normalizeMigrationName(selectedMigration);
  const applied = new Set(appliedNames.map((name) => String(name)));
  if (!localMigrations.includes(selected)) {
    throw gateError('MIGRATION_NOT_IN_LOCAL_SET', `A migration ${selected} não existe no diretório local de migrations.`);
  }
  const pending = localMigrations.filter((name) => !applied.has(name));
  const selectedIndex = localMigrations.indexOf(selected);
  const earlierPending = pending.filter((name) => localMigrations.indexOf(name) < selectedIndex);
  const laterPending = pending.filter((name) => localMigrations.indexOf(name) > selectedIndex);
  return {
    pending,
    earlierPending,
    laterPending,
    selectedPending: pending.includes(selected),
    pendingDigest: sha256Text(pending.join('\n')),
  };
}

export function approvalMaterial({ migration, migrationSha256, gitSha, pendingDigest, databaseId }) {
  const normalizedMigration = normalizeMigrationName(migration);
  if (!HEX_64.test(migrationSha256 || '')) throw gateError('MIGRATION_HASH_INVALID', 'SHA-256 da migration inválido.');
  if (!HEX_40.test(gitSha || '')) throw gateError('GIT_SHA_INVALID', 'Git SHA inválido.');
  if (!HEX_64.test(pendingDigest || '')) throw gateError('PENDING_DIGEST_INVALID', 'Digest da fila de migrations inválido.');
  if (!UUID.test(databaseId || '')) throw gateError('DATABASE_ID_INVALID', 'UUID do banco inválido.');
  return [
    `reportVersion=${REPORT_VERSION}`,
    `database=${PRODUCTION_DATABASE_NAME}`,
    `databaseId=${databaseId}`,
    `migration=${normalizedMigration}`,
    `migrationSha256=${migrationSha256}`,
    `gitSha=${gitSha}`,
    `pendingDigest=${pendingDigest}`,
  ].join('\n');
}

export function buildApproval({ migration, migrationSha256, gitSha, pendingDigest, databaseId = PRODUCTION_DATABASE_ID }) {
  const approvalHash = sha256Text(approvalMaterial({ migration, migrationSha256, gitSha, pendingDigest, databaseId }));
  const token = `${APPROVAL_PREFIX}:${normalizeMigrationName(migration)}:${approvalHash}`;
  return { approvalHash, token };
}

export function assertApprovalToken(token, expectedToken) {
  if (typeof token !== 'string' || token !== expectedToken) {
    throw gateError(
      'PRODUCTION_AUTHORIZATION_MISMATCH',
      'A autorização não corresponde exatamente à migration, hash, Git SHA, fila pendente e banco auditados.',
    );
  }
}

export function assertProductionIdentity(identity) {
  if (identity.name !== PRODUCTION_DATABASE_NAME || identity.id !== PRODUCTION_DATABASE_ID) {
    throw gateError(
      'PRODUCTION_DATABASE_IDENTITY_MISMATCH',
      `Destino recusado: esperado ${PRODUCTION_DATABASE_NAME} (${PRODUCTION_DATABASE_ID}).`,
      { received: identity },
    );
  }
  return true;
}

export function assertAuditMatchesCurrent(audit, current) {
  if (!audit || audit.reportVersion !== REPORT_VERSION || audit.phase !== 'audit' || audit.writesPerformed !== false) {
    throw gateError('AUDIT_REPORT_INVALID', 'O relatório informado não é um preflight de migration válido.');
  }
  const comparisons = [
    ['database.name', audit.database?.name, current.databaseName],
    ['database.id', audit.database?.id, current.databaseId],
    ['migration.name', audit.migration?.name, current.migration],
    ['migration.sha256', audit.migration?.sha256, current.migrationSha256],
    ['git.sha', audit.git?.sha, current.gitSha],
    ['pending.digest', audit.pending?.digest, current.pendingDigest],
    ['approval.hash', audit.approval?.hash, current.approvalHash],
  ];
  const mismatch = comparisons.find(([, expected, actual]) => expected !== actual);
  if (mismatch) {
    throw gateError('AUDIT_DRIFT_DETECTED', `O estado atual divergiu do audit em ${mismatch[0]}. Nova auditoria é obrigatória.`);
  }
  if (audit.git?.clean !== true || current.gitClean !== true) {
    throw gateError('GIT_TREE_NOT_CLEAN', 'A aplicação exige worktree limpo e idêntico ao SHA auditado.');
  }
  if (audit.pending?.selectedPending !== true || current.selectedPending !== true) {
    throw gateError('MIGRATION_NOT_PENDING', 'A migration selecionada já não está pendente.');
  }
  return true;
}

export function createWranglerConfig(accountId, { migrationsDir = null } = {}) {
  const binding = {
    binding: 'DB',
    database_name: PRODUCTION_DATABASE_NAME,
    database_id: PRODUCTION_DATABASE_ID,
  };
  if (migrationsDir) binding.migrations_dir = migrationsDir;
  return {
    name: 'maono-production-migration-operator',
    compatibility_date: '2026-09-26',
    account_id: accountId,
    d1_databases: [binding],
  };
}

export async function ensureMigrationFile(name, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const migration = normalizeMigrationName(name);
  const path = join(migrationsDir, migration);
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) {
    throw gateError('MIGRATION_FILE_MISSING', `Arquivo migrations/${migration} não encontrado.`);
  }
  const sql = await readFile(path, 'utf8');
  return { name: migration, path, sql, sha256: await sha256File(path), analysis: analyzeMigrationSql(sql) };
}

export async function runProcess(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) return resolvePromise({ code, stdout, stderr });
      return rejectPromise(gateError(
        options.errorCode || 'COMMAND_FAILED',
        options.safeMessage || `${command} encerrou com código ${code}.`,
        { command, args, exitCode: code, stderr: stderr.slice(-2000) },
      ));
    });
  });
}

export async function runGit(args, injected = {}) {
  const runner = injected.runProcess || runProcess;
  return await runner('git', args, {
    errorCode: 'GIT_COMMAND_FAILED',
    safeMessage: 'Não foi possível confirmar o estado Git local.',
  });
}

export async function readGitSnapshot(injected = {}) {
  const shaResult = await runGit(['rev-parse', 'HEAD'], injected);
  const statusResult = await runGit(['status', '--porcelain=v1', '--untracked-files=normal'], injected);
  const sha = shaResult.stdout.trim();
  if (!HEX_40.test(sha)) throw gateError('GIT_SHA_INVALID', 'O executor não conseguiu obter um SHA Git de 40 caracteres.');
  const lines = statusResult.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  return { sha, clean: lines.length === 0, dirtyEntries: lines.slice(0, 100) };
}

export async function runWranglerJson(args, configPath, injected = {}) {
  const runner = injected.runProcess || runProcess;
  const result = await runner(
    'npx',
    ['--yes', `wrangler@${WRANGLER_VERSION}`, ...args, '--config', configPath, '--json'],
    {
      env: { WRANGLER_SEND_METRICS: 'false' },
      errorCode: 'WRANGLER_COMMAND_FAILED',
      safeMessage: 'O Wrangler falhou durante uma etapa remota. Nenhuma identidade ou sucesso foi presumido.',
    },
  );
  const raw = result.stdout.trim();
  if (!raw) throw gateError('WRANGLER_EMPTY_JSON', 'O Wrangler não devolveu JSON; a operação foi bloqueada.');
  try {
    return JSON.parse(raw);
  } catch {
    throw gateError('WRANGLER_INVALID_JSON', 'O Wrangler devolveu uma resposta que não pôde ser validada como JSON.');
  }
}

export async function runWranglerApply(configPath, injected = {}) {
  const runner = injected.runProcess || runProcess;
  return await runner(
    'npx',
    ['--yes', `wrangler@${WRANGLER_VERSION}`, 'd1', 'migrations', 'apply', PRODUCTION_DATABASE_NAME, '--remote', '--config', configPath],
    {
      env: { WRANGLER_SEND_METRICS: 'false', CI: 'true' },
      errorCode: 'WRANGLER_APPLY_FAILED',
      safeMessage: 'A aplicação da migration falhou. Verifique o relatório pós-falha e o D1 antes de qualquer repetição.',
    },
  );
}

export async function makeTemporaryWranglerConfig(accountId, { isolatedMigration = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'maono-production-migration-'));
  const configPath = join(root, 'wrangler.json');
  let config;
  if (isolatedMigration) {
    const migration = normalizeMigrationName(isolatedMigration.name);
    const migrationDir = join(root, 'migrations');
    await mkdir(migrationDir, { recursive: true });
    await copyFile(isolatedMigration.path, join(migrationDir, migration));
    config = createWranglerConfig(accountId, { migrationsDir: 'migrations' });
  } else {
    config = createWranglerConfig(accountId);
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return {
    root,
    configPath,
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

export async function queryLedger(configPath, injected = {}) {
  const json = await runWranglerJson([
    'd1', 'execute', PRODUCTION_DATABASE_NAME, '--remote',
    '--command', 'SELECT id, name, applied_at FROM d1_migrations ORDER BY id;'
  ], configPath, injected);
  return rowsFromD1Json(json).map((row) => ({
    id: row.id ?? null,
    name: String(row.name || ''),
    appliedAt: row.applied_at ?? null,
  })).filter((row) => row.name);
}

export async function queryIntegrity(configPath, injected = {}) {
  const quickJson = await runWranglerJson([
    'd1', 'execute', PRODUCTION_DATABASE_NAME, '--remote', '--command', 'PRAGMA quick_check;'
  ], configPath, injected);
  const foreignJson = await runWranglerJson([
    'd1', 'execute', PRODUCTION_DATABASE_NAME, '--remote', '--command', 'PRAGMA foreign_key_check;'
  ], configPath, injected);
  const quickRows = rowsFromD1Json(quickJson);
  const foreignRows = rowsFromD1Json(foreignJson);
  const quickValue = quickRows[0]?.quick_check ?? quickRows[0]?.['quick_check'] ?? null;
  return {
    quickCheck: quickValue,
    quickCheckOk: String(quickValue || '').toLowerCase() === 'ok',
    foreignKeyViolations: foreignRows,
    foreignKeyCheckOk: foreignRows.length === 0,
  };
}

export async function readRemoteState(configPath, selectedMigration, injected = {}) {
  const info = await runWranglerJson(['d1', 'info', PRODUCTION_DATABASE_NAME], configPath, injected);
  const identity = extractD1Identity(info);
  assertProductionIdentity(identity);
  const ledger = await queryLedger(configPath, injected);
  const localMigrations = await listLocalMigrations(injected.migrationsDir || DEFAULT_MIGRATIONS_DIR);
  const pending = computePendingState(localMigrations, ledger.map((row) => row.name), selectedMigration);
  return { identity, ledger, localMigrations, pending };
}

export async function captureTimeTravelBookmark(configPath, injected = {}) {
  const info = await runWranglerJson(['d1', 'time-travel', 'info', PRODUCTION_DATABASE_NAME], configPath, injected);
  return {
    bookmark: extractBookmark(info),
    capturedAt: new Date().toISOString(),
  };
}

export async function ensureReportDir(path = DEFAULT_REPORT_DIR) {
  await mkdir(path, { recursive: true });
  return path;
}

export function defaultAuditReportPath(migration, gitSha, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return join(DEFAULT_REPORT_DIR, `audit-${normalizeMigrationName(migration).replace(/\.sql$/i, '')}-${gitSha.slice(0, 12)}-${stamp}.json`);
}

export function defaultPostReportPath(migration, gitSha, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return join(DEFAULT_REPORT_DIR, `post-${normalizeMigrationName(migration).replace(/\.sql$/i, '')}-${gitSha.slice(0, 12)}-${stamp}.json`);
}

export async function writeJsonReport(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true }).catch(() => {});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return path;
}

export function safeError(error) {
  if (error instanceof MigrationGateError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'MIGRATION_GATE_UNEXPECTED', message: 'Falha inesperada no operador; revise o ambiente antes de repetir.' };
}

export function parseNamedArgs(argv, allowed) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw gateError('ARGUMENT_INVALID', 'Use somente opções nomeadas com --.');
    const key = token.slice(2);
    if (!allowed.has(key) || Object.hasOwn(result, key)) throw gateError('ARGUMENT_INVALID', `Opção desconhecida ou repetida: --${key}.`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw gateError('ARGUMENT_INVALID', `Valor ausente para --${key}.`);
    result[key] = value;
  }
  return result;
}
