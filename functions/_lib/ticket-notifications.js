import { getDb, getTableColumns, tableExists } from './organizations.js';
import { can } from './permissions.js';
import { buildTicketAccessPredicate, getTicketSelectiveAccessCapability, requireTicketAccess } from './ticket-access.js';

const enabled = (value) => String(value || '').trim().toLowerCase() === 'true';
const iso = (ms) => new Date(ms).toISOString();
const scope = (organizationId) => ({ organizationId, scopeType: 'organization', resourceType: 'ticket' });
export function notificationError(code, status = 503) {
  return Object.assign(new Error('Notificações de chamados indisponíveis.'), { code, status });
}
export function notificationStart(env) {
  const raw = String(env.MAONO_TICKET_NOTIFICATION_START_AT || '');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw) || (!Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString()!==raw)) {
    throw notificationError('TICKET_NOTIFICATION_START_REQUIRED');
  }
  return raw;
}
export function notificationOrganizations(env) {
  const values=String(env.MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS || '').split(',').map(v=>v.trim());
  if (!values.length || values.length>20 || values.some(v=>!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1)) {
    throw notificationError('TICKET_NOTIFICATION_SCOPE_REQUIRED');
  }
  return [...new Set(values.map(Number))];
}
export async function notificationReady(env, consumer = false) {
  if (!enabled(env[consumer ? 'MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED' : 'MAONO_TICKET_NOTIFICATIONS_ENABLED'])) return false;
  notificationStart(env);
  notificationOrganizations(env);
  if (consumer && !['local','production'].includes(String(env.MAONO_RUNTIME_ENV || '').toLowerCase())) {
    throw notificationError('TICKET_NOTIFICATION_RUNTIME_DENIED');
  }
  if (!(await getTicketSelectiveAccessCapability(env))) throw notificationError('TICKET_NOTIFICATION_ACCESS_REQUIRED');
  for (const table of ['ticket_command_outbox','ticket_notifications','ticket_notification_candidates']) {
    if (!(await tableExists(env,table))) throw notificationError('TICKET_NOTIFICATION_SCHEMA_OUTDATED');
  }
  const columns = await getTableColumns(env, 'ticket_command_outbox');
  const inbox = await getTableColumns(env, 'ticket_notifications');
  const candidates = await getTableColumns(env, 'ticket_notification_candidates');
  const events = await getTableColumns(env, 'ticket_events');
  const trigger = await getDb(env).prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='ticket_notification_snapshot'").first();
  if (!columns.has('notification_token') || !columns.has('notification_completed_at') ||
      !inbox.has('read_at') || !candidates.has('state') || !events.has('audience') || !trigger) throw notificationError('TICKET_NOTIFICATION_SCHEMA_OUTDATED');
  return true;
}
async function recipientAllowed(env, event, userId) {
  const user = await getDb(env).prepare(`SELECT u.id,u.role FROM users u
    JOIN organization_users ou ON ou.user_id=u.id
    JOIN organizations o ON o.id=ou.organization_id AND o.active=1
    WHERE u.id=? AND u.active=1 AND ou.organization_id=?`).bind(userId, event.organization_id).first();
  if (!user) return false;
  user.activeOrganizationId = event.organization_id;
  if (!(await can(env, user, 'ticket.view', scope(event.organization_id))).allowed) return false;
  if (event.audience === 'internal' && !(await can(env, user, 'ticket.note.view', scope(event.organization_id))).allowed) return false;
  try { await requireTicketAccess(env, event.organization_id, event.ticket_id, user); }
  catch (error) { if ([403,404].includes(error.status)) return false; throw error; }
  return true;
}
// Every write is fenced; a reclaimed or expired worker cannot deliver or ACK.
const leaseSql = `EXISTS (SELECT 1 FROM ticket_command_outbox o WHERE o.id=?
  AND o.status='processing' AND o.notification_token=? AND o.notification_lease_until>?)`;
