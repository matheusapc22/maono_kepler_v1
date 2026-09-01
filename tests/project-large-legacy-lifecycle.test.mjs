import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const middlewarePath = new URL(
  "../functions/api/projects/[slug]/_middleware.js",
  import.meta.url,
);
const legacyLargeSavePath = new URL(
  "../functions/_lib/project-large-legacy-config-save.js",
  import.meta.url,
);

test("middleware envia projeto legado para promoção streaming e preserva ACTIVE no fluxo normal", async () => {
  const middleware = await readFile(middlewarePath, "utf8");

  assert.match(middleware, /isLifecycleManagedProject/);
  assert.match(
    middleware,
    /if \(!isLifecycleManagedProject\(project\)\)[\s\S]*saveLargeLegacyProjectConfigStream/,
  );
  assert.match(
    middleware,
    /project\.lifecycle_state !== PROJECT_LIFECYCLE_STATES\.ACTIVE/,
  );
  assert.match(
    middleware,
    /error\.code = "PROJECT_CONFIG_LIFECYCLE_BLOCKED"/,
  );
  assert.match(
    middleware,
    /saveLargeProjectConfigStream\(env,[\s\S]*request,[\s\S]*project/,
  );
});

test("promoção legado -> ACTIVE é CAS e publica somente após READY", async () => {
  const service = await readFile(legacyLargeSavePath, "utf8");

  const reserve = service.indexOf("reserveProjectConfigRevision(env");
  const finish = service.indexOf("finishSessionWithReconciliation(env");
  const ready = service.indexOf("markProjectConfigRevisionReady(env");
  const publish = service.indexOf("publishLegacyPromotion(env");

  assert.ok(reserve > 0);
  assert.ok(finish > reserve);
  assert.ok(ready > finish);
  assert.ok(publish > ready);

  assert.match(service, /lifecycle_state = 'ACTIVE'/);
  assert.match(
    service,
    /AND config_revision = \?[\s\S]*AND lifecycle_state IS NULL[\s\S]*AND active = 1/,
  );
  assert.match(service, /config_checksum_algorithm = \?/);
  assert.match(service, /config_storage_ref = \?/);
  assert.match(service, /config_size_bytes = \?/);
  assert.match(service, /preview_status = 'PENDING'/);
});

test("promoção não relê o MapConfig legado nem materializa o request grande", async () => {
  const service = await readFile(legacyLargeSavePath, "utf8");

  assert.match(service, /request\.body\.getReader\(\)/);
  assert.doesNotMatch(service, /request\.text\s*\(/);
  assert.doesNotMatch(service, /request\.json\s*\(/);
  assert.doesNotMatch(service, /reconcileLegacyProjectLifecycle/);
  assert.doesNotMatch(service, /publishProjectConfigRevision/);
  assert.match(service, /getMapConfigRevisionFileName/);
  assert.match(service, /writeMode:\s*"create"/);
  assert.match(service, /allowedLifecycleStates:\s*\[\]/);
});

test("tentativa anterior com objeto imutável pode ser reconciliada por metadata", async () => {
  const service = await readFile(legacyLargeSavePath, "utf8");

  assert.match(service, /findCommittedMetadata/);
  assert.match(service, /getDropboxMetadata/);
  assert.match(service, /metadata\.sizeBytes === expectedSize/);
  assert.match(service, /metadata\.providerHash/);
  assert.match(service, /DROPBOX_PATH_NOT_FOUND/);
});
