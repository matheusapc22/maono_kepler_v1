import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {integratedDb,ACTORS,WINDOW,seedTicket,drainExport} from '../../../tests/helpers/ticket-integrated-db.mjs';
import {providerHarness} from '../../../tests/helpers/ticket-upload-provider.mjs';
import {readMetrics} from '../../../functions/_lib/ticket-metrics.js';
import {createTicketExport,downloadTicketExport} from '../../../functions/_lib/ticket-exports.js';
import {resolveTicketConversationContext} from '../../../functions/_lib/ticket-conversations.js';
import {initiateResumableTicketAttachmentUpload,uploadTicketAttachmentSessionChunk} from '../../../functions/_lib/ticket-attachment-uploads.js';
import {dropboxContentHashHex} from '../../../functions/_lib/dropbox-content-hash.js';

// Fixed, small, synthetic scenario. No production URL, credentials or SLO inference.
// The SQLite adapter serializes DB work; Promise.all exercises async interleaving,
// not distributed worker concurrency. Provider latency is deliberately mocked.
const records=100,samples=5,cleanup=[],originalFetch=globalThis.fetch;
const f=await integratedDb({after:fn=>cleanup.push(fn)});
const timing={metrics:[],exports:[],uploads:[]};
let sourceChangeRejections=0;
async function measure(flow,operation){const start=performance.now();await operation();timing[flow].push(performance.now()-start);}
try {
  for(let i=0;i<records;i++)seedTicket(f,{id:100+i,subject:'CC17 synthetic '+i});
  Object.assign(f.env,{DROPBOX_APP_KEY:'local-key',DROPBOX_APP_SECRET:'local-secret',DROPBOX_REFRESH_TOKEN:'local-refresh'});
  f.sqlite.exec("UPDATE organizations SET storage_status='READY',storage_error=NULL WHERE id=1");
  const started=performance.now();
  for(let i=0;i<samples;i++){
    const provider=providerHarness();globalThis.fetch=provider.fetch;
    const exportStart=performance.now();let exportNeedsRetry=false;
    async function exportAndCheck(key){
      const {job}=await createTicketExport(f.env,1,ACTORS.editor,{...WINDOW,idempotencyKey:key});
      const terminal=await drainExport(f,job.id);
      if(terminal.state==='failed'&&terminal.error_code==='SOURCE_CHANGED'){
        await assert.rejects(()=>downloadTicketExport(f.env,1,ACTORS.editor,job.id,{storage:f.storage}));
        sourceChangeRejections++;return false;
      }
      assert.equal(terminal.state,'ready',terminal.error_code);
      const csv=await(await downloadTicketExport(f.env,1,ACTORS.editor,job.id,{storage:f.storage})).text();
      assert.equal(csv.split('CC17 synthetic ').length-1,records);return true;
    }
    const outcomes=await Promise.allSettled([
      measure('metrics',async()=>{const result=await readMetrics(f.env,1,ACTORS.editor,WINDOW);assert.equal(result.aggregation.matched+result.aggregation.pending,records);}),
      (async()=>{exportNeedsRetry=!await exportAndCheck('cc17-mixed-export-'+i);})(),
      measure('uploads',async()=>{
        const bytes=new TextEncoder().encode('%PDF-1.7\n'+('synthetic '.repeat(800)));
        const contentHash=await dropboxContentHashHex(bytes);
        const context=await resolveTicketConversationContext(f.env,1,100+i,ACTORS.owner);
        const result=await initiateResumableTicketAttachmentUpload(f.env,1,100+i,ACTORS.owner,{name:'cc17.pdf',mimeType:'application/pdf',size:bytes.byteLength,contentHash});
        const done=await uploadTicketAttachmentSessionChunk(f.env,context,result.upload.sessionId,ACTORS.owner,new Request('https://cc17.test/upload',{method:'PATCH',headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.byteLength),'Upload-Offset':'0','If-Match':result.upload.etag},body:bytes}));
        assert.equal(done.complete,true);assert.equal(done.attachment.status,'ACTIVE');assert.equal(provider.session.committed.content_hash,contentHash);
      }),
    ]);
    for(const result of outcomes)if(result.status==='rejected')throw result.reason;
    if(exportNeedsRetry)assert.equal(await exportAndCheck('cc17-export-recovery-'+i),true);
    timing.exports.push(performance.now()-exportStart); // Includes wait/recovery after a source change.
  }
  assert.equal(f.sqlite.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  const results=Object.fromEntries(Object.entries(timing).map(([flow,values])=>{
    const sorted=[...values].sort((a,b)=>a-b);
    return [flow,{samples:values.length,p95Ms:Number(sorted[Math.ceil(.95*sorted.length)-1].toFixed(2)),errorRate:0,measurementsMs:values.map(v=>Number(v.toFixed(2)))}];
  }));
  results.exports.initialAttemptErrorRate=sourceChangeRejections/samples;
  const report={schemaVersion:1,environment:'local',productionAcceptance:false,releaseAuthorized:false,sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),trackedWorktreeDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),createdAt:new Date().toISOString(),records,concurrentFlows:3,durationSeconds:Number(((performance.now()-started)/1000).toFixed(3)),budget:null,invariantsPreserved:true,sourceChangeRejections,results,limitations:['errorRate counts final failed scenarios; exports.initialAttemptErrorRate includes source-change rejections.','Export elapsed time includes the concurrent batch and a new request after SOURCE_CHANGED.','Five samples only; p95 is the maximum of this small sample.','Local SQLite D1 adapter and mocked Dropbox, not distributed capacity.','Production load, budgets and CT56 remain pending.']};
  await mkdir('.tmp/cc17',{recursive:true});await writeFile('.tmp/cc17/benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {globalThis.fetch=originalFetch;for(const fn of cleanup.reverse())await fn();}
