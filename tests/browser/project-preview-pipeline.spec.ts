import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import { readFileSync } from 'node:fs';
let bundle='';
const styles=['src/pages/Projects/projects.css','src/pages/Projects/components/ProjectPages.css','src/pages/Projects/components/project-cards.css','src/pages/Projects/components/project-card-interactions.css'].map(path=>readFileSync(path,'utf8')).join('\n');
test.beforeAll(async()=>{
  const built=await build({entryPoints:['tests/browser/fixtures/project-preview-pipeline.tsx'],bundle:true,write:false,format:'iife',globalName:'previewFixture',platform:'browser',jsx:'automatic',loader:{'.css':'empty','.png':'dataurl'},
    define:{'import.meta.env':JSON.stringify({DEV:false,PROD:false,VITE_PROJECT_PREVIEW_TRANSITION_V2:'true'})},plugins:[{name:'navigation-boundary',setup(plugin){
      plugin.onResolve({filter:/route-modules$/},()=>({path:'route-modules',namespace:'fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const preloadRouteModule = async () => undefined;',loader:'js'}));
    }}]});bundle=built.outputFiles[0].text;
});
async function load(page:any){
  // A routed local fixture origin gives actual persistent IDB without an external server.
  await page.route('http://localhost/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body><main id="root" class="mm-projects-content mm-project-pages"></main></body></html>'}));
  await page.goto('http://localhost/');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle});
}
test.beforeEach(async({page})=>load(page));
test('PNG bytes survive reload in real IndexedDB on every engine',async({page})=>{
  const first=await page.evaluate(async()=>{const f=(window as any).previewFixture;const record=await f.makeRecord();await f.spool.defaultPreviewSpool.put(record);return {key:record.key,hash:record.manifest.imageChecksum,size:record.blob.size}});
  await load(page);
  const resumed=await page.evaluate(async()=>{const f=(window as any).previewFixture;const rows=await f.spool.defaultPreviewSpool.list('3','7');return {length:rows.length,key:rows[0].key,hash:await f.contract.hashPreviewBlob(rows[0].blob),size:rows[0].blob.size}});
  expect(resumed).toEqual({length:1,...first});
});
test('staged PNG survives JSON cleanup and reload, then binds before precursor is removed',async({page})=>{
  await page.evaluate(async()=>{const f=(window as any).previewFixture;const r=await f.makeRecord();const m=r.manifest;const staged={key:JSON.stringify(['3','7',m.saveOperationId]),actorId:'3',organizationId:'7',saveOperationId:m.saveOperationId,editorSessionId:m.editorSessionId,editGeneration:m.editGeneration,rendererVersion:m.rendererVersion,blob:r.blob,imageChecksum:m.imageChecksum,captureMethod:m.captureMethod,createdAt:r.createdAt,expiresAt:r.expiresAt};await f.spool.defaultPreviewSpool.stage(staged);sessionStorage.setItem('stagedSaveId',m.saveOperationId)});
  await load(page);
  const result=await page.evaluate(async()=>{const f=(window as any).previewFixture;const id=sessionStorage.getItem('stagedSaveId');const s=await f.spool.defaultPreviewSpool.staged('3','7',id);
    const snapshot={scope:{actorId:'3',organizationId:'7',projectId:'19'},projectSlug:'synthetic',manifest:{operationId:id,contentHash:'a'.repeat(64)},editorSessionId:s.editorSessionId,editGeneration:s.editGeneration,serialized:{body:null}};
    const receipt={operationId:id,organizationId:7,projectId:19,publishedRevision:2,checksum:'a'.repeat(64),checksumAlgorithm:'dropbox-content-hash'};
    const record=await f.recovery.bindCapturedPreview(snapshot,{receipt},s);return {rows:(await f.spool.defaultPreviewSpool.list('3','7')).length,staged:await f.spool.defaultPreviewSpool.staged('3','7',id),hash:await f.contract.hashPreviewBlob(record.blob),expected:s.imageChecksum}});
  expect(result.rows).toBe(1);expect(result.staged).toBeNull();expect(result.hash).toBe(result.expected);
});
test('account/organization isolation, short expiry and logout cleanup cover staged and bound PNGs',async({page})=>{
  const result=await page.evaluate(async()=>{const f=(window as any).previewFixture;const a=await f.makeRecord(), b=await f.makeRecord('other','7');await f.spool.defaultPreviewSpool.put(a);await f.spool.defaultPreviewSpool.put(b);
    const isolated=(await f.spool.defaultPreviewSpool.list('3','8')).length;await f.spool.defaultPreviewSpool.clearAccount('3');
    const remaining=(await f.spool.defaultPreviewSpool.list('3','7')).length;const other=(await f.spool.defaultPreviewSpool.list('other','7')).length;
    b.expiresAt=Date.now()-1;await f.spool.defaultPreviewSpool.put(b);return{isolated,remaining,other,expired:(await f.spool.defaultPreviewSpool.list('other','7')).length,retention:f.spool.PREVIEW_SPOOL_RETENTION_MS}});
  expect(result).toEqual({isolated:0,remaining:0,other:1,expired:0,retention:86400000});
});
test('same operation cannot replace its bytes or extend its retention',async({page})=>{
  const result=await page.evaluate(async()=>{const f=(window as any).previewFixture;const record=await f.makeRecord();await f.spool.defaultPreviewSpool.put(record);let refused=false;
    try{await f.spool.defaultPreviewSpool.put({...record,manifest:{...record.manifest,imageChecksum:'b'.repeat(64)}})}catch{refused=true}
    await f.spool.defaultPreviewSpool.put({...record,createdAt:record.createdAt+5000,expiresAt:record.expiresAt+5000});
    const stored=(await f.spool.defaultPreviewSpool.list('3','7'))[0];return{refused,sameExpiry:stored.expiresAt===record.expiresAt,hash:await f.contract.hashPreviewBlob(stored.blob),expected:record.manifest.imageChecksum}});
  expect(result.refused).toBe(true);expect(result.sameExpiry).toBe(true);expect(result.hash).toBe(result.expected);
});
test('no-capturer status is stable in all three actual project sections; focus remains usable',async({page})=>{
  await page.evaluate(()=>{const f=(window as any).previewFixture;f.renderCards([{id:19,slug:'synthetic',name:'Mapa sintético',organizationId:7,thumbnailStatus:'PENDING',jobState:'WAITING_CAPTURE',configRevision:2,thumbnailRevision:null,description:'Fixture',favorite:true}])});
  for(const tab of ['Todos os Projetos','Recentes','Favoritos']){
    await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.locator('[data-preview-state="missing-neutral"]')).toBeVisible();await expect(page.locator('[data-preview-status="PENDING"]')).toHaveCount(0);
    const card=page.getByRole('link',{name:/Mapa sintético/});await card.focus();await expect(card).toBeFocused();
  }
});
test('immutable artifact changes decode new PNG in all tabs and preserve a previous image on failed generation',async({page})=>{
  const png=await page.evaluate(async()=>{const r=await (window as any).previewFixture.makeRecord();return Array.from(new Uint8Array(await r.blob.arrayBuffer()))});
  await page.route('**/api/projects/synthetic/thumbnail?*',route=>route.fulfill({contentType:'image/png',body:Buffer.from(png)}));
  const project={id:19,slug:'synthetic',name:'Mapa sintético',organizationId:7,thumbnailStatus:'READY',artifactId:'artifact-one',jobState:'READY',configRevision:2,thumbnailRevision:2,description:'Fixture',favorite:true};
  await page.evaluate(p=>(window as any).previewFixture.renderCards([p]),project);
  for(const tab of ['Todos os Projetos','Recentes','Favoritos']){await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.locator('.mm-project-card__preview img.is-loaded')).toHaveCount(1)}
  await page.evaluate(p=>(window as any).updatePreviewFixture([{...p,artifactId:'artifact-two'}]),project);
  await expect(page.locator('.mm-project-card__preview img.is-loaded')).toHaveAttribute('src',/artifactId=artifact-two/);
  await page.evaluate(p=>(window as any).updatePreviewFixture([{...p,artifactId:'artifact-two',thumbnailStatus:'FAILED',jobState:'FAILED_FINAL',configRevision:3}]),project);
  await expect(page.locator('.mm-project-card__preview img.is-loaded')).toHaveAttribute('src',/artifactId=artifact-two/);
});

