import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { evaluateCC10Schema, assertCC10Schema, CC10_SCHEMA_QUERY } from '../scripts/migrations/cc10-schema-preflight.mjs';
import { createTicketCommandDb } from './helpers/ticket-command-db.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ledger = ['0010_ticket_center.sql', '0025_ticket_triage_classification.sql', '0026_ticket_command_lifecycle.sql', '0027_ticket_selective_access.sql', '0028_ticket_conversations.sql'].map(name => ({ name }));
test('CC10 preflight rejects missing dependency, partial/applied schema and detects schema drift', async (t) => { const f = await createTicketCommandDb(t); for (const n of ledger.slice(3))
    f.sqlite.exec(read('migrations/' + n.name)); const objects = () => f.sqlite.prepare(CC10_SCHEMA_QUERY).all().map(x => ({ ...x })); const good = evaluateCC10Schema(objects(), ledger); assert.equal(good.compatible, true); assert.throws(() => assertCC10Schema(evaluateCC10Schema(objects(), ledger.slice(1))), { code: 'CC10_SCHEMA_PREFLIGHT_BLOCKED' }); f.sqlite.exec(read('migrations/0033_ticket_sla_policies.sql')); const after = evaluateCC10Schema(objects(), ledger); assert.equal(after.compatible, false); assert.notEqual(good.digest, after.digest); assert.equal(f.sqlite.prepare('PRAGMA quick_check').get().quick_check, 'ok'); assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []); assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM ticket_sla_policies').get().n, 0); });
test('fresh schema has same CC10 objects as upgrade and no seeded production contract', () => { const db = new DatabaseSync(':memory:'), reference = new DatabaseSync(':memory:'); try {
    db.exec(read('schema.sql'));
    reference.exec('PRAGMA foreign_keys=OFF;' + read('migrations/0033_ticket_sla_policies.sql'));
    const q = "SELECT name,sql FROM sqlite_schema WHERE name LIKE 'ticket_sla_%' ORDER BY name";
    assert.deepEqual(db.prepare(q).all(), reference.prepare(q).all());
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ticket_sla_assignments').get().n, 0);
}
finally {
    db.close();
    reference.close();
} });
