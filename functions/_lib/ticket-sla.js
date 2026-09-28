import { getDb, getTableColumns, tableExists } from './organizations.js';
import { requireTicketAccess } from './ticket-access.js';
import { assertTicketCommandReady } from './ticket-commands.js';
import { projectSla, validatePolicy, slaError } from './ticket-sla-clock.js';
export const isTicketSlaEnabled = (env, org) => String(env.MAONO_TICKET_SLA_ENABLED).toLowerCase() === 'true' && String(env.MAONO_TICKET_SLA_ORGANIZATION_IDS || '').split(',').map(x => x.trim()).includes(String(org));
export async function assertSlaReady(env, org) {
    if (!isTicketSlaEnabled(env, org))
        throw slaError('SLA indisponível nesta organização.', 503, 'TICKET_SLA_DISABLED');
    await assertTicketCommandReady(env, org);
    if (String(env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED).toLowerCase() !== 'true' || String(env.MAONO_TICKET_CONVERSATIONS_ENABLED).toLowerCase() !== 'true')
        throw slaError('SLA aguarda preparação do ambiente.', 503, 'TICKET_SLA_NOT_READY');
    for (const table of ['ticket_sla_policies', 'ticket_sla_assignments', 'ticket_sla_schema', 'ticket_messages'])
        if (!await tableExists(env, table))
            throw slaError('Schema SLA indisponível.', 503, 'TICKET_SLA_NOT_READY');
    if (!(await getTableColumns(env, 'ticket_events')).has('message_id'))
        throw slaError('Histórico de mensagens indisponível.', 503, 'TICKET_SLA_NOT_READY');
    const objects = await getDb(env).prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('ticket_sla_policy_sequence','ticket_sla_assignment_sequence','ticket_sla_policy_no_update','ticket_sla_policy_no_delete','ticket_sla_assignment_no_update','ticket_sla_assignment_no_delete')").all();
    if (objects.results.length !== 6 || !await getDb(env).prepare('SELECT version FROM ticket_sla_schema WHERE version=1').first())
        throw slaError('Schema SLA incompleto.', 503, 'TICKET_SLA_NOT_READY');
}
function inputCommand(body) {
    if (!body || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId))
        throw slaError('Informe versão e identificador de tentativa válidos.');
    if (typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000)
        throw slaError('Justifique com 10 a 1000 caracteres.');
}
async function digest(value) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function replay(row, hash, actor) { if (row.fingerprint !== hash || Number(row.actor_id) !== Number(actor.id))
    throw slaError('Tentativa já usada com outros dados.', 409, 'TICKET_SLA_IDEMPOTENCY_CONFLICT'); return row; }
