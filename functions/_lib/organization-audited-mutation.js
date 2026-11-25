import { operationAuditEnabled, requireOperationAuditReady, safeAuditChanges } from './operation-audit.js';

const clean = (value, max = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null;
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function snapshot(row) {
  if (!row) return null;
  return safeAuditChanges({ name: row.name, description: row.description, active: row.active, plan: row.plan,
    projectLimit: row.project_limit, ownerId: row.management_owner_id, storageStatus: row.storage_status });
}

/** The mutation and its attributed receipt share a D1 transaction.
 * SQLite restores changes() after triggers; zero-row CAS writes produce no receipt.
 * The after-image and identity are selected from the committed candidate inside
 * that same transaction, not reconstructed later from a mutable organization.
 */
export async function auditedOrganizationMutation(env, mutation, {
  context, organizationId, slug, operationId, attemptId = null, action, eventType = 'effect_confirmed', outcome = 'succeeded', before = null, code = null, storageOnly = false,
}) {
  if (!operationAuditEnabled(env)) return mutation.first();
  await requireOperationAuditReady(env);
  const sourceEventId = crypto.randomUUID();
  const selector = organizationId == null ? 'o.slug=?' : 'o.id=?';
  const actor = context || {};
  if (!['running', 'succeeded', 'unknown', 'no_change', 'partial', 'blocked'].includes(outcome)) throw new Error('AUDIT_MUTATION_OUTCOME_INVALID');
  const receipt = env.DB.prepare(`INSERT INTO audit_operation_frames (
    source,source_event_id,operation_id,attempt_id,event_type,outcome,
    actor_id,actor_name,original_actor_id,original_actor_name,executor_kind,
    organization_id,organization_name,organization_slug,context_organization_id,
    category,action,resource_type,resource_id,resource_label,ui_route,technical_origin,
    code,version,before_json,after_json,details_json)
    SELECT 'organization_lifecycle',?,?,?,?,?, ?,?,?,?,?, o.id,o.name,o.slug,?,
      'organizations',?,'organization',CAST(o.id AS TEXT),o.name,?,?,?,o.management_version,?,
      ${storageOnly ? "json_object('storageStatus',o.storage_status)" : "json_object('name',o.name,'description',o.description,'active',o.active,'plan',o.plan,'projectLimit',o.project_limit,'ownerId',o.management_owner_id,'storageStatus',o.storage_status)"},
      json_object('effectOnly',json('true'))
    FROM organizations o WHERE ${selector} AND changes()>0`).bind(
    sourceEventId, clean(operationId, 80), clean(attemptId, 100), eventType, outcome,
    id(actor.actorId), clean(actor.actorName), id(actor.originalActorId), clean(actor.originalActorName),
    ['user', 'worker', 'system'].includes(actor.executorKind) ? actor.executorKind : 'unknown',
    id(actor.contextOrganizationId), action, clean(actor.route, 200), clean(actor.origin, 300),
    /^[A-Z][A-Z0-9_]{0,100}$/.test(code || '') ? code : null,
    JSON.stringify(storageOnly ? before ? { storageStatus: before.storage_status ?? null } : null : snapshot(before)), organizationId ?? slug,
  );
  const results = await env.DB.batch([mutation, receipt]);
  return results[0]?.results?.[0] || null;
}
