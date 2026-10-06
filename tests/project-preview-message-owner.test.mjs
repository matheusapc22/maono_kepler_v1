import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ownsPreviewMessage, previewSnapshotWithoutPayload } from '../src/pages/Kepler/thumbnail/preview-message-owner.ts';

test('an old PNG receipt cannot overwrite a newer confirmed save in the same editor generation', () => {
  const a = { route:'actor:org:map',operationId:'save-A',revision:2 };
  const b = { ...a,operationId:'save-B',revision:3 };
  let owner = a, message = 'JSON 2';
  const report = (receipt, text) => { if (ownsPreviewMessage(owner, receipt)) message = text; };
  owner = b; message = 'JSON 3';
  report(a,'PNG 2 READY'); assert.equal(message,'JSON 3');
  report(a,'PNG 2 FAILED'); assert.equal(message,'JSON 3');
  report(b,'PNG 3 READY'); assert.equal(message,'PNG 3 READY');
});
test('starting another save revokes old PNG message ownership even before its JSON receipt or failure', () => {
  const a = {route:'actor:org:map',operationId:'save-A',revision:2};
  assert.equal(ownsPreviewMessage(a,a),true);
  assert.equal(ownsPreviewMessage(null,a),false);
  for (const next of [{...a,route:'actor:other:map'},{...a,operationId:'save-B'},{...a,revision:3}]) assert.equal(ownsPreviewMessage(next,a),false);
});
test('mounted save callback guards every PNG message by exact owner and later edits; transport stays independent', () => {
  const source=readFileSync(new URL('../src/pages/Kepler/components/maono-save-button.tsx',import.meta.url),'utf8');
  const callback=source.slice(source.indexOf('onState: (state, detail)'),source.indexOf('}).catch(() =>',source.indexOf('onState: (state, detail)')));
  assert.match(callback,/ownsPreviewMessage\(previewMessageOwnerRef.current, previewMessageOwner\)/);
  assert.match(callback,/confirmationMatchesEditor/);
  assert.doesNotMatch(callback,/\bsnapshot\b|\bresult\b/,'long-lived callbacks use the payload-free preview snapshot only');
  assert.ok(callback.indexOf('ownsPreviewMessage')<callback.indexOf('setMessageType'));
  assert.equal((source.match(/previewMessageOwnerRef.current = null/g)||[]).length,4,'unmount, retry, update and create revoke UI ownership');
  assert.match(source,/isCurrent: \(\) => isPreviewSessionCurrent\(previewSnapshot.scope.actorId, previewSnapshot.scope.organizationId\)/);
});

test('PNG callback metadata drops large JSON and creation bodies without changing save bytes or receipt identity', () => {
  const body = new Blob(['synthetic saved JSON']);
  const original = { serialized:{body,payloadBytes:body.size}, creation:{requestBody:'synthetic creation JSON',idempotencyKey:'creation-one'},
    scope:{actorId:'1',organizationId:'2',projectId:'3'}, manifest:{operationId:'save-A',contentHash:'a'.repeat(64)}, editorSessionId:'editor-one',editGeneration:2 };
  const preview=previewSnapshotWithoutPayload(original);
  assert.equal(preview.serialized.body,null);assert.equal(preview.creation.requestBody,null);
  assert.equal(original.serialized.body,body);assert.equal(original.creation.requestBody,'synthetic creation JSON');
  assert.deepEqual(preview.scope,original.scope);assert.deepEqual(preview.manifest,original.manifest);
  assert.equal(preview.editorSessionId,original.editorSessionId);assert.equal(preview.editGeneration,original.editGeneration);
});
