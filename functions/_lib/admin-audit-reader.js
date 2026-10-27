const EVENTS = new Map([
  ['ticket.created', 'ticket_create'],
  ['ticket.attachment.added', 'ticket_attachment'],
  ['project.change_request.submitted', 'map_proposal'],
  ['project.lifecycle.draft_created', 'project_draft'],
  ['project.lifecycle.reconcile', 'project_reconcile'],
  ['permission.grant', 'permission_grant'],
  ['permission.revoke', 'permission_revoke'],
  ['permission.native.deny', 'permission_deny'],
  ['permission.native.restore', 'permission_restore'],
]);

export function auditCursor(url) {
  const params = new URL(url).searchParams;
  if ([...params.keys()].some(key => key !== 'before') || params.getAll('before').length > 1) throw new Error('INVALID_CURSOR');
  if (!params.has('before')) return null;
  const value = params.get('before');
  if (!/^[1-9]\d*$/.test(value || '') || !Number.isSafeInteger(Number(value))) throw new Error('INVALID_CURSOR');
  return Number(value);
}

function publicTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(value)) return null;
  const parsed = new Date(value.replace(' ', 'T').replace(/Z?$/, 'Z'));
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return parsed.toISOString();
}

export async function readAdminAuditPage(db, before) {
  // No joins, details JSON, actors, paths or organization reconstruction.
  const sql = `SELECT id, action, created_at FROM audit_logs${before === null ? '' : ' WHERE id < ?'} ORDER BY id DESC LIMIT 26`;
  const query = db.prepare(sql);
  const result = await (before === null ? query : query.bind(before)).all();
  if (!Array.isArray(result?.results) || result.results.length > 26) throw new Error('AUDIT_UNAVAILABLE');
  let previous = before ?? Infinity;
  const entries = result.results.map(row => {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || row.id >= previous) throw new Error('AUDIT_UNAVAILABLE');
    previous = row.id;
    return { id: row.id, event: EVENTS.get(row.action) ?? 'other', createdAt: publicTime(row.created_at) };
  });
  return { entries: entries.slice(0, 25), nextBefore: entries.length > 25 ? entries[24].id : null };
}