test('full 32MiB spool promotes its staged PNG atomically without charging duplicate quota',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=(window as any).previewFixture, store=f.spool.defaultPreviewSpool;
    const payload=new Blob([new Uint8Array(4*1024*1024)],{type:'image/png'}), checksum=await f.contract.hashPreviewBlob(payload);
    for(let i=0;i<7;i++){const r=await f.makeRecord();r.blob=payload;r.manifest.sizeBytes=payload.size;r.manifest.imageChecksum=checksum;await store.put(r)}
    const r=await f.makeRecord();r.blob=payload;r.manifest.sizeBytes=payload.size;r.manifest.imageChecksum=checksum;
    const m=r.manifest,key=JSON.stringify(['3','7',m.saveOperationId]);
    await store.stage({key,actorId:'3',organizationId:'7',saveOperationId:m.saveOperationId,editorSessionId:m.editorSessionId,editGeneration:m.editGeneration,rendererVersion:m.rendererVersion,blob:payload,imageChecksum:checksum,captureMethod:m.captureMethod,createdAt:r.createdAt,expiresAt:r.expiresAt});
    await store.promote(r,key);return {count:(await store.list('3','7')).length,stage:await store.staged('3','7',m.saveOperationId)};
  });expect(result).toEqual({count:8,stage:null});
});
test('logout guard prevents a delayed promotion from restoring cleared private PNG bytes',async({page})=>{
  const result=await page.evaluate(async()=>{const f=(window as any).previewFixture,r=await f.makeRecord(),m=r.manifest,store=f.spool.defaultPreviewSpool,key=JSON.stringify(['3','7',m.saveOperationId]);
    await store.stage({key,actorId:'3',organizationId:'7',saveOperationId:m.saveOperationId,editorSessionId:m.editorSessionId,editGeneration:m.editGeneration,rendererVersion:m.rendererVersion,blob:r.blob,imageChecksum:m.imageChecksum,captureMethod:m.captureMethod,createdAt:r.createdAt,expiresAt:r.expiresAt});
    let current=true;const result=store.promote(r,key,()=>current).then(()=> 'unexpected-success',(error:any)=>error.name);current=false;await store.clearAccount('3');
    return {outcome:await result,count:(await store.list('3','7')).length,stage:await store.staged('3','7',m.saveOperationId)};
  });expect(result).toEqual({outcome:'AbortError',count:0,stage:null});
});
test('regular recovery sweeps an expired staged PNG even if its JSON never confirmed',async({page})=>{
  const count=await page.evaluate(async()=>{const f=(window as any).previewFixture,r=await f.makeRecord(),m=r.manifest;await f.spool.defaultPreviewSpool.stage({key:JSON.stringify(['3','7',m.saveOperationId]),actorId:'3',organizationId:'7',saveOperationId:m.saveOperationId,editorSessionId:m.editorSessionId,editGeneration:m.editGeneration,rendererVersion:m.rendererVersion,blob:r.blob,imageChecksum:m.imageChecksum,captureMethod:m.captureMethod,createdAt:Date.now()-100000,expiresAt:Date.now()-1});
    await f.spool.defaultPreviewSpool.list('3','7');return new Promise<number>((resolve,reject)=>{const open=indexedDB.open(f.spool.PREVIEW_SPOOL_DATABASE);open.onsuccess=()=>{const db=open.result,tx=db.transaction('staged'),request=tx.objectStore('staged').count();tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>reject(tx.error)}});
  });expect(count).toBe(0);
});
test('neutral WAITING_CAPTURE cards discover a later READY operation without remounting',async({page})=>{
  const png=await page.evaluate(async()=>Array.from(new Uint8Array(await(await (window as any).previewFixture.makeRecord()).blob.arrayBuffer())));
  let queries=0;
  await page.route('**/api/projects/synthetic/thumbnail/status',route=>{queries++;return route.fulfill({json:{ok:true,thumbnailStatus:'READY',jobState:'READY',artifactId:'resumed-artifact',configRevision:2,thumbnailRevision:2,thumbnailAttempts:1}})});
  await page.route('**/api/projects/synthetic/thumbnail?*',route=>route.fulfill({contentType:'image/png',body:Buffer.from(png)}));
  await page.clock.install();
  await page.evaluate(()=>(window as any).previewFixture.renderCards([{id:19,slug:'synthetic',name:'Mapa sintético',organizationId:7,thumbnailStatus:'PENDING',jobState:'WAITING_CAPTURE',configRevision:2,thumbnailRevision:null,description:'Fixture'}]));
  await expect(page.locator('[data-preview-state="missing-neutral"]')).toBeVisible();await expect(page.locator('[data-preview-status="PENDING"]')).toHaveCount(0);
  await page.clock.fastForward(16000);await page.locator('.mm-project-card').scrollIntoViewIfNeeded();
  await expect(page.locator('.mm-project-card__preview img')).toHaveAttribute('src',/artifactId=resumed-artifact/);expect(queries).toBe(1);
});

test('card image failures distinguish session expiration from confirmed missing bytes',async({page})=>{
  let status=401;await page.route('**/api/projects/synthetic/thumbnail?*',route=>route.fulfill({status,json:{error:{code:status===401?'SESSION_INVALID':'PROJECT_THUMBNAIL_NOT_FOUND'}}}));
  const project={id:19,slug:'synthetic',name:'Mapa sintético',organizationId:7,thumbnailStatus:'READY',artifactId:'artifact-session',jobState:'READY',configRevision:2,thumbnailRevision:2};
  await page.evaluate(p=>(window as any).previewFixture.renderCards([p]),project);await page.locator('.mm-project-card').scrollIntoViewIfNeeded();
  await expect(page.locator('.mm-project-card__preview')).toHaveAttribute('data-preview-error','session');
  status=404;await page.evaluate(p=>(window as any).updatePreviewFixture([{...p,artifactId:'artifact-missing'}]),project);
  await expect(page.locator('.mm-project-card__preview')).toHaveAttribute('data-preview-error','missing');
  await expect(page.locator('[data-preview-state="failed-neutral"]')).toBeVisible();
});