export async function consumeTicketNotifications(env, { now = Date.now, batchSize = 10 } = {}) {
  if (!(await notificationReady(env, true))) return { enabled: false, claimed: 0 };
  const db = getDb(env), start = notificationStart(env);
  const organizations=notificationOrganizations(env), placeholders=organizations.map(()=>'?').join(',');
  const limit = Math.max(1, Math.min(25, Number.isInteger(batchSize) ? batchSize : 10));
  const stamp = iso(now());
  // Expired final attempts become observable failures, never an infinite reclaim loop.
  await db.prepare(`UPDATE ticket_command_outbox SET status='failed',notification_error='LEASE_EXHAUSTED',
    notification_token=NULL,notification_lease_until=NULL
    WHERE id IN (SELECT id FROM ticket_command_outbox WHERE organization_id IN (${placeholders}) AND created_at>=? AND status='processing'
      AND notification_lease_until<=? AND notification_attempts>=5 ORDER BY created_at LIMIT 25)`)
    .bind(...organizations,start, stamp).run();
  const rows = (await db.prepare(`SELECT o.id FROM ticket_command_outbox o
    WHERE o.organization_id IN (${placeholders}) AND o.created_at>=? AND o.notification_attempts<5
    AND EXISTS (SELECT 1 FROM ticket_notification_candidates c WHERE c.outbox_id=o.id)
    AND ((o.status='pending' AND (o.notification_next_at IS NULL OR o.notification_next_at<=?))
      OR (o.status='processing' AND o.notification_lease_until<=?))
    ORDER BY o.created_at,o.id LIMIT ?`).bind(...organizations,start,stamp,stamp,limit).all()).results || [];
  const report = { enabled: true, claimed: 0, delivered: 0, suppressed: 0, failed: 0, retried: 0, lostLease: 0 };
  for (const row of rows) {
    const token = crypto.randomUUID(), claimAt = iso(now());
    const claim = await db.prepare(`UPDATE ticket_command_outbox SET status='processing',notification_token=?,
      notification_lease_until=?,notification_attempts=notification_attempts+1
      WHERE id=? AND notification_attempts<5 AND ((status='pending' AND (notification_next_at IS NULL OR notification_next_at<=?))
      OR (status='processing' AND notification_lease_until<=?)) RETURNING *`)
      .bind(token,iso(now()+120000),row.id,claimAt,claimAt).first();
    if (!claim) continue;
    report.claimed++;
    try {
      const event = await db.prepare(`SELECT e.audience,e.event_type,o.organization_id,o.ticket_id,o.event_id
        FROM ticket_command_outbox o JOIN ticket_events e ON e.id=o.event_id
          AND e.organization_id=o.organization_id AND e.ticket_id=o.ticket_id
        WHERE o.id=?`).bind(row.id).first();
      if (!event || !['ticket','internal'].includes(event.audience)) throw notificationError('TICKET_NOTIFICATION_EVENT_INVALID');
      const candidates = (await db.prepare(`SELECT recipient_id FROM ticket_notification_candidates WHERE outbox_id=?`).bind(row.id).all()).results || [];
      const decisions = [];
      for (const candidate of candidates) decisions.push({ id: candidate.recipient_id, allowed: await recipientAllowed(env,event,candidate.recipient_id) });
      const completedAt = iso(now()), writes = [], deliveryIndexes = [];
      for (const decision of decisions) {
        if (decision.allowed) { deliveryIndexes.push(writes.length); writes.push(db.prepare(`INSERT INTO ticket_notifications
          (outbox_id,organization_id,ticket_id,event_id,recipient_id,audience,created_at)
          SELECT ?,?,?,?,?,?,? WHERE ${leaseSql}
          ON CONFLICT(event_id,recipient_id,channel) DO NOTHING`)
          .bind(row.id,event.organization_id,event.ticket_id,event.event_id,decision.id,event.audience,completedAt,row.id,token,completedAt)); }
        writes.push(db.prepare(`UPDATE ticket_notification_candidates SET state=?
          WHERE outbox_id=? AND recipient_id=? AND ${leaseSql}`)
          .bind(decision.allowed?'delivered':'suppressed',row.id,decision.id,row.id,token,completedAt));
      }
      writes.push(db.prepare(`UPDATE ticket_command_outbox SET status='delivered',notification_completed_at=?,
        notification_error=NULL,notification_token=NULL,notification_lease_until=NULL,notification_next_at=NULL
        WHERE id=? AND status='processing' AND notification_token=? AND notification_lease_until>?`)
        .bind(completedAt,row.id,token,completedAt));
      const result = await db.batch(writes);
      if (result.at(-1)?.meta?.changes) {
        report.delivered += deliveryIndexes.reduce((total,index)=>total+Number(result[index]?.meta?.changes||0),0);
        report.suppressed += decisions.filter(d=>!d.allowed).length;
      } else report.lostLease++;
    } catch {
      // Do not persist exceptions: DB errors can contain private SQL/parameters.
      const terminal = claim.notification_attempts>=5;
      const retryAt = iso(now()+Math.min(3600000,30000*2**(claim.notification_attempts-1))+Math.floor(Math.random()*5000));
      const result = await db.prepare(`UPDATE ticket_command_outbox SET status=?,notification_next_at=?,
        notification_error='DELIVERY_FAILED',notification_token=NULL,notification_lease_until=NULL
        WHERE id=? AND notification_token=? AND status='processing'`)
        .bind(terminal?'failed':'pending',retryAt,row.id,token).run();
      if (result.meta?.changes) report[terminal?'failed':'retried']++; else report.lostLease++;
    }
  }
  return report;
}

