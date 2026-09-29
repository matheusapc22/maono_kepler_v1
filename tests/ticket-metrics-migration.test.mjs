import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTicketCommandDb } from './helpers/ticket-command-db.mjs';
import { CC11_SCHEMA_QUERY, evaluateCC11Schema } from '../scripts/migrations/cc11-schema-preflight.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('additive upgrade and fresh schema; compatible preflight, missing prerequisite and partial migration blocked', async (t) => { const f = await createTicketCommandDb(t); const names = ['0010_ticket_center.sql', '0025_ticket_triage_classification.sql', '0026_ticket_command_lifecycle.sql', '0027_ticket_selective_access.sql', '0028_ticket_conversations.sql', '0033_ticket_sla_policies.sql']; for (const n of names.slice(3))
    f.sqlite.exec(read('migrations/' + n)); const objects = f.sqlite.prepare(CC11_SCHEMA_QUERY).all(), ledger = names.map(name => ({ name })); assert.equal(evaluateCC11Schema(objects, ledger).compatible, true); assert.equal(evaluateCC11Schema(objects, ledger.slice(0, -1)).compatible, false); f.sqlite.exec(read('migrations/0034_ticket_metric_rollups.sql')); assert.equal(evaluateCC11Schema(f.sqlite.prepare(CC11_SCHEMA_QUERY).all(), ledger).compatible, false); assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []); const fresh = new DatabaseSync(':memory:'); try {
    fresh.exec(read('schema.sql'));
    assert.equal(fresh.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'ticket_metric_%' AND type='table'").get().n, 3);
    assert.deepEqual(fresh.prepare('PRAGMA foreign_key_check').all(), []);
}
finally {
    fresh.close();
} });
