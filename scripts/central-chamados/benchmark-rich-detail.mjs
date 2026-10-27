import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { fixture, stats } from './benchmark-read-paths.mjs';
import { loadPerformanceUiBuild } from './performance-ui-build.mjs';

const [beforeDirectory,afterDirectory,label]=process.argv.slice(2);
assert.match(label||'',/^[a-z][a-z0-9-]*$/);
const toolingSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
await mkdir('.tmp/ticket-performance',{recursive:true});
for(const suffix of ['','-progress']){try{await access(`.tmp/ticket-performance/rich-${label}${suffix}.json`);throw new Error('Output label already used');}catch(error){if(error.code!=='ENOENT')throw error;}}
await writeFile(`.tmp/ticket-performance/rich-${label}-reservation.json`,JSON.stringify({toolingSha,startedAt:new Date().toISOString(),beforeDirectory,afterDirectory}),{flag:'wx'});
const smoke=process.env.PERF_SMOKE==='1',results=[],builds={};let browser;
const optional={ok:true,enabled:false,schemaReady:true,projects:[],files:[],folders:[],tickets:[],users:[],items:[],jobs:[],unread:0,nextCursor:null,facets:{types:[],projects:[],folderCounts:[]},pagination:{total:0,hasMore:false}};
const session={authenticated:true,user:{id:1,name:'Synthetic operator',role:'owner',activeOrganizationId:1,permissions:[],deniedPermissions:[]},projects:[],organizations:[{id:1,name:'Synthetic',slug:'synthetic',active:true}],activeOrganization:{id:1,name:'Synthetic',slug:'synthetic',active:true}};
async function run(records,variant,iteration){
  const f=await fixture(records,true,0);f.setHandlers(builds[variant].handlers);
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR',timezoneId:'UTC',serviceWorkers:'block'}),page=await context.newPage();
  const requests=[],marks=[],errors=[],requestFailures=[];let richReads=0,inFlight=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>requestFailures.push(r.failure()?.errorText||'unknown'));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(route.request().method()==='PATCH'){
      assert.equal(url.pathname,'/api/organizations/1/tickets/1');assert.ok(route.request().headers()['if-match']);
      return route.fulfill({status:412,json:{ok:false,error:{code:'TICKET_VERSION_CONFLICT',category:'CONFLICT',retryable:true}}});
    }
    assert.equal(route.request().method(),'GET');inFlight++;
    try{
      let data=url.pathname==='/api/session'?session:optional;
      if(/^\/api\/organizations\/1\/tickets(?:\/1)?$/.test(url.pathname)){
        const detail=url.pathname.endsWith('/1/tickets/1'),result=await f.request(detail?'detail':'list',url.searchParams.toString(),'owner',1);data=result.data;
        requests.push({kind:detail?'detail':'list',trace:{...result.trace,events:iteration<0?result.trace.events:undefined}});
        if(detail){assert.equal(data.ticket.id,1);assert.ok(data.attachments.length>=2);assert.ok(data.events.length>0);assert.ok(data.ticket.labels.length>0);richReads++;}
      }
      await route.fulfill({status:200,json:data,headers:{'Cache-Control':'private, no-store'}});
    }catch(error){errors.push(error.message);await route.abort().catch(()=>{});}finally{inFlight--;}
  });
  const mark=async(name,fn)=>{const start=performance.now();await fn();marks.push({name,elapsedMs:performance.now()-start});};
  const ready=()=>page.locator('.ticket-detail-content:not(.mm-loading-ticket-detail) .ticket-detail-summary').waitFor({state:'visible'});
  try{
    await mark('rich-direct-summary',async()=>{await page.goto(`${builds[variant].origin}/projects?cc_org=1&cc_view=list&cc_q=SYN-1&cc_sort=updated_asc&cc_ticket=1`);await ready();});
    assert.equal((await page.locator('#ticket-detail-title').textContent()).trim(),'Synthetic 1');
    await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click();
    await mark('rich-reopen-summary',async()=>{await page.getByRole('button',{name:'Synthetic 1',exact:true}).click();await ready();});
    const date=page.locator('.ticket-detail-content:not(.mm-loading-ticket-detail) input[type=date]').first();await date.fill('2099-01-01');
    await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
    const reload=page.getByRole('button',{name:'Consultar versão atual',exact:true});await reload.waitFor({state:'visible'});
    let focus;
    await mark('rich-refresh-draft',async()=>{await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/organizations/1/tickets/1'&&r.request().method()==='GET'),reload.click()]);await page.waitForFunction(()=>document.querySelector('.ticket-detail-content:not(.mm-loading-ticket-detail)')?.getAttribute('aria-busy')==='false');assert.equal(await date.inputValue(),'2099-01-01');focus=await reload.evaluate(e=>document.activeElement===e);});
    for(let i=0;i<100&&inFlight;i++)await page.waitForTimeout(10);
    assert.equal(inFlight,0);assert.deepEqual(errors,[]);assert.equal(richReads,3);if(variant==='after')assert.equal(focus,true);
    return {records,flow:true,variant,iteration,sourceSha:builds[variant].manifest.sourceSha,marks,requests,requestFailures,invariants:{richReads,authorizedAttachmentsAtLeast:2,historyPresent:true,labelsPresent:true,draftPreserved:true,focusPreserved:focus}};
  }finally{await context.close();await f.close();}
}
try{
  builds.before=await loadPerformanceUiBuild(beforeDirectory);builds.after=await loadPerformanceUiBuild(afterDirectory);
  assert.deepEqual(builds.before.manifest.fixtureFiles,builds.after.manifest.fixtureFiles);assert.deepEqual(builds.before.manifest.dependencies,builds.after.manifest.dependencies);
  browser=await chromium.launch({headless:true});
  for(const records of smoke?[80]:[80,800])for(let i=-1;i<(smoke?0:30);i++)for(const variant of i%2===0?['before','after']:['after','before']){
    const result=await run(records,variant,i);results.push(result);console.log(JSON.stringify({records,variant,iteration:i,marks:result.marks}));await writeFile(`.tmp/ticket-performance/rich-${label}-progress.json`,JSON.stringify(results));
  }
  const summary=[];for(const records of [80,800])for(const variant of ['before','after']){
    const runs=results.filter(r=>r.records===records&&r.variant===variant&&r.iteration>=0);if(!runs.length)continue;
    summary.push({records,variant,metrics:Object.fromEntries(runs[0].marks.map(m=>[m.name,stats(runs.map(r=>r.marks.find(x=>x.name===m.name).elapsedMs))]))});
  }
  await writeFile(`.tmp/ticket-performance/rich-${label}.json`,JSON.stringify({toolingSha,builds:Object.fromEntries(Object.entries(builds).map(([k,b])=>[k,b.manifest.digest])),browser:browser.version(),conditions:'owner; flow ON; 80/800 synthetic tickets; ticket1 with public+internal authorized attachments, labels/history; optional module APIs disabled; direct URL versus reopen versus draft refresh are separate milestones; no remote D1; same instrumentation as main comparison',summary,results},null,2),{flag:'wx'});
}finally{await browser?.close();for(const build of Object.values(builds))await build.close();}
