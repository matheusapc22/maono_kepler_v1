import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalBrowserBlob } from './helpers/local-browser-url.mjs';

test('browser fixtures permit only Blob bytes owned by the current local origin', () => {
  assert.equal(isLocalBrowserBlob('blob:http://127.0.0.1:4176/uuid', 'http://127.0.0.1:4176/projects/demo'), true);
  assert.equal(isLocalBrowserBlob(new URL('blob:http://localhost:4176/uuid'), 'http://localhost:4176/'), true);
  for (const url of ['blob:https://production.example/uuid', 'blob:http://127.0.0.1:9999/uuid', 'blob:http://localhost:4176/uuid', 'https://production.example/file', 'http://127.0.0.1:4176/api/write', 'blob:null/uuid', 'data:text/plain,bytes', 'invalid']) {
    assert.equal(isLocalBrowserBlob(url, 'http://127.0.0.1:4176/projects/demo'), false, url);
  }
  assert.equal(isLocalBrowserBlob('blob:https://production.example/uuid', 'https://production.example/'), false);
  assert.equal(isLocalBrowserBlob('blob:null/uuid', 'about:blank'), false);
});
