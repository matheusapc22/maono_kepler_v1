import {createHash} from 'node:crypto';
const expected={schemaVersion:1,enabled:false,planId:'maono-free-synthetic-pilot-20261116',accountId:'1988481e4c75c760516161104b7e1e50',databaseName:'maono_synthetic_rehearsal_pilot_20261116',workerName:'maono-synthetic-rehearsal-pilot-20261116',registryClassName:'SyntheticClaimRegistry',maxWorkers:1,maxDatabases:1,maxNamespaces:1,maxLifetimeHours:24,spendingLimitUSD:0,freeOnly:true,allowSubscriptionChange:false,allowDelete:false,allowSql:false,allowTransientDenyAllEndpoint:true,manualOwnerApprovalRequired:true,productionAllowed:false};
export function validateProvisionPlan(bytes) {
 const fail=()=>{throw Error('SYNTHETIC_PROVISION_PLAN_DENIED');};
 if(!(bytes instanceof Uint8Array)||bytes.length>16384)fail();
 let text,plan;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/\r\n/g,'\n');if(text.charCodeAt(0)===0xfeff||text.includes('\r'))fail();plan=JSON.parse(text);}catch{fail();}
 if(!plan||Array.isArray(plan)||Object.keys(plan).length!==Object.keys(expected).length||typeof plan.enabled!=='boolean'||Object.entries(expected).some(([key,value])=>key!=='enabled'&&plan[key]!==value))fail();
 return Object.freeze({plan:Object.freeze({...plan}),sha256:createHash('sha256').update(text).digest('hex'),executionEnabled:plan.enabled});
}
