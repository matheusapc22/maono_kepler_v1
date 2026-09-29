import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evaluateEvidence as evaluateCC17} from '../cc17/evidence-gate.mjs';

export const DATABASE_ID='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
export const REQUIREMENTS=Object.freeze(Array.from({length:40},(_,i)=>`REQ-CC-${String(i+1).padStart(2,'0')}`));
export const CASES=Object.freeze(Array.from({length:60},(_,i)=>`CT-${String(i+1).padStart(2,'0')}`));
export const INHERITED_PENDING=Object.freeze([...Array.from({length:8},(_,i)=>`C17-P0${i+1}`),...Array.from({length:5},(_,i)=>`C18-P0${i+1}`)]);
const matrix=JSON.parse(await readFile(new URL('../../../docs/central-chamados/cc-18/traceability.json',import.meta.url),'utf8'));
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,19)===x.slice(0,19);
const link=x=>{try{const u=new URL(x);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}};
const proof=(p,expectedSha,status='PASS')=>isObject(p)&&p.status===status&&p.productSha===expectedSha&&text(p.executor)&&date(p.executedAt)&&link(p.evidence);

// Offline bookkeeping: no HTTP, SQL, secrets, flag mutation or automatic rollout.
// Filled links are assertions for a human reviewer, not authenticated proof.
export function evaluateDelivery(input,expectedSha){
 const issues=[];const need=(ok,id,message)=>{if(!ok)issues.push({id,message});};
 const x=isObject(input)?input:{};
 need(sha(expectedSha),'SHA','Fixar SHA completo do produto.');
 need(x.schemaVersion===1,'FORMAT','Usar template de entrega versão 1.');
 need(x.productSha===expectedSha&&x.environment==='production','TARGET','Ambiente/SHA alvo ausente ou divergente.');
 for(const key of ['code','deployment','schema','qa','review','documentation','operations','handoff'])
  need(proof(x[key],expectedSha),key.toUpperCase(),`${key}: responsável, data, SHA e evidência PASS obrigatórios.`);
 need(x.code?.merged===true&&link(x.code?.pullRequest),'MERGE','Merge e URL da PR precisam de evidência própria.');
 need(x.deployment?.servedSha===expectedSha&&link(x.deployment?.canonicalUrl),'DEPLOY','Comprovar SHA servido no alvo canônico; Preview não basta.');
 need(x.schema?.databaseName==='maono_maps'&&x.schema?.databaseId===DATABASE_ID&&x.schema?.environment==='production','DATABASE','Conferir identidade e ambiente D1.');
 need(x.schema?.quickCheck==='ok'&&x.schema?.foreignKeyViolations===0&&link(x.schema?.ledgerEvidence),'INTEGRITY','Ledger e integridade remotos são obrigatórios mesmo sem SQL nova.');
 need(['none','applied'].includes(x.schema?.migrationDisposition)&&link(x.schema?.diffEvidence),'MIGRATION','Revisar diff final e registrar aplicação ou ausência de SQL nova.');
 if(x.schema?.migrationDisposition==='applied')need(Array.isArray(x.schema?.migrations)&&x.schema.migrations.length>0&&x.schema.migrations.every(m=>isObject(m)&&text(m.filename)&&/^[a-f0-9]{64}$/.test(m.sha256||'')&&text(m.approvalHash)&&date(m.appliedAt)&&link(m.postValidation)),'MIGRATION_APPLY','Cada SQL nova exige autorização e pós-validação próprias.');
 if(x.schema?.migrationDisposition==='none')need(Array.isArray(x.schema.migrations)&&x.schema.migrations.length===0,'MIGRATION_NONE','Dispensa não pode esconder migrations declaradas.');
 need(text(x.code?.author)&&text(x.review?.executor)&&x.review.executor.trim().toLowerCase()!==x.code.author.trim().toLowerCase(),'INDEPENDENT_REVIEW','Revisor deve ser identificado e distinto do autor.');
 let cc17;try{cc17=evaluateCC17(isObject(x.cc17)?x.cc17:{},expectedSha);}catch{cc17={status:'PENDING',issues:['Formato de evidência CC17 inválido.']};}
 need(cc17.status==='READY_FOR_FINAL_REVIEW','CC17','CC17 pendente: '+cc17.issues.join('; '));
 const rows=(value,ids,key)=>{
  const a=Array.isArray(value)?value:[];
  need(a.length===ids.length&&a.every(v=>isObject(v)&&ids.includes(v.id))&&new Set(a.map(v=>v?.id)).size===ids.length,key,'Cobertura completa, sem IDs duplicados ou desconhecidos.');
  for(const id of ids)need(a.filter(v=>v?.id===id).length===1&&proof(a.find(v=>v?.id===id),expectedSha),id,'Evidência final ausente, pendente ou de outro SHA.');
  return a;
 };
 const tests=rows(x.tests,CASES,'TEST_COVERAGE'),requirements=rows(x.requirements,REQUIREMENTS,'REQ_COVERAGE');
 for(const expected of matrix.tests){const observed=tests.find(t=>t?.id===expected.id);need(observed?.expected===expected.expected&&text(observed?.observed)&&['local','ci','production'].includes(observed?.environment),expected.id+':RESULT','Registrar ambiente, resultado esperado do roteiro e observado, sem inferir PASS.');}
 for(const requirement of matrix.requirements){
  const row=requirements.find(r=>r?.id===requirement.id);
  need(Array.isArray(row?.tests)&&row.tests.length===requirement.tests.length&&requirement.tests.every(id=>row.tests.includes(id))&&new Set(row.tests).size===row.tests.length,requirement.id+':LINKS','Vínculos devem corresponder à matriz versionada.');
  need(link(row?.pullRequest),requirement.id+':PR','Vincular PR de implementação; vínculo não implica aceite.');
 }
 for(const id of ['CT-53','CT-54','CT-55','CT-56','CT-57','CT-58','CT-59'])need(tests.find(t=>t?.id===id)?.environment==='production',id+':ENV','Fixtures locais não substituem aceite humano/autenticado.');
 const ct59=tests.find(t=>t?.id==='CT-59');
 need(text(ct59?.executor)&&text(x.code?.author)&&ct59.executor.trim().toLowerCase()!==x.code.author.trim().toLowerCase(),'CT59_OPERATOR','Operador CT59 deve ser distinto do autor.');
 for(const key of ['diagnosis','reprocess','restore','cleanup'])need(link(ct59?.[key]),'CT59_'+key.toUpperCase(),'Ensaio exige prova própria de '+key+'.');
 need(Array.isArray(x.pendingItems),'PENDING_REGISTER','Declarar pendências, inclusive humanas.');
 const pending=Array.isArray(x.pendingItems)?x.pendingItems:[];
 need(INHERITED_PENDING.every(id=>pending.filter(p=>p?.id===id).length===1)&&new Set(pending.map(p=>p?.id)).size===pending.length,'PENDING_COVERAGE','Preservar C17-P01–08 e C18-P01–05, sem remover ou duplicar IDs para encerrar.');
 for(const [index,p]of (Array.isArray(x.pendingItems)?x.pendingItems:[]).entries()){
  need(isObject(p)&&text(p.id)&&text(p.reason)&&text(p.owner)&&typeof p.blocking==='boolean','PENDING_'+index,'Pendência deve conter ID, motivo, dono e classificação explícita.');
  need(proof(p,expectedSha,'RESOLVED'),'PENDING_'+index+':OPEN','Pendência aberta impede encerramento; não dispensar por merge.');
 }
 need(Array.isArray(x.blockers)&&x.blockers.length===0,'BLOCKERS','Bloqueadores não declarados ou ainda abertos.');
 need(x.operations?.rolloutApproved===true&&link(x.operations?.rolloutEvidence)&&link(x.operations?.cohortEvidence)&&link(x.operations?.newOrganizationChecklist),'ROLLOUT_PLAN','Exigir plano/coorte e checklist para novas organizações, sem autorizar ativação.');
 return {schemaVersion:1,productSha:sha(expectedSha)?expectedSha:null,status:issues.length?'PENDING':'READY_FOR_FINAL_REVIEW',releaseAuthorized:false,issues};
}
async function main(args){
 if(args.length!==3)throw Error('invalid arguments');
 const result=evaluateDelivery(JSON.parse(await readFile(args[0],'utf8')),args[1]);
 const output=resolve(args[2]);await mkdir(dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result));return result.issues.length?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{process.exitCode=await main(process.argv.slice(2));}catch{console.error('CC18_DELIVERY_INVALID: entrada inválida ou destino existente; usar JSON e arquivo de saída novo.');process.exitCode=2;}}
