import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOrganizationStorageDriftRepairs,
  buildOrganizationStorageDriftReport,
  ORGANIZATION_STORAGE_DRIFT_CODE,
  publicOrganizationStorageDriftReport,
} from "../functions/_lib/organization-storage-drift.js";

const NOW = Date.parse("2026-09-18T20:00:00.000Z");

function org(overrides = {}) {
  return {
    id: 1,
    name: "Cliente A",
    slug: "cliente-a",
    active: 1,
    dropbox_root_path: "/projects/cliente-a",
    storage_status: "READY",
    storage_error: null,
    storage_checked_at: "2026-09-18T19:00:00.000Z",
    ...overrides,
  };
}

function deps({
  organizations = [],
  files = [],
  entries = [],
  pages = 1,
} = {}) {
  return {
    listOrganizations: async () => organizations,
    listOrganizationFiles: async () => files,
    listProjectsRoot: async () => ({
      entries,
      cursor: "cursor-final",
      has_more: false,
      pages,
    }),
    requireSchema: async () => new Set([
      "dropbox_root_path",
      "storage_status",
      "storage_error",
      "storage_checked_at",
    ]),
  };
}

test("inventário classifica healthy, missing, orphan e path legacy sem mutação", async () => {
  let providerListCalls = 0;
  const dependencies = deps({
    organizations: [
      org({ id: 1, slug: "cliente-a" }),
      org({
        id: 2,
        name: "Cliente B",
        slug: "cliente-b",
        dropbox_root_path: "/projects/cliente-b",
      }),
      org({
        id: 3,
        name: "Legacy",
        slug: "legacy",
        dropbox_root_path: "/projects/legacy-antigo",
      }),
    ],
    entries: [
      {
        ".tag": "folder",
        name: "cliente-a",
        path_display: "/projects/cliente-a",
        path_lower: "/projects/cliente-a",
      },
      {
        ".tag": "folder",
        name: "legacy-antigo",
        path_display: "/projects/legacy-antigo",
        path_lower: "/projects/legacy-antigo",
      },
      {
        ".tag": "folder",
        name: "orphan-x",
        path_display: "/projects/orphan-x",
        path_lower: "/projects/orphan-x",
      },
    ],
  });

  const report = await buildOrganizationStorageDriftReport(
    {},
    {
      correlationId: "corr-prh07-report",
      nowFn: () => NOW,
      ...dependencies,
      listProjectsRoot: async (...args) => {
        providerListCalls += 1;
        return dependencies.listProjectsRoot(...args);
      },
    },
  );

  assert.equal(providerListCalls, 1);
  assert.equal(report.complete, true);
  assert.equal(report.summary.organizations, 3);
  assert.equal(report.summary.orphanFolders, 1);

  const healthy = report.organizations.find((item) => item.id === 1);
  assert.deepEqual(healthy.issues, []);
  assert.equal(healthy.repairable, false);

  const missing = report.organizations.find((item) => item.id === 2);
  assert.ok(
    missing.issues.some(
      (item) =>
        item.code ===
        ORGANIZATION_STORAGE_DRIFT_CODE.READY_MISSING_PHYSICAL,
    ),
  );
  assert.equal(missing.repairable, true);

  const legacy = report.organizations.find((item) => item.id === 3);
  assert.ok(
    legacy.issues.some(
      (item) =>
        item.code ===
        ORGANIZATION_STORAGE_DRIFT_CODE.PATH_LEGACY,
    ),
  );
  assert.equal(legacy.physicalFolderExists, true);

  assert.equal(
    report.orphanFolders[0].code,
    ORGANIZATION_STORAGE_DRIFT_CODE.ORPHAN_PHYSICAL,
  );
  assert.equal(report.orphanFolders[0].repairable, false);
});

test("READY com folder ausente é repairable e ERROR com folder existente converge por apply aprovado", async () => {
  const report = await buildOrganizationStorageDriftReport(
    {},
    {
      correlationId: "corr-prh07-classify",
      nowFn: () => NOW,
      ...deps({
        organizations: [
          org({ id: 1 }),
          org({
            id: 2,
            name: "Cliente B",
            slug: "cliente-b",
            dropbox_root_path: "/projects/cliente-b",
            storage_status: "ERROR",
            storage_error: "DROPBOX_UNAVAILABLE",
          }),
        ],
        entries: [
          {
            ".tag": "folder",
            name: "cliente-b",
            path_display: "/projects/cliente-b",
            path_lower: "/projects/cliente-b",
          },
        ],
      }),
    },
  );

  const first = report.organizations.find((item) => item.id === 1);
  assert.ok(
    first.issues.some(
      (item) =>
        item.code ===
        ORGANIZATION_STORAGE_DRIFT_CODE.READY_MISSING_PHYSICAL,
    ),
  );

  const second = report.organizations.find((item) => item.id === 2);
  assert.ok(
    second.issues.some(
      (item) =>
        item.code ===
        ORGANIZATION_STORAGE_DRIFT_CODE.PHYSICAL_PRESENT_NOT_READY,
    ),
  );

  const calls = [];
  const result = await applyOrganizationStorageDriftRepairs(
    {},
    {
      approvedOrganizationIds: [1, 2],
      confirmation: "APPLY_APPROVED_STORAGE_DRIFT",
      correlationId: "corr-prh07-apply",
      nowFn: () => NOW,
      buildReport: async () => report,
      ensureStorage: async (_env, row, options) => {
        calls.push({
          id: row.id,
          revalidateReady: options.revalidateReady,
          correlationId: options.correlationId,
        });
        return {
          organization: {
            ...row,
            storage_status: "READY",
            storage_error: null,
          },
          status: "READY",
          ready: true,
          repairedPath: false,
          superseded: false,
        };
      },
    },
  );

  assert.equal(result.repaired, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    calls.map((item) => item.id),
    [1, 2],
  );
  assert.ok(calls.every((item) => item.revalidateReady === true));
  assert.ok(
    calls.every(
      (item) => item.correlationId === "corr-prh07-apply",
    ),
  );
});

