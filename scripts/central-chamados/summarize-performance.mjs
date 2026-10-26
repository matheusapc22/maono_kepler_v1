import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { stats } from './benchmark-read-paths.mjs';

const read = async name => JSON.parse(await readFile(`.tmp/ticket-performance/${name}.json`,'utf8'));
const backend=await read('paired-0ms'), browser=await read('browser-paired'), refresh=await read('refresh-followup');
const destination='docs/central-chamados/performance';
await mkdir(destination,{recursive:true});
assert.equal(backend.results.length,48);
assert.equal(browser.results.length,248);assert.equal(browser.summary.length,8);
assert.equal(refresh.results.length,124);assert.equal(refresh.summary.length,4);
const measured=browser.results.filter(r=>r.iteration>=0), repeated=refresh.results.filter(r=>r.iteration>=0);
assert.equal(measured.length,240);assert.equal(repeated.length,120);
assert.ok(repeated.every(r=>r.invariants.draftPreserved&&r.invariants.refreshFocusPreserved));
for(const r of backend.results)for(const v of ['before','after'])assert.equal(r.measurements[v].length,30);
for(const s of browser.summary)for(const m of Object.values(s.metrics))assert.equal(m.n,30);

await writeFile(`${destination}/paired-summary.json`,JSON.stringify({...backend,results:backend.results.map(({measurements,warmups,...r})=>r)},null,2)+'\n');
const summarizeBrowser=report=>({...report,results:undefined,conditions:report.summary.map(condition=>{
  const runs=report.results.filter(r=>r.iteration>=0&&r.records===condition.records&&r.flow===condition.flow&&r.variant===condition.variant);
  return {...condition,journeys:runs.length,failures:runs.reduce((n,r)=>n+r.failures,0),
    draftFailures:runs.filter(r=>!r.invariants.draftPreserved).length,focusFailures:runs.filter(r=>!r.invariants.refreshFocusPreserved).length,
    clientRequestFailures:runs.every(r=>Array.isArray(r.requestFailures))?runs.flatMap(r=>r.requestFailures):null,
    requestCounts:stats(runs.map(r=>r.requests.length)),responseBodyBytes:stats(runs.map(r=>r.requests.reduce((n,q)=>n+(q.bytes||0),0))),
    bindingCalls:stats(runs.map(r=>r.requests.reduce((n,q)=>n+(q.backend?.bindingCalls||0),0))),snapshots:stats(runs.map(r=>r.snapshots)),
    reactCommitDurationMs:stats(runs.flatMap(r=>r.reactProfile.map(c=>c.actualDuration))),
    reactRenderTotalPerJourneyMs:stats(runs.map(r=>r.reactProfile.reduce((n,c)=>n+c.actualDuration,0)))};
})});
await writeFile(`${destination}/browser-summary.json`,JSON.stringify(summarizeBrowser(browser),null,2)+'\n');
await writeFile(`${destination}/refresh-summary.json`,JSON.stringify(summarizeBrowser(refresh),null,2)+'\n');
const num=n=>n.toFixed(2), change=(a,b)=>`${((b/a-1)*100).toFixed(1)}%`;
const backendRows=backend.results.map(r=>{
  const a=r.summary.before,b=r.summary.after;
  return `| ${r.records} | ${r.flow?'ON':'OFF'} | ${r.profile} | ${r.scenario} | ${num(a.elapsedMs.p50)} → ${num(b.elapsedMs.p50)} | ${num(a.elapsedMs.p95)} → ${num(b.elapsedMs.p95)} | ${change(a.elapsedMs.p95,b.elapsedMs.p95)} | ${a.bindingCalls.p50} → ${b.bindingCalls.p50} |`;
});
const browserRows=[];
for(const a of browser.summary.filter(s=>s.variant==='before')){
  const b=browser.summary.find(s=>s.variant==='after'&&s.records===a.records&&s.flow===a.flow);
  for(const [name,old] of Object.entries(a.metrics)){
    const next=b.metrics[name];
    browserRows.push(`| ${a.records} | ${a.flow?'ON':'OFF'} | ${name} | ${num(old.p50)} → ${num(next.p50)} | ${num(old.p95)} → ${num(next.p95)} | ${change(old.p95,next.p95)} |`);
  }
}
const regressions=backend.results.filter(r=>r.summary.after.elapsedMs.p95>r.summary.before.elapsedMs.p95*1.1).length;
let uiRegressions=0;
for(const a of browser.summary.filter(s=>s.variant==='before')){
  const b=browser.summary.find(s=>s.variant==='after'&&s.records===a.records&&s.flow===a.flow);
  uiRegressions+=Object.keys(a.metrics).filter(k=>b.metrics[k].p95>a.metrics[k].p95*1.1).length;
}
const focusRows=refresh.summary.map(s=>`| ${s.records} | ${s.flow?'ON':'OFF'} | ${s.metrics['refresh-with-draft'].n} | ${num(s.metrics['refresh-with-draft'].p50)} | ${num(s.metrics['refresh-with-draft'].p95)} |`);
await writeFile(`${destination}/MEASUREMENTS.md`,[
  '# Measured results',
  '',
  `Original paired code: ${browser.sourceSha}; backend baseline: ${backend.baselineSha}. Focus follow-up: ${refresh.sourceSha}. Chromium: ${browser.browser}. All times below are milliseconds. See README for scope/overhead and unavailable fields.`,
  '',
  `Acceptance remains incomplete: ${regressions}/48 backend conditions and ${uiRegressions}/40 UI conditions show more than 10% p95 regression. The 30% UI reduction target is not demonstrated across conditions. These are observed local results, not remote D1 measurements.`,
  '',
  '## Backend — 30 measured requests per side in every row',
  '',
  '| Tickets | Flow | Profile | Scenario | p50 before → after | p95 before → after | p95 change | Median bindings before → after |',
  '|---:|:---:|---|---|---:|---:|---:|---:|',...backendRows,
  '',
  '## Browser — 30 measured journeys per side in every row',
  '',
  '| Tickets | Flow | Milestone | p50 before → after | p95 before → after | p95 change |',
  '|---:|:---:|---|---:|---:|---:|',...browserRows,
  '',
  'All original journeys preserved the date draft. All original journeys lost refresh-button focus in both variants; this is an existing defect, not a schema regression. Route/page errors were zero; client-side aborts were not captured in that run.',
  '',
  '## Focus correction follow-up',
  '',
  '120 measured refresh journeys plus four excluded warm-ups passed draft and focus assertions. This shorter journey exercises the targeted correction after rebuilding. It is not substituted for the original paired performance run and has no claimed speed-up.',
  '',
  '| Tickets | Flow | n | Refresh p50 | Refresh p95 |',
  '|---:|:---:|---:|---:|---:|',...focusRows,
  '',
  'The compact browser summaries include request counts, JSON-body bytes, binding totals, snapshot counts, React commit durations and total render time per journey. Profiler timings include profiling overhead; the optional APIs are disabled fixtures, so their completion does not establish actual secondary-module latency.',
  '',
  '## Waterfalls',
  '',
  'CSV files select iteration 0 (the first measured iteration after excluded warm-up), fixed without selecting for latency. HTTP rows contain observed start time, duration, kind/page/snapshot reuse/status/bytes; SQL rows contain per-request start time, duration, statement kind, statement count and hashed fingerprint. No payloads or parameters are retained. All original samples are retained in the separate sanitized evidence archive.',
  '',
].join('\n'));
const csvValue=v=>JSON.stringify(v??'');
const csv=(header,rows)=>[header.join(','),...rows.map(r=>r.map(csvValue).join(','))].join('\n')+'\n';
const http=[];
for(const r of browser.results.filter(r=>r.iteration===0))r.requests.forEach((q,index)=>http.push([r.records,r.flow,r.variant,index,q.kind,q.page,q.reusesSnapshot,q.startMs,q.durationMs,q.status,q.bytes,q.backend?.bindingCalls]));
await writeFile(`${destination}/http-waterfall.csv`,csv(['tickets','flow','variant','order','kind','page','reusesSnapshot','startMs','durationMs','status','jsonBodyBytes','backendBindings'],http));
const sql=[];
for(const r of backend.results)for(const variant of ['before','after'])r.measurements[variant][0].events.slice().sort((a,b)=>a.startMs-b.startMs).forEach((e,index)=>sql.push([r.records,r.flow,r.profile,r.scenario,variant,index,e.phase,e.kind,e.sqlStatements,e.query,e.startMs,e.durationMs,e.adapterDurationMs]));
await writeFile(`${destination}/sql-waterfall.csv`,csv(['tickets','flow','profile','scenario','variant','order','sqlCategory','kind','sqlStatements','fingerprint','startMs','bindingDurationMs','adapterDurationMs'],sql));
// Static chart from observed timings, fixed iteration selection, no live data.
const panels=browser.results.filter(r=>r.flow&&r.iteration===0);
const colors={general:'#b45f06',secondary:'#64748b',detail:'#7c3aed'};
const plots=panels.map(r=>({...r,first:r.marks.find(m=>m.name==='direct-first-authorized-kanban').elapsedMs,all:r.marks.find(m=>m.name==='direct-four-first-pages').elapsedMs}));
const maximum=Math.ceil(Math.max(...plots.map(r=>r.all))/100)*100, scale=800/maximum;
let y=65;
const shapes=['<rect width="1080" height="100%" fill="white"/>','<text x="24" y="30" font-size="20" font-weight="bold">Kanban initial request waterfall — iteration 0, flow ON</text>'];
for(const p of plots){
  const requests=p.requests.filter(q=>q.startMs<p.all&&q.durationMs!==undefined);
  shapes.push(`<text x="24" y="${y}" font-size="16" font-weight="bold">${p.records} tickets / ${p.variant} — first content ${num(p.first)} ms; four columns ${num(p.all)} ms</text>`);y+=20;
  const top=y;
  for(const q of requests){
    shapes.push(`<text x="24" y="${y+14}" font-size="12">${q.kind}</text><rect x="${180+q.startMs*scale}" y="${y}" width="${Math.max(1,q.durationMs*scale)}" height="17" fill="${colors[q.kind]||'#2563eb'}"/><text x="${185+(q.startMs+q.durationMs)*scale}" y="${y+13}" font-size="10">${num(q.durationMs)} ms</text>`);y+=24;
  }
  for(const [time,color] of [[p.first,'#15803d'],[p.all,'#9333ea']])shapes.push(`<line x1="${180+time*scale}" y1="${top-5}" x2="${180+time*scale}" y2="${y}" stroke="${color}" stroke-dasharray="4 3"/>`);
  for(let t=0;t<=maximum;t+=100)shapes.push(`<text x="${180+t*scale}" y="${y+15}" font-size="10">${t}</text>`);
  y+=60;
}
shapes.push(`<text x="24" y="${y}" font-size="12">Milliseconds from journey start. Green: first authorized content. Purple: all first pages. Gray: disabled optional APIs.</text>`);
shapes.push(`<text x="24" y="${y+22}" font-size="12">Local Chromium profiling fixture + real handlers + SQLite. Intercepted HTTP; no remote D1 or production latency claim.</text>`);
await writeFile(`${destination}/kanban-waterfall.svg`,`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${y+50}" viewBox="0 0 1080 ${y+50}" font-family="Arial, sans-serif" fill="#172033">${shapes.join('')}</svg>\n`);
console.log(JSON.stringify({backendConditions:backend.results.length,backendRequests:2880,browserJourneys:measured.length,focusJourneys:repeated.length,backendP95RegressionsAbove10Percent:regressions,uiP95RegressionsAbove10Percent:uiRegressions,files:['paired-summary.json','browser-summary.json','refresh-summary.json','MEASUREMENTS.md','http-waterfall.csv','sql-waterfall.csv']}));
