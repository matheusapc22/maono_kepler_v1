import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readinessSource = await readFile(
  new URL(
    "../functions/_lib/organization-storage-readiness.js",
    import.meta.url,
  ),
  "utf8",
);
const organizationFilesSource = await readFile(
  new URL(
    "../functions/api/organizations/[id]/files.js",
    import.meta.url,
  ),
  "utf8",
);
const downloadSource = await readFile(
  new URL(
    "../functions/api/organizations/[id]/files/[fileId]/download.js",
    import.meta.url,
  ),
  "utf8",
);
const deleteSource = await readFile(
  new URL(
    "../functions/api/organizations/[id]/files/[fileId].js",
    import.meta.url,
  ),
  "utf8",
);
const adminFilesSource = await readFile(
  new URL(
    "../functions/api/admin/organizations/[id]/files.js",
    import.meta.url,
  ),
  "utf8",
);
const ticketCenterSource = await readFile(
  new URL("../functions/_lib/ticket-center.js", import.meta.url),
  "utf8",
);
const workerSource = await readFile(
  new URL("../workers/organization-storage-recovery.js", import.meta.url),
  "utf8",
);
const runbookSource = await readFile(
  new URL(
    "../docs/ops/organization-storage-recovery.md",
    import.meta.url,
  ),
  "utf8",
);
const boundariesSource = await readFile(
  new URL(
    "../docs/architecture/organization-storage-readiness-boundaries.md",
    import.meta.url,
  ),
  "utf8",
);

test("readiness é leitura de estado e não importa provider nem healing", () => {
  assert.match(readinessSource, /readOrganizationStorageReadiness/);
  assert.match(readinessSource, /requireOrganizationStorageReady/);
  assert.doesNotMatch(readinessSource, /ensureOrganizationStorage\(/);
  assert.doesNotMatch(readinessSource, /ensureDropboxFolder/);
  assert.doesNotMatch(readinessSource, /fetch\s*\(/);
});

test("GET de documentos é D1-only e não dispara healing", () => {
  assert.match(
    organizationFilesSource,
    /readOrganizationStorageReadiness\(organization\)/,
  );
  assert.doesNotMatch(
    organizationFilesSource,
    /ensureOrganizationStorage\(/,
  );

  const getReadiness = organizationFilesSource.indexOf(
    "readOrganizationStorageReadiness(organization)",
  );
  const listPage = organizationFilesSource.indexOf(
    "listOrganizationFilesPage(",
  );
  assert.ok(getReadiness >= 0);
  assert.ok(listPage > getReadiness);
});

test("operações físicas de documentos têm readiness gate; soft-trash permanece D1-only", () => {
  assert.match(
    organizationFilesSource,
    /requireOrganizationStorageReady\(organization/,
  );
  assert.match(downloadSource, /requireOrganizationStorageReady\(organization/);

  const gate = organizationFilesSource.indexOf(
    "requireOrganizationStorageReady(organization",
  );
  const upload = organizationFilesSource.indexOf(
    "uploadOrganizationBinary(",
  );
  assert.ok(gate >= 0 && upload > gate);

  // A partir da 08-S4, DELETE normal é retenção lógica por 10 dias.
  // Exigir readiness/Dropbox aqui reintroduziria a exclusão física que o
  // contrato da Lixeira explicitamente removeu.
  assert.match(deleteSource, /trashOrganizationFile/);
  assert.doesNotMatch(deleteSource, /requireOrganizationStorageReady\(organization/);
  assert.doesNotMatch(deleteSource, /deleteOrganizationBinary\(/);
});

test("ticket attachments deixam de fazer healing de organização no request", () => {
  assert.doesNotMatch(ticketCenterSource, /ensureOrganizationStorage\(/);
  assert.match(
    ticketCenterSource,
    /ticket\.attachment\.upload\.readiness/,
  );
  assert.match(
    ticketCenterSource,
    /ticket\.attachment\.download\.readiness/,
  );
  assert.match(
    ticketCenterSource,
    /ticket\.attachment\.delete\.readiness/,
  );
});

test("superfície Admin de arquivos físicos exige READY", () => {
  assert.match(adminFilesSource, /requireOrganizationStorageReady/);
  assert.match(adminFilesSource, /storage_status/);
  assert.match(adminFilesSource, /storage_checked_at/);

  const handler = adminFilesSource.slice(
    adminFilesSource.indexOf("export async function onRequest"),
  );
  const gate = handler.indexOf(
    "requireOrganizationStorageReady(organization",
  );
  const list = handler.indexOf("listDropboxFolder(");
  const upload = handler.indexOf("upsertOrganizationFile(");
  assert.ok(gate >= 0);
  assert.ok(list > gate);
  assert.ok(upload > gate);
});

test("worker é scheduled, nasce desabilitado e possui dry-run + kill switch", () => {
  assert.match(workerSource, /scheduled\(_controller, env, ctx\)/);
  assert.match(workerSource, /MAONO_STORAGE_RECOVERY_ENABLED/);
  assert.match(workerSource, /MAONO_STORAGE_RECOVERY_KILL_SWITCH/);
  assert.match(workerSource, /MAONO_STORAGE_RECOVERY_DRY_RUN/);
  assert.match(workerSource, /fairOrder: true/);
  assert.match(workerSource, /recordAuditLog/);
  assert.match(workerSource, /correlationId/);
});

test("runbook e matriz documentam ativação segura e boundaries", () => {
  assert.match(runbookSource, /DRY_RUN=true/);
  assert.match(runbookSource, /KILL_SWITCH=true/);
  assert.match(runbookSource, /não ativa o cron em Production automaticamente/i);

  assert.match(boundariesSource, /D1_ONLY/);
  assert.match(boundariesSource, /STORAGE_READ/);
  assert.match(boundariesSource, /STORAGE_WRITE/);
  assert.match(boundariesSource, /RECOVERY_BACKGROUND/);
});
