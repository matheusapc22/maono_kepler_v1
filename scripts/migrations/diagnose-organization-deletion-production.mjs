import { resolve } from 'node:path';
import { collectDeletionDiagnostic, validateDiagnosticContext, diagnosticFailure } from './organization-deletion-diagnostic.mjs';
import { ensureMigrationFile, readGitSnapshot, requireCloudflareEnvironment, makeTemporaryWranglerConfig,
  parseNamedArgs, readRemoteState, writeJsonReport } from './production-migration-lib.mjs';
let temporary, stage='arguments';
try {
  const args=parseNamedArgs(process.argv.slice(2),new Set(['migration','report']));
  stage='git-snapshot';
  const git=await readGitSnapshot();
  stage='context';
  validateDiagnosticContext(process.env,git,args.migration);
  stage='migration-source';
  const migration=await ensureMigrationFile(args.migration);
  stage='cloudflare-config';
  const {accountId}=requireCloudflareEnvironment();
  stage='temporary-config';
  temporary=await makeTemporaryWranglerConfig(accountId);
  stage='remote-state';
  const remote=await readRemoteState(temporary.configPath,migration.name);
  const result=await collectDeletionDiagnostic(temporary.configPath,remote,migration,{onStage:value=>{stage=value;}});
  stage='report-write';
  await writeJsonReport(resolve(args.report||'.tmp/production-migrations/organization-deletion-diagnostic.json'),
    {...result,generatedAt:new Date().toISOString(),gitSha:git.sha,database:remote.identity});
  process.stdout.write('Organization 10 diagnostic collected; writes: NO; Dropbox: NOT VERIFIED\n');
} catch (error) {
  const failure=diagnosticFailure(error,stage);
  // Fixed artifact path even when arguments/report output are invalid. Do not overwrite evidence.
  try { await writeJsonReport(resolve('.tmp/production-migrations/organization-deletion-diagnostic-failure.json'),failure); }
  catch { failure.failureArtifactWritten=false; }
  process.stderr.write(JSON.stringify(failure)+'\n');
  process.exitCode=1;
} finally { await temporary?.cleanup().catch(()=>{}); }
