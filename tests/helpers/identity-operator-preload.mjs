// Offline CLI harness. Every child-process request is intercepted before the
// operator is imported. No Git, npx, network, credential or production binding.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const root=process.env.IDENTITY_FIXTURE_ROOT;
if(!root)throw new Error('Synthetic fixture root required');
const db=new DatabaseSync(join(root,'fixture.sqlite'));
let snapshots=0;
childProcess.spawn=(command,args)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  queueMicrotask(()=>{
    try {
      let result;
      if(command==='git') {
        if(args[0]==='rev-parse')result='a'.repeat(40);
        else if(args[0]==='status')result='';else throw new Error('Unexpected git request');
      } else if(command==='npx') {
        if(args.includes('info')&&!args.includes('time-travel'))result=JSON.stringify({name:'maono_maps',uuid:'5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'});
        else if(args.includes('time-travel'))result=JSON.stringify({bookmark:'synthetic-bookmark-123456789'});
        else if(args.includes('--command')) {
          const sql=args[args.indexOf('--command')+1];
          if(sql.includes('inventory_json')) {
            snapshots++;
            if(process.env.IDENTITY_FIXTURE_FAULT==='final-drift'&&snapshots===2)db.exec("UPDATE organizations SET name='Changed before final read' WHERE id=1");
          }
          result=JSON.stringify([{success:true,results:db.prepare(sql).all()}]);
        } else if(args.includes('apply')) {
          appendFileSync(join(root,'writes.log'),'apply-attempt\n');
          const configPath=args[args.indexOf('--config')+1];
          const config=JSON.parse(readFileSync(configPath,'utf8'));
          const dir=join(dirname(configPath),config.d1_databases[0].migrations_dir);
          const files=readdirSync(dir);
          if(files.length!==1||files[0]!=='0043_organization_creation_identity.sql')throw new Error('Isolation violated');
          const sql=readFileSync(join(dir,files[0]),'utf8');
          if(!sql.startsWith('SELECT CASE WHEN'))throw new Error('Guard missing');
          if(process.env.IDENTITY_FIXTURE_FAULT==='transaction-drift')db.exec("UPDATE organizations SET name='Changed after last read' WHERE id=1");
          db.exec('BEGIN IMMEDIATE');
          try {db.exec(sql);db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').run(files[0],'2026-11-06 22:00:00');db.exec('COMMIT');}
          catch(error){db.exec('ROLLBACK');throw error;}
          if(process.env.IDENTITY_FIXTURE_FAULT==='post-schema')db.exec('DROP TRIGGER org_identity_update');
          if(process.env.IDENTITY_FIXTURE_FAULT==='uncertain-response')throw new Error('Synthetic lost response');
          result='Synthetic apply complete';
        } else throw new Error('Unexpected npx request');
      } else throw new Error('Forbidden process');
      child.stdout.end(result);child.stderr.end();child.emit('close',0);
    } catch(error){child.stdout.end();child.stderr.end(error.message);child.emit('close',1);}
  });
  return child;
};
syncBuiltinESMExports();