const conflict = () => slaError('A versão mudou. Atualize antes de tentar novamente.', 412, 'TICKET_SLA_VERSION_CONFLICT');
function policySummary(p) { const { intervals, coverage, ...calendar } = p.calendar; return { ...p, calendar }; }
export async function listSlaPolicies(env, org) {
    await assertSlaReady(env, org);
    const rows = await getDb(env).prepare('SELECT version,policy_json,published_at FROM ticket_sla_policies WHERE organization_id=? ORDER BY version DESC LIMIT 101').bind(org).all();
    return { policies: rows.results.slice(0, 100).map(x => ({ version: x.version, publishedAt: x.published_at, ...policySummary(JSON.parse(x.policy_json)) })), hasMore: rows.results.length > 100 };
}
export async function publishSlaPolicy(env, org, actor, body) {
    await assertSlaReady(env, org);
    inputCommand(body);
    if (body.approved !== true)
        throw slaError('Confirme a aprovação operacional das metas e calendário.');
    const fingerprint = await digest(body), db = getDb(env);
    const prior = await db.prepare('SELECT * FROM ticket_sla_policies WHERE organization_id=? AND request_id=?').bind(org, body.requestId).first();
    if (prior) {
        replay(prior, fingerprint, actor);
        return { version: prior.version, replayed: true };
    }
    const policy = validatePolicy(body.policy);
    const members = await db.prepare(`SELECT u.id FROM organization_users ou JOIN users u ON u.id=ou.user_id WHERE ou.organization_id=? AND u.active=1 AND u.id IN (${policy.responders.map(() => '?').join(',')})`).bind(org, ...policy.responders).all();
    if (members.results.length !== policy.responders.length)
        throw slaError('Atendente elegível deve ser usuário ativo da organização.');
    const published = new Date().toISOString(), version = body.expectedVersion + 1;
    try {
        await db.batch([
            db.prepare('INSERT INTO ticket_sla_policies(organization_id,version,request_id,actor_id,fingerprint,policy_json,reason,published_at) VALUES(?,?,?,?,?,?,?,?)').bind(org, version, body.requestId, actor.id, fingerprint, JSON.stringify(policy), body.reason.trim(), published),
            db.prepare("INSERT INTO audit_logs(user_id,action,details,created_at) VALUES(?,'ticket.sla.policy.published',?,?)").bind(actor.id, JSON.stringify({ organizationId: org, version, reason: body.reason.trim(), requestId: body.requestId }), published),
        ]);
    }
    catch (error) {
        const winner = await db.prepare('SELECT * FROM ticket_sla_policies WHERE organization_id=? AND request_id=?').bind(org, body.requestId).first();
        if (winner) {
            replay(winner, fingerprint, actor);
            return { version: winner.version, replayed: true };
        }
        if (/CONSTRAINT|VERSION_CONFLICT|UNIQUE/.test(String(error)))
            throw conflict();
        throw error;
    }
    return { version, replayed: false };
}
export async function assignSlaPolicy(env, org, ticket, actor, body) {
    await assertSlaReady(env, org);
    await requireTicketAccess(env, org, ticket, actor, 'ticket.manage');
    inputCommand(body);
    if (!Number.isSafeInteger(body.policyVersion) || body.policyVersion < 1 || !Number.isSafeInteger(body.cycle) || body.cycle < 1)
        throw slaError('Informe a versão da política e o ciclo.');
    const db = getDb(env), fingerprint = await digest({ ticket, ...body });
    const prior = await db.prepare('SELECT * FROM ticket_sla_assignments WHERE organization_id=? AND request_id=?').bind(org, body.requestId).first();
    if (prior) {
        replay(prior, fingerprint, actor);
        return { sequence: prior.sequence, replayed: true };
    }
    const p = await db.prepare('SELECT * FROM ticket_sla_policies WHERE organization_id=? AND version=?').bind(org, body.policyVersion).first();
    if (!p)
        throw slaError('Política não encontrada.', 404, 'TICKET_SLA_POLICY_NOT_FOUND');
    const now = new Date().toISOString(), policy = JSON.parse(p.policy_json), ms = Date.parse(now);
    if (!policy.calendar.coverage.some(([a, b]) => a <= ms && ms < b))
        throw slaError('Calendário não cobre o instante atual. Publique uma nova versão.');
    try {
        await db.batch([
            db.prepare('INSERT INTO ticket_sla_assignments(organization_id,ticket_id,cycle_number,sequence,policy_version,request_id,actor_id,fingerprint,effective_at,reason) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(org, ticket, body.cycle, body.expectedVersion + 1, body.policyVersion, body.requestId, actor.id, fingerprint, now, body.reason.trim()),
            db.prepare("INSERT INTO audit_logs(user_id,action,details,created_at) VALUES(?,'ticket.sla.policy.assigned',?,?)").bind(actor.id, JSON.stringify({ organizationId: org, ticketId: ticket, cycle: body.cycle, policyVersion: body.policyVersion, reason: body.reason.trim(), requestId: body.requestId, segmentationRule: 'sum_of_elapsed_over_segment_target' }), now)
        ]);
    }
    catch (error) {
        const winner = await db.prepare('SELECT * FROM ticket_sla_assignments WHERE organization_id=? AND request_id=?').bind(org, body.requestId).first();
        if (winner) {
            replay(winner, fingerprint, actor);
            return { sequence: winner.sequence, replayed: true };
        }
        if (/CONSTRAINT|VERSION_CONFLICT|UNIQUE/.test(String(error)))
            throw conflict();
        throw error;
    }
    return { sequence: body.expectedVersion + 1, replayed: false };
}
export async function readTicketSla(env, org, ticket, actor) {
    await requireTicketAccess(env, org, ticket, actor, 'ticket.view');
    if (!isTicketSlaEnabled(env, org))
        return { enabled: false };
    await assertSlaReady(env, org);
    const db = getDb(env), cap = 2001;
    // One D1 batch snapshot: an in-flight close/message cannot split the replay.
    const results = await db.batch([
        db.prepare('SELECT created_by,current_cycle_number,version FROM organization_tickets WHERE organization_id=? AND id=?').bind(org, ticket),
        db.prepare('SELECT * FROM ticket_cycles WHERE organization_id=? AND ticket_id=? ORDER BY cycle_number LIMIT ?').bind(org, ticket, cap),
        db.prepare('SELECT * FROM ticket_sla_assignments WHERE organization_id=? AND ticket_id=? ORDER BY cycle_number,sequence LIMIT ?').bind(org, ticket, cap),
        db.prepare('SELECT p.version,p.policy_json FROM ticket_sla_policies p WHERE p.organization_id=? AND EXISTS(SELECT 1 FROM ticket_sla_assignments a WHERE a.organization_id=p.organization_id AND a.policy_version=p.version AND a.ticket_id=?) LIMIT ?').bind(org, ticket, cap),
        db.prepare('SELECT cycle_number,reason,started_at,ended_at FROM ticket_wait_intervals WHERE organization_id=? AND ticket_id=? LIMIT ?').bind(org, ticket, cap),
        db.prepare(`SELECT m.id,m.author_user_id,m.kind,m.audience,m.created_at,1 AS human FROM ticket_messages m
 JOIN ticket_commands c ON c.id=m.command_id AND c.actor_user_id=m.author_user_id AND c.organization_id=m.organization_id
 WHERE m.organization_id=? AND m.ticket_id=? AND m.kind='response' AND m.audience='ticket' AND c.operation='ticket.message.created'
 AND EXISTS(SELECT 1 FROM ticket_events e WHERE e.organization_id=m.organization_id AND e.ticket_id=m.ticket_id AND e.message_id=m.id AND e.event_type='ticket.message.created' AND e.actor_user_id=m.author_user_id AND e.command_id=m.command_id)
 ORDER BY m.created_at,m.id LIMIT ?`).bind(org, ticket, cap),
        db.prepare("SELECT id FROM ticket_events WHERE organization_id=? AND ticket_id=? AND corrects_event_id IS NOT NULL LIMIT 1").bind(org, ticket)
    ]);
    if (results.some(x => x.results.length >= cap))
        throw slaError('Histórico excede o limite do cálculo síncrono.', 503, 'TICKET_SLA_HISTORY_LIMIT');
    // Re-authorize after the snapshot, before any derived metadata leaves the API.
    await requireTicketAccess(env, org, ticket, actor, 'ticket.view');
    const [record, cycles, assignments, policies, waits, messages, corrections] = results.map(x => x.results);
    if (!record.length)
        throw slaError('Chamado não encontrado.', 404, 'TICKET_NOT_FOUND');
    if (corrections.length)
        return { enabled: true, status: 'unknown', reason: 'history_correction_requires_review', cycles: [] };
    const now = new Date().toISOString();
    const projection = projectSla({ cycles, assignments, policies: policies.map(x => ({ version: x.version, policy: JSON.parse(x.policy_json) })), waits, messages: messages.map(x => ({ ...x, human: x.human === 1 })), requesterId: record[0].created_by, now });
    return { enabled: true, ...projection, currentCycle: record[0].current_cycle_number, assignmentVersion: assignments.filter(x => x.cycle_number === record[0].current_cycle_number).at(-1)?.sequence || 0 };
}
