import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateDocs} from '../scripts/central-chamados/cc18/validate-docs.mjs';
import {normalizeExportInput} from '../functions/_lib/ticket-export-domain.js';
import {discoverRoutes,sourceFingerprint} from '../scripts/central-chamados/cc18/route-inventory.mjs';
const spec=JSON.parse(await readFile(new URL('../docs/central-chamados/cc-18/openapi.json',import.meta.url)));
test('CC18 covers current routes, methods, source fingerprints, matrix and local links',async()=>{const r=await validateDocs();assert.deepEqual(r.issues,[]);assert.equal(r.routes,51);assert.equal(r.operations,82);});
test('resumable reservation is attachments POST; uploads collection is GET only',()=>{const p='/api/organizations/{id}/tickets/{ticketId}/attachments';assert.ok(spec.paths[p].post);assert.ok(spec.paths[p+'/uploads'].get);assert.equal(spec.paths[p+'/uploads'].post,undefined);assert.ok(spec.paths[p+'/uploads/{uploadId}'].patch.requestBody.content['application/octet-stream']);});
test('export request example obeys the actual domain validator',()=>{const x=normalizeExportInput({idempotencyKey:'cc18-export-intent-001',from:'2026-09-01T00:00:00Z',to:'2026-09-28T00:00:00Z',asOf:'2026-09-29T00:00:00Z',report:'backlog'});assert.equal(x.report,'backlog');});
test('spec keeps resource tokens and export idempotency distinct',()=>{assert.ok(spec.paths['/api/organizations/{id}/tickets/{ticketId}/state'].get.responses['200'].headers.ETag);assert.ok(spec.components.schemas.ExportCreate.properties.idempotencyKey);assert.equal(spec.components.securitySchemes.Session.name,'maono_session');});

test('notice contract documents recipient folders, explicit versioned actions and legacy compatibility',()=>{
 const route=spec.paths['/api/organizations/{id}/ticket-notifications'];
 assert.deepEqual(route.get.parameters.find(p=>p.name==='folder').schema.enum,['active','deleted']);
 assert.equal(route.get.responses['200'].content['application/json'].schema.$ref,'#/components/schemas/NotificationInbox');
 const [current,legacy]=spec.components.schemas.NotificationRecipientAction.anyOf;
 assert.deepEqual(current.required,['id','action','version']);assert.deepEqual(current.properties.action.enum,['read','unread','dismiss','restore']);assert.deepEqual(legacy.required,['id','read']);assert.deepEqual(legacy.not.required,['action']);
 assert.equal(spec.components.schemas.NotificationInbox.properties.items.items.properties.version.minimum,1);
 assert.deepEqual(route.patch.responses['200'].headers['Cache-Control'].schema.enum,['private, no-store']);
});

test('reviewed ETag responses document no-transform without weakening If-Match',()=>{
 for(const [suffix,method,status]of [['state','get','200'],['drafts','post','201'],['drafts/{draftId}','get','200'],['drafts/{draftId}','patch','200'],['messages','post','201'],['messages/{messageId}','patch','200']]){
  const operation=spec.paths['/api/organizations/{id}/tickets/{ticketId}/'+suffix][method];
  assert.ok(operation.responses[status].headers.ETag);
  assert.deepEqual(operation.responses[status].headers['Cache-Control'].schema.enum,['private, no-store, no-transform']);
  if(method==='patch')assert.equal(operation.parameters.find(p=>p.name==='If-Match').required,true);
 }
});
test('source inventory is portable across Windows paths and checkout line endings',async()=>{
 const routes=await discoverRoutes();
 assert.equal(routes.length,51);
 assert.ok(routes.every(r=>!r.path.includes('\\')&&!r.file.includes('\\')&&r.dependencies.every(p=>!p.includes('\\'))));
 assert.equal(sourceFingerprint('a\r\nb\r\n','c\r\n'),sourceFingerprint('a\nb\n','c\n'));
 assert.notEqual(sourceFingerprint('a\nb\n','c\n'),sourceFingerprint('a\nchanged\n','c\n'));
});
