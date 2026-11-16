import {assertOwnerReviewPolicy} from '../d1-remote-audit/owner-review-policy.mjs';
export function assertProvisionGate(environment,runs,options) {
 if(!options||typeof options!=='object'||Array.isArray(options))throw Error('PROVISION_GATE_DENIED');
 const {actorId,repository,runId,runAttempt}=options;
 if(!environment||Array.isArray(environment)||environment.name!=='synthetic-d1-provision'||runAttempt!=='1'||
    typeof runId!=='string'||!/^\d+$/.test(runId)||!runs||Array.isArray(runs)||runs.total_count!==1||
    !Array.isArray(runs.workflow_runs)||runs.workflow_runs.length!==1)throw Error('PROVISION_GATE_DENIED');
 const run=runs.workflow_runs[0];
 if(!run||Array.isArray(run)||!Number.isSafeInteger(run.id)||String(run.id)!==runId||run.event!=='workflow_dispatch'||run.run_attempt!==1||
    run.head_branch!=='main'||run.actor?.id!==172453089||run.path!=='.github/workflows/d1-synthetic-provision.yml')throw Error('PROVISION_GATE_DENIED');
 // Reuse owner identity/review requirements only AFTER enforcing the distinct scope.
 assertOwnerReviewPolicy({...environment,name:'synthetic-d1-readonly-audit'},{actorId,repository});
 return Object.freeze({singleDispatchObserved:true,manualApprovalRequired:true,independentReview:false});
}
