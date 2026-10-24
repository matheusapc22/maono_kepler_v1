import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/production-acceptance-operator.yml',import.meta.url),'utf8');
test('CC07 dispatcher accepts a data-only plan and keeps human environment/concurrency/budgets',()=>{
 assert.match(workflow,/cc07_plan:/);assert.match(workflow,/MAONO_ACCEPTANCE_CC07_PLAN_JSON: \$\{\{ inputs.cc07_plan \}\}/);
 assert.match(workflow,/environment: production-acceptance/);assert.match(workflow,/cancel-in-progress: false/);
 assert.match(workflow,/timeout-minutes: 210/);assert.match(workflow,/timeout-minutes: 192/);
 assert.doesNotMatch(workflow,/^\s*(?:schedule|push):/m);
});
test('CC07 credentials are conditional and scoped exclusively to protected execution',()=>{
 const execution=workflow.slice(workflow.indexOf('name: Execute protected Production acceptance operation'),workflow.indexOf('name: Summarize sanitized acceptance result'));
 for(const name of ['MAONO_ACCEPTANCE_CC07_WORKER_TOKEN','MAONO_ACCEPTANCE_CC07_D1_READ_TOKEN','MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON']){
  assert.equal(workflow.split(`${name}:`).length-1,1);assert.match(execution,new RegExp(`${name}: \\$\\{\\{ inputs.suite == 'cc07-notifications'`));
 }
 assert.match(execution,/inputs.suite == 'cc07-notifications' && inputs.mode == 'run' && secrets.MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON/);
 assert.match(execution,/inputs.suite != 'cc07-notifications' && secrets.MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON/);
 assert.doesNotMatch(workflow,/MAONO_D1_MIGRATION_API_TOKEN/);
});
