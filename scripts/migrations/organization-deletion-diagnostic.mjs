import { collectIdentityPostValidation, IDENTITY_MIGRATION } from './organization-identity-0043.mjs';
import { PRODUCTION_DATABASE_NAME, assertProductionIdentity, gateError, MigrationGateError, safeError, runWranglerJson, sha256Text } from './production-migration-lib.mjs';

export const DIAGNOSTIC_MODE = 'organization-deletion-diagnostic';
export const TARGET_ID = 10;
const fail = () => { throw gateError('DELETION_DIAGNOSTIC_BLOCKED','Diagnostico incompleto; nenhuma escrita executada.'); };
const keys = (row, expected) => row && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...expected].sort());
const count = n => Number.isSafeInteger(n) && n >= 0;
const removable = new Set(['organization_access_delegations','organization_users','user_permission_denials','user_permissions']);
const retained = new Set(['organization_management_events','organization_deletions','organization_deleted_management_events']);
export const DIAGNOSTIC_QUERIES = Object.freeze({
  target: `SELECT id, active, management_version AS version,
    CASE WHEN slug='maono-qa-organizacoes-20261102' THEN 1 ELSE 0 END AS identityMatches,
    CASE WHEN storage_status IN ('READY','DISABLED') THEN 1 ELSE 0 END AS storageSettled,
    CASE WHEN julianday(updated_at)<=julianday('now','-2 minutes') THEN 1 ELSE 0 END AS drained,
    CASE WHEN dropbox_root_path='/projects/maono-qa-organizacoes-20261102' THEN 1 ELSE 0 END AS pathMatches,
    (SELECT COUNT(*) FROM organizations other WHERE other.id<>10 AND trim(COALESCE(other.dropbox_root_path,''))<>''
      AND (lower(rtrim(other.dropbox_root_path,'/'))=lower(o.dropbox_root_path)
      OR instr(lower(rtrim(other.dropbox_root_path,'/'))||'/',lower(o.dropbox_root_path)||'/')=1
      OR instr(lower(o.dropbox_root_path)||'/',lower(rtrim(other.dropbox_root_path,'/'))||'/')=1)) AS overlappingPaths,
    (SELECT COUNT(*) FROM user_permissions WHERE organization_id=10 AND project_id IS NOT NULL) AS mixedPermissions,
    (SELECT COUNT(*) FROM organization_management_operation_items WHERE state<>'succeeded') AS globalUnresolvedItems
    FROM organizations o WHERE id=10;`,
  dependencies: `SELECT m.name,
    (SELECT COUNT(*) FROM sqlite_master t WHERE t.type='trigger' AND
      t.name IN ('org_delete_guard_'||m.name||'_insert','org_delete_guard_'||m.name||'_update')) AS guards
    FROM sqlite_master m WHERE m.type='table' AND EXISTS
      (SELECT 1 FROM pragma_table_info(m.name) c WHERE c.name='organization_id') ORDER BY m.name;`,
  foreignKeys: `SELECT COUNT(*) AS n FROM sqlite_master m, pragma_foreign_key_list(m.name) f
    WHERE m.type='table' AND f."table"='organizations' AND f."from"<>'organization_id'
      AND NOT(m.name='sessions' AND f."from"='active_organization_id');`,
  quick: 'PRAGMA quick_check;',
  foreign: 'PRAGMA foreign_key_check;',
});
export function validateDiagnosticContext(env,git,migration) {
  if(env.MODE!==DIAGNOSTIC_MODE || env.MIGRATION!==IDENTITY_MIGRATION || migration!==IDENTITY_MIGRATION) fail();
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
    env.GITHUB_REPOSITORY!=='matheusapc22/maono_kepler_v1'||env.GITHUB_REF_NAME!=='main'||
    env.GITHUB_REPOSITORY_OWNER!=='matheusapc22'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
    env.APPROVAL_HASH!==''||env.CLOUDFLARE_ACCOUNT_ID!=='09d455fa1cf988b0d9db89987b73eaff'||
    env.PRODUCT_BRANCH!=='mano_kepler_v1'||env.PRODUCTION_D1_NAME!==PRODUCTION_DATABASE_NAME||
    env.PRODUCTION_D1_ID!=='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'||
    !/^[0-9a-f]{40}$/.test(env.VALIDATED_RELEASE_SHA||'')||git?.sha!==env.VALIDATED_RELEASE_SHA||git.clean!==true) fail();
}
export function dependencyQuery(name) {
  if(typeof name!=='string'|| !/^[a-zA-Z_][a-zA-Z_0-9]{0,127}$/.test(name)) fail();
  return `SELECT COUNT(*) AS n FROM "${name}" WHERE organization_id=10;`;
}
export async function collectDeletionDiagnostic(configPath, remote, migration, injected={}) {
  assertProductionIdentity(remote.identity);
  injected.onStage?.('identity-before');
  const evidence=await collectIdentityPostValidation(configPath,remote,migration,injected);
  const query=async sql => {
    const result=await runWranglerJson(['d1','execute',PRODUCTION_DATABASE_NAME,'--remote','--command',sql],configPath,injected,'ORGANIZATION_QA_INVENTORY');
    const parts=Array.isArray(result)?result:[result];
    if(parts.length!==1||parts[0]?.success!==true||!Array.isArray(parts[0]?.results)) fail();
    return parts[0].results;
  };
  const read=async()=>{
    const target=await query(DIAGNOSTIC_QUERIES.target);
    const fields=['id','active','version','identityMatches','storageSettled','drained','pathMatches','overlappingPaths','mixedPermissions','globalUnresolvedItems'];
    if(target.length!==1||!keys(target[0],fields)||target[0].id!==TARGET_ID||!fields.every(k=>count(target[0][k]))||
      !['active','identityMatches','storageSettled','drained','pathMatches'].every(k=>target[0][k]<=1)) fail();
    if(target[0].identityMatches!==1) fail();
    const dependencies=await query(DIAGNOSTIC_QUERIES.dependencies);
    if(dependencies.length>200) fail();
    const seen=new Set(), result=[];
    for(const row of dependencies){
      if(!keys(row,['name','guards'])||!count(row.guards)||row.guards>2||seen.has(row.name)) fail();
      const sql=dependencyQuery(row.name);seen.add(row.name);
      const rows=await query(sql);
      if(rows.length!==1||!keys(rows[0],['n'])||!count(rows[0].n)) fail();
      // No raw schema identifiers or business rows escape the runner.
      result.push({tableDigest:sha256Text(row.name),kind:retained.has(row.name)?'retained':removable.has(row.name)?'removable':'business',
        count:rows[0].n,guardCount:row.guards});
    }
    const foreign=await query(DIAGNOSTIC_QUERIES.foreignKeys);
    if(foreign.length!==1||!keys(foreign[0],['n'])||!count(foreign[0].n)) fail();
    return {target:target[0],dependencies:result,nonstandardForeignKeys:foreign[0].n};
  };
  injected.onStage?.('integrity');
  const quick=await query(DIAGNOSTIC_QUERIES.quick), foreign=await query(DIAGNOSTIC_QUERIES.foreign);
  if(quick.length!==1||!keys(quick[0],['quick_check'])||quick[0].quick_check!=='ok'||foreign.length) fail();
  injected.onStage?.('target-first');
  const first=await read();
  injected.onStage?.('target-second');
  const last=await read();
  injected.onStage?.('identity-after');
  const finalEvidence=await collectIdentityPostValidation(configPath,remote,migration,injected);
  if(JSON.stringify(first)!==JSON.stringify(last)||evidence.digest!==finalEvidence.digest) fail();
  return {version:1,phase:'organization-deletion-diagnostic-read-only',organizationId:TARGET_ID,
    writesPerformed:false,observed:last,snapshotDigest:sha256Text(JSON.stringify(last)),
    identityEvidenceDigest:evidence.digest,integrity:{quickCheck:'ok',foreignKeyViolationCount:0},
    aggregateReadsStable:true,atomicDatabaseSnapshot:false,
    storageProviderVerified:false,flagsObserved:false,exclusiveTestWindowProven:false,
    deletionEligibilityVerified:false,migrationAuthorized:false,activationAuthorized:false};
}

