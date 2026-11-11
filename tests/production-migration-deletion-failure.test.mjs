import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {gateError,safeError} from '../scripts/migrations/production-migration-lib.mjs';
for(const stage of ['DELETION_OBJECTS','DELETION_COLUMNS','DELETION_FOREIGN_KEYS'])test('distinct sanitized metadata stage: '+stage,()=>{
  const error=safeError(gateError('WRANGLER_COMMAND_FAILED','private',{stage,exitCode:1,stdout:'PRIVATE SELECT TOKEN SQLITE_AUTH',stderr:''}));
  assert.equal(error.diagnostic.stage,stage);
  assert.deepEqual(error.diagnostic.categories,['SQLITE_AUTH']);
  assert.doesNotMatch(JSON.stringify(error),/PRIVATE|SELECT|TOKEN/);
});
for(const stage of ['D1_INFO','DELETION_OBJECTS','DELETION_COLUMNS','DELETION_FOREIGN_KEYS'])test('0044 sanitized failure artifact: '+stage,t=>{
  const root=mkdtempSync(join(tmpdir(),'deletion-error-artifact-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const db=new DatabaseSync(join(root,'fixture.sqlite'));
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8').split('-- Organization permanent deletion (migration 0044)')[0]);
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);');db.close();
  const report=join(root,'audit.json');
  const result=spawnSync(process.execPath,['--import',new URL('./helpers/identity-operator-preload.mjs',import.meta.url).href,
    fileURLToPath(new URL('../scripts/migrations/audit-production.mjs',import.meta.url)),
    '--migration','0044_organization_permanent_deletion.sql','--report',report],{
    encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,NODE_NO_WARNINGS:'1',
    IDENTITY_FIXTURE_ROOT:root,IDENTITY_FIXTURE_FAULT:'read-failure:'+stage,
    CLOUDFLARE_API_TOKEN:'synthetic-not-a-real-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}});
  assert.equal(result.status,1,result.stderr);assert.equal(existsSync(report),false);
  const raw=readFileSync(report+'.failure.json','utf8'),failure=JSON.parse(raw);
  assert.equal(failure.phase,'audit-failed');assert.equal(failure.writesPerformed,false);assert.equal(failure.readyForAuthorization,false);
  assert.equal(failure.error.diagnostic.stage,stage);
  assert.deepEqual(Object.keys(failure).sort(),['error','phase','readyForAuthorization','writesPerformed']);
  assert.doesNotMatch(raw,/PRIVATE|Bearer|SELECT|synthetic-not-a-real-token|approval/);
  assert.equal(existsSync(join(root,'writes.log')),false);
});
