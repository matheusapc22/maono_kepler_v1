import { resolve } from 'node:path';
import { buildOrganizationSchemaReferences } from './organization-schema-references.mjs';
import { ORGANIZATION_SCHEMA_QUERIES } from './organization-management-schema.mjs';
import { collectQaInventory, validateQaInventoryContext, qaInventoryFailure } from './organization-qa-inventory.mjs';
import { ensureMigrationFile, readGitSnapshot, requireCloudflareEnvironment, makeTemporaryWranglerConfig,
  parseNamedArgs, readRemoteState, writeJsonReport, WRANGLER_VERSION } from './production-migration-lib.mjs';

let temporary;
try {
  const args = parseNamedArgs(process.argv.slice(2),new Set(['migration','report']));
  const git = await readGitSnapshot();
  validateQaInventoryContext(process.env,git,args.migration);
  // Source provenance is validated locally before the first remote access.
  buildOrganizationSchemaReferences(ORGANIZATION_SCHEMA_QUERIES);
  const migration = await ensureMigrationFile(args.migration);
  const { accountId } = requireCloudflareEnvironment();
  temporary = await makeTemporaryWranglerConfig(accountId);
  const remote = await readRemoteState(temporary.configPath,migration.name);
  const result = await collectQaInventory(temporary.configPath,remote,migration);
  const report = { ...result, generatedAt:new Date().toISOString(), git:{ sha:git.sha, clean:true },
    database:remote.identity, migration:{ name:migration.name,sha256:migration.sha256 }, wranglerVersion:WRANGLER_VERSION };
  await writeJsonReport(resolve(args.report || '.tmp/production-migrations/organization-qa-inventory.json'),report);
  process.stdout.write(`Organization QA inventory: ${result.selection.status}; writes: NO; acceptance: NOT EXECUTED\n`);
} catch (error) {
  // Never forward CLI streams, SQL, raw database rows, arbitrary args or errors.
  process.stderr.write(JSON.stringify(qaInventoryFailure(error))+'\n');
  process.exitCode = 1;
} finally {
  await temporary?.cleanup().catch(() => {});
}
