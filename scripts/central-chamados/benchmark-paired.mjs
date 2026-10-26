import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fixture, stats } from './benchmark-read-paths.mjs';
import { onRequestGet as beforeList } from '../../.tmp/ticket-performance/baseline-source/functions/api/organizations/[id]/tickets.js';
import { onRequestGet as beforeDetail } from '../../.tmp/ticket-performance/baseline-source/functions/api/organizations/[id]/tickets/[ticketId].js';
import { onRequestGet as afterList } from '../../functions/api/organizations/[id]/tickets.js';
import { onRequestGet as afterDetail } from '../../functions/api/organizations/[id]/tickets/[ticketId].js';

const label=process.env.PERF_OUTPUT_LABEL;
if(label)assert.match(label,/^[a-z][a-z0-9-]*$/);
const output=`.tmp/ticket-performance/paired-${label?label+'-':''}${Number(process.env.PERF_BINDING_DELAY_MS||0)}ms.json`;
await mkdir('.tmp/ticket-performance',{recursive:true});
try{await access(output);throw new Error('Output label already used');}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(output+'.reservation.json',JSON.stringify({startedAt:new Date().toISOString(),label}),{flag:'wx'});
const samples=Number(process.env.PERF_SAMPLES||30),results=[];
assert.ok(Number.isInteger(samples)&&samples>=30);
const regressionTargets=new Set(['80|false|viewer|list-first','800|false|owner|list-first','800|false|viewer|filter-new','800|true|owner|list-first','80|false|owner|filter-new','800|false|viewer|detail','800|true|owner|filter-new']);
for(const records of [80,800])for(const flow of [false,true])for(const profile of ['owner','viewer']){
  const f=await fixture(records,flow,Number(process.env.PERF_BINDING_DELAY_MS||0));
  try{
    const snapshot=(await f.request('list','includeUndated=1',profile)).data.pagination.snapshot;
    for(const [scenario,kind,query] of [
      ['list-first','list','includeUndated=1&limit=25'],
      ['list-reuse','list',`includeUndated=1&limit=25${snapshot?'&snapshot='+snapshot:''}`],
      ['queue-reuse','list',`includeUndated=1&queue=open&limit=25${snapshot?'&snapshot='+snapshot:''}`],
      ['queue-page2','list',`includeUndated=1&queue=open&limit=25&page=2${snapshot?'&snapshot='+snapshot:''}`],
      ['filter-new','list','includeUndated=1&q=Synthetic&limit=25'],
      ['detail','detail',''],
    ]){
      if(process.env.PERF_REGRESSION_ONLY==='1'&&!regressionTargets.has([records,flow,profile,scenario].join('|')))continue;
      const measurements={before:[],after:[]},warmups=[];
      for(let i=-1;i<samples;i++)for(const variant of i%2===0?['before','after']:['after','before']){
        f.setHandlers(variant==='before'?{list:beforeList,detail:beforeDetail}:{list:afterList,detail:afterDetail});
        // Keep snapshot rate-limit state identical without timing setup/cleanup.
        if(flow&&['list-first','filter-new'].includes(scenario))f.sqlite.prepare('DELETE FROM ticket_query_snapshots WHERE id<>?').run(snapshot);
        const {trace}=await f.request(kind,query,profile);
        if(i<0)warmups.push({variant,trace});else measurements[variant].push(trace);
      }
      const summary=Object.fromEntries(Object.entries(measurements).map(([variant,values])=>[variant,Object.fromEntries(['elapsedMs','bytes','sqlCalls','bindingCalls','bindingMs','schemaCalls'].map(key=>[key,stats(values.map(v=>v[key]))]))]));
      results.push({records,flow,profile,scenario,flags:Object.fromEntries(Object.entries(f.env).filter(([key])=>key.startsWith('MAONO_'))),summary,warmups,measurements});
      console.log(JSON.stringify({records,flow,profile,scenario,before:summary.before.elapsedMs,after:summary.after.elapsedMs,bindings:[summary.before.bindingCalls.p50,summary.after.bindingCalls.p50]}));
    }
  }finally{await f.close();}
}
const diff=execFileSync('git',['diff','HEAD','--','functions'],{encoding:'utf8'});
const report={sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baselineSha:'381c93256d985b0ae39722128fc4ad54f17f025f',trackedWorktreeDirty:!!diff,patchSha256:createHash('sha256').update(diff).digest('hex'),scopeModuleSha256:createHash('sha256').update(await readFile('functions/_lib/request-schema.js')).digest('hex'),runtime:process.version,samples,delayMs:Number(process.env.PERF_BINDING_DELAY_MS||0),environment:'local actual route handlers with in-memory SQLite; paired alternating order; no remote D1',limitations:['bindingMs is cumulative across possibly overlapping spans, not SQL time or wall time','adapterDurationMs includes Node SQLite and instrumentation overhead','rows_read, rows_written and D1 SQL duration unavailable','list-first means new snapshot/request, not a cold Worker process','First warm-up pair excluded per scenario','No payloads, SQL parameters or cookies recorded'],results};
report.diagnostics={regressionTargetsOnly:process.env.PERF_REGRESSION_ONLY==='1',processCpu:process.env.PERF_CPU_DIAGNOSTICS==='1',note:'Process CPU is optional diagnostic instrumentation, may be quantized and includes all process threads; elapsed minus CPU is not a precise scheduler span. Separate from accepted no-CPU comparison.'};
await mkdir('.tmp/ticket-performance',{recursive:true});
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});
