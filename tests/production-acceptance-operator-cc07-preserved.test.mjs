import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCc07Inventory} from '../scripts/acceptance/cc07-operator.mjs';
import {preservedCc07Digest,preservedCc07Snapshot} from '../scripts/acceptance/cc07-preserved.mjs';
import {preservedFixture} from './helpers/cc07-preserved-fixture.mjs';
const now=Date.parse('2026-10-25T10:00:00.000Z');
function fixture(){const p={organizationId:1,qaIds:{manager:1,allowed:2},policy:{startAt:new Date(now).toISOString(),maxEvents:3,maxAttempts:6},qa9:{digest:'qa9'}};
 const a={...preservedFixture(p),startedAt:new Date(now).toISOString(),completedAt:new Date(now).toISOString(),qa9Digest:'qa9',outsideDigest:'outside',organizationIds:[1,9]};return {p,a};}
test('preserved evidence partitions exact known records without mutating input or accepting a new record',()=>{
 const {p,a}=fixture(),original=structuredClone(a),result=assertCc07Inventory(a,p,{now,empty:true});
 assert.equal(result.preservedVerified,true);assert.ok(Object.values(result.scoped).every(x=>x.length===0));assert.deepEqual(a,original);
 a.scoped.tickets.push({id:71,created_by:1});assert.throws(()=>assertCc07Inventory(a,p,{now,empty:true}),{code:'CC07_TARGET_NOT_EMPTY'});
});
for(const [name,change]of Object.entries({
 subject:a=>{a.preservedRows.ticket[0].matches_origin=0;},version:a=>{a.scoped.tickets[0].version++;},visibility:a=>{a.scoped.tickets[0].visibility='organization';},state:a=>{a.scoped.tickets[0].status='open';},
 outbox:a=>{a.scoped.outbox[0].id='unknown';},processed:a=>{a.scoped.outbox[0].notification_attempts=1;},lease:a=>{a.scoped.outbox[0].notification_lease_until='future';},recipient:a=>{a.scoped.candidates[0].recipient_id=3;},
 notice:a=>{a.scoped.notices.push({outbox_id:a.scoped.outbox[0].id});},event:a=>{a.preservedRows.events[0].id=999;},eventContent:a=>{a.preservedRows.events[0].actor_user_id=999;},
 duplicate:a=>{a.preservedRows.events[1]=a.preservedRows.events[0];},truncated:a=>{a.preservedRows.events.pop();},cycle:a=>{a.preservedRows.cycles[0].origin='reopened';},acl:a=>{a.preservedRows.acl.push({...a.preservedRows.acl[0],principal_id:2});},
 policy:a=>{a.preservedRows.policies.push({policy_id:1});},counts:a=>{a.preservedRows.counts[0].events=5;},foreign:a=>{a.qa9Digest='changed';},
}))test(`preservation rejects ${name} drift without adopting it`,()=>{const {p,a}=fixture();change(a);assert.throws(()=>assertCc07Inventory(a,p,{now,empty:true}));});
test('preserved digest is canonical across row order, but does not refresh an expired source',()=>{
 const {p,a}=fixture();a.scoped.outbox.reverse();a.preservedRows.events.reverse();
 assert.equal(preservedCc07Digest(preservedCc07Snapshot(a,p)),p.preserved.digest);
 assert.doesNotThrow(()=>assertCc07Inventory(a,p,{now,empty:true}));
 assert.throws(()=>assertCc07Inventory(a,p,{now:now+600001,empty:true}),{code:'CC07_INVENTORY_EXPIRED'});
});
test('approved old records never exempt an unknown outbox, recipient, or new-ticket owner',()=>{
 for(const target of ['outbox','candidates','tickets']){const {p,a}=fixture();a.scoped[target].push(target==='outbox'?{id:'unknown',ticket_id:70}:target==='candidates'?{outbox_id:'unknown',recipient_id:2}:{id:71,created_by:3});
  assert.throws(()=>assertCc07Inventory(a,p,{now,empty:true}));}
});
