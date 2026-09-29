import {feedbackMetricSource} from './ticket-feedback.js';
import {aggregateFeedback} from './ticket-feedback-domain.js';
import { getDb } from './organizations.js';
import { buildTicketAccessPredicate } from './ticket-access.js';
import { assertSlaReady } from './ticket-sla.js';
import { aggregateMetricFacts, projectMetricTicket, metricWindow, metricsError } from './ticket-metrics-domain.js';
export const isMetricsEnabled = (env, org) => String(env.MAONO_TICKET_METRICS_ENABLED).toLowerCase() === 'true' && String(env.MAONO_TICKET_METRICS_ORGANIZATION_IDS || '').split(',').map(x => x.trim()).includes(String(org));
async function ready(env, org, actor) {
    if (!isMetricsEnabled(env, org))
        throw metricsError('Métricas indisponíveis nesta organização.', 503, 'TICKET_METRICS_DISABLED');
    await assertSlaReady(env, org);
    const db = getDb(env);
    if (!await db.prepare('SELECT 1 FROM organization_users ou JOIN users u ON u.id=ou.user_id WHERE ou.organization_id=? AND u.id=? AND u.active=1').bind(org, actor.id).first())
        throw metricsError('Acesso indisponível.', 403, 'TICKET_METRICS_ACCESS_DENIED');
    const objects = await db.prepare("SELECT name FROM sqlite_master WHERE name IN ('ticket_metric_definitions','ticket_metric_rollups','ticket_metric_checkpoints','ticket_metric_definition_sequence','ticket_metric_definition_no_update','ticket_metric_definition_no_delete','ticket_metric_checkpoint_no_update','ticket_metric_checkpoint_no_delete')").all();
    if (objects.results.length !== 8)
        throw metricsError('Métricas aguardam preparação do ambiente.', 503, 'TICKET_METRICS_NOT_READY');
}
async function digest(v) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v))))].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function visible(env, org, actor) { const p = await buildTicketAccessPredicate(env, org, actor); return { sql: `t.organization_id=? AND t.active=1 AND (${p.sql})`, values: [org, ...p.values] }; }
async function definition(db, org, version) {
    if (version === 0)
        return { version: 0, reopen_hours: null };
    const row = version == null ? await db.prepare('SELECT * FROM ticket_metric_definitions WHERE organization_id=? ORDER BY version DESC LIMIT 1').bind(org).first() : await db.prepare('SELECT * FROM ticket_metric_definitions WHERE organization_id=? AND version=?').bind(org, version).first();
    if (version != null && !row)
        throw metricsError('Versão de métricas não encontrada.', 404, 'TICKET_METRICS_DEFINITION_NOT_FOUND');
    return row || { version: 0, reopen_hours: null };
}
export async function publishMetricDefinition(env, org, actor, body) {
    await ready(env, org, actor);
    if (body.approved !== true || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || !Number.isSafeInteger(body.reopenHours) || body.reopenHours < 1 || body.reopenHours > 8760 || typeof body.requestId !== 'string' || !/^[-\w]{16,100}$/.test(body.requestId) || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000)
        throw metricsError('Informe janela de reabertura aprovada, versão, justificativa e identificador de tentativa.');
    const db = getDb(env), prior = await db.prepare('SELECT * FROM ticket_metric_definitions WHERE organization_id=? AND request_id=?').bind(org, body.requestId).first();
    const replay = row => { if (row.actor_id !== actor.id || row.reopen_hours !== body.reopenHours || row.reason !== body.reason.trim() || row.version !== body.expectedVersion + 1)
        throw metricsError('Tentativa reutilizada com outros dados.', 409, 'TICKET_METRICS_CONFLICT'); return { version: row.version, replayed: true }; };
    if (prior)
        return replay(prior);
    const version = body.expectedVersion + 1, now = new Date().toISOString();
    try {
        await db.batch([db.prepare('INSERT INTO ticket_metric_definitions VALUES(?,?,1,?,?,?,?,?)').bind(org, version, body.reopenHours, actor.id, body.requestId, body.reason.trim(), now), db.prepare("INSERT INTO audit_logs(user_id,action,details,created_at) VALUES(?,'ticket.metrics.definition.published',?,?)").bind(actor.id, JSON.stringify({ organizationId: org, version, reason: body.reason.trim() }), now)]);
    }
    catch (error) {
        const winner = await db.prepare('SELECT * FROM ticket_metric_definitions WHERE organization_id=? AND request_id=?').bind(org, body.requestId).first();
        if (winner)
            return replay(winner);
        if (/CONSTRAINT|VERSION_CONFLICT|UNIQUE/.test(String(error)))
            throw metricsError('Versão alterada; atualize a consulta.', 412, 'TICKET_METRICS_CONFLICT');
        throw error;
    }
    return { version, replayed: false };
}
async function capture(env, org, actor, input) {
    await ready(env, org, actor);
    const db = getDb(env), window = metricWindow(input);
    const feedback = await feedbackMetricSource(env, org, actor);
    if (input.definitionVersion != null && (!Number.isSafeInteger(Number(input.definitionVersion)) || Number(input.definitionVersion) < 0))
        throw metricsError('Versão inválida.');
    const def = await definition(db, org, input.definitionVersion == null ? null : Number(input.definitionVersion));
    const access = await visible(env, org, actor), cap = 2001;
    const query = (select, join = '', order = 't.id', limit = cap) => db.prepare(`SELECT ${select} FROM organization_tickets t ${join} WHERE ${access.sql} AND julianday(t.created_at)<=julianday(?) ORDER BY ${order} LIMIT ?`).bind(...access.values, window.asOf, limit);
    const rows = (await db.batch([
        query('t.id,t.status,t.version,t.created_by,t.created_at,t.demand_nature,t.assigned_to', '', 't.id', 201),
        query('c.*', 'JOIN ticket_cycles c ON c.ticket_id=t.id AND c.organization_id=t.organization_id', 't.id,c.cycle_number'),
        query('e.*', "JOIN ticket_events e ON e.ticket_id=t.id AND e.organization_id=t.organization_id AND COALESCE(e.audience,'ticket')='ticket'", 't.id,e.id'),
        query('w.*', 'JOIN ticket_wait_intervals w ON w.ticket_id=t.id AND w.organization_id=t.organization_id', 't.id,w.id'),
        query('m.id,m.ticket_id,m.author_user_id,m.created_at,m.kind,m.audience', `JOIN ticket_messages m ON m.ticket_id=t.id AND m.organization_id=t.organization_id JOIN ticket_commands c ON c.id=m.command_id AND c.actor_user_id=m.author_user_id AND c.organization_id=m.organization_id AND c.operation='ticket.message.created' JOIN ticket_message_revisions r ON r.message_id=m.id AND r.version=1 AND length(trim(r.body))>0 AND m.kind='response' AND m.audience='ticket' AND EXISTS(SELECT 1 FROM ticket_events e WHERE e.ticket_id=m.ticket_id AND e.organization_id=m.organization_id AND e.message_id=m.id AND e.command_id=m.command_id AND e.actor_user_id=m.author_user_id AND e.event_type='ticket.message.created')`, 't.id,m.id'),
        query('s.*', 'JOIN ticket_sla_assignments s ON s.ticket_id=t.id AND s.organization_id=t.organization_id', 't.id,s.cycle_number,s.sequence'),
        query('DISTINCT p.*', 'JOIN ticket_sla_assignments s ON s.ticket_id=t.id AND s.organization_id=t.organization_id JOIN ticket_sla_policies p ON p.organization_id=s.organization_id AND p.version=s.policy_version', 'p.version'),
        query('r.*', 'JOIN ticket_metric_rollups r ON r.ticket_id=t.id AND r.organization_id=t.organization_id', 't.id', 201)
    ])).map(x => x.results);
    if (rows[0].length > 200 || rows.slice(1, 7).some(x => x.length >= cap))
        throw metricsError('Universo excede o limite da consulta síncrona. Relatório assíncrono necessário.', 503, 'TICKET_METRICS_LIMIT');
    const [tickets, cycles, events, waits, messages, assignments, policies, rollups] = rows;
    const partitions = await Promise.all(tickets.map(async (ticket) => { const subset = xs => xs.filter(x => x.ticket_id === ticket.id); const source = { ...(feedback ? {feedback: subset(feedback.rows)} : {}), ticket, cycles: subset(cycles), events: subset(events), waits: subset(waits), messages: subset(messages), assignments: subset(assignments), policies: policies.filter(p => subset(assignments).some(s => s.policy_version === p.version)) }; const hash = await digest({ source, window, definition: { version: def.version, reopen_hours: def.reopen_hours } }), fact = {...projectMetricTicket(source, window, def), ...(feedback ? {feedback:source.feedback} : {})}, stored = rollups.find(r => r.ticket_id === ticket.id); return { ticket, hash, fact, stored, matched: stored?.source_hash === hash && stored.facts_json === JSON.stringify(fact) }; }));
    // Rebuild the predicate after the snapshot: group/ACL revocation must invalidate the whole response.
    const recheck = await visible(env, org, actor);
    const still = await db.prepare(`SELECT t.id FROM organization_tickets t WHERE ${recheck.sql} AND julianday(t.created_at)<=julianday(?) ORDER BY t.id LIMIT 201`).bind(...recheck.values, window.asOf).all();
    if (JSON.stringify(still.results.map(x => x.id)) !== JSON.stringify(tickets.map(x => x.id)))
        throw metricsError('Acesso alterado. Atualize a consulta.', 409, 'TICKET_METRICS_ACCESS_CHANGED');
    await ready(env, org, actor);
    if (feedback) await feedback.verify();
    return { db, window, def, partitions, feedbackEnabled: !!feedback };
}
export async function readMetrics(env, org, actor, input) {
    if (!isMetricsEnabled(env, org))
        return { enabled: false };
    const { window, def, partitions, feedbackEnabled } = await capture(env, org, actor, input);
    // A stale rollup is never trusted. Raw projection is the reconciliation oracle for this bounded release.
    const result = aggregateMetricFacts(partitions.map(p => p.fact), window, def);
    const built = partitions.filter(p => p.matched).map(p => p.stored.built_at).sort()[0] || null;
    return { enabled: true, ...result, dictionary: feedbackEnabled ? {...result.dictionary, families:[...result.dictionary.families,'outcome_effort'], effort:'ordinal', extensions:{feedback:1}} : result.dictionary, feedback: feedbackEnabled ? aggregateFeedback(partitions.flatMap(p=>p.fact.feedback || []),window) : {enabled:false}, aggregation: { mode: 'authorized_raw_verified', matched: partitions.filter(p => p.matched).length, pending: partitions.filter(p => !p.matched).length, builtAt: built, lagMs: built ? Math.max(0, Date.now() - Date.parse(built)) : null }, dimensions: { nature: 'current', team: 'current_assignee' }, generatedAt: new Date().toISOString() };
}
export async function replayMetrics(env, org, actor, input) {
    const { db, window, def, partitions } = await capture(env, org, actor, input), now = new Date().toISOString();
    const changed = partitions.filter(p => !p.matched), statements = [];
    for (const p of changed) {
        const revision = (p.stored?.revision || 0) + 1;
        statements.push(db.prepare(`INSERT INTO ticket_metric_checkpoints(organization_id,ticket_id,revision,source_hash,previous_hash,watermark,dictionary_version,definition_version,window_json,quality_json,actor_id,built_at) VALUES(?,?,?,?,?,?,1,?,?,?,?,?)`).bind(org, p.ticket.id, revision, p.hash, p.stored?.source_hash || null, p.fact.watermark, def.version, JSON.stringify(window), JSON.stringify(p.fact.quality), actor.id, now));
        statements.push(db.prepare(`INSERT INTO ticket_metric_rollups VALUES(?,?,1,?,?,?,?,?,?,?) ON CONFLICT(organization_id,ticket_id) DO UPDATE SET dictionary_version=excluded.dictionary_version,definition_version=excluded.definition_version,window_json=excluded.window_json,source_hash=excluded.source_hash,facts_json=excluded.facts_json,watermark=excluded.watermark,revision=excluded.revision,built_at=excluded.built_at`).bind(org, p.ticket.id, def.version, JSON.stringify(window), p.hash, JSON.stringify(p.fact), p.fact.watermark, revision, now));
    }
    if (statements.length) {
        statements.push(db.prepare("INSERT INTO audit_logs(user_id,action,details,created_at) VALUES(?,'ticket.metrics.replayed',?,?)").bind(actor.id, JSON.stringify({ organizationId: org, partitions: changed.length, definitionVersion: def.version, window }), now));
        try {
            await db.batch(statements);
        }
        catch (error) {
            if (/UNIQUE|CONSTRAINT/.test(String(error)))
                throw metricsError('Reconstrução concorrente; atualize antes de repetir.', 409, 'TICKET_METRICS_CONFLICT');
            throw error;
        }
    }
    // Do not return pre-write aggregates; re-read and authorize anew after persistence.
    return { ...await readMetrics(env, org, actor, { ...window, definitionVersion: def.version }), replay: { changed: changed.length, unchanged: partitions.length - changed.length } };
}
