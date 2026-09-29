import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const REQUIRED_CASES=Object.freeze(['CT55','CT56','CT57','CT58']);
const shaPattern=/^[a-f0-9]{40}$/;
const link=value=>typeof value==='string'&&/^https:\/\//.test(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
const date=value=>text(value)&&Number.isFinite(Date.parse(value));
// Evidence bookkeeping only. This evaluator performs no network, flag or SQL operation.
// It cannot grant an acceptance window or certify the truth of uploaded evidence.
export function evaluateEvidence(input,expectedSha) {
  const issues=[];const require=(ok,message)=>{if(!ok)issues.push(message);};
  require(shaPattern.test(expectedSha||''),'expectedSha must identify an exact product commit');
  require(input?.schemaVersion===1,'unsupported evidence schema');
  require(input?.productSha===expectedSha&&input?.servedSha===expectedSha,'product/served SHA mismatch or absent');
  require(input?.environment==='production','local fixtures do not certify Production acceptance');
  require(input?.window?.approved===true&&text(input?.window?.approvedBy)&&date(input?.window?.approvedAt)&&link(input?.window?.evidence),'approved scoped window evidence is missing');
  require(input?.schema?.verified===true&&link(input?.schema?.evidence),'schema verification evidence is missing');
  require(input?.review?.approved===true&&text(input?.review?.reviewer)&&link(input?.review?.evidence),'independent review evidence is missing');
  require(input?.cleanup?.complete===true&&link(input?.cleanup?.evidence),'resource cleanup is not proven');
  require(input?.configuration?.restored===true&&link(input?.configuration?.evidence),'configuration restoration is not proven');
  require(Array.isArray(input?.blockers)&&input.blockers.length===0,'blockers absent from report or still open');
  const cases=Array.isArray(input?.cases)?input.cases:[];
  for(const id of REQUIRED_CASES){
    const rows=cases.filter(c=>c.id===id);require(rows.length===1,`${id}: exactly one final case record required`);
    const row=rows[0];require(row?.status==='PASS'&&row?.productSha===expectedSha&&row?.environment==='production'&&text(row?.executor)&&date(row?.executedAt)&&link(row?.evidence),`${id}: passing authenticated evidence is missing`);
  }
  const b=input?.performance?.budget,results=input?.performance?.results;
  require(b?.approved===true&&text(b?.approvedBy)&&date(b?.approvedAt)&&link(b?.evidence),'performance budget approval is missing');
  for(const key of ['records','concurrency','durationSeconds','samples'])require(Number.isSafeInteger(b?.[key])&&b[key]>0,`budget.${key} must be a positive integer`);
  require(Number.isFinite(b?.maxErrorRate)&&b.maxErrorRate>=0&&b.maxErrorRate<1,'budget.maxErrorRate is missing or invalid');
  for(const flow of ['metrics','exports','uploads']){
    const r=results?.[flow],limit=b?.p95Ms?.[flow];
    require(Number.isFinite(limit)&&limit>0,`${flow}: approved p95 budget is missing`);
    require(Number.isFinite(r?.p95Ms)&&r.p95Ms>=0&&r.p95Ms<=limit,`${flow}: p95 absent or over budget`);
    require(Number.isSafeInteger(r?.samples)&&r.samples>=b?.samples,`${flow}: insufficient samples`);
    require(Number.isFinite(r?.errorRate)&&r.errorRate>=0&&r.errorRate<=b?.maxErrorRate,`${flow}: errors absent or over budget`);
  }
  for(const key of ['records','concurrency','durationSeconds'])require(Number.isFinite(input?.performance?.observed?.[key])&&input.performance.observed[key]>=b?.[key],`observed ${key} below approved scenario`);
  require(input?.performance?.invariantsPreserved===true&&link(input?.performance?.evidence),'performance invariants/evidence missing');
  return {schemaVersion:1,productSha:expectedSha,status:issues.length?'PENDING':'READY_FOR_FINAL_REVIEW',releaseAuthorized:false,issues};
}
async function main(args){
  if(args.length!==3)throw Error('Usage: evidence-gate.mjs <evidence.json> <expected-40-char-sha> <report.json>');
  const result=evaluateEvidence(JSON.parse(await readFile(args[0],'utf8')),args[1]);
  const out=resolve(args[2]);await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));return result.issues.length?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{process.exitCode=await main(process.argv.slice(2));}catch{console.error('CC17_EVIDENCE_INVALID: supply a valid report and a new output path.');process.exitCode=2;}}