// Persist only enumerated labels, never exception messages, streams or raw rows.
const FAILURE_STAGES = new Set(['arguments','git-snapshot','context','migration-source','cloudflare-config',
  'temporary-config','remote-state','identity-before','integrity','target-first','target-second','identity-after','report-write']);
const FAILURE_CODES = new Set(['DELETION_DIAGNOSTIC_BLOCKED','ARGUMENT_INVALID','GIT_SHA_INVALID',
  'GIT_COMMAND_FAILED','GIT_TREE_NOT_CLEAN','MIGRATION_NAME_INVALID','MIGRATION_FILE_MISSING',
  'MIGRATION_NOT_IN_LOCAL_SET','CLOUDFLARE_TOKEN_MISSING','CLOUDFLARE_ACCOUNT_INVALID',
  'D1_JSON_SHAPE_UNEXPECTED','D1_IDENTITY_UNREADABLE','D1_BOOKMARK_UNAVAILABLE','PRODUCTION_DATABASE_IDENTITY_MISMATCH',
  'ORGANIZATION_SCHEMA_SOURCE_DRIFT',
  ...['TARGET_INVALID','RESPONSE_INVALID','SNAPSHOT_SIZE','SNAPSHOT_INVALID','INVENTORY_INVALID',
    'INVENTORY_INCOMPLETE','CONFLICTS','LEDGER_INVALID','LEDGER_REQUIRED','LEDGER_PHASE','LEDGER_DRIFT',
    'SCHEMA_INCOMPATIBLE','PHASE_INVALID'].map(code=>'IDENTITY_0043_'+code)]);
const WRANGLER_CODES = new Set(['WRANGLER_COMMAND_FAILED','WRANGLER_EMPTY_JSON','WRANGLER_INVALID_JSON']);
export function diagnosticFailure(error,stage) {
  const known = error instanceof MigrationGateError;
  const code = known && (FAILURE_CODES.has(error.code)||WRANGLER_CODES.has(error.code))
    ? error.code : 'DELETION_DIAGNOSTIC_UNEXPECTED';
  return {version:1,phase:'organization-deletion-diagnostic-read-only',status:'blocked',organizationId:TARGET_ID,
    stage:FAILURE_STAGES.has(stage)?stage:'unknown',code,writesPerformed:false,
    ...(known&&WRANGLER_CODES.has(code)?{transport:safeError(error).diagnostic}:{}),
    storageProviderVerified:false,flagsObserved:false,deletionEligibilityVerified:false,
    migrationAuthorized:false,activationAuthorized:false};
}
