import { resolve } from 'node:path';
import { collectDeletionDiagnostic, validateDiagnosticContext } from './organization-deletion-diagnostic.mjs';
import { ensureMigrationFile, readGitSnapshot, requireCloudflareEnvironment, makeTemporaryWranglerConfig,
  parseNamedArgs, readRemoteState, writeJsonReport } from './production-migration-lib.mjs';
let temporary;
try {
  const args=parseNamedArgs(process.argv.slice(2),new Set(['migration','report']));
  const git=await readGitSnapshot();
  validateDiagnosticContext(process.env,git,args.migration);
  const migration=await ensureMigrationFile(args.migration);
  const {accountId}=requireCloudflareEnvironment();
  temporary=await makeTemporaryWranglerConfig(accountId);
  const remote=await readRemoteState(temporary.configPath,migration.name);
  const result=await collectDeletionDiagnostic(temporary.configPath,remote,migration);
  await writeJsonReport(resolve(args.report||'.tmp/production-migrations/organization-deletion-diagnostic.json'),
    {...result,generatedAt:new Date().toISOString(),gitSha:git.sha,database:remote.identity});
  process.stdout.write('Organization 10 diagnostic collected; writes: NO; Dropbox: NOT VERIFIED\n');
} catch {
  process.stderr.write('DELETION_DIAGNOSTIC_BLOCKED: no production writes; inspect reviewed collector requirements.\n');
  process.exitCode=1;
} finally { await temporary?.cleanup().catch(()=>{}); }
