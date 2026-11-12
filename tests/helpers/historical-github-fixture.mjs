// Synthetic authenticated GitHub transport for offline CLI post-validation only.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {crc32,AUDIT_REPOSITORY,AUDIT_WORKFLOW,HISTORICAL_AUDIT_NAME} from '../../scripts/migrations/historical-audit-artifact.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function zip(raw){const name=Buffer.from('audit.json'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22),crc=crc32(raw);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(raw.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(0x80000000,38);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+raw.length,16);return Buffer.concat([local,name,raw,central,name,end]);}
export function installHistoricalGitHubFixture(root){
 const raw=readFileSync(join(root,'audit.json')),archive=zip(raw),workflow=Buffer.from('synthetic reviewed workflow');
 const content={type:'file',encoding:'base64',content:workflow.toString('base64'),sha:createHash('sha1').update(Buffer.concat([Buffer.from('blob '+workflow.length+'\0'),workflow])).digest('hex')};
 const run={id:33,workflow_id:7,path:AUDIT_WORKFLOW,event:'workflow_dispatch',head_branch:'main',run_attempt:1,status:'completed',conclusion:'success',actor:{id:22},triggering_actor:{id:22},repository:{id:11},head_repository:{id:11},head_sha:'a'.repeat(40)};
 const artifact={id:44,name:`production-d1-audit-${HISTORICAL_AUDIT_NAME}-33`,expired:false,expires_at:'2099-01-01T00:00:00Z',size_in_bytes:archive.length,digest:'sha256:'+hash(archive),workflow_run:{id:33,repository_id:11,head_repository_id:11,head_branch:'main',head_sha:'a'.repeat(40)}};
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);if(u.hostname==='synthetic.blob.core.windows.net'){if(options.headers.Authorization)throw new Error('Credential redirect');return new Response(archive,{status:200});}
  if(u.hostname!=='api.github.com'||options.headers.Authorization!=='Bearer synthetic-github-token')throw new Error('Forbidden offline fetch');
  if(u.pathname.endsWith('/zip'))return new Response(null,{status:302,headers:{location:'https://synthetic.blob.core.windows.net/audit'}});
  let value;if(u.pathname.endsWith('/artifacts'))value={total_count:1,artifacts:[artifact]};else if(u.pathname.includes('/contents/'))value=content;else if(u.pathname.includes('/compare/'))value={status:'ahead',merge_base_commit:{sha:'a'.repeat(40)}};else if(u.pathname.endsWith('/actions/runs/33'))value=run;else if(u.pathname.endsWith('/actions/workflows/production-d1-migration-operator.yml'))value={id:7,path:AUDIT_WORKFLOW,state:'active'};else if(u.pathname===`/repos/${AUDIT_REPOSITORY}`)value={id:11,full_name:AUDIT_REPOSITORY,owner:{id:22},default_branch:'main'};else throw new Error('Unknown offline route');return new Response(JSON.stringify(value),{status:200});
 };
}
