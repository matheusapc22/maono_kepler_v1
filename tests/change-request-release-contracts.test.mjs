import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { previewOrigin, verifyMigrationChecksums, assertLargeAcceptanceSize, assertReleaseHealth } from '../scripts/operations/change-request-release-contracts.mjs';
import { readAcceptanceConfig } from '../scripts/preview/change-request-acceptance-stream.mjs';

test('Preview credentials cannot target another project, production, userinfo or an injected URL', () => {
  assert.equal(previewOrigin('https://abcdef12.maono-kepler-v1.pages.dev/'), 'https://abcdef12.maono-kepler-v1.pages.dev');
  for (const url of ['https://attacker.test','https://maono-kepler-v1.pages.dev','https://a.maono-kepler-v1.pages.dev.attacker.test','https://cookie@a.maono-kepler-v1.pages.dev','http://a.maono-kepler-v1.pages.dev','https://a.maono-kepler-v1.pages.dev/path','https://a.maono-kepler-v1.pages.dev/?token=x']) assert.throws(() => previewOrigin(url));
});
test('migration bytes must match reviewed hashes, including on already-applied retries', () => {
  verifyMigrationChecksums();
  assert.throws(() => verifyMigrationChecksums(name => Buffer.concat([readFileSync(`migrations/${name}`),Buffer.from('-- drift')])), /checksum mismatch/);
});
test('small fixtures cannot pass the production large MapConfig acceptance', () => {
  for (const size of [0,8*1024*1024,90*1024*1024-1,101*1024*1024,NaN]) assert.throws(() => assertLargeAcceptanceSize(size));
  assertLargeAcceptanceSize(90*1024*1024);
});
test('pre-merge health allows old Production schema; closure still requires the complete stack', () => {
  const response = new Response('{}', { headers: {'X-Maono-Runtime-Env':'production'} });
  const body = {service:'maono-kepler-v1',runtime:{runtime:'production'},checks:{dbBinding:true,databaseReachable:true,dropboxAppKey:true,dropboxAppSecret:true,dropboxRefreshToken:true}};
  assertReleaseHealth(response, body, 'production', {stack:false});
  assert.throws(() => assertReleaseHealth(response, body, 'production'), /checks failed/);
  body.checks.changeRequestLifecycleReady = body.checks.changeRequestApplyArtifactReady = body.checks.changeRequestResubmissionReady = true;
  assertReleaseHealth(response,body,'production');
  body.checks.databaseReachable=false;
  assert.throws(() => assertReleaseHealth(response,body,'production',{stack:false}),/checks failed/);
});
test('config-stream rejects truncation and stale revision without retry or legacy JSON parsing', async () => {
  let calls=0;
  const args={origin:'https://abcdef12.maono-kepler-v1.pages.dev',slug:'qa-smoke-test',revision:4,cookie:'maono_session=fixture',fetcher:async (url,init) => {
    calls++; assert.match(url,/config-stream$/); assert.equal(init.redirect,'manual');
    return new Response('{}',{headers:{'X-Maono-Runtime-Env':'preview','X-Maono-Config-Transport':'stream','X-Maono-Config-Revision':'4','X-Maono-Config-Size':String(90*1024*1024)}});
  }};
  await assert.rejects(readAcceptanceConfig(args),/do not mask/);
  assert.equal(calls,1);
  await assert.rejects(readAcceptanceConfig({...args,revision:5}),/revision/);
});

test('session use is blocked for a Preview from a different commit or failed deployment', async () => {
  const { verifyPreviewDeployment } = await import('../scripts/operations/change-request-release-contracts.mjs');
  const origin='https://abcdef12.maono-kepler-v1.pages.dev';
  const env={VALIDATED_RELEASE_SHA:'a'.repeat(40),CLOUDFLARE_ACCOUNT_ID:'fixture',CLOUDFLARE_API_TOKEN:'fixture'};
  const deployment={url:origin,environment:'preview',latest_stage:{status:'success'},deployment_trigger:{metadata:{commit_hash:'a'.repeat(40)}}};
  const fetcher=async () => Response.json({success:true,result:[deployment]});
  await verifyPreviewDeployment(origin,fetcher,env);
  deployment.deployment_trigger.metadata.commit_hash='b'.repeat(40);
  await assert.rejects(verifyPreviewDeployment(origin,fetcher,env),/validated release SHA/);
  deployment.deployment_trigger.metadata.commit_hash='a'.repeat(40);
  deployment.latest_stage.status='failure';
  await assert.rejects(verifyPreviewDeployment(origin,fetcher,env),/validated release SHA/);
});
