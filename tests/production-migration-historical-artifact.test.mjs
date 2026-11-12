import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {extractAuditZip,crc32,fetchHistoricalAuditArtifact,validateHistoricalAuditOrigin,AUDIT_REPOSITORY,AUDIT_WORKFLOW,HISTORICAL_AUDIT_NAME,MAX_AUDIT_BYTES} from '../scripts/migrations/historical-audit-artifact.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function zip(raw,options={}){raw=Buffer.from(raw);const name=Buffer.from(options.name||'audit.json'),method=options.store?0:8,packed=method===0?raw:deflateRawSync(raw),descriptor=options.descriptor?Buffer.alloc(16):Buffer.alloc(0),flags=0x800+(options.descriptor?8:0),crc=crc32(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);if(!options.descriptor){local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);}local.writeUInt16LE(name.length,26);
 if(options.descriptor){descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(packed.length,8);descriptor.writeUInt32LE(raw.length,12);}
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(0x80000000,38);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length+descriptor.length,16);return Buffer.concat([local,name,packed,descriptor,central,name,end]);}
const context={runId:'33',repositoryId:'11',ownerId:'22',workflowSha:'b'.repeat(40),workflowRef:`${AUDIT_REPOSITORY}/${AUDIT_WORKFLOW}@refs/heads/main`,approvalHash:'c'.repeat(64),token:'SYNTHETIC_SECRET_TOKEN',now:0};
function fixture(){
 const audit={contractId:'historical-0044-operator-v1',version:1,phase:'historical-audit-transport-blocked',readyForAuthorization:false,approvalEligible:false,writesPerformed:false,material:{migration:{name:HISTORICAL_AUDIT_NAME},gitSha:'d'.repeat(40)},evidenceIdentity:context.approvalHash};
 const body=Buffer.from(JSON.stringify(audit)),archive=zip(body),workflow=Buffer.from('synthetic reviewed workflow');
 const content={type:'file',encoding:'base64',content:workflow.toString('base64'),sha:createHash('sha1').update(Buffer.concat([Buffer.from('blob '+workflow.length+'\0'),workflow])).digest('hex')};
 const data={repo:{id:11,full_name:AUDIT_REPOSITORY,owner:{id:22},default_branch:'main'},workflow:{id:7,path:AUDIT_WORKFLOW,state:'active'},run:{id:33,workflow_id:7,path:AUDIT_WORKFLOW,event:'workflow_dispatch',head_branch:'main',run_attempt:1,status:'completed',conclusion:'success',actor:{id:22},triggering_actor:{id:22},repository:{id:11},head_repository:{id:11},head_sha:'a'.repeat(40)},compare:{status:'ahead',merge_base_commit:{sha:'a'.repeat(40)}},content,artifact:{id:44,name:`production-d1-audit-${HISTORICAL_AUDIT_NAME}-33`,expired:false,expires_at:'2099-01-01T00:00:00Z',size_in_bytes:archive.length,digest:'sha256:'+hash(archive),workflow_run:{id:33,repository_id:11,head_repository_id:11,head_branch:'main',head_sha:'a'.repeat(40)}},archive,audit,calls:[],redirect:'https://synthetic.blob.core.windows.net/result?sig=synthetic'};
 const fetch=async(url,opts)=>{data.calls.push({url,opts});assert.equal(opts.redirect,'manual');const u=new URL(url);if(u.hostname!=='api.github.com'){assert.equal(opts.headers.Authorization,undefined);return new Response(data.archive,{status:200});}assert.equal(opts.headers.Authorization,'Bearer '+context.token);let value;
 if(u.pathname.endsWith('/zip'))return new Response(null,{status:302,headers:{location:data.redirect}});
 if(u.pathname.endsWith('/artifacts'))value={total_count:data.total??1,artifacts:data.artifacts??[data.artifact]};else if(u.pathname.includes('/contents/'))value=u.searchParams.get('ref')===context.workflowSha?(data.currentContent??data.content):data.content;else if(u.pathname.includes('/compare/'))value=data.compare;else if(u.pathname.endsWith('/actions/runs/33'))value=data.run;else if(u.pathname.endsWith('/actions/workflows/production-d1-migration-operator.yml'))value=data.workflow;else value=data.repo;
 return new Response(JSON.stringify(value),{status:200});};return {data,fetch};
}
for(const options of [{},{store:true},{descriptor:true}])test('bounded ZIP accepted known layout '+JSON.stringify(options),()=>{assert.equal(extractAuditZip(zip('hello',options)).toString(),'hello');});
for(const name of ['../audit.json','/audit.json','C:\\audit.json','audit.json/','other.json','audit.json\0'])test('ZIP rejects path '+name,()=>assert.throws(()=>extractAuditZip(zip('x',{name}))));
const mutations={truncated:b=>b.subarray(0,b.length-1),trailing:b=>Buffer.concat([b,Buffer.from('x')]),duplicates:b=>{b.writeUInt16LE(2,b.length-12);return b;},overlap:b=>{b.writeUInt32LE(1,b.length-6);return b;},symlink:b=>{const c=b.readUInt32LE(b.length-6);b.writeUInt32LE(0xa0000000,c+38);return b;},encrypted:b=>{b.writeUInt16LE(1,6);return b;},crc:b=>{b[14]^=1;return b;},size:b=>{b.writeUInt32LE(999,18);return b;},offset:b=>{const c=b.readUInt32LE(b.length-6);b.writeUInt32LE(1,c+42);return b;},descriptor:b=>{const c=b.readUInt32LE(b.length-6);b[c-1]^=1;return b;}};
for(const [name,mutate] of Object.entries(mutations))test('ZIP rejects '+name,()=>assert.throws(()=>extractAuditZip(mutate(zip('hello',{descriptor:name==='descriptor'})))));
test('inflate bomb rejected during bounded decompression even with forged declared size',()=>{const b=zip(Buffer.alloc(MAX_AUDIT_BYTES+1,65));const c=b.readUInt32LE(b.length-6);b.writeUInt32LE(1,22);b.writeUInt32LE(1,c+24);assert.throws(()=>extractAuditZip(b));});
test('ZIP byte-mutation fuzz always bounded and fixed safe error',()=>{const source=zip('synthetic');for(let i=0;i<source.length;i++){const b=Buffer.from(source);b[i]^=0xff;try{const v=extractAuditZip(b);assert.ok(v.length<=MAX_AUDIT_BYTES);}catch(e){assert.equal(e.code,'HISTORICAL_AUDIT_PROVENANCE_BLOCKED');assert.equal(e.message,'Historical audit provenance blocked.');}}});
test('authenticated fixed provenance succeeds without credential redirect or D1',async()=>{const {data,fetch}=fixture();const r=await fetchHistoricalAuditArtifact(context,fetch);assert.equal(r.provenance.artifactAuthenticityVerified,true);assert.equal(r.provenance.writeAuthorization,false);assert.equal(r.audit.evidenceIdentity,context.approvalHash);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_SECRET_TOKEN/);assert.equal(data.calls.filter(c=>!c.url.startsWith('https://api.github.com/')).length,1);});
const originMutations={repo:d=>d.repo.id++,owner:d=>d.repo.owner.id++,workflow:d=>d.workflow.id++,workflowPath:d=>d.workflow.path='other.yml',ref:d=>d.run.head_branch='feature',event:d=>d.run.event='pull_request',actor:d=>d.run.actor.id++,triggerActor:d=>d.run.triggering_actor.id++,attempt:d=>d.run.run_attempt=2,conclusion:d=>d.run.conclusion='failure',status:d=>d.run.status='in_progress',headRepo:d=>d.run.head_repository.id++,ancestor:d=>d.compare.merge_base_commit.sha='e'.repeat(40),workflowContent:d=>d.currentContent={...d.content,sha:'f'.repeat(40)},expired:d=>d.artifact.expired=true,expiry:d=>d.artifact.expires_at='invalid',artifactRun:d=>d.artifact.workflow_run.id++,artifactRepo:d=>d.artifact.workflow_run.repository_id++,artifactHead:d=>d.artifact.workflow_run.head_sha='e'.repeat(40),checksum:d=>d.artifact.digest='sha256:'+'0'.repeat(64),artifactName:d=>d.artifact.name='wrong',duplicates:d=>{d.total=2;d.artifacts=[d.artifact,d.artifact];},pagination:d=>d.total=101,selfConsistentWrongOrigin:d=>{d.run.actor.id=99;d.artifact.digest='sha256:'+hash(d.archive);}};
for(const [name,mutate] of Object.entries(originMutations))test('origin rejects '+name,async()=>{const {data,fetch}=fixture();mutate(data);await assert.rejects(fetchHistoricalAuditArtifact(context,fetch),{code:'HISTORICAL_AUDIT_PROVENANCE_BLOCKED'});});
for(const redirect of ['http://synthetic.blob.core.windows.net/x','https://evil.example/x','https://u:p@synthetic.blob.core.windows.net/x','https://synthetic.blob.core.windows.net:444/x','https://api.github.com/other','https://blob.core.windows.net.evil.example/x'])test('reject unsafe redirect '+redirect,async()=>{const {data,fetch}=fixture();data.redirect=redirect;await assert.rejects(fetchHistoricalAuditArtifact(context,fetch));assert.equal(data.calls.filter(c=>!c.url.startsWith('https://api.github.com/')).length,0);});
for(const runId of ['0','-1','01','1.5','33/../44','9007199254740992'])test('strict run ID '+runId,async()=>{let calls=0;await assert.rejects(fetchHistoricalAuditArtifact({...context,runId},()=>{calls++;}));assert.equal(calls,0);});

