import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  activeFlags,
  flagSnapshot,
  parseCredentials,
  safeFlags,
  suiteContext,
  validateManifest,
} from "../scripts/acceptance/production-acceptance-lib.mjs";
import { publicManifest } from "../scripts/acceptance/registry.mjs";
import { manifest as cc04 } from "../scripts/acceptance/suites/cc04-selective-access.mjs";

const workflow = await readFile(
  new URL("../.github/workflows/production-acceptance-operator.yml", import.meta.url),
  "utf8",
);
const operator = await readFile(
  new URL("../scripts/acceptance/operator.mjs", import.meta.url),
  "utf8",
);
const acceptanceLib = await readFile(
  new URL("../scripts/acceptance/production-acceptance-lib.mjs", import.meta.url),
  "utf8",
);
const suiteSource = await readFile(
  new URL("../scripts/acceptance/suites/cc04-selective-access.mjs", import.meta.url),
  "utf8",
);

test("generic operator is manual-only for protected Production execution", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push\s*:/m);
  assert.doesNotMatch(workflow, /^\s*schedule\s*:/m);
  assert.match(workflow, /environment: production-acceptance/);
  assert.match(workflow, /group: maono-production-acceptance/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("dispatch requires repository owner, main ref and explicit mode confirmations", () => {
  assert.match(workflow, /test "\$ACTOR" = "\$OWNER"/);
  assert.match(workflow, /test "\$DISPATCH_REF" = "main"/);
  assert.match(workflow, /PREPARE_PRODUCTION_ACCEPTANCE/);
  assert.match(workflow, /RUN_PRODUCTION_ACCEPTANCE/);
  assert.match(workflow, /RESTORE_PRODUCTION_ACCEPTANCE_SAFE_STATE/);
});

test("protected secrets are only injected into the operator step", () => {
  const cloudflare = workflow.match(/MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN \}\}/g) || [];
  const credentials = workflow.match(/MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON:/g) || [];
  assert.equal(cloudflare.length, 1);
  assert.equal(credentials.length, 1);
  assert.doesNotMatch(workflow, /env:\s*\n(?:.*\n)*?\s+MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN:[\s\S]*?steps:/);
});

test("official actions in protected workflow are immutable-SHA pinned and package cache is disabled", () => {
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node|upload-artifact)@v\d/);
  assert.match(workflow, /package-manager-cache: false/);
});

test("workflow pins mano_kepler_v1 and refuses drift before protected access", () => {
  assert.match(workflow, /PRODUCT_BRANCH: mano_kepler_v1/);
  assert.match(workflow, /release_sha: \$\{\{ steps\.pin\.outputs\.sha \}\}/);
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/);
  assert.match(workflow, /git ls-remote origin/);
  assert.match(workflow, /test "\$current" = "\$VALIDATED_RELEASE_SHA"/);
});

test("browser runtime is isolated, exact-versioned and installed before production secrets", () => {
  const installIndex = workflow.indexOf("Install isolated browser runtime before any Production secret is exposed");
  const operatorIndex = workflow.indexOf("Execute protected Production acceptance operation");
  assert.ok(installIndex > 0 && operatorIndex > installIndex);
  assert.match(workflow, /needs\.validate\.outputs\.browser_required == 'true' && inputs\.mode == 'run'/);
  assert.match(workflow, /npm install --prefix scripts\/acceptance/);
  assert.match(workflow, /--ignore-scripts/);
  assert.match(workflow, /@playwright\/test@1\.55\.0/);
  assert.match(workflow, /scripts\/acceptance\/node_modules\/\.bin\/playwright install --with-deps chromium/);
  assert.match(workflow, /git diff --exit-code -- \./);
  assert.match(workflow, /git status --porcelain --untracked-files=no/);
});

test("suite manifest is generic-contract compatible and exposes only registered metadata", () => {
  assert.doesNotThrow(() => validateManifest(cc04));
  const publicValue = publicManifest("cc04-selective-access");
  assert.equal(publicValue.id, "cc04-selective-access");
  assert.equal(publicValue.mutationMode, "controlled_mutation");
  assert.equal(publicValue.requiresBrowser, true);
  assert.deepEqual(publicValue.cases, ["CT-11", "CT-12", "CT-13", "CT-50"]);
});

test("feature flags have explicit baseline, active and safe states", () => {
  assert.deepEqual(activeFlags(cc04), { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: true });
  assert.deepEqual(safeFlags(cc04), { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: false });
  assert.deepEqual(
    flagSnapshot(
      { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: { type: "plain_text", value: "false" } },
      ["MAONO_TICKET_SELECTIVE_ACCESS_ENABLED"],
    ),
    { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: { state: "observed", value: false } },
  );
});

