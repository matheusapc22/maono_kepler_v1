import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/large-create-preview-acceptance.yml", import.meta.url),
  "utf8",
);
const runner = await readFile(
  new URL("../scripts/large-create/preview-acceptance.mjs", import.meta.url),
  "utf8",
);

test("operator de acceptance é manual-only e exige confirmação explícita", () => {
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(workflow, /RUN_LARGE_CREATE_PREVIEW_ACCEPTANCE/);
  assert.match(workflow, /large-create-preview-acceptance/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test("operator fixa SHA, recusa drift e só aceita Preview pages.dev", () => {
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git ls-remote origin/);
  assert.match(workflow, /VALIDATED_RELEASE_SHA/);
  assert.match(workflow, /\.pages\\\.dev/);
  assert.match(workflow, /target_mib/);
  assert.match(workflow, /n < 90 \|\| n > 100/);
});

test("cookie QA entra apenas por GitHub Secret e não é impresso", () => {
  assert.match(
    workflow,
    /MAONO_PREVIEW_CREATOR_SESSION_COOKIE:\s*\$\{\{ secrets\.MAONO_PREVIEW_CREATOR_SESSION_COOKIE \}\}/,
  );
  assert.doesNotMatch(workflow, /echo\s+.*MAONO_PREVIEW_CREATOR_SESSION_COOKIE/);
  assert.doesNotMatch(workflow, /printenv/);
  assert.doesNotMatch(runner, /console\.(?:log|info|error)\([^\n]*sessionCookie/);
});

test("runner exige runtime Preview, QA org, feature flag e mutations abertas", () => {
  assert.match(runner, /runtime\?\.runtime,\s*"preview"/);
  assert.match(runner, /previewMutationsEnabled,\s*true/);
  assert.match(runner, /largeCreateStreamEnabled,\s*true/);
  assert.match(runner, /EXPECTED_QA_ORG_ID/);
  assert.match(runner, /EXPECTED_QA_ORG_SLUG/);
  assert.match(runner, /permissions\.has\("project\.create"\)/);
});
