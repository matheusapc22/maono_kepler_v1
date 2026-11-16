import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';
const workflow=readFileSync(new URL('../.github/workflows/d1-synthetic-readonly-audit.yml',import.meta.url),'utf8');
test('workflow audit is protected, main-only, exact manifest, never PR or arbitrary resource selection',()=>{
 assert.match(workflow,/github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/needs\.validate\.outputs\.enabled == 'true'/);assert.match(workflow,/environment: synthetic-d1-readonly-audit/);
 assert.match(workflow,/assertOwnerReviewPolicy/);assert.match(workflow,/MAONO_DISPATCH_ACTOR_ID: \$\{\{ github\.actor_id \}\}/);
 assert.match(workflow,/MAONO_SYNTHETIC_MANIFEST_SHA256: \$\{\{ inputs\.manifest_sha256 \}\}/);assert.ok(!/wrangler|d1 execute|deploy |MAONO_D1_MIGRATION_API_TOKEN|CLOUDFLARE_API_TOKEN|pull_request_target/.test(workflow));
});
test('CLI validates disabled template without token or network; audit fails closed',()=>{
 const valid=spawnSync(process.execPath,['scripts/d1-remote-audit/cli.mjs','--validate'],{encoding:'utf8'});assert.equal(valid.status,0,valid.stderr);const output=JSON.parse(valid.stdout);assert.equal(output.auditEnabled,false);assert.equal(output.configured,false);
 const audit=spawnSync(process.execPath,['scripts/d1-remote-audit/cli.mjs','--audit'],{encoding:'utf8',env:{...process.env,MAONO_ENABLE_SYNTHETIC_READONLY_AUDIT:'1',MAONO_SYNTHETIC_MANIFEST_SHA256:output.manifestSha256,MAONO_SYNTHETIC_AUDIT_READ_TOKEN:'ephemeralFakeReadTokenForTestsOnly'}});assert.equal(audit.status,1);assert.equal(audit.stdout,'');assert.equal(audit.stderr.trim(),'SYNTHETIC_READONLY_AUDIT_FAILED_CLOSED');assert.ok(!audit.stderr.includes('ephemeralFake'));
 const extra=spawnSync(process.execPath,['scripts/d1-remote-audit/cli.mjs','--audit','--account','anything'],{encoding:'utf8'});assert.equal(extra.status,1);
});

test('workflow enabled output has an actual newline, never a literal backslash n',()=>{
 assert.match(workflow,/String\.fromCharCode\(10\)/);
});
