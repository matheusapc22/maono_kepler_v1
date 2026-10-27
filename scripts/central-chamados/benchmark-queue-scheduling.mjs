import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { fixture, stats } from './benchmark-read-paths.mjs';
import { loadPerformanceUiBuild } from './performance-ui-build.mjs';

const [serialDirectory,parallelDirectory,boundedDirectory,label]=process.argv.slice(2);
assert.match(label||'',/^[a-z][a-z0-9-]*$/);
const output=`.tmp/ticket-performance/queues-${label}`,toolingSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
await mkdir('.tmp/ticket-performance',{recursive:true});
for(const suffix of ['.json','-progress.json']){try{await access(output+suffix);throw new Error('Output label already used');}catch(error){if(error.code!=='ENOENT')throw error;}}
await writeFile(output+'-reservation.json',JSON.stringify({toolingSha,startedAt:new Date().toISOString(),serialDirectory,parallelDirectory,boundedDirectory}),{flag:'wx'});
const smoke=process.env.PERF_SMOKE==='1',builds={},results=[];let browser;
const optional={ok:true,enabled:false,schemaReady:true,projects:[],files:[],folders:[],tickets:[],users:[],items:[],jobs:[],unread:0,nextCursor:null,facets:{types:[],projects:[],folderCounts:[]},pagination:{total:0,hasMore:false}};
const session={authenticated:true,user:{id:1,name:'Synthetic operator',role:'owner',activeOrganizationId:1,permissions:[],deniedPermissions:[]},projects:[],organizations:[{id:1,name:'Synthetic',slug:'synthetic',active:true}],activeOrganization:{id:1,name:'Synthetic',slug:'synthetic',active:true}};
async function run(records,variant,iteration){
  const build=builds[variant],f=await fixture(records,true,0);f.setHandlers(build.handlers);
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR',timezoneId:'UTC',serviceWorkers:'block'}),page=await context.newPage();
  const requests=[],errors=[],requestFailures=[],authorized=new Map();let start=performance.now(),snapshot=null,active=0,maxActive=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>requestFailures.push(r.failure()?.errorText||'unknown'));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();assert.equal(route.request().method(),'GET');
    const queue=url.searchParams.get('queue');let record;
    if(queue){record={queue,startMs:performance.now()-start,reusesPreparedSnapshot:url.searchParams.get('snapshot')===snapshot};requests.push(record);active++;maxActive=Math.max(maxActive,active);}
    try{
      let data=url.pathname==='/api/session'?session:optional;
      if(url.pathname==='/api/organizations/1/tickets'){
        const result=await f.request('list',url.searchParams.toString(),'owner');data=result.data;
        if(!queue)snapshot=data.pagination.snapshot;
        for(const ticket of data.tickets)authorized.set(ticket.code,ticket.subject);
        if(record)Object.assign(record,{bytes:result.trace.bytes,backend:{...result.trace,events:iteration<0?result.trace.events:undefined}});
      }
      await route.fulfill({status:200,json:data,headers:{'Cache-Control':'private, no-store'}});
    }catch(error){errors.push(error.message);await route.abort().catch(()=>{});}finally{if(record){record.durationMs=performance.now()-start-record.startMs;active--;}}
  });
  try{
    await page.goto(`${build.origin}/projects?cc_org=1&cc_view=list`);
    const preparedSubject=page.locator('.ticket-list-table .ticket-subject-button').first();
    await preparedSubject.waitFor({state:'visible'});assert.ok(snapshot);
    assert.ok([...authorized.values()].includes((await preparedSubject.textContent()).trim()),'list setup requires real authorized content');
    start=performance.now();
    await page.getByRole('combobox',{name:'Visualização dos chamados',exact:true}).click();await page.getByRole('listbox').getByRole('option',{name:'Kanban',exact:true}).click();
    await page.locator('.ticket-kanban-card:not(.mm-loading-ticket-card) .ticket-kanban-subject').first().waitFor({state:'visible'});const firstMs=performance.now()-start;
    await page.waitForFunction(()=>document.querySelectorAll('.ticket-kanban-stack').length===4&&[...document.querySelectorAll('.ticket-kanban-stack')].every(e=>e.getAttribute('aria-busy')==='false'));const fourMs=performance.now()-start;
    const cards=await page.locator('.ticket-kanban-card:not(.mm-loading-ticket-card)').evaluateAll(cards=>cards.map(card=>({code:card.querySelector('.ticket-kanban-card-topline strong')?.textContent?.trim(),subject:card.querySelector('.ticket-kanban-subject')?.textContent?.trim()})));
    for(const card of cards){assert.ok(authorized.has(card.code));assert.equal(card.subject,authorized.get(card.code));}
    assert.deepEqual(errors,[]);assert.equal(requests.length,4);assert.ok(requests.every(r=>r.reusesPreparedSnapshot));assert.equal(active,0);
    const snapshots=f.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket_query_snapshots').get().n;assert.equal(snapshots,1);
    const profile=await page.evaluate(()=>window.__ticketProfile||[]);assert.ok(profile.length);
    return {records,flow:true,variant,iteration,sourceSha:build.manifest.sourceSha,manifestDigest:build.manifest.digest,firstMs,fourMs,requests,requestFailures,maxActiveHandlers:maxActive,snapshots,semanticAuthorizedCards:cards.length,reactProfile:profile};
  }finally{await context.close();await f.close();}
}
try{
  for(const [variant,directory] of Object.entries({serial:serialDirectory,parallel:parallelDirectory,bounded:boundedDirectory}))builds[variant]=await loadPerformanceUiBuild(directory);
  for(const variant of ['parallel','bounded']){
    assert.deepEqual(builds.serial.manifest.fixtureFiles,builds[variant].manifest.fixtureFiles);assert.deepEqual(builds.serial.manifest.dependencies,builds[variant].manifest.dependencies);
    const old=new Map(builds.serial.manifest.sourceFiles.map(f=>[f.path,f.sha256]));
    const changed=builds[variant].manifest.sourceFiles.filter(f=>old.get(f.path)!==f.sha256).map(f=>f.path);
    assert.deepEqual(changed,['src/pages/Projects/components/TicketKanbanBoard.tsx'],'only queue scheduling product source differs');
  }
  browser=await chromium.launch({headless:true});
  const orders=[['serial','parallel','bounded'],['bounded','parallel','serial'],['parallel','serial','bounded'],['bounded','serial','parallel'],['parallel','bounded','serial'],['serial','bounded','parallel']];
  for(const records of smoke?[80]:[80,800])for(let i=-1;i<(smoke?0:30);i++)for(const variant of orders[(i+6)%6]){
    const result=await run(records,variant,i);results.push(result);console.log(JSON.stringify({records,variant,iteration:i,firstMs:result.firstMs,fourMs:result.fourMs,maxActiveHandlers:result.maxActiveHandlers}));await writeFile(output+'-progress.json',JSON.stringify(results));
  }
  const summary=[];for(const records of [80,800])for(const variant of ['serial','parallel','bounded']){
    const runs=results.filter(r=>r.records===records&&r.variant===variant&&r.iteration>=0);if(runs.length)summary.push({records,variant,firstMs:stats(runs.map(r=>r.firstMs)),fourMs:stats(runs.map(r=>r.fourMs)),maxActiveHandlers:stats(runs.map(r=>r.maxActiveHandlers))});
  }
  await writeFile(output+'.json',JSON.stringify({toolingSha,builds:Object.fromEntries(Object.entries(builds).map(([k,b])=>[k,b.manifest])),browser:browser.version(),conditions:'80/800 synthetic tickets; owner; flow ON; list prepared first, then measured List→Kanban; 30 samples per variant in balanced six-order rotations; same fixture/dependency versions/backend, only Board differs; real authorized subject required; no artificial delay/throttle, no remote D1; production React Profiler and per-binding instrumentation',summary,results},null,2),{flag:'wx'});
}finally{await browser?.close();for(const build of Object.values(builds))await build.close();}