async function inboxFilter(env, organizationId, user) {
  const db = getDb(env);
  // Fresh membership and role, never trust a caller's recipient/role payload.
  const member = await db.prepare(`SELECT u.id,u.role FROM users u JOIN organization_users ou ON ou.user_id=u.id
    JOIN organizations org ON org.id=ou.organization_id AND org.active=1
    WHERE u.id=? AND ou.organization_id=? AND u.active=1`).bind(user.id,organizationId).first();
  if (!member) throw notificationError('TICKET_NOTIFICATION_FORBIDDEN',403);
  const actor = { ...member, activeOrganizationId: organizationId };
  if (!(await can(env,actor,'ticket.view',scope(organizationId))).allowed) throw notificationError('TICKET_NOTIFICATION_FORBIDDEN',403);
  const note = (await can(env,actor,'ticket.note.view',scope(organizationId))).allowed;
  const access = await buildTicketAccessPredicate(env,organizationId,actor);
  return { sql: `n.organization_id=? AND n.recipient_id=? AND t.active=1
    AND (n.audience='ticket' OR ?=1) AND (${access.sql})`, values: [organizationId,user.id,note?1:0,...access.values] };
}
const inboxJoin = `FROM ticket_notifications n JOIN organization_tickets t ON t.id=n.ticket_id AND t.organization_id=n.organization_id`;
export async function listTicketNotifications(env, organizationId, user, { before = null, limit = 20 } = {}) {
  if (!(await notificationReady(env)) || !notificationOrganizations(env).includes(Number(organizationId))) return { enabled:false,items:[],unread:0,nextCursor:null };
  const cursor = before == null || before==='' ? null : Number(before);
  if (cursor!==null && (!Number.isSafeInteger(cursor)||cursor<1)) throw notificationError('TICKET_NOTIFICATION_CURSOR_INVALID',400);
  const size = Math.max(1,Math.min(50,Number.isFinite(Number(limit)) ? Math.floor(Number(limit)||20) : 20));
  const db=getDb(env), filter=await inboxFilter(env,organizationId,user);
  const count=await db.prepare(`SELECT COUNT(*) AS total ${inboxJoin} WHERE ${filter.sql} AND n.read_at IS NULL`).bind(...filter.values).first();
  const rows=(await db.prepare(`SELECT n.id,n.ticket_id,n.audience,n.created_at,n.read_at,t.code,t.subject ${inboxJoin}
    WHERE ${filter.sql} AND (? IS NULL OR n.id<?) ORDER BY n.id DESC LIMIT ?`)
    .bind(...filter.values,cursor,cursor,Math.floor(size)+1).all()).results || [];
  const items=rows.slice(0,Math.floor(size)).map(r=>({id:r.id,ticketId:r.ticket_id,code:r.code,subject:r.subject,
    internal:r.audience==='internal',createdAt:r.created_at,readAt:r.read_at}));
  return {enabled:true,items,unread:Number(count?.total||0),nextCursor:rows.length>size ? String(items.at(-1).id):null};
}
export async function markTicketNotification(env, organizationId, user, notificationId, read) {
  if (!(await notificationReady(env)) || !notificationOrganizations(env).includes(Number(organizationId))) throw notificationError('TICKET_NOTIFICATIONS_DISABLED');
  if (!Number.isSafeInteger(Number(notificationId))||Number(notificationId)<1||typeof read!=='boolean') throw notificationError('TICKET_NOTIFICATION_INPUT_INVALID',400);
  const filter=await inboxFilter(env,organizationId,user);
  const result=await getDb(env).prepare(`UPDATE ticket_notifications SET read_at=? WHERE id IN
    (SELECT n.id ${inboxJoin} WHERE n.id=? AND ${filter.sql})`)
    .bind(read?new Date().toISOString():null,Number(notificationId),...filter.values).run();
  if (!result.meta?.changes) throw notificationError('TICKET_NOTIFICATION_NOT_FOUND',404);
  return {ok:true};
}
export async function requireNotificationOperator(env, organizationId, user) {
  if (!(await notificationReady(env)) || !notificationOrganizations(env).includes(Number(organizationId))) throw notificationError('TICKET_NOTIFICATIONS_DISABLED');
  if (!(await can(env,user,'admin.panel.access',scope(organizationId))).allowed) throw notificationError('TICKET_NOTIFICATION_OPERATOR_FORBIDDEN',403);
}
export async function notificationOperations(env, organizationId, user) {
  await requireNotificationOperator(env,organizationId,user);
  const db=getDb(env), start=notificationStart(env);
  const metrics=(await db.prepare(`SELECT o.status,COUNT(*) AS total,MIN(o.created_at) AS oldest,
    SUM(o.notification_attempts) AS attempts FROM ticket_command_outbox o
    WHERE o.organization_id=? AND o.created_at>=? AND EXISTS
      (SELECT 1 FROM ticket_notification_candidates c WHERE c.outbox_id=o.id)
    GROUP BY o.status`).bind(organizationId,start).all()).results || [];
  const failures=(await db.prepare(`SELECT id,notification_attempts AS attempts,notification_error AS error,created_at
    FROM ticket_command_outbox WHERE organization_id=? AND created_at>=? AND status='failed'
    ORDER BY created_at,id LIMIT 50`).bind(organizationId,start).all()).results || [];
  const deliveries=(await db.prepare(`SELECT c.state,COUNT(*) AS total FROM ticket_notification_candidates c
    JOIN ticket_command_outbox o ON o.id=c.outbox_id WHERE o.organization_id=? AND o.created_at>=?
    GROUP BY c.state`).bind(organizationId,start).all()).results || [];
  return {metrics,failures,deliveries};
}
export async function retryTicketNotification(env, organizationId, user, outboxId) {
  await requireNotificationOperator(env,organizationId,user);
  if (typeof outboxId!=='string'||!outboxId||outboxId.length>150) throw notificationError('TICKET_NOTIFICATION_INPUT_INVALID',400);
  const db=getDb(env), start=notificationStart(env), token=crypto.randomUUID(), stamp=new Date().toISOString();
  const result=await db.batch([
    db.prepare(`UPDATE ticket_command_outbox SET status='pending',notification_attempts=0,notification_next_at=NULL,
      notification_token=?,notification_lease_until=NULL,notification_error=NULL
      WHERE id=? AND organization_id=? AND status='failed' AND created_at>=?
      AND EXISTS (SELECT 1 FROM ticket_notification_candidates c WHERE c.outbox_id=ticket_command_outbox.id)`)
      .bind(token,outboxId,organizationId,start),
    db.prepare(`INSERT INTO audit_logs(user_id,action,details,created_at)
      SELECT ?,'ticket.notification.retried',json_object('organizationId',organization_id,'outboxId',id),?
      FROM ticket_command_outbox WHERE id=? AND organization_id=? AND notification_token=? AND status='pending'`)
      .bind(user.id,stamp,outboxId,organizationId,token),
  ]);
  if (!result[0]?.meta?.changes) throw notificationError('TICKET_NOTIFICATION_NOT_FOUND',404);
  return {ok:true};
}
