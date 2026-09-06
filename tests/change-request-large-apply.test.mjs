import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { readChangeRequestApplyArtifact, claimChangeRequestApplyArtifact } from '../functions/_lib/project-change-request-apply-artifact.js';
import * as hashes from '../functions/_lib/dropbox-content-hash.js';

const migration = await readFile(new URL('../migrations/0022_change_request_apply_artifacts.sql', import.meta.url),'utf8');
test('claim is immutable and retries cannot switch the bytes or base revision', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
  sqlite.exec("CREATE TABLE project_change_requests(id TEXT PRIMARY KEY); INSERT INTO project_change_requests VALUES('r');"); sqlite.exec(migration);
  const db = {prepare(sql) {const q=sqlite.prepare(sql);let args=[];return {bind(...a){args=a;return this;},async first(){return q.get(...args);},async run(){return q.run(...args);}};}};
  const env={DB:db}, row={id:'r'}, artifact={checksum:'a'.repeat(64),sizeBytes:90*1024*1024,baseRevision:3};
  await claimChangeRequestApplyArtifact(env,db,row,artifact);
  await claimChangeRequestApplyArtifact(env,db,row,artifact);
  await assert.rejects(claimChangeRequestApplyArtifact(env,db,row,{...artifact,checksum:'b'.repeat(64)}),{code:'CHANGE_REQUEST_APPLY_ARTIFACT_CONFLICT'});
  assert.throws(()=>sqlite.exec("UPDATE project_change_request_apply_artifacts SET size_bytes=1"),/IMMUTABLE/);
});
test('metadata rejects stale reviewer version, oversized payload and missing checksum', () => {
  const headers={'X-Maono-Config-Checksum':'a'.repeat(64),'X-Maono-Config-Size':'94371840','X-Maono-Expected-Revision':'3','X-Maono-Change-Request-Version':'2'};
  const row={base_revision:3,lifecycle_version:2};
  assert.equal(readChangeRequestApplyArtifact(new Request('https://test',{headers}),row).sizeBytes,94371840);
  assert.throws(()=>readChangeRequestApplyArtifact(new Request('https://test',{headers}),{...row,lifecycle_version:3}),{code:'CHANGE_REQUEST_REVIEW_STATE_CONFLICT'});
  assert.throws(()=>readChangeRequestApplyArtifact(new Request('https://test',{headers:{...headers,'X-Maono-Config-Size':String(101*1024*1024)}}),row),{code:'CHANGE_REQUEST_APPLY_ARTIFACT_INVALID'});
});

// Execute the production streaming loop with only network/ledger boundaries replaced.
async function streamingService() {
  let source = await readFile(new URL('../functions/_lib/project-large-config-save.js',import.meta.url),'utf8');
  source=source.replace(/import\s+[\s\S]*?from\s+"[^"]+";\n/g,'').replace(/export /g,'');
  const seen={maxBlock:0,uploaded:0,published:0,reserved:0}; let artifact;
  const deps={...hashes, DROPBOX_STREAM_BLOCK_BYTES:4*1024*1024,
    ensureDropboxFolder:async()=>{}, startLargeDropboxUploadSession:async()=>({session_id:'fixture'}),
    appendLargeDropboxUploadSession:async(_e,_id,offset,block)=>{assert.equal(offset,seen.uploaded);seen.maxBlock=Math.max(seen.maxBlock,block.length);seen.uploaded+=block.length;},
    finishLargeDropboxUploadSession:async()=>{return {size:artifact.sizeBytes,content_hash:artifact.checksum,rev:'1'};},
    getDropboxMetadata:async()=>{throw new Error('Unexpected reconciliation');},
    createMapConfigStorageRef:()=> 'revision/4',getMapConfigRevisionFileName:()=> 'r4.json',PROJECT_LIFECYCLE_STATES:{ACTIVE:'ACTIVE'},
    reserveProjectConfigRevision:async(_env,input)=>{seen.reserved++;artifact=input;return {alreadyPublished:false,revision:{}};},
    markProjectConfigRevisionReady:async()=>({}),markProjectConfigRevisionFailed:async()=>{},
    publishProjectConfigRevision:async()=>{seen.published++;return {id:1,organization_id:1};},
  };
  const save=new Function(...Object.keys(deps),source+'\nreturn saveLargeProjectConfigStream;')(...Object.values(deps));
  return {save,seen};
}
function generatedRequest(size) {
  let sent=0;const body=new ReadableStream({pull(controller){
    const length=Math.min(64*1024,size-sent);if(!length){controller.close();return;}
    const block=new Uint8Array(length).fill(0x78);if(sent===0)block.set(new TextEncoder().encode('{"version":"v1","config":{},"datasets":[],"padding":"'));if(sent+length===size){block[length-2]=0x22;block[length-1]=0x7d;}
    sent+=length;controller.enqueue(block);
  }});
  return new Request('https://test',{method:'POST',duplex:'half',body,headers:{'Content-Type':'application/vnd.maono.map-config+json','X-Maono-Large-Config':'1','X-Maono-Expected-Revision':'3','X-Maono-Config-Size':String(size),'X-Maono-Config-Schema':'legacy-kepler','X-Maono-Config-Schema-Version':'1','X-Maono-Config-Version':'v1','X-Maono-Dataset-Count':'0'}});
}
test('90 MiB traverses shared save in <=4 MiB blocks without whole-body parse', async () => {
  const {save,seen}=await streamingService();
  const request=generatedRequest(90*1024*1024);
  request.json=request.text=request.arrayBuffer=()=>{throw new Error('Whole-body materialization forbidden');};
  const result=await save({}, {request,project:{id:1,organization_id:1,dropbox_root_path:'/qa',config_revision:3},user:{id:1}});
  assert.equal(result.revision,4);assert.equal(result.artifact.sizeBytes,90*1024*1024);
  assert.ok(seen.maxBlock<=4*1024*1024);assert.equal(seen.published,1);
});
test('checksum mismatch never reserves or publishes a revision', async () => {
  const {save,seen}=await streamingService();
  await assert.rejects(save({}, {request:generatedRequest(1024),project:{id:1,organization_id:1,dropbox_root_path:'/qa',config_revision:3},user:{id:1},allowSmall:true,expectedContentHash:'0'.repeat(64)}),{code:'CHANGE_REQUEST_APPLY_CHECKSUM_MISMATCH'});
  assert.equal(seen.reserved,0);assert.equal(seen.published,0);
});