test('post route reauthenticates and compares bytes, never trusting a sidecar boolean',async t=>{
 const cwd=process.cwd(),root=mkdtempSync(join(tmpdir(),'historical-origin-'));process.chdir(root);t.after(()=>{process.chdir(cwd);rmSync(root,{recursive:true,force:true});});mkdirSync('.tmp/production-migrations',{recursive:true});
 const path='.tmp/production-migrations/original-audit.json',{data,fetch}=fixture();writeFileSync(path,JSON.stringify(data.audit));writeFileSync('.tmp/production-migrations/original-audit-origin.json','{"artifactAuthenticityVerified":true}');
 assert.equal((await validateHistoricalAuditOrigin(path,context.approvalHash,context,fetch)).provenance.artifactAuthenticityVerified,true);
 writeFileSync(path,JSON.stringify({...data.audit,forged:true}));await assert.rejects(validateHistoricalAuditOrigin(path,context.approvalHash,context,fetch));
 await assert.rejects(validateHistoricalAuditOrigin('other.json',context.approvalHash,context,fetch));
 data.run.actor.id=999;writeFileSync(path,JSON.stringify(data.audit));await assert.rejects(validateHistoricalAuditOrigin(path,context.approvalHash,context,fetch));
});
test('stream size and redirect loops fail closed without emitting token',async()=>{
 const {fetch}=fixture();let storageCalls=0;
 await assert.rejects(fetchHistoricalAuditArtifact(context,async(url,opts)=>{if(!url.startsWith('https://api.github.com/')){storageCalls++;assert.equal(opts.headers.Authorization,undefined);return new Response(null,{status:302,headers:{location:url}});}return fetch(url,opts);}));assert.equal(storageCalls,3);
 await assert.rejects(fetchHistoricalAuditArtifact(context,async()=>new Response('x',{status:200,headers:{'content-length':'5000000'}})),e=>!e.message.includes(context.token));
});

