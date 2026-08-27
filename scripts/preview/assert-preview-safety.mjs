import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function read(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const runtime = await read("functions/_lib/runtime-environment.js");
const policy = await read("functions/_lib/preview-write-policy.js");
const middleware = await read("functions/_middleware.js");

assert.match(runtime, /MAONO_RUNTIME_ENV/);
assert.match(runtime, /MAONO_PREVIEW_MUTATIONS_ENABLED/);
assert.match(runtime, /MAONO_PREVIEW_QA_ORG_ID/);
assert.match(policy, /PREVIEW_WRITE_OUTSIDE_QA_ORG/);
assert.match(policy, /PREVIEW_GLOBAL_MUTATION_DENIED/);
assert.match(policy, /PREVIEW_MUTATIONS_DISABLED/);
assert.match(middleware, /evaluatePreviewWritePolicy/);
assert.match(middleware, /resolvePreviewMutationOrganizationId/);
assert.match(middleware, /X-Maono-Runtime-Env/);

const workflowsDir = new URL("../../.github/workflows/", import.meta.url);
const workflowNames = await readdir(workflowsDir);

for (const name of workflowNames) {
  if (!/\.ya?ml$/i.test(name)) continue;
  const source = await readFile(new URL(name, workflowsDir), "utf8");
  const isPreviewWorkflow = /preview/i.test(name) || /preview/i.test(source);
  if (!isPreviewWorkflow) continue;

  const remoteD1Mutation = /wrangler\s+d1\s+(?:migrations\s+apply|execute)[\s\S]{0,240}--remote/i;
  assert.doesNotMatch(
    source,
    remoteD1Mutation,
    `${path.basename(name)} não pode aplicar migration/execute remoto no D1 a partir do Preview`,
  );
}

console.log("Preview safety gate: OK");
