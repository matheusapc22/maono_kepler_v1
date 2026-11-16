// Read-only diagnostics: fixed synthetic account, GET only, no raw response output.
const BASE='https://api.cloudflare.com/client/v4/accounts/1988481e4c75c760516161104b7e1e50';
const PATHS=['/d1/database','/workers/scripts','/workers/durable_objects/namespaces'];
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const int=v=>Number.isSafeInteger(v)&&v>=0;
export function summarizeEnvelope(e){
 const known=['success','errors','messages','result','result_info'];
 const p=obj(e)?e.result_info:undefined;
 const pk=['page','per_page','count','total_count','total_pages','cursor','next_cursor'];
 const pagination={present:p!==undefined,object:obj(p),unknownFieldCount:obj(p)?Object.keys(p).filter(k=>!pk.includes(k)).length:0};
 for(const k of ['page','per_page','count','total_count','total_pages']) pagination[k]=obj(p)&&int(p[k])?p[k]:null;
 for(const k of ['cursor','next_cursor']) pagination[k+'Nonempty']=obj(p)&&p[k]!==undefined&&p[k]!==null&&p[k]!=='';
 const envelopeAccepted=obj(e)&&Object.keys(e).every(k=>known.includes(k))&&e.success===true&&Array.isArray(e.errors)&&e.errors.length===0&&Array.isArray(e.messages)&&Object.hasOwn(e,'result');
 const paginationAccepted=p===undefined||(obj(p)&&Object.keys(p).every(k=>pk.includes(k))&&(p.page===undefined||p.page===1)&&(p.per_page===undefined||(Number.isSafeInteger(p.per_page)&&p.per_page>=1))&&['count','total_count'].every(k=>p[k]===undefined||p[k]===0)&&(p.total_pages===undefined||p.total_pages===0||p.total_pages===1)&&['cursor','next_cursor'].every(k=>p[k]===undefined||p[k]===null||p[k]===''));
 return {envelopeObject:obj(e),unknownFieldCount:obj(e)?Object.keys(e).filter(k=>!known.includes(k)).length:0,success:obj(e)&&e.success===true,errorsArray:obj(e)&&Array.isArray(e.errors),errorCodes:obj(e)&&Array.isArray(e.errors)?e.errors.slice(0,20).map(x=>int(x?.code)?x.code:null):[],messagesArray:obj(e)&&Array.isArray(e.messages),resultArray:obj(e)&&Array.isArray(e.result),resultCount:obj(e)&&Array.isArray(e.result)?e.result.length:null,pagination,envelopeAccepted,emptyListAccepted:obj(e)&&Array.isArray(e.result)&&e.result.length===0&&paginationAccepted};
}
export function assertDiagnosticContext(e){
 if(e.GITHUB_ACTIONS!=='true'||e.GITHUB_REPOSITORY!=='matheusapc22/maono_kepler_v1'||e.GITHUB_REF!=='refs/heads/main'||e.GITHUB_EVENT_NAME!=='workflow_dispatch'||e.GITHUB_RUN_ATTEMPT!=='1'||e.GITHUB_ACTOR_ID!=='172453089'||e.GITHUB_WORKFLOW_REF!=='matheusapc22/maono_kepler_v1/.github/workflows/d1-synthetic-preflight-diagnostic.yml@refs/heads/main'||e.MAONO_DIAGNOSTIC_CONFIRMATION!=='READ_ONLY_SYNTHETIC_PREFLIGHT')throw Error('DIAGNOSTIC_CONTEXT_DENIED');
}
export async function diagnosePreflight({token,fetchImpl=globalThis.fetch,timeoutMs=10000}={}){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{20,256}$/.test(token)||typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('DIAGNOSTIC_INPUT_DENIED');
 const results=[];
 for(const [index,path] of PATHS.entries()){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},timeoutMs);});
  try{results.push(await Promise.race([timeout,(async()=>{
   const url=BASE+path;
   const r=await fetchImpl(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',credentials:'omit',signal:controller.signal});
   const report={endpoint:['d1-list','worker-list','namespace-list'][index],httpStatus:int(r?.status)&&r.status<=599?r.status:null};
   if(!r||r.redirected||(r.url&&r.url!==url))return {...report,outcome:'response-identity-rejected'};
   report.contentTypeJson=/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'');
   if(!report.contentTypeJson||!r.body)return {...report,outcome:'non-json-or-no-body'};
   const reader=r.body.getReader(),chunks=[];let total=0;
   const abort=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
   try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1048576){abort();return {...report,outcome:'body-limit'};}chunks.push(value);}}finally{controller.signal.removeEventListener('abort',abort);reader.releaseLock();}
   const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   let envelope;try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return {...report,outcome:'invalid-json'};}
   const summary=summarizeEnvelope(envelope);
   return {...report,outcome:'inspected',...summary,preflightAccepted:[200,201].includes(r.status)&&summary.envelopeAccepted&&summary.emptyListAccepted};
  })()]));}catch{results.push({endpoint:['d1-list','worker-list','namespace-list'][index],outcome:controller.signal.aborted?'timeout':'transport-failed'});}finally{clearTimeout(timer);controller.abort();}
 }
 return {diagnosticOnly:true,writeAttempts:0,sqlExecuted:false,productionTouched:false,authorizationToProvision:false,results};
}
