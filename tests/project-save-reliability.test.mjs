import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceSource = await readFile(
  new URL("../functions/_lib/project-config-service.js", import.meta.url),
  "utf8",
);

test("sync de organization_files é auxiliar e não rebaixa save persistido", () => {
  assert.match(
    serviceSource,
    /async function updateLinkedOrganizationFile[\s\S]*try \{[\s\S]*UPDATE organization_files[\s\S]*catch \(error\) \{[\s\S]*organization_file_sync/,
  );
  assert.match(
    serviceSource,
    /PROJECT_ORGANIZATION_FILE_SYNC_FAILED/,
  );
  assert.match(
    serviceSource,
    /auxiliaryWarnings:/,
  );
});

test("revisão já publicada nunca é marcada FAILED por etapa auxiliar posterior", () => {
  assert.match(
    serviceSource,
    /publicationCompleted = Boolean\(reservation\.alreadyPublished\)/,
  );
  assert.match(
    serviceSource,
    /const updatedProject = await runObservedStage\(trace, "PUBLISH",[\s\S]*publishProjectConfigRevision\(env,[\s\S]*publicationCompleted = true/,
  );
  assert.match(
    serviceSource,
    /if \(\s*reservation &&\s*!publicationCompleted &&[\s\S]*markProjectConfigRevisionFailed/,
  );
});

test("legado distingue upload feito de commit de metadata não confirmado", () => {
  assert.match(
    serviceSource,
    /PROJECT_CONFIG_COMMIT_NOT_CONFIRMED/,
  );
  assert.match(
    serviceSource,
    /stage: "project_metadata_commit"/,
  );
  assert.match(
    serviceSource,
    /storageWriteCompleted: true/,
  );
  assert.match(
    serviceSource,
    /retryable: true/,
  );
});


test("PRL-10: recovery de UPDATE depende do contrato idempotente revisão + checksum", async () => {
  const revisionsSource = await readFile(
    new URL("../functions/_lib/project-config-revisions.js", import.meta.url),
    "utf8",
  );

  assert.match(
    revisionsSource,
    /currentRevision === nextRevision[\s\S]*config_checksum[\s\S]*publishedLedger\?\.status === "READY"[\s\S]*alreadyPublished: true/,
  );
  assert.match(
    revisionsSource,
    /existing\.status === "FAILED"[\s\S]*attempts = attempts \+ 1/,
  );
});
