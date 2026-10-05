import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { previewMime, validatePreviewBytes, loadDocumentPreview, MAX_PREVIEW_BYTES, DocumentPreviewError, previewErrorPresentation } from '../src/lib/document-preview.ts';
import { readPreviewText, MAX_PREVIEW_TEXT_CHARS } from '../src/lib/document-preview-text.ts';
import { restoreDocumentPreview } from './helpers/document-preview-preservation.mjs';
const bytes = name => new Uint8Array(readFileSync(new URL(`./fixtures/document-preview/${name}`, import.meta.url)));
const file = { id: 12, name: 'map.png', size: 1, mimeType: 'image/png' };
function mockFetch(t, handler) { const original = globalThis.fetch; globalThis.fetch = handler; t.after(() => { globalThis.fetch = original; }); }
test('preview integration preserves every unrelated controller line', () => {
 const current = readFileSync(new URL('../src/pages/Projects/components/DocumentsSection.tsx', import.meta.url), 'utf8');
 // Exact original file at 83ba80d; independent of shallow CI checkout history.
 const expected = '73d9ec1cb5be7e44805ae6b93a25f616c0721ea44760b52713b34a7e282206dc';
 assert.equal(createHash('sha256').update(restoreDocumentPreview(current)).digest('hex'), expected);
});
test('extension, declared MIME and byte signatures must agree; no active content', () => {
 for (const name of ['file.svg','file.html','file.docx','file.xlsx','file.json','file.pdf.html','file.constructor','file.__proto__','pdf']) assert.throws(() => previewMime({...file,name}), {code:'unsupported'});
 assert.throws(() => previewMime({...file,mimeType:'text/html'}),{code:'invalid'});
 assert.throws(() => previewMime({...file,size:MAX_PREVIEW_BYTES+1}),{code:'too-large'});
 assert.throws(() => validatePreviewBytes(new TextEncoder().encode('<svg onload="x()">'), 'image/png'),{code:'invalid'});
 assert.throws(() => validatePreviewBytes(bytes('area-map.png'),'application/pdf'),{code:'invalid'});
 for (const [name,mime] of [['area-map.png','image/png'],['area-map.jpg','image/jpeg'],['area-map.webp','image/webp'],['market-report.pdf','application/pdf']]) {
  const result = validatePreviewBytes(bytes(name),mime); assert.equal(result.blob.type,mime); assert.ok(result.blob.size>0);
  if(result.kind==='image') assert.deepEqual([result.width,result.height],[1000,640]);
 }
});
test('image dimensions and bytes are capped before browser decode', () => {
 const png = bytes('area-map.png');new DataView(png.buffer).setUint32(16,12001);
 assert.throws(()=>validatePreviewBytes(png,'image/png'),{code:'too-large'});
 const webp=bytes('area-map.webp');webp.set(new TextEncoder().encode('VP8X'),12);webp[20]=2;
 assert.throws(()=>validatePreviewBytes(webp,'image/webp'),{code:'invalid'});
 assert.throws(()=>validatePreviewBytes(new Uint8Array(MAX_PREVIEW_BYTES+1),'image/png'),{code:'too-large'});
});
test('authenticated no-store streaming reports actual bytes without invented totals', async t => {
 const data=bytes('area-map.png');let options;let url;
 mockFetch(t,async (u,o)=>{url=u;options=o;return new Response(new ReadableStream({start(c){c.enqueue(data.slice(0,20));c.enqueue(data.slice(20));c.close();}}),{headers:{'Content-Type':'image/png'}});});
 const progress=[];const result=await loadDocumentPreview('org/a',file,new AbortController().signal,p=>progress.push(p));
 assert.equal(url,'/api/organizations/org%2Fa/files/12/download');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
 assert.equal(progress.at(-1).loaded,data.length);assert.ok(progress.every(p=>p.total===null));assert.equal(result.blob.size,data.length);
});
test('stops oversized streams even without trusted metadata/content length', async t => {
 let cancelled=false;
 mockFetch(t,async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(MAX_PREVIEW_BYTES+1));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'image/png'}}));
 await assert.rejects(loadDocumentPreview(1,file,new AbortController().signal,()=>{}),{code:'too-large'});assert.equal(cancelled,true);
});
test('rejects declared oversized responses and MIME confusion without reading contents', async t => {
 for(const headers of [{'Content-Type':'text/html'},{'Content-Type':'image/png','Content-Length':String(MAX_PREVIEW_BYTES+1)}]) {
  let cancelled=false;mockFetch(t,async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers}));
  await assert.rejects(loadDocumentPreview(1,file,new AbortController().signal,()=>{}),{code:headers['Content-Length']?'too-large':'invalid'});assert.equal(cancelled,true);
 }
});
test('access denied and unavailable are explicit without reflecting server/private error bodies',async t=>{
 for(const status of [401,403,404,410,503]) {
  mockFetch(t,async()=>new Response('secret internal stack',{status}));
  await assert.rejects(loadDocumentPreview(1,file,new AbortController().signal,()=>{}),e=>e.code===(status===401||status===403?'access':status===404||status===410?'unavailable':'network')&&!e.message.includes('secret'));
 }
});
test('unsupported/large metadata and already aborted requests do not fetch',async t=>{
 let calls=0;mockFetch(t,async()=>{calls++;throw Error('unexpected');});
 for(const f of [{...file,name:'file.docx'},{...file,size:MAX_PREVIEW_BYTES+1}]) await assert.rejects(loadDocumentPreview(1,f,new AbortController().signal,()=>{}));
 const controller=new AbortController();controller.abort();await assert.rejects(loadDocumentPreview(1,file,controller.signal,()=>{}),{name:'AbortError'});assert.equal(calls,0);
});
test('closing while a request is pending aborts transport, does not return stale bytes',async t=>{
 let transport;mockFetch(t,(_u,o)=>new Promise((_resolve,reject)=>{transport=o.signal;o.signal.addEventListener('abort',()=>reject(o.signal.reason));}));
 const controller=new AbortController();const loading=loadDocumentPreview(1,file,controller.signal,()=>{});controller.abort();await assert.rejects(loading,{name:'AbortError'});assert.equal(transport.aborted,true);
});
test('preview network deadline aborts the underlying request with a retryable presentation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal;
 mockFetch(t,(_url,options)=>new Promise((_resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(signal.reason));}));
 const pending=loadDocumentPreview(1,file,new AbortController().signal,()=>{});t.mock.timers.tick(120_000);
 await assert.rejects(pending,e=>e.code==='network'&&/demorou/.test(e.message));assert.equal(signal.aborted,true);
});
test('PDF core, worker and private resource bundle stay version-aligned without scripting resources',()=>{
 const root=new URL('../',import.meta.url);const version=JSON.parse(readFileSync(new URL('package.json',root),'utf8')).dependencies['pdfjs-dist'];
 const renderer=readFileSync(new URL('src/pages/Projects/components/DocumentPdfPreview.tsx',root),'utf8');const plugin=readFileSync(new URL('scripts/vite/pdf-preview-assets.ts',root),'utf8');
 assert.ok(renderer.includes(`/assets/pdfjs-${version}/`));assert.ok(plugin.includes(`assets/pdfjs-${version}/`));assert.ok(renderer.includes('pdfjs-dist/legacy/build/pdf.mjs'));assert.ok(renderer.includes('pdfjs-dist/legacy/build/pdf.worker.mjs?url'));
 assert.doesNotMatch(plugin,/quickjs|sandbox/);assert.ok(plugin.includes('openjpeg_nowasm_fallback.js'));assert.ok(plugin.includes('jbig2_nowasm_fallback.js'));
});

