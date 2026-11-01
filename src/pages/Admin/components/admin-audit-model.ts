export const auditEventLabels: Record<string, string> = {
  ticket_create: 'Criação de chamado', ticket_attachment: 'Inclusão de anexo em chamado',
  map_proposal: 'Envio de proposta de mapa', project_draft: 'Criação de rascunho de projeto',
  project_reconcile: 'Reconciliação de projeto', permission_grant: 'Concessão de permissão',
  permission_revoke: 'Revogação de permissão', permission_deny: 'Bloqueio de permissão nativa',
  permission_restore: 'Restauração de permissão nativa', other: 'Ação não catalogada',
};
export type AuditEntry = { id: number; event: string; createdAt: string | null };
export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null };
export function parseAuditPage(value: unknown): AuditPage {
  const data = value as { ok?: unknown; entries?: unknown; nextBefore?: unknown } | null;
  if (!data || data.ok !== true || !Array.isArray(data.entries) || data.entries.length > 25) throw new Error('Invalid audit response');
  let previous = Infinity;
  const entries = data.entries.map((row: AuditEntry) => {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || row.id >= previous) throw new Error('Invalid audit entry');
    previous = row.id;
    const validTime = typeof row.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.createdAt) && Number.isFinite(Date.parse(row.createdAt));
    return { id: row.id, event: Object.hasOwn(auditEventLabels, row.event) ? row.event : 'other', createdAt: validTime ? row.createdAt : null };
  });
  const next = data.nextBefore;
  if (next !== null && (!Number.isSafeInteger(next) || entries.length !== 25 || next !== entries[24].id)) throw new Error('Invalid audit pagination');
  return { entries, nextBefore: next as number | null };
}
