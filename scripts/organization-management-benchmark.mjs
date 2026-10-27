import {performance} from 'node:perf_hooks';
import {persistenceFixture} from '../tests/helpers/project-persistence-fixture.mjs';
import {onRequest} from '../functions/api/admin/organization-management/[[path]].js';

// Isolated SQLite + actual Pages handler/session/ACL. No network or deployed DB.
// This reports returned rows, not D1 rows_read, which SQLite does not expose.
const results=[];
for(const count of [6,50,500]){
  const cleanup=[];let returnedRows=0;
  const f=persistenceFixture({after:fn=>cleanup.push(fn)},{afterSql({value}){
    if(value?.results)returnedRows+=value.results.length;
    else if(value&&typeof value==='object'&&!('meta' in value)&&!('success' in value))returnedRows++;
  }});
  try{
    f.env.ORGANIZATION_MANAGEMENT_V1='true';f.db.exec("UPDATE users SET role='super_admin' WHERE id=1");
    const insert=f.db.prepare('INSERT INTO organizations(id,name,slug,dropbox_root_path,storage_status) VALUES(?,?,?,?,?)');
    for(let id=3;id<=count;id++)insert.run(id,`Benchmark ${id}`,`benchmark-${id}`,`/projects/benchmark-${id}`,'READY');
    const project=f.db.prepare('INSERT INTO projects(name,slug,organization_id,dropbox_root_path) VALUES(?,?,?,?)');
    const file=f.db.prepare('INSERT INTO organization_files(organization_id,name,file_name,dropbox_path,deleted_at,purged_at) VALUES(?,?,?,?,?,?)');
    for(let id=1;id<=count;id++){
      if(id>2)f.db.prepare("INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(?,1,'owner')").run(id);
      for(let index=0;index<2;index++)project.run(`Project ${id}-${index}`,`project-${id}-${index}`,id,`/projects/benchmark-${id}/project-${index}`);
      for(let index=0;index<3;index++)file.run(id,`Document ${index}`,`document-${index}.pdf`,`/projects/benchmark-${id}/document-${index}.pdf`,index===1?'2026-01-01':null,index===2?'2026-01-01':null);
    }
    const samples=[];let statements=0,rows=0;
    for(let index=0;index<35;index++){
      returnedRows=0;const before=f.sqlCalls.length,start=performance.now();
      const response=await onRequest({env:f.env,request:new Request('https://local.invalid/api/admin/organization-management/organizations?size=10',{headers:f.headers(1)})});
      const body=await response.json(),duration=performance.now()-start;
      if(response.status!==200||body.summary.organizations!==count)throw new Error(`Unexpected benchmark result: ${response.status}`);
      if(index>=5){samples.push(duration);statements=f.sqlCalls.length-before;rows=returnedRows;}
    }
    samples.sort((a,b)=>a-b);
    results.push({organizations:count,projects:count*2,fileRecords:count*3,activeFiles:count,users:2,memberships:count,samples:samples.length,p50Ms:samples[Math.ceil(samples.length*.5)-1],p95Ms:samples[Math.ceil(samples.length*.95)-1],httpRequestsPerSample:1,sqlStatementsPerSample:statements,databaseRowsReturnedPerSample:rows,organizationRowsReturned:Math.min(count,10),d1RowsRead:null});
  }finally{for(const fn of cleanup.reverse())fn();}
}
console.log(JSON.stringify({environment:'local SQLite + actual Pages handler; no browser/network/remote D1',generatedAt:new Date().toISOString(),warmup:5,results},null,2));
