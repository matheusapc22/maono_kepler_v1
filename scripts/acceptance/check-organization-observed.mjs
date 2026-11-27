// Invoked by the read-only ZIP verifier with bytes on stdin and independently pinned IDs.
import {readFileSync} from 'node:fs';
import {verifyObservedCase} from './organization-observed-case.mjs';

const [run,workflowSha,sha,caseId] = process.argv.slice(2);
try {
  const bundle = JSON.parse(readFileSync(0,'utf8'));
  const scenariosSha256 = verifyObservedCase(bundle,{run:Number(run),attempt:1,workflowSha,sha,caseId});
  const {success,conflict} = bundle.scenarios;
  const openedAt = Date.parse(success.capture.startedAt), finishedAt = Date.parse(conflict.capture.capturedAt);
  if (Date.parse(success.capture.capturedAt) > Date.parse(conflict.capture.startedAt) ||
      finishedAt < openedAt || finishedAt - openedAt > 55*60_000) throw new Error('OBSERVED_SEQUENCE');
  console.log(JSON.stringify({scenariosSha256,openedAt,finishedAt}));
} catch {
  process.exitCode=1;
}
