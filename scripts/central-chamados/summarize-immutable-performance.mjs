import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { stats } from './benchmark-read-paths.mjs';

const file='.tmp/ticket-performance/ui-pair-kanban-authorized.json';
const bytes=await readFile(file),report=JSON.parse(bytes);
const runs=report.results.filter(r=>r.iteration>=0),comparisons=[];
assert.equal(runs.length,240);
for(const records of [80,800])for(const flow of [false,true]){
  const before=report.summary.find(s=>s.records===records&&s.flow===flow&&s.variant==='before');
  const after=report.summary.find(s=>s.records===records&&s.flow===flow&&s.variant==='after');
  for(const name of Object.keys(before.metrics))comparisons.push({records,flow,name,before:before.metrics[name],after:after.metrics[name],p95ChangePct:100*(after.metrics[name].p95/before.metrics[name].p95-1)});
}
const timing=[];
for(const records of [80,800])for(const flow of [false,true])for(const variant of ['before','after']){
  const selected=runs.filter(r=>r.records===records&&r.flow===flow&&r.variant===variant);
  const metric={records,flow,variant,snapshots:stats(selected.map(r=>r.snapshots)),apiRequests:stats(selected.map(r=>r.requests.length)),responseBytes:stats(selected.map(r=>r.requests.reduce((n,r)=>n+(r.bytes||0),0))),reactActualDurationTotal:stats(selected.map(r=>r.reactProfile.reduce((n,p)=>n+(p.actualDuration||0),0)))};
  for(const name of ['direct-first-authorized-kanban','list-to-kanban-first','detail-first-authorized-summary','detail-reopen-authorized-summary','refresh-with-draft']){
    const data=selected.map(r=>{
      const mark=r.marks.find(m=>m.name===name),start=mark.startMs,end=start+mark.elapsedMs;
      const requests=r.requests.filter(q=>q.startMs>=start&&q.startMs<end&&(name.includes('kanban')?['open','in_progress','in_review','closed'].includes(q.kind):q.kind==='detail'));
      const first=requests.sort((a,b)=>(a.startMs+a.durationMs)-(b.startMs+b.durationMs))[0];
      return first?{requestStartAfterActionMs:first.startMs-start,requestDurationMs:first.durationMs,responseToVisibleProbeMs:end-first.startMs-first.durationMs}:null;
    }).filter(Boolean);
    metric[name]=Object.fromEntries(['requestStartAfterActionMs','requestDurationMs','responseToVisibleProbeMs'].map(key=>[key,stats(data.map(v=>v[key]))]));
  }
  timing.push(metric);
}
const summary={sourceSha:report.builds.after.sourceSha,baselineSha:report.builds.before.sourceSha,toolingSha:report.toolingSha,rawSha256:createHash('sha256').update(bytes).digest('hex'),browser:report.browser,environment:report.environment,overhead:report.overhead,
 builds:Object.fromEntries(Object.entries(report.builds).map(([k,m])=>[k,{sourceSha:m.sourceSha,toolingSha:m.toolingSha,digest:m.digest,assets:m.assets}])),
 measuredJourneys:runs.length,warmups:report.results.length-runs.length,failures:runs.reduce((n,r)=>n+r.failures,0),requestFailures:runs.flatMap(r=>r.requestFailures),draftFailures:runs.filter(r=>!r.invariants.draftPreserved).length,candidateFocusFailures:runs.filter(r=>r.variant==='after'&&!r.invariants.refreshFocusPreserved).length,baselineFocusFailures:runs.filter(r=>r.variant==='before'&&!r.invariants.refreshFocusPreserved).length,
 comparisons,timing,limitations:['Same-process intercepted actual handlers + SQLite, not D1 remote','Optional modules return disabled envelopes; completion of real secondary modules is not measured','Response-to-visible probe includes transport/React/presentation/Playwright wait overhead, not an isolated render span','React total is summed actualDuration over the complete journey, not a milestone','The host is not a dedicated performance appliance; all measured tail regressions remain reported']};
