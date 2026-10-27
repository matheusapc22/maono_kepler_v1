import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [label]=process.argv.slice(2);
assert.match(label||'',/^[a-z][a-z0-9-]*$/);
const raw=await readFile(`.tmp/ticket-performance/queues-${label}.json`),report=JSON.parse(raw);
const measured=report.results.filter(r=>r.iteration>=0);
assert.equal(measured.length,180);
assert.ok(report.summary.every(s=>s.firstMs.n===30&&s.fourMs.n===30));
const comparisons=report.summary.map(s=>{
  const baseline=report.summary.find(x=>x.records===s.records&&x.variant==='serial');
  return {...s,firstP95ChangePct:100*(s.firstMs.p95/baseline.firstMs.p95-1),fourP95ChangePct:100*(s.fourMs.p95/baseline.fourMs.p95-1)};
});
const summary={toolingSha:report.toolingSha,rawSha256:createHash('sha256').update(raw).digest('hex'),browser:report.browser,conditions:report.conditions,
  variantMeaning:{serial:'Existing open-first read, then three concurrent siblings',parallel:'Four concurrent reads with a prepared snapshot',bounded:'Two workers; each freed worker starts the next queue without depending on open'},
  builds:Object.fromEntries(Object.entries(report.builds).map(([name,b])=>[name,{sourceSha:b.sourceSha,digest:b.digest,assets:b.assets}])),
  measuredJourneys:measured.length,warmups:report.results.length-measured.length,requestFailures:measured.flatMap(r=>r.requestFailures),
  allPreparedSnapshotReads:measured.every(r=>r.requests.length===4&&r.requests.every(q=>q.reusesPreparedSnapshot)&&r.snapshots===1),comparisons,
  decision:'Four concurrent reads rejected. Two-worker candidate passed this causal p95 guardrail but then failed the full journey (80/flow ON first content +22.9%). Both scheduling changes are reverted; this causal run is retained, not performance acceptance.',
  limitations:['First-ever List to Kanban after real authorized List setup, unlike the full journey that opens Kanban before List; do not compare absolute timings across these protocols','Same local process SQLite backend, not remote D1','Production React Profiler, per-binding tracing and Playwright overhead on every variant','First-content medians are worse for both parallel candidates; report p50 as well as p95','No 30% p95 improvement demonstrated by this run']};
const out='docs/central-chamados/performance/';
await writeFile(out+`queue-${label}-summary.json`,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
let md='# Queue scheduling causal comparison\n\n';
md+=`Harness \`${summary.toolingSha}\`; ${summary.measuredJourneys} measured journeys plus ${summary.warmups} excluded warmups; Chromium ${summary.browser}. Owner, flow ON, 80/800 synthetic tickets, 30 samples per variant and volume in six balanced order permutations. Separate immutable UI bundles; source hashes verify that only TicketKanbanBoard differs. Same frozen backend, fixture and recorded dependency versions. No concurrent local tests, builds or benchmarks.\n\n`;
md+='`serial` is the existing open-first request followed by three concurrent siblings, not four serial requests. The initial List is prepared before timing and its visible subject must match an authorized response. First Kanban content requires a visible real subject excluding skeletons; rendered codes/subjects are checked against authorized responses. Each journey makes four queue reads with the prepared token and retains exactly one snapshot.\n\n';
md+='| Tickets | Scheduling | First p50 / p95 ms | Four pages p50 / p95 ms | First p95 change | Four p95 change |\n|---:|---|---:|---:|---:|---:|\n';
const fmt=n=>n.toFixed(2);
for(const c of comparisons)md+=`| ${c.records} | ${c.variant} | ${fmt(c.firstMs.p50)} / ${fmt(c.firstMs.p95)} | ${fmt(c.fourMs.p50)} / ${fmt(c.fourMs.p95)} | ${fmt(c.firstP95ChangePct)}% | ${fmt(c.fourP95ChangePct)}% |\n`;
md+=`\nRecorded request failures/aborts: ${summary.requestFailures.length}. All prepared-snapshot invariants: ${summary.allPreparedSnapshotReads}. Four-way parallelism remains rejected. The two-worker candidate stays within the proposed 10% p95 regression guardrail here, but does not demonstrate the 30% target and has worse first-content medians. Its separate complete journey subsequently failed the guardrail (80/flow ON first content +22.9%). Both scheduling candidates are reverted; delivered scheduling returns to 13b3a66. No timing or loading-presentation policy changed.\n\n`;
md+='This isolates local scheduling, not remote D1 performance. The same-process adapter, React Profiler and Playwright add overhead. The six-way order balances execution order but does not make this host a controlled performance appliance. Do not combine these absolute timings with the earlier full-journey protocol. Every result, including rejected variants, is retained.\n';
await writeFile(out+`QUEUE-${label.toUpperCase()}.md`,md,{flag:'wx'});
const csv=['records,variant,source_sha,iteration,order,queue,start_ms,duration_ms,body_bytes,binding_calls,binding_ms,reuses_prepared_snapshot'];
for(const r of measured.filter(r=>r.iteration===0))r.requests.forEach((q,i)=>csv.push([r.records,r.variant,r.sourceSha,r.iteration,i,q.queue,q.startMs,q.durationMs,q.bytes,q.backend.bindingCalls,q.backend.bindingMs,q.reusesPreparedSnapshot].join(',')));
await writeFile(out+`queue-${label}-waterfall.csv`,csv.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({measured:summary.measuredJourneys,failures:summary.requestFailures.length,comparisons},null,2));