test("path legacy e orphan nunca são auto-aplicados", async () => {
  const report = await buildOrganizationStorageDriftReport(
    {},
    {
      correlationId: "corr-prh07-no-auto",
      nowFn: () => NOW,
      ...deps({
        organizations: [
          org({
            id: 7,
            slug: "cliente-sete",
            dropbox_root_path: "/projects/nome-antigo",
          }),
        ],
        entries: [
          {
            ".tag": "folder",
            name: "nome-antigo",
            path_display: "/projects/nome-antigo",
            path_lower: "/projects/nome-antigo",
          },
          {
            ".tag": "folder",
            name: "orphan",
            path_display: "/projects/orphan",
            path_lower: "/projects/orphan",
          },
        ],
      }),
    },
  );

  let ensureCalls = 0;
  const result = await applyOrganizationStorageDriftRepairs(
    {},
    {
      approvedOrganizationIds: [7],
      confirmation: "APPLY_APPROVED_STORAGE_DRIFT",
      correlationId: "corr-prh07-no-auto",
      buildReport: async () => report,
      ensureStorage: async () => {
        ensureCalls += 1;
      },
    },
  );

  assert.equal(ensureCalls, 0);
  assert.equal(result.repaired, 0);
  assert.equal(result.skipped, 1);
  assert.equal(
    result.organizations[0].reason,
    "NO_APPROVED_REPAIRABLE_DRIFT",
  );
  assert.equal(report.orphanFolders.length, 1);
});

test("path inválido bloqueia apply mesmo quando o estado também seria repairable", async () => {
  const report = await buildOrganizationStorageDriftReport(
    {},
    {
      correlationId: "corr-prh07-path-block",
      nowFn: () => NOW,
      ...deps({
        organizations: [
          org({
            id: 11,
            slug: "cliente-onze",
            dropbox_root_path: "/legacy/cliente-onze",
            storage_status: "UNKNOWN",
          }),
        ],
        entries: [],
      }),
    },
  );

  assert.equal(report.organizations[0].pathDecisionRequired, true);
  assert.equal(report.organizations[0].repairable, false);

  let ensureCalls = 0;
  const result = await applyOrganizationStorageDriftRepairs(
    {},
    {
      approvedOrganizationIds: [11],
      confirmation: "APPLY_APPROVED_STORAGE_DRIFT",
      correlationId: "corr-prh07-path-block",
      buildReport: async () => report,
      ensureStorage: async () => {
        ensureCalls += 1;
      },
    },
  );

  assert.equal(ensureCalls, 0);
  assert.equal(result.repaired, 0);
  assert.equal(result.skipped, 1);
  assert.equal(
    result.organizations[0].reason,
    "NO_APPROVED_REPAIRABLE_DRIFT",
  );
});

test("apply exige confirmação explícita e lote aprovado limitado", async () => {
  await assert.rejects(
    () =>
      applyOrganizationStorageDriftRepairs(
        {},
        {
          approvedOrganizationIds: [1],
          confirmation: "wrong",
        },
      ),
    (error) => {
      assert.equal(
        error.code,
        "ORGANIZATION_STORAGE_DRIFT_CONFIRMATION_REQUIRED",
      );
      return true;
    },
  );

  await assert.rejects(
    () =>
      applyOrganizationStorageDriftRepairs(
        {},
        {
          approvedOrganizationIds: [],
          confirmation: "APPLY_APPROVED_STORAGE_DRIFT",
        },
      ),
    (error) => {
      assert.equal(
        error.code,
        "ORGANIZATION_STORAGE_DRIFT_APPROVAL_REQUIRED",
      );
      return true;
    },
  );
});

test("metadata de arquivo fora da raiz da organização é reportada e nunca auto-reparada", async () => {
  const report = await buildOrganizationStorageDriftReport(
    {},
    {
      correlationId: "corr-prh07-file",
      nowFn: () => NOW,
      ...deps({
        organizations: [org({ id: 5 })],
        files: [
          {
            id: 91,
            organization_id: 5,
            active: 1,
            dropbox_path: "/projects/outra-org/documents/a.json",
          },
        ],
        entries: [
          {
            ".tag": "folder",
            name: "cliente-a",
            path_display: "/projects/cliente-a",
            path_lower: "/projects/cliente-a",
          },
        ],
      }),
    },
  );

  assert.equal(report.organizations[0].fileIssues.length, 1);
  assert.equal(
    report.organizations[0].fileIssues[0].code,
    ORGANIZATION_STORAGE_DRIFT_CODE.FILE_PATH_OUTSIDE_ORGANIZATION,
  );
  assert.equal(report.organizations[0].fileIssues[0].repairable, false);
});

test("relatório público remove rows internos usados pelo apply", async () => {
  const report = await buildOrganizationStorageDriftReport(
    {},
    {
      correlationId: "corr-prh07-public",
      nowFn: () => NOW,
      ...deps({
        organizations: [org()],
        entries: [
          {
            ".tag": "folder",
            name: "cliente-a",
            path_display: "/projects/cliente-a",
            path_lower: "/projects/cliente-a",
          },
        ],
      }),
    },
  );

  const publicReport = publicOrganizationStorageDriftReport(report);
  assert.equal("_rowsById" in publicReport, false);
  assert.equal(publicReport.correlationId, "corr-prh07-public");
});