const out='docs/central-chamados/performance/';
await writeFile(out+'immutable-ui-summary.json',JSON.stringify(summary,null,2)+'\n');
const fmt=n=>n.toFixed(2);
let md='# Immutable UI comparison\n\n';
md+=`Baseline \`${summary.baselineSha}\`; candidate product \`${summary.sourceSha}\`; harness \`${summary.toolingSha}\`. Each variant serves a separately built, hash-verified UI and frozen handlers. Same Chromium ${summary.browser}, production React Profiler, 80/800 synthetic tickets, owner, flow OFF/ON, no network/CPU throttle. Thirty alternating pairs per condition; ${summary.measuredJourneys} measured journeys, ${summary.warmups} excluded warmups.\n\n`;
md+='Full request lifecycle is recorded for assets and intercepted APIs. Body bytes and Chromium-reported sizes are local observations, not remote wire cost. Original historical comparisons remain separate. No concurrent local tests/builds/benchmarks ran during this comparison.\n\n';
md+=`Runtime failures: ${summary.failures}; request failures/aborts: ${summary.requestFailures.length}; draft failures: ${summary.draftFailures}; candidate focus failures: ${summary.candidateFocusFailures}; baseline focus failures: ${summary.baselineFocusFailures}.\n\n`;
md+='| Tickets | Flow | Milestone | Before p50 / p95 ms | After p50 / p95 ms | p95 change |\n|---:|:---:|---|---:|---:|---:|\n';
for(const c of comparisons)md+=`| ${c.records} | ${c.flow?'ON':'OFF'} | ${c.name} | ${fmt(c.before.p50)} / ${fmt(c.before.p95)} | ${fmt(c.after.p50)} / ${fmt(c.after.p95)} | ${fmt(c.p95ChangePct)}% |\n`;
md+='\nNegative change is faster. Every condition with more than 10% p95 regression remains a failed proposed guardrail, regardless of median or explanatory hypotheses.\n\n';
md+='| Tickets | Flow | Variant | First detail request p95 ms | Response to visible probe p95 ms | Whole journey React actualDuration p95 ms |\n|---:|:---:|---|---:|---:|---:|\n';
for(const t of timing)md+=`| ${t.records} | ${t.flow?'ON':'OFF'} | ${t.variant} | ${fmt(t['detail-first-authorized-summary'].requestDurationMs.p95)} | ${fmt(t['detail-first-authorized-summary'].responseToVisibleProbeMs.p95)} | ${fmt(t.reactActualDurationTotal.p95)} |\n`;
md+='\nThe response-to-visible probe is not an isolated rendering measurement: it includes client handling, existing presentation timing and Playwright observation. The unchanged presentation policy has a 260 ms content deadline; these figures must not be interpreted as permission to shorten it. Optional-module completion, remote D1 latency, full logical backend spans and D1 rows_read/rows_written remain unmeasured.\n';
await writeFile(out+'IMMUTABLE-MEASUREMENTS.md',md);
const csv=['records,flow,variant,source_sha,iteration,order,kind,page,reuses_snapshot,start_ms,duration_ms,body_bytes,status,binding_calls,binding_ms'];
for(const r of runs.filter(r=>r.iteration===0))r.requests.forEach((q,i)=>csv.push([r.records,r.flow,r.variant,r.sourceSha,0,i,q.kind,q.page??'',q.reusesSnapshot??'',q.startMs,q.durationMs??'',q.bytes??'',q.status??'',q.backend?.bindingCalls??'',q.backend?.bindingMs??''].join(',')));
await writeFile(out+'immutable-http-waterfall.csv',csv.join('\n')+'\n');
console.log(JSON.stringify({measuredJourneys:summary.measuredJourneys,failures:summary.failures,requestFailures:summary.requestFailures.length,candidateFocusFailures:summary.candidateFocusFailures,regressions:comparisons.filter(c=>c.p95ChangePct>10),principal:comparisons.filter(c=>['direct-first-authorized-kanban','list-to-kanban-first','detail-first-authorized-summary'].includes(c.name))},null,2));
