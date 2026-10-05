import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
test('old thirty-second candidate recycler and shared revision writer are gone',async()=>{
 const source=await readFile(new URL('../functions/_lib/project-config-revisions.js',import.meta.url),'utf8');
 assert.match(source,/getProjectConfigRevision/);
 assert.doesNotMatch(source,/ABANDONED_READY_GRACE|deleteDropbox|recycleUnpublished|reserveProjectConfigRevision|publishProjectConfigRevision/);
});
test('expired workers are fenced and receipts cannot be silently deleted or reused',async()=>{
 const sql=await readFile(new URL('../migrations/0039_project_save_operations.sql',import.meta.url),'utf8');
 const source=await readFile(new URL('../functions/_lib/project-save-operations.js',import.meta.url),'utf8');
 assert.match(sql,/RECEIPT_RETAINED/);assert.match(sql,/IDENTITY_IMMUTABLE/);
 assert.match(source,/lease_epoch/);assert.match(source,/upload_epoch/);
 assert.doesNotMatch(source,/deleteDropboxPathIfExists/);
});