// Generated by official archiver 7.0.1, archive.file(audit.json), zlib level 6.
// upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a package-lock blob:
// 7b5e8775fc15bcc6a4a83897ccc9d00b722d5284; archiver integrity:
// sha512-ZcbTaIqJOfCc03QwD468Unz/5Ir8ATtvAHsK+FdXbDIbGfihqh9mrvdcYunQzqn4HrvWWaFyaxJhGZagaJJpPQ==
// No dependency is required to consume this byte-for-byte positive fixture.
const officialZip='UEsDBBQACAAIAAAAbF0AAAAAAAAAAAAAAAAKAAAAYXVkaXQuanNvbqtWKq7MK8lILclMVrJSyk9Ly0zOTMxRSCxKzsgsSy1SSM7PLUgsyUzKzMksqVTIz8upVKrlAgBQSwcIPfpLmzcAAAA1AAAAUEsBAi0DFAAIAAgAAABsXT36S5s3AAAANQAAAAoAAAAAAAAAAAAgALaBAAAAAGF1ZGl0Lmpzb25QSwUGAAAAAAEAAQA4AAAAbwAAAAAA';
test('official upload-artifact-pinned archiver stream layout accepted',()=>{
 const bytes=Buffer.from(officialZip,'base64');assert.equal(hash(bytes),'71188d7efb5310d83c3b851ec702bdd42d7cd68eddd90d7d564e43b13c1d1281');
 assert.equal(bytes.readUInt16LE(6),8); // streaming data descriptor, same archive.file path
 assert.equal(extractAuditZip(bytes).toString(),'{"synthetic":"official archiver compatibility only"}\n');
});

for(const [name,change] of Object.entries({oldPhase:{phase:'historical-audit-ready'},ready:{readyForAuthorization:true},eligible:{approvalEligible:true},approval:{approval:{hash:context.approvalHash}},wrongIdentity:{evidenceIdentity:'0'.repeat(64)}}))test('blocked evidence rejects authority '+name,async()=>{const {data,fetch}=fixture();Object.assign(data.audit,change);data.archive=zip(JSON.stringify(data.audit));data.artifact.size_in_bytes=data.archive.length;data.artifact.digest='sha256:'+hash(data.archive);await assert.rejects(fetchHistoricalAuditArtifact(context,fetch));});
