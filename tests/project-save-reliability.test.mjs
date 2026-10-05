import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
const source=await readFile(new URL('../functions/_lib/project-save-operations.js',import.meta.url),'utf8');
test('success is an immutable historical receipt rather than the current head',()=>{
 assert.match(source,/receipt_json/);assert.match(source,/publishedRevision/);
 assert.match(source,/PROJECT_SAVE_TERMINAL_STATES/);
});
test('publication and its dependent writes share the guarded SQL batch',()=>{
 assert.match(source,/project_save_transaction_guard/);assert.match(source,/changes\(\) = 1/);
 assert.match(source,/await db.batch\(statements\)/);
 assert.match(source,/save_operation_id/);
});
test('auxiliary work is durable outbox work and cannot downgrade PUBLISHED',()=>{
 assert.match(source,/project_save_outbox/);assert.match(source,/AUDIT/);assert.match(source,/PUBLISHED/);
 assert.doesNotMatch(source,/markProjectConfigRevisionFailed|reserveProjectConfigRevision/);
});