test('preview presentation never renders exception messages or unknown reason fields',()=>{
 const failure=new DocumentPreviewError('access');failure.message='SECRET FROM PROVIDER';
 assert.equal(previewErrorPresentation(failure).code,'access');assert.doesNotMatch(previewErrorPresentation(failure).message,/SECRET/);
 for(const value of [new Error('SECRET'),{reason:'access',message:'SECRET'},null]) assert.equal(previewErrorPresentation(value).code,'network');
 failure.reason='constructor';assert.equal(previewErrorPresentation(failure).code,'network');
 assert.match(previewErrorPresentation(new DocumentPreviewError('reader-load')).message,/Atualize a página/);
});

test('PDF text extraction supports WebKit streams without async iteration',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue({items:[{str:'Texto'},{type:'beginMarkedContent'},{str:'acessível'}]});c.close();}});
 Object.defineProperty(stream,Symbol.asyncIterator,{value:undefined});
 assert.equal(await readPreviewText(stream,new AbortController().signal),'Texto acessível');assert.equal(stream.locked,false);
});
test('PDF text extraction stops and cancels at its character budget',async()=>{
 let cancelled=false;let reads=0;
 const stream=new ReadableStream({pull(c){reads++;c.enqueue({items:[{str:'x'.repeat(60_000)}]});},cancel(reason){assert.ok(reason instanceof Error);cancelled=true;}});
 assert.equal((await readPreviewText(stream,new AbortController().signal)).length,MAX_PREVIEW_TEXT_CHARS);assert.equal(cancelled,true);assert.ok(reads<=3);assert.equal(stream.locked,false);
});
test('PDF text extraction aborts a pending reader and releases its lock',async()=>{
 let cancelled=false;const stream=new ReadableStream({cancel(reason){assert.ok(reason instanceof Error);cancelled=true;}});const controller=new AbortController();
 const loading=readPreviewText(stream,controller.signal);controller.abort();await assert.rejects(loading,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(stream.locked,false);
});
test('PDF optional-text failures cannot enter the raster failure handler',()=>{
 const source=readFileSync(new URL('../src/pages/Projects/components/DocumentPdfPreview.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/page\.getTextContent\(/);assert.match(source,/catch \{\s*if \(active\) setTextUnavailable\(true\);/);assert.match(source,/readPreviewText\(page\.streamTextContent\(\), textController\.signal\)/);
});

test('preview removes the marked labels and text disclosure while retaining accessible PDF text',()=>{
 const dialog=readFileSync(new URL('../src/pages/Projects/components/DocumentPreviewDialog.tsx',import.meta.url),'utf8');
 const pdf=readFileSync(new URL('../src/pages/Projects/components/DocumentPdfPreview.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/pages/Projects/components/DocumentPreviewDialog.css',import.meta.url),'utf8');
 assert.doesNotMatch(dialog,/PDF e imagens|leitura segura|Arquivo original preservado|descriptionId|summary/);
 assert.doesNotMatch(pdf,/<details|<summary|Texto desta página|Texto disponível abaixo|mm-preview-page-text|mm-preview-text-fallback/);
 assert.doesNotMatch(css,/mm-preview-page-text|mm-preview-text-fallback|summary/);
 assert.match(pdf,/aria-describedby=\{pageText \|\| textUnavailable \? textId : undefined\}/);
 assert.match(pdf,/<p id=\{textId\} className="mm-preview-sr-only">/);
 assert.match(css,/\.mm-preview-sr-only \{[^}]*position: absolute;[^}]*clip-path: inset\(50%\);/);
 for(const label of ['Diminuir zoom','Ajustar à largura','Aumentar zoom','Baixar original','Esc para fechar']) assert.ok(dialog.includes(label));
 for(const label of ['Página anterior','Próxima página']) assert.ok(pdf.includes(label));
});

test('PDF text cap releases its lock without waiting for a stalled worker cancellation ack',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue({items:[{str:'x'.repeat(MAX_PREVIEW_TEXT_CHARS)}]});},cancel(reason){assert.ok(reason instanceof Error);return new Promise(()=>{});}});
 const result=await readPreviewText(stream,new AbortController().signal);assert.equal(result.length,MAX_PREVIEW_TEXT_CHARS);assert.equal(stream.locked,false);
});
