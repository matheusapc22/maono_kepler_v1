import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {validateProvisionPlan} from './plan.mjs';
import {provisionFixedPilot} from './fixed-core.mjs';
import {createRunJournal} from './journal.mjs';
let journal;
try {
 const mode=process.argv.slice(2);if(mode.length!==1||!['--validate','--provision'].includes(mode[0]))throw Error('DENIED');
 const {plan,sha256,executionEnabled}=validateProvisionPlan(readFileSync('ops/d1-synthetic-provision/plan.json'));
 if(mode[0]==='--validate'){console.log(JSON.stringify({planSha256:sha256,executionEnabled,resourcesCreated:false}));}
 else {
  if(process.platform!=='linux'||!executionEnabled||process.env.MAONO_PROVISION_PLAN_SHA256!==sha256||process.env.GITHUB_ACTIONS!=='true'||
     process.env.GITHUB_REPOSITORY!=='matheusapc22/maono_kepler_v1'||process.env.GITHUB_REF!=='refs/heads/main'||
     process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_RUN_ATTEMPT!=='1'||
     process.env.GITHUB_ACTOR_ID!=='172453089'||process.env.GITHUB_WORKFLOW_REF!=='matheusapc22/maono_kepler_v1/.github/workflows/d1-synthetic-provision.yml@refs/heads/main')throw Error('DENIED');
  const o=JSON.parse(readFileSync('ops/d1-synthetic-provision/free-observation.json','utf8').replace(/^\uFEFF/,''));
  if(!o||Array.isArray(o)||typeof o.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(o.observedAt)||!Number.isFinite(Date.parse(o.observedAt))||new Date(o.observedAt).toISOString().replace('.000Z','Z')!==o.observedAt||o.accountId!==plan.accountId||o.plan!=='Free'||o.displayedPriceUSD!==0||o.method!=='authenticated-dashboard-read'||
     o.sourceUrl!=='https://dash.cloudflare.com/'+plan.accountId+'/workers/plans'||o.operatorObservationOnly!==true||o.cryptographicAttestation!==false||o.maxAgeSeconds!==3600)throw Error('DENIED');
  const freeObservation={accountId:o.accountId,plan:'free',monthlyBaseUSD:0,observedAtMs:Date.parse(o.observedAt),source:'cloudflare-dashboard',operatorObservationOnly:true};
  mkdirSync('.tmp/d1-synthetic-provision',{recursive:true});journal=createRunJournal('.tmp/d1-synthetic-provision/journal.jsonl');
  const result=await provisionFixedPilot({plan,freeObservation,token:process.env.MAONO_SYNTHETIC_PROVISION_TOKEN,journal});
  writeFileSync('.tmp/d1-synthetic-provision/result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result));if(result.status!=='provisioned-deny-all')process.exitCode=1;
 }
}catch{process.stderr.write('SYNTHETIC_PROVISION_RUNNER_FAILED_CLOSED\n');process.exitCode=1;}finally{journal?.close();}
