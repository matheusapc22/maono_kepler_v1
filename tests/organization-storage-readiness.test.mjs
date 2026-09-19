import assert from "node:assert/strict";
import test from "node:test";

import {
  publicOrganizationStorageReadiness,
  readOrganizationStorageReadiness,
  requireOrganizationStorageReady,
} from "../functions/_lib/organization-storage-readiness.js";

function organization(overrides = {}) {
  return {
    id: 1,
    slug: "acme",
    active: 1,
    dropbox_root_path: "/projects/acme",
    storage_status: "READY",
    storage_error: null,
    storage_checked_at: "2026-09-18T18:00:00.000Z",
    ...overrides,
  };
}

const NOW = Date.parse("2026-09-18T18:00:30.000Z");

test("READY saudável é liberado sem side effect", () => {
  const readiness = readOrganizationStorageReadiness(
    organization(),
    { nowFn: () => NOW },
  );

  assert.deepEqual(readiness, {
    status: "READY",
    ready: true,
    busy: false,
    retryable: false,
    recoveryRecommended: false,
    reason: "READY",
    checkedAt: "2026-09-18T18:00:00.000Z",
  });

  assert.deepEqual(
    publicOrganizationStorageReadiness(readiness),
    {
      status: "READY",
      ready: true,
      busy: false,
      retryable: false,
      recoveryRecommended: false,
      checkedAt: "2026-09-18T18:00:00.000Z",
    },
  );
});

test("PENDING recente é busy e não recomenda segundo healing", () => {
  const readiness = readOrganizationStorageReadiness(
    organization({
      storage_status: "PENDING",
      storage_checked_at: "2026-09-18T18:00:00.000Z",
    }),
    { nowFn: () => NOW, claimTtlMs: 120_000 },
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.busy, true);
  assert.equal(readiness.retryable, true);
  assert.equal(readiness.recoveryRecommended, false);
  assert.equal(readiness.reason, "CLAIM_IN_PROGRESS");
});

test("PENDING expirado e ERROR recomendam recovery", () => {
  const stale = readOrganizationStorageReadiness(
    organization({
      storage_status: "PENDING",
      storage_checked_at: "2026-09-18T17:55:00.000Z",
    }),
    { nowFn: () => NOW, claimTtlMs: 120_000 },
  );
  assert.equal(stale.reason, "CLAIM_STALE");
  assert.equal(stale.recoveryRecommended, true);

  const failed = readOrganizationStorageReadiness(
    organization({
      storage_status: "ERROR",
      storage_error: "DROPBOX_UNAVAILABLE",
    }),
    { nowFn: () => NOW },
  );
  assert.equal(failed.reason, "STORAGE_ERROR");
  assert.equal(failed.ready, false);
  assert.equal(failed.retryable, true);
  assert.equal(failed.recoveryRecommended, true);
});

test("READY com path inválido ou erro residual não é considerado pronto", () => {
  const invalidPath = readOrganizationStorageReadiness(
    organization({ dropbox_root_path: "/legacy/acme" }),
    { nowFn: () => NOW },
  );
  assert.equal(invalidPath.ready, false);
  assert.equal(invalidPath.reason, "STORAGE_PATH_INVALID");

  const residualError = readOrganizationStorageReadiness(
    organization({ storage_error: "DROPBOX_UNAVAILABLE" }),
    { nowFn: () => NOW },
  );
  assert.equal(residualError.ready, false);
  assert.equal(residualError.reason, "READY_WITH_ERROR");
});

test("organização inativa é bloqueada sem retry", () => {
  const readiness = readOrganizationStorageReadiness(
    organization({
      active: 0,
      storage_status: "DISABLED",
    }),
    { nowFn: () => NOW },
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.retryable, false);
  assert.equal(readiness.recoveryRecommended, false);

  assert.throws(
    () =>
      requireOrganizationStorageReady(
        organization({
          active: 0,
          storage_status: "DISABLED",
        }),
        {
          nowFn: () => NOW,
          operation: "document.upload.readiness",
        },
      ),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "ORGANIZATION_STORAGE_DISABLED");
      assert.equal(error.retryable, false);
      assert.equal(error.stage, "document.upload.readiness");
      return true;
    },
  );
});

test("operações físicas recebem erro seguro e retryable quando storage não está READY", () => {
  assert.throws(
    () =>
      requireOrganizationStorageReady(
        organization({
          storage_status: "ERROR",
          storage_error: "DROPBOX_UNAVAILABLE",
        }),
        {
          nowFn: () => NOW,
          operation: "document.download.readiness",
        },
      ),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "ORGANIZATION_STORAGE_NOT_READY");
      assert.equal(error.retryable, true);
      assert.equal(error.publicMessage, error.message);
      assert.equal(error.details.storageStatus, "ERROR");
      assert.equal(error.details.recoveryRecommended, true);
      assert.doesNotMatch(error.message, /DROPBOX_UNAVAILABLE/);
      return true;
    },
  );
});

test("legacy READY funciona, mas legacy não pronto não promete retry automático", () => {
  const row = organization({ slug: "new-name", dropbox_root_path: "/projects/old-name" });
  assert.equal(readOrganizationStorageReadiness(row, { nowFn: () => NOW }).ready, true);
  const failed = readOrganizationStorageReadiness({ ...row, storage_status: "ERROR", storage_error: "DROPBOX_UNAVAILABLE" }, { nowFn: () => NOW });
  assert.equal(failed.ready, false);
  assert.equal(failed.retryable, false);
  assert.equal(failed.recoveryRecommended, false);
  assert.equal(failed.reason, "STORAGE_PATH_DECISION_REQUIRED");
});
