import {evaluateHistoricalDeletionPrestate} from './deletion-historical-prestate.mjs';
import { DELETION_MIGRATION, readDeletionSchemaEvidence, assertDeletionSchema } from './organization-deletion-schema-0044.mjs';
import { IDENTITY_MIGRATION, collectIdentityEvidence, guardedIdentityMigration, identityApprovalEvidence } from './organization-identity-0043.mjs';
import {CC15_MIGRATION,readCC15Schema,assertCC15Schema} from './cc15-schema-preflight.mjs';
import {CC13_MIGRATION,readCC13Schema,assertCC13Schema} from './cc13-schema-preflight.mjs';
import {CC12_MIGRATION,readCC12Schema,assertCC12Schema} from './cc12-schema-preflight.mjs';
import {CC11_MIGRATION,readCC11Schema,assertCC11Schema} from './cc11-schema-preflight.mjs';
import {CC10_MIGRATION,readCC10Schema,assertCC10Schema} from './cc10-schema-preflight.mjs';
import {CC09_MIGRATION,readCC09Schema,assertCC09Schema} from './cc09-schema-preflight.mjs';
import {CC08_MIGRATION,readCC08Schema,assertCC08Schema} from './cc08-schema-preflight.mjs';
import { resolve } from 'node:path';
import {
  PRODUCTION_DATABASE_ID,
  PRODUCTION_DATABASE_NAME,
  REPORT_VERSION,
  WRANGLER_VERSION,
  buildApproval,
  assertOperationalMigration,
  assertDeletionLedgerPrestate,
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
  assertOperationalMigration(args.migration);
  const { accountId } = requireCloudflareEnvironment();
  const migration = await ensureMigrationFile(args.migration);
  const git = await readGitSnapshot();
  if (!git.clean) {
    throw gateError('GIT_TREE_NOT_CLEAN', 'O audit de produção exige worktree limpo para vincular a autorização a um Git SHA imutável.');
  }

  temporary = await makeTemporaryWranglerConfig(accountId);
  const remote = await readRemoteState(temporary.configPath, migration.name);
  if(migration.name===DELETION_MIGRATION) assertDeletionLedgerPrestate(remote.ledger);
  if (!remote.pending.selectedPending) {
    throw gateError('MIGRATION_NOT_PENDING', `A migration ${migration.name} já não está pendente no D1 de produção.`);
  }

  const backup = await captureTimeTravelBookmark(temporary.configPath);
  const integrity = await queryIntegrity(temporary.configPath);
  if (!integrity.quickCheckOk || !integrity.foreignKeyCheckOk) {
    throw gateError('DATABASE_INTEGRITY_FAILED', 'O preflight encontrou falha de integridade; autorização de produção foi bloqueada.');
  }

  const deletionEvidence=migration.name===DELETION_MIGRATION ? await readDeletionSchemaEvidence(temporary.configPath) : null;
  const schemaPreflight=deletionEvidence ? deletionEvidence.report : migration.name===CC15_MIGRATION ? await readCC15Schema(temporary.configPath,remote.ledger) : migration.name===CC13_MIGRATION ? await readCC13Schema(temporary.configPath,remote.ledger) : migration.name===CC12_MIGRATION ? await readCC12Schema(temporary.configPath,remote.ledger) : migration.name===CC11_MIGRATION ? await readCC11Schema(temporary.configPath,remote.ledger) : migration.name===CC08_MIGRATION ? await readCC08Schema(temporary.configPath,remote.ledger) : migration.name===CC09_MIGRATION ? await readCC09Schema(temporary.configPath,remote.ledger) : migration.name===CC10_MIGRATION ? await readCC10Schema(temporary.configPath,remote.ledger) : null;
  if(schemaPreflight && !schemaPreflight.compatible){
    await ensureReportDir();
    const blockedPath=args.report ? resolve(args.report) : defaultAuditReportPath(migration.name,git.sha);
    const deletionSafetyCertification=deletionEvidence ? evaluateHistoricalDeletionPrestate(deletionEvidence.snapshot,{
      integrity,ledger:remote.ledger,snapshotDigests:deletionEvidence.snapshotDigests,gitSha:git.sha,pendingDigest:remote.pending.pendingDigest,
    }) : null;
    await writeJsonReport(blockedPath,{phase:'schema-preflight-blocked',writesPerformed:false,readyForAuthorization:false,git,database:remote.identity,schemaPreflight,integrity,backup,
      ...(deletionSafetyCertification ? {deletionSafetyCertification} : {}),
    });
    if(migration.name===DELETION_MIGRATION) assertDeletionSchema(schemaPreflight); else if(migration.name===CC15_MIGRATION) assertCC15Schema(schemaPreflight); else if(migration.name===CC13_MIGRATION) assertCC13Schema(schemaPreflight); else if(migration.name===CC12_MIGRATION) assertCC12Schema(schemaPreflight); else if(migration.name===CC11_MIGRATION) assertCC11Schema(schemaPreflight); else if(migration.name===CC10_MIGRATION) assertCC10Schema(schemaPreflight); else if(migration.name===CC09_MIGRATION) assertCC09Schema(schemaPreflight); else assertCC08Schema(schemaPreflight);
  }
  const identityEvidence = migration.name === IDENTITY_MIGRATION
    ? await collectIdentityEvidence(temporary.configPath, remote, migration, 'pre') : null;
  const identityExecution = identityEvidence ? guardedIdentityMigration(identityEvidence) : null;
  const evidenceDigest = identityEvidence ? identityApprovalEvidence(identityEvidence, identityExecution) : migration.name===DELETION_MIGRATION ? schemaPreflight.digest : undefined;
  const approval = buildApproval({
    migration: migration.name,
    migrationSha256: migration.sha256,
    gitSha: git.sha,
    pendingDigest: remote.pending.pendingDigest,
    databaseId: remote.identity.id,
    evidenceDigest,
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
    schemaPreflight,
    ...(migration.name===DELETION_MIGRATION ? {evidenceDigest} : {}),
    ...(identityEvidence ? {
      identityEvidence:identityEvidence.report,
      execution:{ sha256:identityExecution.sha256, sourceSha256:identityExecution.sourceSha256,
        requestSha256:identityExecution.requestSha256,
        assertionCount:identityExecution.assertionCount, bytes:identityExecution.bytes,
        atomic:true, kind:'0043-equality-guards-and-exact-source-v1' },
      evidenceDigest,
    } : {}),
    approval: {
      required: true,
      hash: approval.approvalHash,
      token: approval.token,
      humanText: `Autorizo executar em produção a migration ${migration.name}, approval ${approval.approvalHash}, no D1 ${PRODUCTION_DATABASE_NAME}.`,
    },
    readyForAuthorization: true,
  };
  if (identityExecution) report.approval.humanText += ` Arquivo isolado com guards SHA-256 ${identityExecution.sha256}; evidência ${evidenceDigest}.`;
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
  // Only sanitized failure evidence, never an approval or raw remote response.
  // Keep earlier migration report contracts unchanged.
  if (args.migration === DELETION_MIGRATION && args.report) {
    try {
      await writeJsonReport(resolve(args.report) + '.failure.json', {
        phase: 'audit-failed', writesPerformed: false, readyForAuthorization: false,
        error: safe,
      });
    } catch {
      process.stderr.write('Sanitized audit failure artifact could not be saved.\n');
    }
  }
  process.stderr.write(`${JSON.stringify({ ok: false, writesPerformed: false, error: safe }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await temporary?.cleanup().catch(() => {});
}
