// Pure metadata contract tests. No GitHub API, approval, environment or credential changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOwnerReviewPolicy} from '../scripts/d1-remote-audit/owner-review-policy.mjs';
const context=()=>({actorId:'172453089',repository:'matheusapc22/maono_kepler_v1'});
function metadata(){return {name:'synthetic-d1-readonly-audit',can_admins_bypass:false,protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:172453089,login:'matheusapc22'}}]}]};}
function denyMutation(mutate){const m=metadata();mutate(m);assert.throws(()=>assertOwnerReviewPolicy(m,context()));}
test('owner-only manual approval is explicitly non-independent',()=>{
 assert.deepEqual(assertOwnerReviewPolicy(metadata(),context()),{manualOwnerApprovalRequired:true,independentReview:false});
});
test('environment identity, explicit bypass denial and self-review choice must match exactly',()=>{
 for(const mutation of [m=>{delete m.name;},m=>{m.name='production-d1-migrations';},m=>{m.name='synthetic-d1-readonly-audit-other';},m=>{m.name=['synthetic-d1-readonly-audit'];},m=>{delete m.can_admins_bypass;},m=>{m.can_admins_bypass=true;},m=>{m.can_admins_bypass=0;},m=>{m.can_admins_bypass='false';},m=>{delete m.protection_rules[0].prevent_self_review;},m=>{m.protection_rules[0].prevent_self_review=true;},m=>{m.protection_rules[0].prevent_self_review=0;}])denyMutation(mutation);
});
test('missing, malformed and duplicate reviewer rules fail closed',()=>{
 for(const mutation of [m=>{delete m.protection_rules;},m=>{m.protection_rules=[];},m=>{m.protection_rules={0:m.protection_rules[0],length:1};},m=>{m.protection_rules=[null];},m=>{m.protection_rules[0].type='wait_timer';},m=>{m.protection_rules.push(structuredClone(m.protection_rules[0]));},m=>{m.protection_rules[0]=Object.assign([],m.protection_rules[0]);},m=>{delete m.protection_rules[0].reviewers;},m=>{m.protection_rules[0].reviewers=[];},m=>{m.protection_rules[0].reviewers.push(structuredClone(m.protection_rules[0].reviewers[0]));},m=>{m.protection_rules[0].reviewers={0:m.protection_rules[0].reviewers[0],length:1};}])denyMutation(mutation);
});
test('reviewer must be the exact numeric owner User identity, not Team or matching display name',()=>{
 for(const mutation of [m=>{m.protection_rules[0].reviewers[0].type='Team';},m=>{delete m.protection_rules[0].reviewers[0].type;},m=>{m.protection_rules[0].reviewers[0].reviewer.id=1;},m=>{m.protection_rules[0].reviewers[0].reviewer.id='172453089';},m=>{m.protection_rules[0].reviewers[0].reviewer.login='another-user';},m=>{m.protection_rules[0].reviewers[0].reviewer.login=['matheusapc22'];},m=>{m.protection_rules[0].reviewers[0].reviewer.login='MatheusAPC22';},m=>{m.protection_rules[0].reviewers[0].reviewer={name:'matheusapc22'};},m=>{m.protection_rules[0].reviewers[0].reviewer=Object.assign([],{id:172453089,login:'matheusapc22'});},m=>{m.protection_rules[0].reviewers[0]=Object.assign([],m.protection_rules[0].reviewers[0]);}])denyMutation(mutation);
});
test('dispatcher must be exact owner ID string and exact repository, with no coercion',()=>{
 for(const c of [{actorId:'1',repository:context().repository},{actorId:172453089,repository:context().repository},{actorId:['172453089'],repository:context().repository},{actorId:'172453089',repository:'matheusapc22/other'},{actorId:'172453089',repository:'other/maono_kepler_v1'},{actorId:'172453089',repository:[context().repository]},{actorId:'172453089'},{repository:context().repository},null,[],Object.assign([],context())])assert.throws(()=>assertOwnerReviewPolicy(metadata(),c));
});
test('non-object and array-shaped metadata never becomes an approval policy',()=>{
 for(const m of [null,undefined,false,'synthetic-d1-readonly-audit',[],Object.assign([],metadata())])assert.throws(()=>assertOwnerReviewPolicy(m,context()));
});
