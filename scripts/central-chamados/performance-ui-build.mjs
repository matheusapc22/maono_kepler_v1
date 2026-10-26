import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadPerformanceUiBuild(directory) {
  const root=path.resolve('.tmp/ticket-performance/ui'),build=path.resolve(directory);
  assert.ok(path.relative(root,build)&&!path.relative(root,build).startsWith('..')&&!path.isAbsolute(path.relative(root,build)),'build must be inside the isolated artifact directory');
  const manifest=JSON.parse(await readFile(path.join(build,'manifest.json'),'utf8'));
  const {digest,...unsigned}=manifest;
  assert.equal(createHash('sha256').update(JSON.stringify(unsigned)).digest('hex'),digest,'manifest changed');
  async function verify(){
    for(const [directory,entries] of [['source',manifest.sourceFiles],['fixture',manifest.fixtureFiles],['dist',manifest.assets]])for(const entry of entries){
      const filename=path.resolve(build,directory,entry.path),base=path.join(build,directory);
      assert.ok(!path.relative(base,filename).startsWith('..')&&!path.isAbsolute(path.relative(base,filename)),'artifact path stays in build');
      const bytes=await readFile(filename);
      assert.equal(bytes.length,entry.bytes,`immutable size: ${directory}/${entry.path}`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,`immutable hash: ${directory}/${entry.path}`);
    }
  }
  await verify();
  const list=await import(pathToFileURL(path.join(build,'source/functions/api/organizations/[id]/tickets.js')).href);
  const detail=await import(pathToFileURL(path.join(build,'source/functions/api/organizations/[id]/tickets/[ticketId].js')).href);
  const dist=path.join(build,'dist');
  const assets=new Map(manifest.assets.map(a=>['/'+a.path,a]));
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const asset=assets.get(pathname)||(!pathname.startsWith('/assets/')&&!pathname.startsWith('/api/')?assets.get('/index.html'):undefined);
    if(req.method!=='GET'||!asset){res.writeHead(404);res.end();return;}
    try {const bytes=await readFile(path.join(dist,asset.path));res.writeHead(200,{'Content-Type':types[path.extname(asset.path)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);}
    catch {res.writeHead(500);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,manifest,handlers:{list:list.onRequestGet,detail:detail.onRequestGet},verify,
    close:async()=>{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await verify();}};
}
