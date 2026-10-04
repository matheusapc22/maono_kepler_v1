import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMaonoSelect} from './helpers/maono-select-preservation.mjs';
import {restoreDocumentProgressiveLoading,restoreTicketDetailProgressiveLoading} from './helpers/ticket-docs-progressive-preservation.mjs';
const cases=[
  {file:'DocumentsSection',restore:restoreDocumentProgressiveLoading,hash:'736bc1aba68b30ffd0250ccea8f69e70b3a488e6e4e12d4f0b2d4b276814b627',canaries:[['PERMISSION.DOCUMENT_VIEW','PERMISSION.DOCUMENT_UPLOAD'],['listOrganizationFiles(','listAllOrganizationFiles('],['limit: 50','limit: 500'],['formData,','new FormData(),'],['<option value="root">Raiz</option>','<option value="">Raiz</option>']]},
  {file:'TicketDetailDrawer',restore:restoreTicketDetailProgressiveLoading,hash:'a0c19fa754c8891256c7e1d6cd39260636949016211ac79bc799c66f0a3c4778',canaries:[['{canManage ? (','{true ? ('],['onUpdate,','onDelete,'],['ticket.status','ticket.priority'],['attachmentLimits={attachmentLimits}','attachmentLimits={{}}']]},
];
for(const {file,restore,hash,canaries} of cases){
 const source=readFileSync(new URL(`../src/pages/Projects/components/${file}.tsx`,import.meta.url),'utf8');
 const check=input=>assert.equal(createHash('sha256').update(restoreMaonoSelect(restore(input))).digest('hex'),hash);
 test(`${file}: exact inverse keeps independent original full-source hash`,()=>check(source));
 test(`${file}: permission/API/payload/options mutation canaries are rejected`,()=>{
  for(const [from,to] of canaries){ assert.ok(source.includes(from),`canary present: ${from}`); assert.throws(()=>check(source.replace(from,to)),`must reject ${from}`); }
 });
 test(`${file}: duplicate approved loading source is rejected rather than excluded`,()=>assert.throws(()=>restore(source+source)));
}
