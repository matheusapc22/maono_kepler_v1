// CC10 pure, bounded, minute-resolution civil calendars. Persist compiled UTC
// intervals with the policy: a future runtime tzdb must not rewrite history.
export const slaError = (message, status = 400, code = 'TICKET_SLA_INVALID') => Object.assign(new Error(message), { status, code, publicMessage: message });
const DAY = 86400000;
export function instant(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
        throw slaError('Instante UTC inválido.');
    const n = Date.parse(value);
    if (new Date(n).toISOString().slice(0, 19) !== value.slice(0, 19))
        throw slaError('Data inválida.');
    return n;
}
function civilDate(value) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(value || ''))
        throw slaError('Use uma data entre 2000 e 2099.');
    return instant(`${value}T00:00:00Z`);
}
function ranges(value) {
    if (!Array.isArray(value) || value.length > 8)
        throw slaError('Informe até oito intervalos por dia.');
    let last = -1;
    return value.map(pair => {
        if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isInteger) || pair[0] < 0 || pair[1] > 1440 || pair[0] >= pair[1] || pair[0] < last)
            throw slaError('Intervalos devem ser ordenados, sem sobreposição, em minutos de 0 a 1440. Divida expediente noturno entre os dias.');
        last = pair[1];
        return [...pair];
    });
}
export function compileCalendar(input) {
    if (!input || typeof input.timeZone !== 'string')
        throw slaError('Informe o fuso IANA do calendário.');
    let formatter;
    try {
        formatter = new Intl.DateTimeFormat('en-CA', { timeZone: input.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    }
    catch {
        throw slaError('Fuso IANA inválido.');
    }
    const start = civilDate(input.from), finish = civilDate(input.through) + DAY;
    if (finish <= start || finish - start > 366 * DAY)
        throw slaError('Calendário deve cobrir entre um e 366 dias.');
    if (!Array.isArray(input.weekly) || input.weekly.length !== 7)
        throw slaError('Informe sete dias, de domingo a sábado.');
    const weekly = input.weekly.map(ranges), exceptions = {};
    if (input.exceptions != null && (typeof input.exceptions !== 'object' || Array.isArray(input.exceptions)))
        throw slaError('Exceções inválidas.');
    if (Object.keys(input.exceptions || {}).length > 366)
        throw slaError('Excesso de exceções.');
    for (const [day, value] of Object.entries(input.exceptions || {})) {
        const d = civilDate(day);
        if (d < start || d >= finish)
            throw slaError('Exceção fora da cobertura.');
        exceptions[day] = ranges(value);
    }
    const offset = ms => {
        const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
    };
    // Scan hourly, locate offset transitions at second precision. Supported civil
    // range 2000..2099; modern IANA transitions cannot occur twice within one hour.
    const spans = [];
    let a = start - 2 * DAY, off = offset(a);
    for (let t = a + 3600000; t <= finish + 2 * DAY; t += 3600000) {
        const next = offset(t);
        if (next !== off) {
            let lo = t - 3600000, hi = t;
            while (hi - lo > 1000) {
                const mid = Math.floor((lo + hi) / 2000) * 1000;
                if (offset(mid) === off)
                    lo = mid;
                else
                    hi = mid;
            }
            spans.push([a, hi, off]);
            a = hi;
            off = next;
        }
    }
    spans.push([a, finish + 2 * DAY, off]);
    const intervals = [], coverage = [];
    for (let day = start; day < finish; day += DAY) {
        const date = new Date(day).toISOString().slice(0, 10), periods = exceptions[date] ?? weekly[new Date(day).getUTCDay()];
        for (const [u, v, o] of spans) {
            const c = [Math.max(day - o, u), Math.min(day + DAY - o, v)];
            if (c[1] > c[0])
                coverage.push(c);
            for (const [s, e] of periods) {
                const x = Math.max(day + s * 60000 - o, u), y = Math.min(day + e * 60000 - o, v);
                if (y > x)
                    intervals.push([x, y]);
            }
        }
    }
    return { timeZone: input.timeZone, from: input.from, through: input.through, weekly, exceptions, intervals: mergeIntervals(intervals), coverage: mergeIntervals(coverage), compilerVersion: 1 };
}
export function mergeIntervals(items) {
    const result = [];
    for (const [a, b] of [...items].sort((x, y) => x[0] - y[0])) {
        if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
            throw slaError('Intervalo inválido.');
        if (b === a)
            continue;
        const last = result.at(-1);
        if (last && a <= last[1])
            last[1] = Math.max(last[1], b);
        else
            result.push([a, b]);
    }
    return result;
}
function intersectionMs(intervals, a, b) { return intervals.reduce((sum, [s, e]) => sum + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0); }
export function businessTime(calendar, from, to, pauses = []) {
    const a = instant(from), b = instant(to);
    if (b < a)
        throw slaError('Fim anterior ao início.');
    if (intersectionMs(calendar.coverage, a, b) !== b - a)
        return { known: false, reason: 'calendar_coverage', elapsedMs: null, pausedMs: null };
    const validPauses = pauses.map(x => { const start = instant(x[0]), stop = instant(x[1]); if (stop < start)
        throw slaError('Pausa termina antes de iniciar.'); return [start, stop]; });
    const union = mergeIntervals(validPauses.map(([s, e]) => [Math.max(a, s), Math.min(b, e)]).filter(x => x[1] > x[0]));
    const gross = intersectionMs(calendar.intervals, a, b), paused = union.reduce((n, [s, e]) => n + intersectionMs(calendar.intervals, s, e), 0);
    return { known: true, elapsedMs: gross - paused, pausedMs: paused };
}
export function validatePolicy(input) {
    if (!input || typeof input.name !== 'string' || input.name.trim().length < 3 || input.name.length > 120)
        throw slaError('Nome da política deve ter 3 a 120 caracteres.');
    const targets = {};
    for (const key of ['responseMinutes', 'resolutionMinutes']) {
        const v = input[key];
        if (v !== null && (!Number.isInteger(v) || v < 1 || v > 525600))
            throw slaError('Meta deve ser nula ou entre 1 e 525600 minutos.');
        targets[key] = v;
    }
    if (!Array.isArray(input.responders) || !input.responders.length || input.responders.length > 100 || !input.responders.every(x => Number.isSafeInteger(x) && x > 0))
        throw slaError('Informe até 100 atendentes humanos elegíveis.');
    if (!Array.isArray(input.pauseReasons) || input.pauseReasons.length > 30 || !input.pauseReasons.every(x => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= 1000))
        throw slaError('Motivos de pausa inválidos.');
    return { name: input.name.trim(), ...targets, responders: [...new Set(input.responders)].sort((a, b) => a - b), pauseReasons: [...new Set(input.pauseReasons)].sort(), calendar: compileCalendar(input.calendar) };
}
// Every read is a pure replay of immutable assignments and source records. No
// projection writer, cron, inferred historical events or mutation in GET.
export function projectSla({ cycles, assignments, policies, waits, messages, requesterId, now }) {
    const end = instant(now), byVersion = new Map(policies.map(x => [x.version, x.policy]));
    let globalResponse = null;
    const ordered = [...messages].sort((a, b) => instant(a.created_at) - instant(b.created_at) || String(a.id).localeCompare(String(b.id)));
    // Determine the unique first response before measuring any cycle. For a
    // pre-assignment message use that cycle's first approved roster, but never
    // manufacture elapsed time for its uncovered prefix.
    for (const m of ordered) {
        const at = instant(m.created_at);
        if (at > end || m.kind !== 'response' || m.audience !== 'ticket' || m.human !== true || Number(m.author_user_id) === Number(requesterId))
            continue;
        const cycle = cycles.find(c => instant(c.opened_at) <= at && (!c.closed_at || at <= instant(c.closed_at)));
        if (!cycle)
            continue;
        const choices = assignments.filter(x => x.cycle_number === cycle.cycle_number).sort((a, b) => a.sequence - b.sequence);
        const chosen = choices.filter(x => instant(x.effective_at) <= at).at(-1) || choices[0];
        if (chosen && byVersion.get(chosen.policy_version)?.responders.includes(Number(m.author_user_id))) {
            globalResponse = { at: m.created_at };
            break;
        }
    }
    const output = [];
    let responseCarry = null;
    for (const cycle of [...cycles].sort((a, b) => a.cycle_number - b.cycle_number)) {
        const stop = Math.min(end, cycle.closed_at ? instant(cycle.closed_at) : end);
        const segments = assignments.filter(x => x.cycle_number === cycle.cycle_number).sort((a, b) => a.sequence - b.sequence);
        if (!segments.length) {
            output.push({ cycle: cycle.cycle_number, status: 'no_sla', closedAt: cycle.closed_at || null, origin: cycle.origin, segments: [] });
            continue;
        }
        const clocks = { response: { consumed: 0, elapsedMs: 0, pausedMs: 0, known: true, enabled: false }, resolution: { consumed: 0, elapsedMs: 0, pausedMs: 0, known: true, enabled: false } };
        if (responseCarry)
            clocks.response = { ...responseCarry };
        const detail = [];
        for (let i = 0; i < segments.length; i++) {
            const s = segments[i], p = byVersion.get(s.policy_version), a = instant(s.effective_at), b = Math.min(stop, i + 1 < segments.length ? instant(segments[i + 1].effective_at) : stop);
            if (!p)
                throw slaError('Versão da política ausente.', 503, 'TICKET_SLA_NOT_READY');
            if (b < a)
                continue;
            const paused = waits.filter(w => w.cycle_number === cycle.cycle_number && p.pauseReasons.includes(w.reason)).map(w => [w.started_at, w.ended_at || now]);
            const part = { version: s.policy_version, from: s.effective_at, to: new Date(b).toISOString(), timeZone: p.calendar.timeZone, name: p.name, responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes };
            for (const key of ['response', 'resolution']) {
                const target = p[`${key}Minutes`], c = clocks[key];
                if (target === null) {
                    c.known = false;
                    part[key] = { known: false, reason: 'no_target' };
                    continue;
                }
                c.enabled = true;
                const z = key === 'response' && globalResponse ? Math.min(b, Math.max(a, instant(globalResponse.at))) : b;
                const measured = businessTime(p.calendar, new Date(a).toISOString(), new Date(z).toISOString(), paused);
                part[key] = measured;
                c.known = c.known && measured.known;
                if (measured.known) {
                    c.elapsedMs += measured.elapsedMs;
                    c.pausedMs += measured.pausedMs;
                    c.consumed += measured.elapsedMs / (target * 60000);
                }
            }
            detail.push(part);
        }
        responseCarry = { ...clocks.response };
        // Baselines are not historical starts. Explicit assignment starts contractual
        // coverage; expose the uncovered prefix instead of pretending it was zero.
        for (const [key, c] of Object.entries(clocks)) {
            c.status = !c.enabled ? 'no_sla' : !c.known ? 'unknown' : c.consumed > 1 ? 'breached' : ((key === 'response' && globalResponse && instant(globalResponse.at) <= stop) || (key === 'resolution' && cycle.closed_at)) ? 'completed' : key === 'response' && cycle.closed_at ? 'awaiting_response' : 'running';
            if (!c.known) {
                c.elapsedMs = null;
                c.pausedMs = null;
                c.consumed = null;
            }
        }
        output.push({ cycle: cycle.cycle_number, origin: cycle.origin, status: 'assigned', closedAt: cycle.closed_at || null, coverageFrom: segments[0].effective_at, uncoveredPrefix: instant(segments[0].effective_at) > instant(cycle.opened_at), clocks, segments: detail });
    }
    return { asOf: now, firstResponse: globalResponse, cycles: output, segmentationRule: 'sum_of_elapsed_over_segment_target', source: 'observed_cycles_and_public_human_messages' };
}
