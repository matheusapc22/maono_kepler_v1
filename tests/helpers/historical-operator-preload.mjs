import {installHistoricalGitHubFixture} from './historical-github-fixture.mjs';
// Offline CLI harness. Every child-process request is intercepted before the
// operator is imported. No Git, npx, network, credential or production binding.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const root=process.env.HISTORICAL_FIXTURE_ROOT;
if(!root)throw new Error('Synthetic fixture root required');
if(process.env.HISTORICAL_FIXTURE_GITHUB==='1')installHistoricalGitHubFixture(root);
const db=new DatabaseSync(join(root,'fixture.sqlite'));db.exec('PRAGMA foreign_keys=ON');
let snapshots=0;
let applied=false;
// Classification here is only a test seam. Production stages are call-site literals.
function readFault(child,args) {
  const sql=args.includes('--command')?args[args.indexOf('--command')+1]:'';
  const stage=args.includes('time-travel')?'D1_TIME_TRAVEL_INFO':args.includes('info')?'D1_INFO':
    sql.includes('inventory_json')?'ORGANIZATION_IDENTITY_SNAPSHOT':
    sql.startsWith('SELECT s.type,s.name,s.tbl_name,s.sql FROM sqlite_schema')?'DELETION_OBJECTS':
    sql.includes('JOIN pragma_index_xinfo(i.name)')?'DELETION_INDEX_COLUMNS':
    sql.includes('LEFT JOIN pragma_index_list(s.name)')?'DELETION_INDEXES':
    sql.includes('JOIN pragma_table_xinfo(s.name)')?'DELETION_COLUMNS':
    sql.includes('JOIN pragma_foreign_key_list(s.name)')?'DELETION_FOREIGN_KEYS':
    sql==='SELECT id, name, applied_at FROM d1_migrations ORDER BY id;'?'D1_LEDGER':
    sql==='PRAGMA quick_check;'?'D1_QUICK_CHECK':sql==='PRAGMA foreign_key_check;'?'D1_FOREIGN_KEY_CHECK':null;
  const [kind,target]=String(process.env.HISTORICAL_FIXTURE_FAULT||'').split(':');
  if(!stage||stage!==target||!['read-failure','spawn-failure','empty-json','invalid-json','post-read-failure'].includes(kind))return false;
  if(kind==='post-read-failure'&&!applied)return false;
  const privateText='PRIVATE_TOKEN Bearer PRIVATE_SECRET SELECT PRIVATE_SQL /PRIVATE_PATH private-slug https://private.example';
  if(kind==='spawn-failure') {
    child.emit('error',Object.assign(new Error(privateText),{code:'ENOENT'}));
    child.stdout.end();child.stderr.end();child.emit('close',-2);
  } else if(kind==='empty-json'||kind==='invalid-json') {
    child.stdout.end(kind==='empty-json'?'':privateText);child.stderr.end();child.emit('close',0);
  } else {
    child.stdout.end(privateText+' SQLITE_AUTH');child.stderr.end(privateText+' ETIMEDOUT');child.emit('close',17);
  }
  return true;
}
childProcess.spawn=(command,args)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  queueMicrotask(()=>{
    try {
      let result;
      if(command==='git') {
        if(args[0]==='rev-parse')result=(process.env.HISTORICAL_FIXTURE_FAULT==='git-drift'?'b':'a').repeat(40);
        else if(args[0]==='status')result=process.env.HISTORICAL_FIXTURE_FAULT==='dirty-git'?' M synthetic-file':'';else throw new Error('Unexpected git request');
      } else if(command==='npx') {
        appendFileSync(join(root,'reads.log'),'npx-call\n');if(readFault(child,args))return;
        if(args.includes('info')&&!args.includes('time-travel'))result=JSON.stringify({name:'maono_maps',uuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'});
        else if(args.includes('time-travel'))result=JSON.stringify({bookmark:'synthetic-bookmark-123456789'});
        else if(args.includes('--command')) {
          const sql=args[args.indexOf('--command')+1];
          if(sql==='SELECT rowid,type,name,tbl_name,sql FROM sqlite_schema ORDER BY rowid;') {
            snapshots++;
            if(process.env.HISTORICAL_FIXTURE_FAULT==='final-drift'&&snapshots===3)db.exec("CREATE INDEX unexpected_final_index ON tickets(priority)");
          }
          result=JSON.stringify([{success:true,results:db.prepare(sql).all()}]);
        } else if(args.includes('apply')) {
          appendFileSync(join(root,'writes.log'),'apply-attempt\n');
          const configPath=args[args.indexOf('--config')+1];
          const config=JSON.parse(readFileSync(configPath,'utf8'));
          const dir=join(dirname(configPath),config.d1_databases[0].migrations_dir);
          const files=readdirSync(dir);
          if(files.length!==1||files[0]!=='0044_organization_permanent_deletion_historical.sql')throw new Error('Isolation violated');
          const sql=readFileSync(join(dir,files[0]),'utf8');
          if(!sql.startsWith('SELECT CASE WHEN'))throw new Error('Guard missing');
          if(process.env.HISTORICAL_FIXTURE_FAULT==='transaction-drift')db.exec("CREATE INDEX unexpected_transaction_index ON tickets(priority)");
          db.exec('BEGIN IMMEDIATE');
          try {db.exec(sql);if(process.env.HISTORICAL_FIXTURE_FAULT==='late-ledger')throw new Error('Synthetic late ledger failure');db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').run(files[0],'2026-11-06 22:00:00');db.exec('COMMIT');}
          catch(error){db.exec('ROLLBACK');throw error;}
          applied=true;
          if(process.env.HISTORICAL_FIXTURE_FAULT==='post-schema')db.exec('DROP TRIGGER '+db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'org_delete_%' LIMIT 1").get().name);
          if(process.env.HISTORICAL_FIXTURE_FAULT==='uncertain-response')throw new Error('Synthetic lost response');
          result='Synthetic apply complete';
        } else throw new Error('Unexpected npx request');
      } else throw new Error('Forbidden process');
      child.stdout.end(result);child.stderr.end();child.emit('close',0);
    } catch(error){child.stdout.end();child.stderr.end(error.message);child.emit('close',1);}
  });
  return child;
};
syncBuiltinESMExports();
