import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCalendar, businessTime, validatePolicy, projectSla } from '../functions/_lib/ticket-sla-clock.js';
const weekly = Array.from({ length: 7 }, () => [[540, 1020]]);
const calendar = (extra = {}) => compileCalendar({ timeZone: 'UTC', from: '2026-01-01', through: '2026-12-31', weekly, ...extra });
const iso = s => `2026-09-${s}Z`;
const policy = (extra = {}) => ({ name: 'Contrato de teste', responseMinutes: 60, resolutionMinutes: 120, responders: [2], pauseReasons: ['cliente'], calendar: calendar(), ...extra });
test('CT33 outside hours, local holiday and invalid calendar', () => {
    const c = calendar({ exceptions: { '2026-09-28': [] } });
    assert.equal(businessTime(c, iso('27T16:30:00'), iso('29T09:30:00')).elapsedMs, 3600000);
    assert.throws(() => calendar({ timeZone: 'Not/AZone' }));
    assert.throws(() => calendar({ from: '2026-02-30' }));
    assert.throws(() => calendar({ weekly: Array(7).fill([[600, 660], [650, 800]]) }));
    assert.equal(businessTime(c, '2025-12-31T12:00:00Z', '2026-01-01T12:00:00Z').known, false);
});
test('CT33 DST gap and fold retain actual UTC time (New York)', () => {
    const c = calendar({ timeZone: 'America/New_York', weekly: Array.from({ length: 7 }, () => [[60, 240]]) });
    assert.equal(businessTime(c, '2026-03-08T05:00:00Z', '2026-03-08T10:00:00Z').elapsedMs, 2 * 3600000);
    assert.equal(businessTime(c, '2026-11-01T04:00:00Z', '2026-11-01T10:00:00Z').elapsedMs, 4 * 3600000);
});
test('CT33 half-hour DST and frozen UTC compilation', () => {
    const c = calendar({ timeZone: 'Australia/Lord_Howe', from: '2026-04-05', through: '2026-04-05', weekly: Array.from({ length: 7 }, () => [[60, 180]]) });
    assert.equal(c.intervals.reduce((n, [a, b]) => n + b - a, 0), 2.5 * 3600000);
    const copy = JSON.parse(JSON.stringify(c));
    assert.deepEqual(copy, c);
});
test('business intervals and overlapping waits are unioned without double subtraction', () => {
    const c = calendar();
    const t = businessTime(c, iso('27T09:00:00'), iso('27T12:00:00'), [[iso('27T09:30:00'), iso('27T10:30:00')], [iso('27T10:00:00'), iso('27T11:00:00')]]);
    assert.equal(t.elapsedMs, 90 * 60000);
    assert.equal(t.pausedMs, 90 * 60000);
});
function fixture() { return { cycles: [{ cycle_number: 1, origin: 'created', opened_at: iso('27T09:00:00'), closed_at: null }], assignments: [{ cycle_number: 1, sequence: 1, policy_version: 1, effective_at: iso('27T09:00:00') }], policies: [{ version: 1, policy: policy() }], waits: [], messages: [], requesterId: 1, now: iso('27T12:00:00') }; }
test('CT34 only eligible public human responder ends clock; requester, automatic and internal excluded', () => {
    const f = fixture();
    f.messages = [{ id: 'a', created_at: iso('27T09:05:00'), author_user_id: 2, kind: 'response', audience: 'ticket', human: false }, { id: 'b', created_at: iso('27T09:10:00'), author_user_id: 2, kind: 'internal', audience: 'internal', human: true }, { id: 'c', created_at: iso('27T09:15:00'), author_user_id: 1, kind: 'response', audience: 'ticket', human: true }, { id: 'd', created_at: iso('27T09:30:00'), author_user_id: 2, kind: 'response', audience: 'ticket', human: true }];
    const r = projectSla(f);
    assert.equal(r.firstResponse.at, iso('27T09:30:00'));
    assert.equal(r.cycles[0].clocks.response.elapsedMs, 1800000);
    assert.equal(r.cycles[0].clocks.response.status, 'completed');
    f.messages = [];
    assert.equal(projectSla(f).cycles[0].clocks.response.status, 'breached');
});
test('CT35 waits depend on pinned reason policy, reopen starts resolution cycle, global first response retained', () => {
    const f = fixture();
    f.cycles[0].closed_at = iso('27T11:00:00');
    f.cycles.push({ cycle_number: 2, origin: 'reopened', opened_at: iso('27T11:30:00'), closed_at: null });
    f.assignments.push({ cycle_number: 2, sequence: 1, policy_version: 1, effective_at: iso('27T11:30:00') });
    f.waits = [{ cycle_number: 1, reason: 'cliente', started_at: iso('27T10:00:00'), ended_at: iso('27T11:00:00') }];
    f.messages = [{ id: 'a', created_at: iso('27T09:30:00'), author_user_id: 2, kind: 'response', audience: 'ticket', human: true }];
    const r = projectSla(f);
    assert.equal(r.cycles[0].clocks.resolution.elapsedMs, 3600000);
    assert.equal(r.cycles[1].clocks.resolution.elapsedMs, 1800000);
    assert.equal(r.cycles[1].clocks.response.elapsedMs, 1800000);
    assert.equal(r.firstResponse.at, iso('27T09:30:00'));
});
test('CT36 publishing does not change previous clock; explicit policy segmentation preserves accrued fractions', () => {
    const f = fixture();
    f.policies.push({ version: 2, policy: policy({ resolutionMinutes: 60 }) });
    assert.equal(projectSla(f).cycles[0].clocks.resolution.consumed, 1.5);
    f.assignments.push({ cycle_number: 1, sequence: 2, policy_version: 2, effective_at: iso('27T10:00:00') });
    assert.equal(projectSla(f).cycles[0].clocks.resolution.consumed, 2.5);
    const a = JSON.stringify(projectSla(f));
    f.messages.reverse();
    assert.equal(JSON.stringify(projectSla(f)), a);
});
test('absent targets, legacy baseline and uncovered calendar do not produce invented zero SLA', () => {
    const f = fixture();
    f.assignments = [];
    assert.equal(projectSla(f).cycles[0].status, 'no_sla');
    f.assignments = [{ cycle_number: 1, sequence: 1, policy_version: 1, effective_at: iso('27T10:00:00') }];
    f.cycles[0].origin = 'observed_baseline';
    assert.equal(projectSla(f).cycles[0].uncoveredPrefix, true);
    f.policies[0].policy.responseMinutes = null;
    assert.equal(projectSla(f).cycles[0].clocks.response.status, 'no_sla');
    f.now = '2027-01-01T12:00:00Z';
    assert.equal(projectSla(f).cycles[0].clocks.resolution.elapsedMs, null);
});
test('first response before assignment is retained without inventing elapsed prefix', () => { const f = fixture(); f.assignments[0].effective_at = iso('27T10:00:00'); f.messages = [{ id: 'early', created_at: iso('27T09:30:00'), author_user_id: 2, kind: 'response', audience: 'ticket', human: true }]; const r = projectSla(f); assert.equal(r.firstResponse.at, iso('27T09:30:00')); assert.equal(r.cycles[0].clocks.response.elapsedMs, 0); assert.equal(r.cycles[0].uncoveredPrefix, true); });
test('a responder change takes effect at its exact boundary; invalid waits rejected', () => { const f = fixture(); f.policies.push({ version: 2, policy: policy({ responders: [3] }) }); f.assignments.push({ cycle_number: 1, sequence: 2, policy_version: 2, effective_at: iso('27T10:00:00') }); f.messages = [{ id: 'boundary', created_at: iso('27T10:00:00'), author_user_id: 2, kind: 'response', audience: 'ticket', human: true }]; assert.equal(projectSla(f).firstResponse, null); assert.throws(() => businessTime(calendar(), iso('27T09:00:00'), iso('27T12:00:00'), [[iso('27T11:00:00'), iso('27T10:00:00')]])); });
