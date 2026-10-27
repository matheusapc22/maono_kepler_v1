import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const [label,ref]=process.argv.slice(2);
assert.match(label||'',/^[a-z][a-z0-9-]*$/,'provide a descriptive build label');
assert.match(ref||'',/^[a-f0-9]{40}$/,'pin a full known Git SHA');
const sha=execFileSync('git',['rev-parse',`${ref}^{commit}`],{encoding:'utf8'}).trim();
const root=path.resolve('.tmp/ticket-performance/ui'),target=path.join(root,`${label}-${sha}`);
await mkdir(root,{recursive:true});
// Every build gets a new content-addressed directory. Never replace a prior build.
await mkdir(target);await mkdir(path.join(target,'source'));await mkdir(path.join(target,'fixture'));
const archive=path.join(target,'source.tar');
execFileSync('git',['archive','--format=tar',`--output=${archive}`,sha,'src','functions','package.json','yarn.lock']);
execFileSync('tar',['-xf',archive,'-C',path.join(target,'source')]);
const fixture=await readFile('tests/browser/fixtures/ticket-performance/main.tsx','utf8');
await writeFile(path.join(target,'fixture/main.tsx'),fixture.replaceAll('../../../../src/','@perf-src/'));
await writeFile(path.join(target,'fixture/index.html'),await readFile('tests/browser/fixtures/ticket-performance/index.html'));
const began=performance.now();
const log=execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','vite.ticket-performance.config.ts'],{
  encoding:'utf8',env:{...process.env,PERF_FIXTURE_ROOT:path.join(target,'fixture'),PERF_SOURCE_ROOT:path.join(target,'source/src'),PERF_BUILD_OUT:path.join(target,'dist')},
});
await writeFile(path.join(target,'build.log'),log);
async function files(directory,prefix=''){
  const result=[];
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=prefix+entry.name,full=path.join(directory,entry.name);
    if(entry.isDirectory())result.push(...await files(full,relative+'/'));
    else {const bytes=await readFile(full);result.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  }
  return result;
}
const manifest={schemaVersion:1,label,sourceSha:sha,toolingSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  createdAt:new Date().toISOString(),runtime:process.version,buildMs:performance.now()-began,
  environment:'isolated actual TicketsSection production profiling build; common installed dependencies; no production configuration or data',
  dependencies:Object.fromEntries(await Promise.all(['react','react-dom','vite','@playwright/test'].map(async name=>[name,JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8')).version]))),
  sourceFiles:await files(path.join(target,'source')),fixtureFiles:await files(path.join(target,'fixture')),assets:await files(path.join(target,'dist'))};
manifest.digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({directory:path.relative(process.cwd(),target),sourceSha:sha,manifestDigest:manifest.digest,buildMs:manifest.buildMs,assets:manifest.assets}));
