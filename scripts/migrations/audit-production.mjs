import { resolve } from 'node:path';
import {
  PRODUCTION_DATABASE_ID,
  PRODUCTION_DATABASE_NAME,
  REPORT_VERSION,
  WRANGLER_VERSION,
  buildApproval,
  captureTimeTravelBookmark,
  defaultAuditReportPath,
  ensureMigrationFile,
  ensureReportDir,
  makeTemporaryWranglerConfig,
  parseNamedArgs,
  queryIntegrity,
  readGitSnapshot,
  readRemoteState,
  requireCloudflareEnvironment,
  safeError,
  writeJsonReport,
  gateError,
} from './production-migration-lib.mjs';

const args = parseNamedArgs(process.argv.slice(2), new Set(['migration', 'report']));
if (!args.migration) throw gateError('MIGRATION_REQUIRED', '--migration é obrigatório.');

let temporary;
try {
  const { accountId } = requireCloudflareEnvironment();
  const migration = await ensureMigrationFile(args.migration);
  const git = await readGitSnapshot();
  if (!git.clean) {
    throw gateError('GIT_TREE_NOT_CLEAN', 'O audit de produção exige worktree limpo para vincular a autorização a um Git SHA imutável.');
  }

  temporary = await makeTemporaryWranglerConfig(accountId);
  const remote = await readRemoteState(temporary.configPath, migration.name);
  if (!remote.pending.selectedPending) {
    throw gateError('MIGRATION_NOT_PENDING', `A migration ${migration.name} já não está pendente no D1 de produção.`);
  }

  const backup = await captureTimeTravelBookmark(temporary.configPath);
  const integrity = await queryIntegrity(temporary.configPath);
  if (!integrity.quickCheckOk || !integrity.foreignKeyCheckOk) {
    throw gateError('DATABASE_INTEGRITY_FAILED', 'O preflight encontrou falha de integridade; autorização de produção foi bloqueada.');
  }

  const approval = buildApproval({
    migration: migration.name,
    migrationSha256: migration.sha256,
    gitSha: git.sha,
    pendingDigest: remote.pending.pendingDigest,
    databaseId: remote.identity.id,
  });

  await ensureReportDir();
  const reportPath = args.report ? resolve(args.report) : defaultAuditReportPath(migration.name, git.sha);
  const report = {
    reportVersion: REPORT_VERSION,
    phase: 'audit',
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    wranglerVersion: WRANGLER_VERSION,
    database: {
      requestedName: PRODUCTION_DATABASE_NAME,
      requestedId: PRODUCTION_DATABASE_ID,
      name: remote.identity.name,
      id: remote.identity.id,
      verified: true,
    },
    git,
    migration: {
      name: migration.name,
      path: `migrations/${migration.name}`,
      sha256: migration.sha256,
      ...migration.analysis,
    },
    pending: {
      names: remote.pending.pending,
      earlier: remote.pending.earlierPending,
      later: remote.pending.laterPending,
      selectedPending: remote.pending.selectedPending,
      digest: remote.pending.pendingDigest,
      isolatedApplyRequired: true,
    },
    ledger: {
      appliedCount: remote.ledger.length,
      selectedAlreadyApplied: remote.ledger.some((row) => row.name === migration.name),
    },
    integrity,
    backup,
    approval: {
      required: true,
      hash: approval.approvalHash,
      token: approval.token,
      humanText: `Autorizo executar em produção a migration ${migration.name}, approval ${approval.approvalHash}, no D1 ${PRODUCTION_DATABASE_NAME}.`,
    },
    readyForAuthorization: true,
  };
  report.applyCommand = `npm run migration:apply:production -- --migration ${migration.name} --audit-report ${reportPath} --approval '${approval.token}'`;

  await writeJsonReport(reportPath, report);

  const warning = remote.pending.earlierPending.length
    ? `\nATENÇÃO: há migrations locais anteriores ainda pendentes: ${remote.pending.earlierPending.join(', ')}. Elas NÃO serão aplicadas pelo executor isolado.`
    : '';
  process.stdout.write([
    '============================================================',
    'MIGRATION READY FOR EXPLICIT PRODUCTION AUTHORIZATION',
    '============================================================',
    `Database: ${remote.identity.name} (${remote.identity.id})`,
    `Migration: ${migration.name}`,
    `Migration SHA256: ${migration.sha256}`,
    `Git SHA: ${git.sha}`,
    `Risk: ${migration.analysis.risk}`,
    `Operations: ${migration.analysis.operations.join(', ') || 'UNCLASSIFIED'}`,
    `Pending digest: ${remote.pending.pendingDigest}`,
    `Time Travel bookmark captured: ${backup.bookmark}`,
    `Integrity: quick_check=${integrity.quickCheck}; foreign_key_violations=${integrity.foreignKeyViolations.length}`,
    `Audit report: ${reportPath}`,
    warning,
    '',
    'AUTHORIZATION TEXT:',
    report.approval.humanText,
    '',
    'STATUS: AWAITING EXPLICIT PRODUCTION AUTHORIZATION',
    'No production migration was applied.',
    '============================================================',
    '',
  ].join('\n'));
} catch (error) {
  const safe = safeError(error);
  process.stderr.write(`${JSON.stringify({ ok: false, writesPerformed: false, error: safe }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await temporary?.cleanup().catch(() => {});
}
