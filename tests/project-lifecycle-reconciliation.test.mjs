import assert from "node:assert/strict";
import test from "node:test";
import { dropboxContentHashHex } from "../functions/_lib/dropbox-content-hash.js";
import { reconcileLegacyProjectLifecycle } from "../functions/_lib/project-lifecycle-reconciler.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { config,seedLegacy,assertReopened } from "./helpers/durable-project-http.mjs";

test("backfill hashes exact legacy bytes, keeps original and publishes immutable operation object",async t=>{
  const f=persistenceFixture(t);await seedLegacy(f);
  const text='{\n  "version": "v1",\n  "config": {"visState": {}},\n  "datasets": []\n}\n';
  const bytes=new TextEncoder().encode(text);
  const legacyPath="/offline/a/map/config.kepler.json";
  await f.store(legacyPath,bytes);
  const saved=await reconcileLegacyProjectLifecycle(f.env,f.project(),{actorUserId:1});
  assert.equal(saved.revision,1);assert.equal(saved.checksum,await dropboxContentHashHex(bytes));
  assert.equal(f.project().config_checksum_algorithm,"dropbox-content-hash");
  assert.equal(f.project().config_size_bytes,bytes.byteLength);
  assert.ok(f.project().config_storage_ref.includes("operations"));
  assert.deepEqual(f.objects.get(legacyPath).bytes,bytes);
  const operationObject=[...f.objects.entries()].find(([path])=>path!==legacyPath);
  assert.ok(operationObject);assert.deepEqual(operationObject[1].bytes,bytes);
  assert.equal(f.ledger().save_operation_id,f.db.prepare("SELECT id FROM project_save_operations").get().id);
  await assertReopened(f,JSON.parse(text),1);
});

test("repeated backfill is idempotent and never makes an extra revision or upload",async t=>{
  const f=persistenceFixture(t);await seedLegacy(f,config("legacy"));
  const first=await reconcileLegacyProjectLifecycle(f.env,f.project(),{actorUserId:1});
  const providerCalls=f.calls.length;
  const second=await reconcileLegacyProjectLifecycle(f.env,f.project(),{actorUserId:1});
  assert.equal(first.skipped,false);assert.equal(second.skipped,true);assert.equal(second.idempotent,true);
  assert.equal(f.calls.length,providerCalls);
  assert.equal(f.db.prepare("SELECT count(*) n FROM project_config_revisions").get().n,1);
});

test("inactive legacy project remains unresolved without automatic FAILED classification",async t=>{
  const f=persistenceFixture(t);await seedLegacy(f);f.db.exec("UPDATE projects SET active=0 WHERE id=1");
  await assert.rejects(reconcileLegacyProjectLifecycle(f.env,f.project(),{actorUserId:1}),{code:"LEGACY_INACTIVE_PROJECT_UNRESOLVED"});
  assert.equal(f.project().lifecycle_state,null);assert.equal(f.project().active,0);assert.equal(f.calls.length,0);
});
