// Validation only. Never creates environments, approves jobs or grants access.
const OWNER_ID=172453089;
export function assertOwnerReviewPolicy(environment,options) {
 const deny=()=>{throw Error('SYNTHETIC_OWNER_REVIEW_POLICY_DENIED');};
 if(!options||typeof options!=='object'||Array.isArray(options))deny();
 const {actorId,repository}=options;
 if(actorId!==String(OWNER_ID)||repository!=='matheusapc22/maono_kepler_v1'||
    !environment||Array.isArray(environment)||environment.name!=='synthetic-d1-readonly-audit'||
    environment.can_admins_bypass!==false||!Array.isArray(environment.protection_rules))deny();
 const rules=environment.protection_rules.filter(r=>r&&r.type==='required_reviewers');
 if(rules.length!==1)deny();
 const rule=rules[0];
 if(Array.isArray(rule)||rule.prevent_self_review!==false||!Array.isArray(rule.reviewers)||rule.reviewers.length!==1)deny();
 const reviewer=rule.reviewers[0];
 if(!reviewer||Array.isArray(reviewer)||reviewer.type!=='User'||!reviewer.reviewer||Array.isArray(reviewer.reviewer)||
    reviewer.reviewer.id!==OWNER_ID||reviewer.reviewer.login!=='matheusapc22')deny();
 return Object.freeze({manualOwnerApprovalRequired:true,independentReview:false});
}
