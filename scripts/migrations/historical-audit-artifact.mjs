// Fixed GitHub provenance path for historical postvalidation. No D1 access.
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export const AUDIT_REPOSITORY='matheusapc22/maono_kepler_v1';
export const AUDIT_WORKFLOW='.github/workflows/production-d1-migration-operator.yml';
export const HISTORICAL_AUDIT_NAME='0044_organization_permanent_deletion_historical.sql';
export const MAX_AUDIT_BYTES=2000000,MAX_ARCHIVE_BYTES=4000000;
const hash=b=>createHash('sha256').update(b).digest('hex');
const need=x=>{if(!x)throw Object.assign(new Error('Historical audit provenance blocked.'),{code:'HISTORICAL_AUDIT_PROVENANCE_BLOCKED'});};
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0&&/^[1-9][0-9]*$/.test(String(x));
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function extra(bytes){let p=0;while(p<bytes.length){need(p+4<=bytes.length);const tag=bytes.readUInt16LE(p),n=bytes.readUInt16LE(p+2);need(tag!==1&&tag!==0x7075&&p+4+n<=bytes.length);p+=4+n;}}
// No filesystem extraction. Accept one regular audit.json with contiguous records.
export function extractAuditZip(zip){
 try{
  need(Buffer.isBuffer(zip)&&zip.length>=22&&zip.length<=MAX_ARCHIVE_BYTES);
  const end=zip.length-22;need(zip.readUInt32LE(end)===0x06054b50&&zip.readUInt16LE(end+4)===0&&zip.readUInt16LE(end+6)===0&&zip.readUInt16LE(end+8)===1&&zip.readUInt16LE(end+10)===1&&zip.readUInt16LE(end+20)===0);
  const offset=zip.readUInt32LE(end+16),size=zip.readUInt32LE(end+12);need(offset+size===end&&size>=46&&offset>=30&&zip.readUInt32LE(offset)===0x02014b50);
  const flags=zip.readUInt16LE(offset+8),method=zip.readUInt16LE(offset+10),crc=zip.readUInt32LE(offset+16),compressed=zip.readUInt32LE(offset+20),expanded=zip.readUInt32LE(offset+24),n=zip.readUInt16LE(offset+28),e=zip.readUInt16LE(offset+30),comment=zip.readUInt16LE(offset+32),mode=zip.readUInt32LE(offset+38)>>>16;
  need(zip.readUInt16LE(offset+6)<=20&&(flags&~0x808)===0&&[0,8].includes(method)&&compressed<=MAX_ARCHIVE_BYTES&&expanded>0&&expanded<=MAX_AUDIT_BYTES&&zip.readUInt16LE(offset+34)===0&&zip.readUInt32LE(offset+42)===0&&[0,0x8000].includes(mode&0xf000)&&comment===0&&46+n+e===size);
  need(zip.subarray(offset+46,offset+46+n).toString('utf8')==='audit.json');extra(zip.subarray(offset+46+n,offset+46+n+e));
  need(zip.readUInt32LE(0)===0x04034b50&&zip.readUInt16LE(4)<=20&&zip.readUInt16LE(6)===flags&&zip.readUInt16LE(8)===method);
  const ln=zip.readUInt16LE(26),le=zip.readUInt16LE(28),start=30+ln+le;need(ln===n&&start<=offset&&zip.subarray(30,30+ln).equals(zip.subarray(offset+46,offset+46+n)));extra(zip.subarray(30+ln,start));
  const local=[zip.readUInt32LE(14),zip.readUInt32LE(18),zip.readUInt32LE(22)],expected=[crc,compressed,expanded];need(local.every((v,i)=>v===expected[i]||((flags&8)!==0&&v===0)));
  let next=start+compressed;need(next<=offset);
  if(flags&8){if(next+4<=offset&&zip.readUInt32LE(next)===0x08074b50)next+=4;need(next+12===offset&&zip.readUInt32LE(next)===crc&&zip.readUInt32LE(next+4)===compressed&&zip.readUInt32LE(next+8)===expanded);next+=12;}
  need(next===offset);const packed=zip.subarray(start,start+compressed);
  const raw=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:MAX_AUDIT_BYTES,info:true});
  const output=method===0?raw:raw.buffer;if(method===8)need(raw.engine.bytesWritten===compressed);
  need(output.length===expanded&&crc32(output)===crc&&Buffer.from(output.toString('utf8'),'utf8').equals(output));return output;
 }catch{need(false);}
}
async function bounded(response,max){const advertised=response.headers.get('content-length');need(advertised===null||/^[0-9]+$/.test(advertised)&&Number(advertised)<=max);need(response.body);const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.byteLength;need(size<=max);chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
function validStorageUrl(value){const u=new URL(value);need(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!u.hash&&(u.hostname.endsWith('.blob.core.windows.net')||u.hostname.endsWith('.actions.githubusercontent.com')));return u.href;}
function workflowBytes(value){need(value?.type==='file'&&value.encoding==='base64'&&sha(value.sha)&&typeof value.content==='string');const bytes=Buffer.from(value.content.replace(/\n/g,''),'base64');need(bytes.length>0&&bytes.length<=200000&&createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')===value.sha);return bytes;}
export async function fetchHistoricalAuditArtifact(context,fetchImpl=fetch){
 try{
  const {runId,approvalHash,repositoryId,ownerId,workflowSha,workflowRef,token}=context;
  need(id(runId)&&id(repositoryId)&&id(ownerId)&&sha(workflowSha)&&workflowRef===`${AUDIT_REPOSITORY}/${AUDIT_WORKFLOW}@refs/heads/main`&&/^[a-f0-9]{64}$/.test(approvalHash)&&typeof token==='string'&&token.length>0);
  const base=`https://api.github.com/repos/${AUDIT_REPOSITORY}`;
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const request=(url,authorized)=>fetchImpl(url,{headers:authorized?headers:{Accept:'application/zip'},redirect:'manual',signal:AbortSignal.timeout(30000)});
  const json=async path=>{const r=await request(base+path,true);need(r.status===200&&!r.headers.get('location'));return JSON.parse((await bounded(r,4000000)).toString('utf8'));};
  const repo=await json('');need(repo.id===Number(repositoryId)&&repo.full_name===AUDIT_REPOSITORY&&repo.owner?.id===Number(ownerId)&&repo.default_branch==='main');
  const workflow=await json('/actions/workflows/production-d1-migration-operator.yml');need(id(workflow.id)&&workflow.path===AUDIT_WORKFLOW&&workflow.state==='active');
  const run=await json('/actions/runs/'+runId);
  need(run.id===Number(runId)&&run.workflow_id===workflow.id&&run.path===AUDIT_WORKFLOW&&run.event==='workflow_dispatch'&&run.head_branch==='main'&&run.run_attempt===1&&run.status==='completed'&&run.conclusion==='success'&&run.actor?.id===Number(ownerId)&&run.triggering_actor?.id===Number(ownerId)&&run.repository?.id===Number(repositoryId)&&run.head_repository?.id===Number(repositoryId)&&sha(run.head_sha));
  const compare=await json('/compare/'+run.head_sha+'...main');need(['ahead','identical'].includes(compare.status)&&compare.merge_base_commit?.sha===run.head_sha);
  const original=await json('/contents/'+AUDIT_WORKFLOW+'?ref='+run.head_sha),current=await json('/contents/'+AUDIT_WORKFLOW+'?ref='+workflowSha);
  need(original.sha===current.sha&&workflowBytes(original).equals(workflowBytes(current)));
  const list=await json('/actions/runs/'+runId+'/artifacts?per_page=100');need(Number.isInteger(list.total_count)&&list.total_count>=1&&list.total_count<=100&&Array.isArray(list.artifacts)&&list.artifacts.length===list.total_count);
  const artifactName=`production-d1-audit-${HISTORICAL_AUDIT_NAME}-${runId}`;const matches=list.artifacts.filter(a=>a.name===artifactName);need(matches.length===1);const a=matches[0];
  need(id(a.id)&&a.expired===false&&Number.isFinite(Date.parse(a.expires_at))&&Date.parse(a.expires_at)>(context.now??Date.now())&&Number.isSafeInteger(a.size_in_bytes)&&a.size_in_bytes>0&&a.size_in_bytes<=MAX_ARCHIVE_BYTES&&/^sha256:[a-f0-9]{64}$/.test(a.digest)&&a.workflow_run?.id===Number(runId)&&a.workflow_run.repository_id===Number(repositoryId)&&a.workflow_run.head_repository_id===Number(repositoryId)&&a.workflow_run.head_branch==='main'&&a.workflow_run.head_sha===run.head_sha);
  let response=await request(base+'/actions/artifacts/'+a.id+'/zip',true),redirects=0;
  while([301,302,303,307,308].includes(response.status)){need(++redirects<=3);const next=validStorageUrl(response.headers.get('location'));response=await request(next,false);}
  need(response.status===200);const zip=await bounded(response,MAX_ARCHIVE_BYTES);need('sha256:'+hash(zip)===a.digest);
  const raw=extractAuditZip(zip),audit=JSON.parse(raw.toString('utf8'));
  need(audit.contractId==='historical-0044-operator-v1'&&audit.version===1&&audit.phase==='historical-audit-transport-blocked'&&audit.readyForAuthorization===false&&audit.approvalEligible===false&&!Object.hasOwn(audit,'approval')&&audit.writesPerformed===false&&audit.material?.migration?.name===HISTORICAL_AUDIT_NAME&&audit.evidenceIdentity===approvalHash&&sha(audit.material?.gitSha));
  return {audit,rawAudit:raw.toString('utf8'),provenance:{repositoryId:Number(repositoryId),workflowId:workflow.id,workflowPath:AUDIT_WORKFLOW,workflowCommit:run.head_sha,workflowBlobSha:original.sha,runId:Number(runId),runAttempt:1,actorId:Number(ownerId),artifactId:Number(a.id),artifactDigest:a.digest,auditSha256:hash(raw),evidenceIdentity:approvalHash,artifactAuthenticityVerified:true,writeAuthorization:false}};
 }catch{need(false);}
}
export function trustedAuditContext(approvalHash=process.env.APPROVAL_HASH){return {runId:process.env.AUDIT_RUN_ID,approvalHash,repositoryId:process.env.TRUSTED_REPOSITORY_ID,ownerId:process.env.TRUSTED_OWNER_ID,workflowSha:process.env.TRUSTED_WORKFLOW_SHA,workflowRef:process.env.TRUSTED_WORKFLOW_REF,token:process.env.GITHUB_TOKEN};}
// Reauthenticate in process; the informational origin.json is never an authority.
export async function validateHistoricalAuditOrigin(auditPath,approvalHash,context=trustedAuditContext(approvalHash),fetchImpl=fetch){
 try{need(resolve(auditPath)===resolve('.tmp/production-migrations/original-audit.json')&&context.approvalHash===approvalHash);const result=await fetchHistoricalAuditArtifact(context,fetchImpl);const local=await readFile(auditPath);need(local.length<=MAX_AUDIT_BYTES&&local.equals(Buffer.from(result.rawAudit,'utf8')));return {audit:result.audit,provenance:result.provenance};}catch{need(false);}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{need(process.env.MODE==='postvalidate'&&process.env.MIGRATION===HISTORICAL_AUDIT_NAME);const result=await fetchHistoricalAuditArtifact({runId:process.env.AUDIT_RUN_ID,approvalHash:process.env.APPROVAL_HASH,repositoryId:process.env.TRUSTED_REPOSITORY_ID,ownerId:process.env.TRUSTED_OWNER_ID,workflowSha:process.env.TRUSTED_WORKFLOW_SHA,workflowRef:process.env.TRUSTED_WORKFLOW_REF,token:process.env.GITHUB_TOKEN});await mkdir('.tmp/production-migrations',{recursive:true});await writeFile('.tmp/production-migrations/original-audit.json',result.rawAudit,{flag:'wx',mode:0o600});await writeFile('.tmp/production-migrations/original-audit-origin.json',JSON.stringify(result.provenance,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write('Historical audit provenance verified; no D1 access performed.\n');}
 catch{process.stderr.write('Historical audit provenance blocked; no D1 access performed.\n');process.exitCode=1;}
}
