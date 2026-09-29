import { projectSla } from './ticket-sla-clock.js';
export const METRIC_VERSION = 1;
export const METRIC_DICTIONARY = Object.freeze({ version: 1, window: '[from,to)', zone: 'UTC', percentile: 'nearest-rank', families: ['first_response', 'resolution', 'age_wait', 'reopening', 'flow'], effort: 'CC-15', durationUnit: 'milliseconds' });
export function metricsError(message, status = 400, code = 'TICKET_METRICS_INVALID') { return Object.assign(new Error(message), { status, code }); }
export function metricWindow(input, now = Date.now()) {
    const from = Date.parse(input.from), to = Date.parse(input.to), asOf = Date.parse(input.asOf);
    if (![from, to, asOf].every(Number.isFinite) || from >= to || to > asOf || asOf > now + 1000 || to - from > 366 * 86400000)
        throw metricsError('Informe início, fim e instante de referência válidos; janela máxima de 366 dias.');
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), asOf: new Date(asOf).toISOString() };
}
const time = v => v ? Date.parse(v) : NaN;
const inside = (v, a, b) => time(v) >= a && time(v) < b;
const parse = v => { try {
    return JSON.parse(v || '{}');
}
catch {
    return {};
} };
export function distribution(samples, population = samples.length, unknown = 0, censored = 0) {
    const values = samples.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
    const p = q => values.length ? values[Math.max(0, Math.ceil(q * values.length) - 1)] : null;
    return { population, observed: values.length, unknown, censored, coverage: population ? values.length / population : null, p50: p(.5), p90: p(.9), p95: p(.95) };
}
function union(intervals) { let total = 0, end = -Infinity; for (const [a, b] of intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((x, y) => x[0] - y[0])) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
} return total; }
// Facts are per ticket, so authorization can always precede aggregation. No text or identities in rollups.
export function projectMetricTicket(source, window, definition = { version: 1, reopen_hours: null }) {
    const { ticket, cycles = [], events = [], waits = [], messages = [], assignments = [], policies = [] } = source;
    const a = time(window.from), b = time(window.to), n = time(window.asOf);
    const unique = new Map();
    let conflict = false;
    for (const e of events) {
        const previous = unique.get(String(e.id));
        if (previous && JSON.stringify(previous) !== JSON.stringify(e))
            conflict = true;
        unique.set(String(e.id), e);
    }
    const ordered = [...unique.values()].sort((x, y) => time(x.created_at) - time(y.created_at) || Number(x.id) - Number(y.id));
    const correction = ordered.some(e => e.corrects_event_id), invalid = conflict || correction;
    const cs = cycles.filter(c => time(c.opened_at) <= n).sort((x, y) => x.cycle_number - y.cycle_number);
    const first = cs.find(c => c.cycle_number === 1), known = !!first && first.origin === 'created' && !invalid;
    const open = cs.filter(c => !c.closed_at || time(c.closed_at) > n).at(-1);
    const openFlag = !!open || (!cs.length && ticket.status !== 'closed' && time(ticket.created_at) <= n);
    let sla = { cycles: [], firstResponse: null };
    if (!invalid)
        try {
            sla = projectSla({ cycles: cs.map(c => ({ ...c, closed_at: time(c.closed_at) > n ? null : c.closed_at })), assignments: assignments.filter(x => time(x.effective_at) <= n), policies: policies.map(p => ({ version: p.version, policy: parse(p.policy_json) })), waits: waits.filter(w => time(w.started_at) <= n).map(w => ({ ...w, ended_at: time(w.ended_at) > n ? null : w.ended_at })), messages: messages.filter(m => time(m.created_at) <= n).map(m => ({ ...m, human: true })), requesterId: ticket.created_by, now: window.asOf });
        }
        catch { /* Bad historical calendar is unknown, never zero. */ }
    const responseAt = time(sla.firstResponse?.at), response = known && Number.isFinite(responseAt) && responseAt >= time(first.opened_at) && responseAt <= n ? responseAt - time(first.opened_at) : null;
    const responseCohort = inside(known ? first.opened_at : ticket.created_at, a, b);
    const covered = known && assignments.some(x => x.cycle_number === 1 && time(x.effective_at) <= time(first.opened_at));
    const resolved = cs.filter(c => inside(c.closed_at, a, b) && time(c.closed_at) <= n);
    const resolution = resolved.map(c => ({ cycle: c.cycle_number, raw: !invalid && c.origin !== 'observed_baseline' && time(c.closed_at) >= time(c.opened_at) ? time(c.closed_at) - time(c.opened_at) : null, outcome: parse(c.closure_json).outcome || 'unknown', useful: sla.cycles.find(s => s.cycle === c.cycle_number && !s.uncoveredPrefix && s.origin !== 'observed_baseline')?.clocks?.resolution?.elapsedMs ?? null }));
    const cycleWork = c => c.origin !== 'observed_baseline' && ordered.find(e => e.command_id && e.entity_version && e.event_type === 'ticket.status.changed' && parse(e.metadata).to === 'in_progress' && time(e.created_at) >= time(c.opened_at) && time(e.created_at) <= Math.min(time(c.closed_at) || n, n));
    const currentWork = open && !invalid ? cycleWork(open) : null;
    const waitByReason = {};
    for (const reason of new Set(waits.map(w => w.reason)))
        waitByReason[reason] = invalid || !known ? null : union(waits.filter(w => w.reason === reason).map(w => [Math.max(a, time(w.started_at)), Math.min(b, n, w.ended_at ? time(w.ended_at) : n)]));
    const waiting = !!open && waits.some(w => time(w.started_at) <= n && (!w.ended_at || time(w.ended_at) > n));
    const h = definition.reopen_hours == null ? null : Number(definition.reopen_hours) * 3600000;
    const reopening = { numerator: 0, denominator: 0, immature: 0, unknown: 0, hours: definition.reopen_hours ?? null };
    for (const c of resolved) {
        if (h === null || invalid) {
            reopening.unknown++;
            continue;
        }
        if (time(c.closed_at) + h > n) {
            reopening.immature++;
            continue;
        }
        reopening.denominator++;
        const next = cs.find(x => x.cycle_number === c.cycle_number + 1 && x.origin === 'reopened');
        if (next && time(next.opened_at) >= time(c.closed_at) && time(next.opened_at) <= time(c.closed_at) + h)
            reopening.numerator++;
    }
    const latest = cs.at(-1);
    return { ticketId: ticket.id, nature: ticket.demand_nature || 'unknown', team: ticket.assigned_to == null ? 'unassigned' : String(ticket.assigned_to), responseCohort, response, responseUnknown: response === null && !covered, responseCensored: response === null && covered,
        responseUseful: response === null || !covered || sla.cycles.some(c => time(cs.find(x => x.cycle_number === c.cycle)?.opened_at) <= responseAt && (c.uncoveredPrefix || !c.clocks?.response?.known)) ? null : (sla.cycles.find(c => !c.uncoveredPrefix && ['completed', 'breached'].includes(c.clocks?.response?.status))?.clocks?.response?.elapsedMs ?? null),
        resolution, resolutionCohort: responseCohort, unresolvedOpening: responseCohort && openFlag,
        total: known && latest?.closed_at && time(latest.closed_at) <= n ? time(latest.closed_at) - time(first.opened_at) : null,
        open: openFlag, age: open && known ? n - time(first.opened_at) : null, cycleAge: open && !invalid && open.origin !== 'observed_baseline' ? n - time(open.opened_at) : null,
        waiting, waitByReason, wait: invalid || !known ? null : union(waits.map(w => [Math.max(a, time(w.started_at)), Math.min(b, n, w.ended_at ? time(w.ended_at) : n)])),
        reopening, wip: !!currentWork, flowUnknown: openFlag && !currentWork && (invalid || !open || open.origin === 'observed_baseline'),
        cycleTimes: resolved.map(c => { const e = !invalid && cycleWork(c); return e ? time(c.closed_at) - time(e.created_at) : null; }),
        quality: { legacy: !first || first.origin === 'observed_baseline', correction: !!correction, conflict, unknownNature: !ticket.demand_nature },
        watermark: ordered.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0), eventCount: ordered.length,
        lastEventAt: ordered.map(e => e.created_at).filter(x => Number.isFinite(time(x))).sort((x, y) => time(x) - time(y)).at(-1) || null };
}
export function aggregateMetricFacts(facts, window, definition = { version: 1, reopen_hours: null }) {
    const response = facts.filter(f => f.responseCohort), resolutions = facts.flatMap(f => f.resolution), opens = facts.filter(f => f.open);
    const dist = (xs, key) => distribution(xs.map(x => x[key]), xs.length, xs.filter(x => x[key] === null).length);
    const reopening = { numerator: 0, denominator: 0, immature: 0, unknown: 0, hours: definition.reopen_hours ?? null };
    for (const f of facts)
        for (const k of ['numerator', 'denominator', 'immature', 'unknown'])
            reopening[k] += f.reopening[k];
    const waitReasons = {};
    for (const f of facts)
        for (const [r, ms] of Object.entries(f.waitByReason)) {
            waitReasons[r] ??= [];
            waitReasons[r].push(ms);
        }
    return { dictionary: METRIC_DICTIONARY, definitionVersion: definition.version, window, authorizedTickets: facts.length,
        firstResponse: { ...distribution(response.map(f => f.response), response.length, response.filter(f => f.responseUnknown).length, response.filter(f => f.responseCensored).length), useful: dist(response, 'responseUseful') },
        resolution: { ...distribution(resolutions.map(r => r.raw), resolutions.length, resolutions.filter(r => r.raw === null).length), uniqueTickets: facts.filter(f => f.resolution.length).length, useful: dist(resolutions, 'useful'), outcomes: Object.fromEntries([...new Set(resolutions.map(r => r.outcome))].map(k => [k, resolutions.filter(r => r.outcome === k).length])), openingCohort: { population: response.length, censored: response.filter(f => f.unresolvedOpening).length }, totalIncludingClosedIntervals: distribution(response.map(f => f.total), response.length, response.filter(f => f.total === null && !f.open).length, response.filter(f => f.open).length) },
        age: dist(opens, 'age'), cycleAge: dist(opens, 'cycleAge'), waiting: opens.filter(f => f.waiting).length,
        wait: dist(facts, 'wait'), waitByReason: Object.fromEntries(Object.entries(waitReasons).map(([r, xs]) => [r, distribution(xs, xs.length, xs.filter(x => x === null).length)])),
        reopening: { ...reopening, rate: reopening.denominator ? reopening.numerator / reopening.denominator : null },
        flow: { wip: facts.filter(f => f.wip).length, unknown: facts.filter(f => f.flowUnknown).length, throughput: resolutions.length, uniqueTickets: facts.filter(f => f.resolution.length).length, cycleTime: distribution(facts.flatMap(f => f.cycleTimes), resolutions.length, resolutions.filter((_, i) => facts.flatMap(f => f.cycleTimes)[i] === null).length) },
        byNature: Object.fromEntries([...new Set(facts.map(f => f.nature))].map(k => [k, { tickets: facts.filter(f => f.nature === k).length, throughput: facts.filter(f => f.nature === k).reduce((n, f) => n + f.resolution.length, 0) }])), byTeam: Object.fromEntries([...new Set(facts.map(f => f.team))].map(k => [k, { tickets: facts.filter(f => f.team === k).length, wip: facts.filter(f => f.team === k && f.wip).length }])),
        quality: { legacy: facts.filter(f => f.quality.legacy).length, corrections: facts.filter(f => f.quality.correction || f.quality.conflict).length, unknownNature: facts.filter(f => f.quality.unknownNature).length },
        watermark: Math.max(0, ...facts.map(f => f.watermark)), eventCount: facts.reduce((s, f) => s + f.eventCount, 0), lastEventAt: facts.map(f => f.lastEventAt).filter(Boolean).sort().at(-1) || null };
}
