import {assertDiagnosticContext,diagnosePreflight} from './preflight-diagnostic.mjs';
try {
 if(process.platform!=='linux'||process.argv.length!==2)throw Error('DENIED');
 assertDiagnosticContext(process.env);
 const result=await diagnosePreflight({token:process.env.MAONO_SYNTHETIC_PROVISION_TOKEN});
 console.log(JSON.stringify(result));
 if(!result.results.every(r=>r.preflightAccepted===true))process.exitCode=1;
}catch{console.error('SYNTHETIC_DIAGNOSTIC_FAILED_CLOSED');process.exitCode=1;}
