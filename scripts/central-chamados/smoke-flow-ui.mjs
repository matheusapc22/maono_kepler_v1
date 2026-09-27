import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=resolve(root,'docs/central-chamados/cc-09/evidence');await mkdir(evidence,{recursive:true});
const directory=await mkdtemp(resolve(tmpdir(),'cc09-ui-'));
await build({entryPoints:[resolve(root,'scripts/central-chamados/flow-ui-harness.tsx')],bundle:true,outfile:resolve(directory,'bundle.js'),jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"test"'},logLevel:'silent'});
await writeFile(resolve(directory,'index.html'),'<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script></html>');
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://local').pathname;const name=path==='/bundle.js'?'bundle.js':path==='/bundle.css'?'bundle.css':'index.html';res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(directory,name)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Sao_Paulo'});page.setDefaultTimeout(10000);
const failed=[],errors=[],requests=[],snapshots=new Map();let snapshotCounter=0,detailDelay=false;
page.on('pageerror',e=>errors.push(e.message));
page.on('requestfailed',req=>failed.push({url:req.url(),error:req.failure()?.errorText}));
const tickets=Array.from({length:250},(_,i)=>({id:i+1,organizationId:1,code:`TKT-${i+1}`,subject:`Chamado QA ${i+1}`,description:'Fixture local',status:'open',priority:'normal',category:'support',assignedTo:{id:1,name:'QA'},createdBy:{id:1,name:'QA'},createdAt:'2026-09-01T12:00:00Z',updatedAt:'2026-09-01T12:00:00Z',queueEnteredAt:'2026-09-01T12:00:00Z',dueAt:i%2?'2026-09-30T12:00:00Z':null,attachmentsCount:0,nextAction:'Conferir evidência',version:1,etag:'"qa"'}));
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname,p=url.searchParams;
 requests.push({path,page:p.get('page'),snapshot:p.get('snapshot'),queue:p.get('queue')});
 const respond=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 if(path.includes('ticket-notifications'))return respond(200,{ok:true,enabled:false});
 if(/\/tickets\/\d+$/.test(path)){
   if(path.endsWith('/999'))return respond(404,{ok:false,code:'TICKET_NOT_FOUND',error:'Indisponível'});
   if(detailDelay)await new Promise(r=>setTimeout(r,600));
   return respond(200,{ok:true,ticket:tickets[0],lifecycleEnabled:false,triageEnabled:false,events:[],attachments:[],assignees:[],attachmentLimits:{maxFiles:5,maxFileBytes:80000000,maxTicketBytes:150000000}});
 }
 if(req.method()==='POST' && path.endsWith('/attachments')){await new Promise(r=>setTimeout(r,1000));return respond(200,{ok:true,upload:{attachmentId:1,chunkSize:1024,offset:0}});}
 if(path.endsWith('/tickets')){
   const org=path.includes('/organizations/1/');let items=org?tickets:[];
   if(p.get('queue')&&p.get('queue')!=='open')items=[];
   if(p.get('q'))items=items.filter(x=>x.subject.includes(p.get('q')));
   if(p.get('status'))items=items.filter(x=>x.status===p.get('status'));
   const token=p.get('snapshot') || `local-${++snapshotCounter}`;
   if(snapshots.has(token))items=snapshots.get(token);else snapshots.set(token,items);
   const n=Number(p.get('page')||1),limit=Number(p.get('limit')||50),offset=(n-1)*limit;
   return respond(200,{ok:true,flowEnabled:true,queuePolicies:[{queue:'in_progress',wipLimit:null,version:0},{queue:'in_review',wipLimit:null,version:0}],triageEnabled:false,lifecycleEnabled:false,
    tickets:items.slice(offset,offset+limit),pagination:{page:n,limit,total:items.length,totalPages:Math.max(1,Math.ceil(items.length/limit)),hasMore:offset+limit<items.length,snapshot:token,snapshotAt:'2026-09-27T00:00:00Z'},
    facets:{byStatus:{new:0,open:items.length,in_progress:0,in_review:0,closed:0},overdue:0},assignees:[],attachmentLimits:{maxFiles:5,maxFileBytes:80000000,maxTicketBytes:150000000}});
 }
 return respond(200,{ok:true,items:[],sessions:[]});
});
const results={};
try{
 await page.goto(base);await expect(page.getByText('Página 1 de 5',{exact:false})).toBeVisible();
 for(let n=2;n<=5;n++){await page.getByRole('button',{name:'Próxima',exact:true}).click();await expect(page.getByText(`Página ${n} de 5`,{exact:false})).toBeVisible();}
 await expect(page.getByRole('button',{name:'Abrir TKT-250',exact:true})).toBeVisible();
 assert.ok(requests.filter(x=>x.page==='5').every(x=>x.snapshot));results.list250=true;
 await page.getByLabel('Visualização dos chamados').selectOption('kanban');
 const open=page.locator('.column-open');await expect(open.locator('.ticket-kanban-card')).toHaveCount(25);
 for(let n=2;n<=10;n++){if(n===2){await open.getByRole('button',{name:'Carregar mais nesta fila'}).focus();await page.keyboard.press('Enter');}else await open.getByRole('button',{name:'Carregar mais nesta fila'}).click();await expect(open.locator('.ticket-kanban-card')).toHaveCount(n*25);}
 results.kanban250=true;
 await page.getByPlaceholder('Código, assunto ou descrição').fill('Chamado QA 250');await expect(open.locator('.ticket-kanban-card')).toHaveCount(1);
 assert.equal(new URL(page.url()).searchParams.get('cc_q'),'Chamado QA 250');
 await page.getByLabel('Visualização dos chamados').selectOption('calendar');await expect(page.locator('.ticket-calendar')).toBeVisible();
 assert.equal(new URL(page.url()).searchParams.get('cc_q'),'Chamado QA 250');
 await page.goBack();await expect(page.getByLabel('Visualização dos chamados')).toHaveValue('kanban');
 await page.reload();await expect(page.getByPlaceholder('Código, assunto ou descrição')).toHaveValue('Chamado QA 250');results.urlBackReload=true;
 await page.goto(`${base}?cc_org=1&cc_ticket=999`);await expect(page.getByText('O chamado não está mais disponível para seu acesso.')).toBeVisible();results.deniedDeepLink=true;
 detailDelay=true;await page.goto(`${base}?cc_org=1&cc_ticket=1`);await page.getByRole('button',{name:'Trocar organização QA'}).dispatchEvent('click');await expect(page.getByText('Organização ativa: QA 2')).toBeAttached();await page.waitForTimeout(750);await expect(page.locator('.ticket-drawer-overlay')).toHaveCount(0);assert.equal(new URL(page.url()).searchParams.get('cc_ticket'),null);results.staleDetailDiscarded=true;
 detailDelay=false;await page.goto(`${base}?cc_org=1&cc_ticket=1`);
 await expect(page.locator('.ticket-attachments input[type=file]').first()).toBeAttached();
 const started=page.waitForRequest(req=>req.method()==='POST'&&req.url().endsWith('/attachments'));
 await page.locator('.ticket-attachments input[type=file]').first().setInputFiles({name:'cc09-qa.txt',mimeType:'text/plain',buffer:Buffer.from('QA somente local')});
 await started;await page.getByRole('button',{name:'Trocar organização QA'}).dispatchEvent('click');
 await expect.poll(()=>failed.some(x=>x.url.endsWith('/attachments')&&x.error?.includes('ABORTED'))).toBe(true);
 assert.equal(requests.some(x=>x.path.includes('/organizations/2/')&&x.path.includes('/attachments')),false);results.uploadScopeAbort=true;results.keyboardPagination=true;
 await page.goto(`${base}?cc_org=1&cc_view=kanban`);await expect(page.locator('.column-open .ticket-kanban-card')).toHaveCount(25);
 await page.screenshot({path:resolve(evidence,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.getByLabel('Visualização dos chamados').selectOption('calendar');await expect(page.locator('.ticket-calendar')).toBeVisible();await page.screenshot({path:resolve(evidence,'mobile.png'),fullPage:true});results.mobileCalendar=true;
 assert.deepEqual(errors,[]);
 await writeFile(resolve(evidence,'ui-smoke.json'),JSON.stringify({localOnly:true,authenticatedAcceptance:false,results,errors},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
