import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fixture } from './benchmark-read-paths.mjs';
import { loadPerformanceUiBuild } from './performance-ui-build.mjs';

const [directory,label,expected='fixed']=process.argv.slice(2);assert.match(label||'',/^[a-z][a-z0-9-]*$/);assert.ok(['fixed','known-bug'].includes(expected));
const build=await loadPerformanceUiBuild(directory),f=await fixture(80,true,0);f.setHandlers(build.handlers);
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000},locale:'pt-BR'});
let release,originalSnapshot=null,failed=false;const held=new Promise(resolve=>{release=resolve;}),requests=[],errors=[];
const optional={ok:true,enabled:false,schemaReady:true,projects:[],files:[],folders:[],tickets:[],users:[],items:[],jobs:[],unread:0,facets:{types:[],projects:[],folderCounts:[]},pagination:{total:0,hasMore:false}};
const session={authenticated:true,user:{id:1,name:'Synthetic operator',role:'owner',activeOrganizationId:1,permissions:[],deniedPermissions:[]},projects:[],organizations:[{id:1,name:'Synthetic',slug:'synthetic',active:true}],activeOrganization:{id:1,name:'Synthetic',slug:'synthetic',active:true}};
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
  assert.equal(route.request().method(),'GET');let data=url.pathname==='/api/session'?session:optional;
  if(url.pathname==='/api/organizations/1/tickets'){
    const queue=url.searchParams.get('queue'),snapshot=url.searchParams.get('snapshot');if(queue)requests.push({queue,reusesOriginal:snapshot===originalSnapshot,hasSnapshot:!!snapshot});
    const result=await f.request('list',url.searchParams.toString(),'owner');data=result.data;
    if(!queue)originalSnapshot=data.pagination.snapshot;
    if(queue&&snapshot===originalSnapshot&&['in_progress','in_review'].includes(queue))await held;
    if(queue==='open'&&!failed){failed=true;return route.fulfill({status:503,json:{ok:false,error:{code:'SERVICE_UNAVAILABLE',category:'INFRASTRUCTURE',retryable:true}}});}
  }
  await route.fulfill({status:200,json:data,headers:{'Cache-Control':'private, no-store'}});
});
try{
  await page.goto(`${build.origin}/projects?cc_org=1&cc_view=list`);await page.locator('.ticket-list-table tbody tr').first().waitFor();
  const second=page.waitForRequest(r=>new URL(r.url()).searchParams.get('queue')==='in_progress');
  const third=page.waitForRequest(r=>new URL(r.url()).searchParams.get('queue')==='in_review');
  await page.getByRole('combobox',{name:'Visualização dos chamados',exact:true}).click();await page.getByRole('listbox').getByRole('option',{name:'Kanban',exact:true}).click();
  const oldRequests=await Promise.all([second,third]);await page.getByRole('alert').first().waitFor();assert.equal(requests.length,3);
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.ticket-kanban-stack').length===4&&[...document.querySelectorAll('.ticket-kanban-stack')].every(e=>e.getAttribute('aria-busy')==='false'&&e.querySelector('.ticket-kanban-subject')));
  release();for(const request of oldRequests)assert.equal(await request.response(),null);
  await page.waitForTimeout(100);
  const staleClosed=requests.filter(r=>r.queue==='closed'&&r.reusesOriginal).length;
  assert.equal(staleClosed,expected==='known-bug'?1:0);
  if(expected==='fixed'){assert.equal(requests.length,7);assert.equal(await page.getByRole('alert').count(),0);}
  assert.deepEqual(errors,[]);
  const result={sourceSha:build.manifest.sourceSha,manifestDigest:build.manifest.digest,expected,staleClosedRequests:staleClosed,requests,passed:true};
  await writeFile(`.tmp/ticket-performance/retry-check-${label}.json`,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}finally{release();await browser.close();await f.close();await build.close();}
