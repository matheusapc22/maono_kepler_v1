import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, stats } from './benchmark-read-paths.mjs';
import { loadPerformanceUiBuild } from './performance-ui-build.mjs';

const [beforeDirectory,afterDirectory,label]=process.argv.slice(2);
assert.match(label||'',/^[a-z][a-z0-9-]*$/,'unique output label required');
const smoke=process.env.PERF_SMOKE==='1';
const refreshOnly=false;
const repeats=smoke?0:Number(process.env.PERF_SAMPLES||30), delayMs=Number(process.env.PERF_BINDING_DELAY_MS||0);
assert.ok(smoke||repeats>=30);
let browser;
const builds={};
const results=[];
const enabledOptional={ok:true,enabled:false,schemaReady:true,projects:[],files:[],folders:[],tickets:[],users:[],items:[],jobs:[],unread:0,nextCursor:null,facets:{types:[],projects:[],folderCounts:[]},pagination:{total:0,hasMore:false}};
async function run(records,flow,variant,iteration) {
  const f=await fixture(records,flow,delayMs);
  f.setHandlers(builds[variant].handlers);
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR',timezoneId:'UTC',serviceWorkers:'block'});
  const page=await context.newPage(), errors=[], requests=[], marks=[], requestFailures=[], network=[], sizesPending=[];
  const networkByRequest=new WeakMap();
  let start=performance.now(), inFlight=0, refreshFocusPreserved=false;
  const session={authenticated:true,user:{id:1,name:'Synthetic operator',role:'owner',activeOrganizationId:1,permissions:[],deniedPermissions:[]},projects:[],organizations:[{id:1,name:'Synthetic',slug:'synthetic',active:true}],activeOrganization:{id:1,name:'Synthetic',slug:'synthetic',active:true}};
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{
    const entry={order:network.length,type:request.resourceType(),api:new URL(request.url()).pathname.startsWith('/api/'),startMs:performance.now()-start};
    network.push(entry);networkByRequest.set(request,entry);
  });
  page.on('requestfinished',request=>{
    const entry=networkByRequest.get(request);entry.durationMs=performance.now()-start-entry.startMs;entry.outcome='finished';
    sizesPending.push(request.sizes().then(sizes=>{entry.chromiumReportedSizes=sizes;}).catch(()=>{entry.chromiumReportedSizes=null;}));
  });
  page.on('requestfailed',request=>{
    const reason=request.failure()?.errorText||'unknown',entry=networkByRequest.get(request);
    if(entry){entry.durationMs=performance.now()-start-entry.startMs;entry.outcome='failed';entry.reason=reason;}
    requestFailures.push({reason,api:new URL(request.url()).pathname.startsWith('/api/')});
  });
  await page.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(req.method()==='PATCH'&&/^\/api\/organizations\/1\/tickets\/\d+$/.test(url.pathname)) {
      assert.ok(req.headers()['if-match'],'draft conflict retains conditional writes');
      requests.push({kind:'synthetic-conflict',status:412,startMs:performance.now()-start});
      return route.fulfill({status:412,json:{ok:false,error:{code:'TICKET_VERSION_CONFLICT',category:'CONFLICT',retryable:true}}});
    }
    assert.equal(req.method(),'GET','Benchmark must not mutate over HTTP');
    const began=performance.now(), record={kind:'secondary',startMs:began-start};requests.push(record);inFlight++;
    try {
      let data;
      if(url.pathname==='/api/session')data=session;
      else if(/^\/api\/organizations\/1\/tickets(?:\/\d+)?$/.test(url.pathname)) {
        const id=url.pathname.match(/tickets\/(\d+)$/)?.[1];
        record.kind=id?'detail':url.searchParams.get('queue')||'general';
        record.page=Number(url.searchParams.get('page')||1);record.reusesSnapshot=url.searchParams.has('snapshot');
        const result=await f.request(id?'detail':'list',url.searchParams.toString(),'owner',Number(id||1));
        data=result.data;record.backend={...result.trace,events:iteration<0?result.trace.events:undefined};
      } else data=enabledOptional;
      const body=JSON.stringify(data);record.bytes=Buffer.byteLength(body);
      await route.fulfill({status:200,contentType:'application/json',headers:{'Cache-Control':'private, no-store'},body});
      record.status=200;
    } catch(e) {record.failure=e.message;errors.push(e.message);await route.abort().catch(()=>{});}
    finally {record.durationMs=performance.now()-began;inFlight--;}
  });
  const mark=async(name,operation)=>{const began=performance.now();await operation();marks.push({name,startMs:began-start,elapsedMs:performance.now()-began});};
  const ready=()=>page.locator('.ticket-kanban-card:not(.mm-loading-ticket-card) .ticket-kanban-subject').first().waitFor({state:'visible'});
  const all=()=>page.waitForFunction(()=>document.querySelectorAll('.ticket-kanban-card:not(.mm-loading-ticket-card) .ticket-kanban-subject').length>0&&[...document.querySelectorAll('.ticket-kanban-stack')].length===4&&[...document.querySelectorAll('.ticket-kanban-stack')].every(e=>e.getAttribute('aria-busy')==='false'));
  const select=async(label)=>{await page.getByRole('combobox',{name:'Visualização dos chamados',exact:true}).click();await page.getByRole('listbox').getByRole('option',{name:label,exact:true}).click();};
  try {
    await mark('direct-first-authorized-kanban',async()=>{await page.goto(`${builds[variant].origin}/projects?cc_org=1&cc_view=kanban`);await ready();});
    await all();marks.push({name:'direct-four-first-pages',elapsedMs:performance.now()-start});
    await page.waitForTimeout(100);
    const open=async()=>{await page.locator('.ticket-kanban-subject').first().click();await page.locator('.ticket-detail-content:not(.mm-loading-ticket-detail) .ticket-detail-summary').waitFor({state:'visible'});};
    if(!refreshOnly) {
    await select('Lista');await page.locator('.ticket-list-table tbody tr').first().waitFor();
    const switched=performance.now();
    await mark('list-to-kanban-first',async()=>{await select('Kanban');await ready();});
    await all();marks.push({name:'list-to-kanban-four',elapsedMs:performance.now()-switched});
    await mark('detail-first-authorized-summary',open);
    await page.waitForTimeout(100);
    await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click();
    await mark('detail-reopen-authorized-summary',open);
    await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click();
    await mark('rapid-switch-final-summary',async()=>{
      await page.locator('.ticket-kanban-subject').first().click();
      await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click();
      const expected=await page.locator('.ticket-kanban-subject').nth(1).textContent();
      await page.locator('.ticket-kanban-subject').nth(1).click();await page.locator('.ticket-detail-content:not(.mm-loading-ticket-detail) .ticket-detail-summary').waitFor({state:'visible'});
      assert.equal((await page.locator('#ticket-detail-title').textContent()).trim(),expected.trim());
    });
    await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click();
    const more=page.locator('.column-open').getByRole('button',{name:/Carregar mais/});
    if(await more.count())await mark('column-pagination',async()=>{await Promise.all([page.waitForResponse(r=>new URL(r.url()).searchParams.get('page')==='2'),more.click()]);await all();});
    // Filter requests are debounced by the actual application; count that time.
    const search=page.getByRole('region',{name:'Filtros de chamados',exact:true}).getByRole('searchbox');
    await mark('filter-authorized-kanban',async()=>{await Promise.all([page.waitForResponse(r=>new URL(r.url()).searchParams.get('q')==='Synthetic 1'),search.fill('Synthetic 1')]);await all();});
    }
    await open();
    const date=page.locator('.ticket-detail-content:not(.mm-loading-ticket-detail) input[type=date]').first();
    await date.fill('2099-01-01');
    await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
    const reload=page.getByRole('button',{name:'Consultar versão atual',exact:true});
    await reload.waitFor({state:'visible'});
    await mark('refresh-with-draft',async()=>{
      await Promise.all([page.waitForResponse(r=>/\/tickets\/\d+\?$|\/tickets\/\d+$/.test(r.url())&&r.request().method()==='GET'),reload.click()]);
      await page.waitForFunction(()=>document.querySelector('.ticket-detail-content:not(.mm-loading-ticket-detail)')?.getAttribute('aria-busy')==='false');
      assert.equal(await date.inputValue(),'2099-01-01');
      refreshFocusPreserved=await reload.evaluate(e=>document.activeElement===e);
    });
    await page.waitForTimeout(150);
    assert.deepEqual(errors,[]);assert.equal(inFlight,0);
    if(variant==='after')assert.equal(refreshFocusPreserved,true,'candidate refresh must preserve focus');
    await Promise.all(sizesPending);
    const profile=await page.evaluate(()=>window.__ticketProfile||[]);
    assert.ok(profile.length,'React production profiler must be active');
    const snapshots=f.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket_query_snapshots').get().n;
    return {records,flow,variant,iteration,sourceSha:builds[variant].manifest.sourceSha,manifestDigest:builds[variant].manifest.digest,marks,requests,network,requestFailures,reactProfile:profile,snapshots,failures:errors.length,
      invariants:{draftPreserved:true,refreshFocusPreserved},unmetExpectations:refreshFocusPreserved?[]:['refresh-button-focus']};
  } catch(error) {await mkdir('.tmp/ticket-performance',{recursive:true});await writeFile(`.tmp/ticket-performance/ui-pair-${label}-error.json`,JSON.stringify({error:String(error),errors,marks,requests},null,2));throw error;}
  finally {await context.close();await f.close();}
}
try {
  builds.before=await loadPerformanceUiBuild(beforeDirectory);
  builds.after=await loadPerformanceUiBuild(afterDirectory);
  assert.notEqual(builds.before.origin,builds.after.origin);
  assert.notEqual(builds.before.manifest.sourceSha,builds.after.manifest.sourceSha);
  assert.deepEqual(builds.before.manifest.fixtureFiles,builds.after.manifest.fixtureFiles,'identical common fixture');
  assert.deepEqual(builds.before.manifest.dependencies,builds.after.manifest.dependencies,'identical recorded dependency versions');
  browser=await chromium.launch({headless:true});
  // Alternate order to reduce runtime/thermal drift. Warmups are retained separately.
  for(const records of smoke?[80]:[80,800])for(const flow of smoke?[true]:[false,true])for(let i=-1;i<repeats;i++) {
    for(const variant of refreshOnly?['after']:i%2===0?['before','after']:['after','before']) {
      const result=await run(records,flow,variant,i);results.push(result);
      console.log(JSON.stringify({records,flow,variant,iteration:i,marks:result.marks}));
      await mkdir('.tmp/ticket-performance',{recursive:true});
      await writeFile(`.tmp/ticket-performance/ui-pair-${label}-progress.json`,JSON.stringify(results));
    }
  }
  if(smoke)process.exitCode=0;
  const summary=[];
  for(const records of smoke?[]:[80,800])for(const flow of [false,true])for(const variant of refreshOnly?['after']:['before','after']) {
    const runs=results.filter(r=>r.records===records&&r.flow===flow&&r.variant===variant&&r.iteration>=0);
    summary.push({records,flow,variant,metrics:Object.fromEntries(runs[0].marks.map(m=>[m.name,stats(runs.map(r=>r.marks.find(x=>x.name===m.name)?.elapsedMs).filter(Number.isFinite))]))});
  }
  await writeFile(`.tmp/ticket-performance/ui-pair-${label}.json`,JSON.stringify({toolingSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),builds:Object.fromEntries(Object.entries(builds).map(([variant,build])=>[variant,build.manifest])),browser:browser.version(),delayMs,environment:'separate immutable production profiling UI bundles + their frozen actual route handlers; same-process intercepted APIs + node:sqlite; no D1 remote; optional modules disabled by synthetic API',overhead:'React production Profiler active; per-binding timers/hash and full request lifecycle recording equally; no CPU/network throttling; durations include Playwright interaction overhead; Chromium reported sizes for intercepted APIs are not remote wire measurements',summary,results},null,2));
} finally {
  await browser?.close();
  const closed=await Promise.allSettled(Object.values(builds).map(build=>build.close()));
  for(const result of closed)if(result.status==='rejected')throw result.reason;
}