test("read_only suites are technically blocked from mutating application endpoints", async () => {
  const context = suiteContext({
    baseUrl: "https://maono.test",
    organizationId: 1,
    profiles: { reader: { cookie: "maono_session=fake", user: { id: 1 } } },
    mutationMode: "read_only",
    deps: { fetchImpl: async () => { throw new Error("network should not be reached"); } },
  });
  await assert.rejects(
    () => context.api("reader", "/api/test", { method: "POST", json: { x: 1 } }),
    (error) => error?.code === "READ_ONLY_SUITE_MUTATION_BLOCKED",
  );
});

test("credential bundle requires named profiles but never surfaces passwords in public metadata", () => {
  const secret = JSON.stringify({
    manager: { email: "manager@example.test", password: "SECRET-1" },
    allowed: { email: "allowed@example.test", password: "SECRET-2" },
    restricted: { email: "restricted@example.test", password: "SECRET-3" },
  });
  const parsed = parseCredentials(secret, cc04.requiredProfiles);
  assert.equal(parsed.manager.email, "manager@example.test");
  assert.equal(parsed.manager.password, "SECRET-1");
  assert.throws(() => parseCredentials("{}", cc04.requiredProfiles), /Credencial QA ausente/);
  assert.equal(JSON.stringify(publicManifest("cc04-selective-access")).includes("SECRET"), false);
});

test("operator blocks flag transitions while Production deployment queue is non-terminal", () => {
  assert.match(acceptanceLib, /pendingProductionDeployments/);
  assert.match(acceptanceLib, /value\.isSkipped !== true/);
  assert.match(acceptanceLib, /PRODUCTION_DEPLOYMENT_IN_PROGRESS/);
  assert.match(acceptanceLib, /waitProductionQuiescent/);
  const transition = acceptanceLib.indexOf("export async function transitionFlags");
  const firstWait = acceptanceLib.indexOf("waitProductionQuiescent", transition);
  const patch = acceptanceLib.indexOf("patchFlags", transition);
  const secondWait = acceptanceLib.indexOf("waitProductionQuiescent", patch);
  const retry = acceptanceLib.indexOf("retryDeployment", transition);
  assert.ok(transition > 0 && firstWait > transition && patch > firstWait && secondWait > patch && retry > secondWait);
});

test("operator skips flag redeploys for suites without managed flags", () => {
  assert.match(operator, /SUITE_HAS_NO_MANAGED_FLAGS/);
  assert.match(operator, /Object\.keys\(manifest\.managedFlags\)\.length > 0/);
  assert.match(operator, /mutationMode: manifest\.mutationMode/);
});

test("operator restores safe flags in finally and offers independent closure mode", () => {
  assert.match(operator, /finally \{[\s\S]*?context\.cleanup\(\)[\s\S]*?transitionFlags\([\s\S]*?safeFlags\(manifest\)/);
  assert.match(operator, /options\.mode === "closure"/);
  assert.match(operator, /configurationRestored = true/);
  assert.match(operator, /cleanupComplete = cleanupErrors\.length === 0/);
});

test("CC-04 suite uses only synthetic data and covers HTTP, attachment and UI revocation surfaces", () => {
  assert.match(suiteSource, /QA-CC04-/);
  assert.match(suiteSource, /Dados sintéticos/);
  assert.match(suiteSource, /CT-11/);
  assert.match(suiteSource, /CT-12/);
  assert.match(suiteSource, /CT-13/);
  assert.match(suiteSource, /CT-50/);
  assert.match(suiteSource, /attachments/);
  assert.match(suiteSource, /download/);
  assert.match(suiteSource, /O chamado não está mais disponível para seu acesso\./);
  assert.match(suiteSource, /visibility: "organization"/);
  assert.match(suiteSource, /active: false, members: \[\]/);
  assert.match(suiteSource, /triageEnabled/);
  assert.match(suiteSource, /\.\.\.\(triageEnabled \?/);
});

test("workflow never carries D1 migration credentials or generic shell input", () => {
  assert.doesNotMatch(workflow, /MAONO_D1_MIGRATION_API_TOKEN/);
  assert.doesNotMatch(workflow, /^\s+CLOUDFLARE_API_TOKEN:/m);
  assert.doesNotMatch(workflow, /command:/);
  assert.doesNotMatch(workflow, /script:/);
});
