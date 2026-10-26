import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fixture } from './benchmark-read-paths.mjs';
import { loadPerformanceUiBuild } from './performance-ui-build.mjs';

const [directory,label,expected='parallel']=process.argv.slice(2);
assert.match(label||'',/^[a-z][a-z0-9-]*$/);
assert.ok(['serial','parallel'].includes(expected));
const build=await loadPerformanceUiBuild(directory),browser=await chromium.launch({headless:true}),results=[];
const optional={ok:true,enabled:false,schemaReady:true,projects:[],files:[],folders:[],tickets:[],users:[],items:[],jobs:[],unread:0,nextCursor:null,facets:{types:[],projects:[],folderCounts:[]},pagination:{total:0,hasMore:false}};
const session={authenticated:true,user:{id:1,name:'Synthetic operator',role:'owner',activeOrganizationId:1,permissions:[],deniedPermissions:[]},projects:[],organizations:[{id:1,name:'Synthetic',slug:'synthetic',active:true}],activeOrganization:{id:1,name:'Synthetic',slug:'synthetic',active:true}};
async function check(cold,status=200){
  const f=await fixture(80,true,0);f.setHandlers(build.handlers);
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'pt-BR',timezoneId:'UTC',serviceWorkers:'block'}),page=await context.newPage();
  let release,held=false,token=null;const gate=new Promise(resolve=>{release=resolve;}),requests=[],errors=[],authorizedCards=new Map();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    assert.equal(route.request().method(),'GET');
    let data=url.pathname==='/api/session'?session:optional;
    if(url.pathname==='/api/organizations/1/tickets'){
      const queue=url.searchParams.get('queue');requests.push({queue,snapshot:url.searchParams.get('snapshot')});
      const result=await f.request('list',url.searchParams.toString(),'owner');data=result.data;
      for(const ticket of data.tickets)authorizedCards.set(ticket.code,ticket.subject);
      if(!queue)token=data.pagination.snapshot;
      if(queue==='open'){held=true;await gate;if(status!==200)return route.fulfill({status,json:{ok:false,error:{code:status===409?'TICKET_QUERY_EXPIRED':status===401?'AUTH_REQUIRED':'AUTH_PERMISSION_DENIED',category:status===409?'INFRASTRUCTURE':'AUTH',retryable:false}}});}
    }
    await route.fulfill({status:200,json:data,headers:{'Cache-Control':'private, no-store'}});
  });
  try{
    await page.goto(`${build.origin}/projects?cc_org=1&cc_view=${cold?'kanban':'list'}`);
    if(!cold){
      await page.locator('.ticket-list-table tbody tr').first().waitFor();
      assert.ok(token);
      await page.getByRole('combobox',{name:'Visualização dos chamados',exact:true}).click();
      await page.getByRole('listbox').getByRole('option',{name:'Kanban',exact:true}).click();
    }
    await page.waitForFunction(()=>document.querySelectorAll('.ticket-kanban-stack').length===4);
    for(let i=0;i<20&&!held;i++)await page.waitForTimeout(25);
    assert.equal(held,true);
    let siblingsReady=false;
    try{await page.waitForFunction(()=>['in_progress','in_review','closed'].every(q=>document.querySelector(`.column-${q} .ticket-kanban-stack`)?.getAttribute('aria-busy')==='false'&&document.querySelector(`.column-${q} .ticket-kanban-card`)),null,{timeout:cold||expected==='serial'?500:5000});siblingsReady=true;}catch(error){if(error.name!=='TimeoutError')throw error;}
    assert.equal(siblingsReady,!cold&&expected==='parallel');
    if(cold){
      assert.equal(await page.locator('.ticket-kanban-card.mm-loading-ticket-card').first().isVisible(),true,'negative control exposes the old visible skeleton selector');
      assert.equal(await page.locator('.ticket-kanban-card:not(.mm-loading-ticket-card) .ticket-kanban-subject').count(),0,'authorized-content selector must not match a skeleton');
    }
    const visibleCards=await page.locator('.ticket-kanban-card:not(.mm-loading-ticket-card)').evaluateAll(cards=>cards.filter(card=>card.querySelector('.ticket-kanban-subject')).map(card=>({code:card.querySelector('.ticket-kanban-card-topline strong')?.textContent?.trim(),subject:card.querySelector('.ticket-kanban-subject')?.textContent?.trim()})));
    for(const card of visibleCards){assert.ok(authorizedCards.has(card.code),'visible card must have an authorized backend response');assert.equal(card.subject,authorizedCards.get(card.code),'visible title must be real authorized content, never placeholder text');}
    const beforeRelease=requests.filter(r=>r.queue);
    assert.equal(beforeRelease.length,cold||expected==='serial'?1:4);
    if(!cold)assert.ok(beforeRelease.every(r=>r.snapshot===token));
    const snapshotsBeforeRelease=f.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket_query_snapshots').get().n;
    release();
    if(status===200)await page.waitForFunction(()=>[...document.querySelectorAll('.ticket-kanban-stack')].length===4&&[...document.querySelectorAll('.ticket-kanban-stack')].every(e=>e.getAttribute('aria-busy')==='false'));
    else{
      await page.getByRole('alert').first().waitFor();
      if(status!==409)await page.waitForFunction(()=>document.querySelectorAll('.ticket-kanban-card').length===0);
      else assert.equal(await page.locator('.column-in_progress .ticket-kanban-card').count()>0,true);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(requests.filter(r=>r.queue).length,4,'no silent fresh snapshot retry');
    }
    assert.deepEqual(errors,[]);
    results.push({cold,status,expected,siblingsReady,queuesBeforeRelease:beforeRelease.map(r=>r.queue),allReusedExistingToken:!cold&&beforeRelease.every(r=>r.snapshot===token),snapshotsBeforeRelease,semanticAuthorizedCards:visibleCards.length,skeletonNegativeControl:cold,passed:true});
  }finally{release();await context.close();await f.close();}
}
try{
  await check(false);await check(true);
  if(expected==='parallel')for(const status of [401,403,404,409])await check(false,status);
  await writeFile(`.tmp/ticket-performance/snapshot-check-${label}.json`,JSON.stringify({sourceSha:build.manifest.sourceSha,manifestDigest:build.manifest.digest,results},null,2));
  console.log(JSON.stringify(results));
}finally{await browser.close();await build.close();}
