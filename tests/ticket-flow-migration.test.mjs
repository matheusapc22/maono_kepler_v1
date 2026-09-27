import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {evaluateCC09Schema,assertCC09Schema} from '../scripts/migrations/cc09-schema-preflight.mjs';
import {createTicketCommandDb} from './helpers/ticket-command-db.mjs';
const ledger=['0010_ticket_center.sql','0025_ticket_triage_classification.sql','0026_ticket_command_lifecycle.sql','0027_ticket_selective_access.sql'].map(name=>({name}));
test('CC09 preflight distinguishes compatible base, missing dependency, partial and applied migration',async t=>{
 const f=await createTicketCommandDb(t);
 const objects=()=>f.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN ('organization_tickets','ticket_query_snapshots','ticket_query_snapshot_items','ticket_queue_policies') ORDER BY type,name").all().map(x=>({...x}));
 assert.equal(evaluateCC09Schema(objects(),ledger).compatible,true);
 assert.throws(()=>assertCC09Schema(evaluateCC09Schema(objects(),ledger.slice(1))),{code:'CC09_SCHEMA_PREFLIGHT_BLOCKED'});
 f.sqlite.exec(readFileSync(new URL('../migrations/0032_ticket_flow_navigation.sql',import.meta.url),'utf8'));
 assert.equal(evaluateCC09Schema(objects(),ledger).compatible,false);
 assert.ok(evaluateCC09Schema(objects(),ledger).conflicting.includes('organization_tickets.queue_entered_at'));
});
test('fresh schema and CC09 upgrade contain valid triggers, FK and indexes',()=>{
 const db=new DatabaseSync(':memory:');
 try{db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}
 finally{db.close();}
});
