// LOCAL SOURCE GENERATOR ONLY. Real hosts and remote enablement are unsupported.
import {createHash} from 'node:crypto';
const ISOLATED_ACCOUNT='1988481e4c75c760516161104b7e1e50';
const PRODUCTION_DATABASE='5bc4dc32-f3bd-4c92-bbd1-cbda63e467db';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields=['accountId','databaseUuid','databaseName','deploymentId','versionId','registryNamespaceId','attemptId','auditSha256','audience'];
// Constant pilot only: no migration files, SQL input, reset, deletion or generic endpoint.
export const LOCAL_PILOT_SQL=Object.freeze([
 "SELECT CASE WHEN (SELECT COUNT(*) FROM maono_synthetic_pilot_identity) = 1 AND EXISTS (SELECT 1 FROM maono_synthetic_pilot_identity WHERE account_id = ? AND database_uuid = ? AND marker = 'local-only-v1') THEN 1 ELSE abs(-9223372036854775808) END AS fixture_guard;",
 "CREATE TABLE maono_synthetic_pilot_result (id INTEGER PRIMARY KEY CHECK(id = 1), label TEXT NOT NULL CHECK(label = 'local-fixed-pilot-v1'));",
 "INSERT INTO maono_synthetic_pilot_result (id, label) VALUES (1, 'local-fixed-pilot-v1');",
]);
function deny(){throw Error('LOCAL_PILOT_CONFIG_DENIED');}
export function buildLocalPilotSource(config={enabled:false}) {
 if(!config||typeof config!=='object'||Array.isArray(config))deny();
 if(config.enabled===false){
  if(Object.keys(config).length!==1)deny();
  return Object.freeze({source:"export default {fetch(){return new Response('DISABLED_LOCAL_PILOT',{status:503});}};",payloadSha256:null,remoteExecutionSupported:false,configured:false});
 }
 if(config.enabled!==true||Object.keys(config).length!==fields.length+1||!fields.every(k=>typeof config[k]==='string')||
    config.accountId!==ISOLATED_ACCOUNT||!uuid.test(config.databaseUuid)||config.databaseUuid===PRODUCTION_DATABASE||
    !/^maono_synthetic_rehearsal_[a-z0-9_]+$/.test(config.databaseName)||
    !['deploymentId','versionId','attemptId'].every(k=>uuid.test(config[k]))||
    !/^[a-f0-9]{32}$/.test(config.registryNamespaceId)||!/^[a-f0-9]{64}$/.test(config.auditSha256)||
    !/^https:\/\/maono-synthetic-rehearsal-[a-z0-9-]+\.invalid\/fixed-batch$/.test(config.audience))deny();
 const fixed=Object.fromEntries(fields.map(k=>[k,config[k]]));
 const plan=LOCAL_PILOT_SQL.map((sql,i)=>({sql,parameters:i===0?[fixed.accountId,fixed.databaseUuid]:[]}));
 const payloadSha256=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 const source=`
// GENERATED LOCAL-ONLY PILOT. Fixture declarations are NOT runtime identity proof.
import {createLocalInvocationVerifier} from '../d1-batch-rehearsal/local-invocation-auth.mjs';
import {createRegistryStore} from '../d1-batch-rehearsal/durable-claim-registry.mjs';
export {SyntheticClaimRegistry} from '../d1-batch-rehearsal/durable-claim-registry.mjs';
const fixed=${JSON.stringify(fixed)};
const plan=${JSON.stringify(plan)};
const payloadSha256=${JSON.stringify(payloadSha256)};
const key='synthetic-d1-once:'+fixed.databaseUuid;
const flags={localRehearsalOnly:true,remoteIdentityAuthenticated:false,operationalAuthorization:false,retryAllowed:false};
function fresh(v){const now=Date.now();if(now<v.authenticatedIssuedAtMs||now>=v.authenticatedExpiresAtMs)throw Error('EXPIRED');}
export default {async fetch(request,env){
 let claimAttempted=false,claimed=false,store;
 try {
  if(env.LOCAL_REHEARSAL_MODE!=='local-only'||env.LOCAL_ACCOUNT_ID!==fixed.accountId||env.LOCAL_VERSION_ID!==fixed.versionId||
     typeof env.LOCAL_TEST_KEY_HEX!=='string'||!/^[a-f0-9]{64}$/.test(env.LOCAL_TEST_KEY_HEX)||!env.TARGET||!env.REGISTRY)throw Error('LOCAL_PREREQUISITES_MISSING');
  // Test key only, supplied in-memory by local Miniflare. No credential loader.
  const bytes=Uint8Array.from(env.LOCAL_TEST_KEY_HEX.match(/../g),x=>parseInt(x,16));
  const cryptoKey=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const verify=createLocalInvocationVerifier({databaseUuid:fixed.databaseUuid,payloadSha256,auditSha256:fixed.auditSha256,attemptId:fixed.attemptId,deploymentId:fixed.deploymentId,registryNamespaceId:fixed.registryNamespaceId,audience:fixed.audience},cryptoKey);
  // HTTP POST may carry an empty stream in workerd. Authenticate a bodyless view,
  // then require EOF without accepting any data chunk before claiming.
  const authRequest=new Request(request.url,{method:request.method,headers:request.headers});
  const authentication=await verify(authRequest,Date.now());
  const length=request.headers.get('content-length');
  if((length!==null&&length!=='0')||request.headers.has('transfer-encoding'))throw Error('BODY_NOT_EMPTY');
  if(request.body!==null){const reader=request.body.getReader();let timer;try{
   const first=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),1000);})]);
   if(!first.done)throw Error('BODY_NOT_EMPTY');
  }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}}
  fresh(authentication);
  store=createRegistryStore(env.REGISTRY);
  claimAttempted=true;
  const answer=await store.claimOnce(key,{state:'claimed',attemptId:fixed.attemptId,payloadSha256,auditSha256:fixed.auditSha256});
  if(answer===false)return Response.json({outcome:'denied-replay',...flags},{status:409});
  if(answer!==true)throw Error('UNCERTAIN_CLAIM');
  claimed=true;
  // No await between this final time gate and starting the fixed batch.
  fresh(authentication);
  const prepared=plan.map(p=>p.parameters.length?env.TARGET.prepare(p.sql).bind(...p.parameters):env.TARGET.prepare(p.sql));
  fresh(authentication);
  const result=await env.TARGET.batch(prepared);
  if(!Array.isArray(result)||result.length!==plan.length||result.some(r=>r.success!==true))throw Error('UNCERTAIN_BATCH');
  if(await store.finish(key,fixed.attemptId,'returned-unverified')!==true)throw Error('UNCERTAIN_FINISH');
  return Response.json({outcome:'returned-unverified',statements:plan.length,...flags});
 }catch{
  // Claim acknowledgement or target outcome may be lost. Never retry the target.
  if(claimed){try{await store.finish(key,fixed.attemptId,'unknown');}catch{ /* retained claim remains closed */ }}
  return Response.json({outcome:claimAttempted?'unknown':'denied',...flags},{status:claimAttempted?409:403});
 }
}};`;
 return Object.freeze({source,payloadSha256,remoteExecutionSupported:false,configured:true});
}
