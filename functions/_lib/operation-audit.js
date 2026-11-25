import { check, ManagementError } from './organization-management-contract.js';

export const operationAuditEnabled = env => String(env.ADMIN_AUDIT_OPERATIONS_V1) === 'true';
const one = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const OUTCOMES = new Set(['requested','authorized','denied','running','succeeded','failed','blocked','partial','unknown','no_change']);
const FIELDS = ['name','description','active','plan','projectLimit','ownerId','storageStatus','decision'];
const DETAILS = ['effectOnly','requestId','checkpoint','attempt','state','reason','reconciled','disposition','expectedVersion','confirmedEventIds','confirmedNoEffect','operationKind','fieldNames'];
// Fingerprints of normalized sqlite_master SQL from migration 0045. This checks
// the actual CHECK/UNIQUE/FK/append-only definitions, not only object names.
export const AUDIT_SCHEMA_FINGERPRINTS=Object.freeze({
  audit_frame_org_deletion_event:'6c7c4f76db492ee60221c26aaa643ab14e2a3842f409b052f40aa6c8ffa5fa0b',
  audit_frame_org_legacy_created:'a189fd0a2e4b2b9edf44812a451982e101a9adc17a72e4771bdc1e97bdaf038d',
  audit_frame_org_management_event:'e37b03119ba65ce9195124d854e9d82f65cb9431f768abf07842934252b7a648',
  audit_frame_org_storage_observed:'ce67be4c82049119481c4d9302adfdaa7a59a8df12ca0c2b75121f8933402b43',
  audit_frames_no_delete:'89fbd9d05773dc639fd6d91f01a9e4a33d285023727811eb2419c64ab18e6cd8',
  audit_frames_no_update:'2cd3f85f631f038319b91502f079a9d3f27fd5c244469a1f14a7ae760a135e03',
  audit_operation_frames:'a5818ffa0d8dc2a0c6c0b18c2cccf95fcc1fb2d2eeffdf9109521e919146d7c3',
  idx_audit_frames_operation:'e6fbeafaf5dc47f28e315312825c298fe1cffcb2422c4bc6973e4fbbad8f428e',
  idx_audit_frames_order:'65be8c4dba3aa1e7efa287068fdcfa41b958060e8b5f4024aed590de5071dc97',
  idx_audit_frames_organization:'02be222fe503cde50bff0090d7a29974e2c35f32e88b375801474bde567c02a2',
  idx_audit_frames_outcome:'a2576b24326278179f8509ebcccbe8854f905e3d3d37dd1a888c11c59b0ae728',
  organization_operation_reconciliations:'9cc80a9f37eaaf724150d7a9f645e7e4be3603392c2f2eac5f77acd92608d338',
  organization_reconciliations_no_delete:'a7641d1eef3f7bcb8cffd05405eda3c97db49bceab54c2d00083904e5f82aec3',
  organization_reconciliations_no_update:'d1678f6d3bf6018390e2510b4d0befe540ba177ea038ad260b47131255267ddd',
});
const clean = (value, max = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max) : null;
const safeId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
function scalar(value) {
  if(value === null || typeof value === 'boolean') return value;
  if(typeof value === 'number') return Number.isFinite(value) ? value : null;
  return clean(value,2000);
}
export function safeAuditChanges(value) {
  const object = parse(value);
  if(!object || Array.isArray(object) || typeof object !== 'object') return null;
  return Object.fromEntries(FIELDS.filter(key => Object.hasOwn(object,key)).map(key => [key,scalar(object[key])]));
}
export function safeAuditDetails(value) {
  const object = parse(value);
  if(!object || Array.isArray(object) || typeof object !== 'object') return {};
  return Object.fromEntries(DETAILS.filter(key => Object.hasOwn(object,key)).map(key => [key,
    Array.isArray(object[key]) ? object[key].slice(0,100).map(value=>scalar(value)) : scalar(object[key])]));
}
export function auditRequestContext(request, actor, extra = {}) {
  let origin = extra.origin || null, route = null;
  if(request) {
    const url = new URL(request.url);
    origin = `api:${request.method}:${url.pathname}`;
    const supplied = request.headers.get('X-Maono-UI-Route');
    // This is explicitly informational; authentication never uses this header.
    if(supplied && /^\/(?:admin|projects|projetos)(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(supplied)) route = supplied.slice(0,200);
  }
  return {
    actorId:safeId(actor?.id), actorName:clean(actor?.name),
    originalActorId:safeId(extra.originalActorId ?? actor?.id),
    originalActorName:clean(extra.originalActorName ?? actor?.name),
    contextOrganizationId:safeId(actor?.activeOrganizationId ?? actor?.active_organization_id),
    route, origin:clean(origin,300), executorKind:extra.executorKind || (request ? 'user' : 'unknown'),
  };
}

export async function requireOperationAuditReady(env) {
  check(operationAuditEnabled(env),'A nova auditoria aguarda ativação neste ambiente.',503,'AUDIT_OPERATIONS_DISABLED');
  const names=Object.keys(AUDIT_SCHEMA_FINGERPRINTS);
  const objects=await all(env,`SELECT name,sql FROM sqlite_master WHERE name IN (${names.map(()=>'?').join(',')})`,...names);
  const matches=await Promise.all(objects.map(async row=>{
    const value=String(row.sql||'').replace(/\s+/g,' ').trim().toLowerCase();
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    const hash=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
    return AUDIT_SCHEMA_FINGERPRINTS[row.name]===hash;
  }));
  check(objects.length===names.length&&matches.every(Boolean),
    'A nova auditoria aguarda a migration 0045 validada.',503,'AUDIT_OPERATIONS_SCHEMA_REQUIRED');
}

/** A prepared statement is included in the SAME D1 batch as the domain state.
 * No optionalRun, network, arbitrary log commands or independent success write. */
export function auditFrameStatement(env, frame, condition = {sql:'1',args:[]}) {
  check(OUTCOMES.has(frame.outcome),'Resultado de auditoria inválido.',500,'AUDIT_FRAME_INVALID');
  const context=frame.context || {}, org=frame.organization || {};
  const source=clean(frame.source,80), eventId=clean(frame.sourceEventId,220);
  check(source&&eventId&&clean(frame.eventType)&&clean(frame.action),'Evento de auditoria incompleto.',500,'AUDIT_FRAME_INVALID');
  const values=[source,eventId,clean(frame.operationId,80),frame.itemIndex ?? null,clean(frame.attemptId,100),clean(frame.parentAttemptId,100),
    frame.eventType,frame.outcome,context.actorId||null,clean(context.actorName),context.originalActorId||null,clean(context.originalActorName),
    ['user','worker','system'].includes(context.executorKind)?context.executorKind:'unknown',safeId(org.id),clean(org.name),clean(org.slug,200),
    safeId(context.contextOrganizationId),clean(frame.category||'organizations'),frame.action,clean(frame.resourceType||'organization'),
    clean(String(frame.resourceId ?? org.id ?? ''),100)||null,clean(frame.resourceLabel||org.name),clean(context.route,200),clean(context.origin,300),
    /^[A-Z][A-Z0-9_]{0,100}$/.test(frame.code||'')?frame.code:null,Number.isSafeInteger(frame.version)?frame.version:null,
    JSON.stringify(safeAuditChanges(frame.before)),JSON.stringify(safeAuditChanges(frame.after)),JSON.stringify(safeAuditDetails(frame.details)),
    frame.occurredAt || new Date().toISOString()];
  return env.DB.prepare(`INSERT INTO audit_operation_frames(source,source_event_id,operation_id,item_index,attempt_id,parent_attempt_id,event_type,outcome,
    actor_id,actor_name,original_actor_id,original_actor_name,executor_kind,organization_id,organization_name,organization_slug,context_organization_id,
    category,action,resource_type,resource_id,resource_label,ui_route,technical_origin,code,version,before_json,after_json,details_json,occurred_at)
    SELECT ${values.map(()=>'?').join(',')} WHERE ${condition.sql} ON CONFLICT(source,source_event_id) DO NOTHING`).bind(...values,...condition.args);
}

export async function operationAuditIdentity(env, actor, operationId, request, extra = {}) {
  // The historical snapshot and today's executor name belong to distinct fields.
  // Read both once within this invocation, including legacy operations with no frame.
  const first=await one(env,`SELECT f.original_actor_id,f.original_actor_name,f.ui_route,u.name AS current_actor_name
    FROM (SELECT ? AS id) requester LEFT JOIN users u ON u.id=requester.id
    LEFT JOIN audit_operation_frames f ON f.id=(SELECT id FROM audit_operation_frames WHERE operation_id=? ORDER BY id LIMIT 1)`,actor.id,operationId);
  const context=auditRequestContext(request,actor,extra);
  if(!context.actorName) context.actorName=first?.current_actor_name || null;
  // Missing original names in legacy operations remain missing; never reconstruct history.
  return {...context,originalActorId:first?.original_actor_id ?? safeId(extra.originalActorId ?? actor.id),
    originalActorName:first?.original_actor_name ?? null,route:context.route ?? first?.ui_route ?? null};
}
export const organizationAction = kind => ({create:'organization.create',change:'organization.update',pause:'organization.pause',resume:'organization.resume',review:'organization.review'}[kind] || 'organization.unknown');
export async function operationOrganization(env, kind, input, key) {
  if(kind==='create') return one(env,'SELECT id,name,slug,management_version FROM organizations WHERE management_create_key=?',key);
  if(kind==='review') return one(env,'SELECT o.id,o.name,o.slug,o.management_version FROM organizations o JOIN organization_limit_requests r ON r.organization_id=o.id WHERE r.id=?',input?.id ?? null);
  if(['change','pause','resume'].includes(kind)) return one(env,'SELECT id,name,slug,management_version FROM organizations WHERE id=?',input?.id ?? null);
  return null;
}
export function managementOutcome(outcome) {
  if(outcome.result?.changed===false) return 'no_change';
  if(outcome.state==='succeeded') return 'succeeded';
  if(outcome.state==='partial') return 'partial';
  if(outcome.code==='ORGANIZATION_OPERATION_FAILED') return 'unknown';
  if(['DENIED','FORBIDDEN','AUTH_PERMISSION_DENIED','MANAGEMENT_SUPER_ADMIN_REQUIRED'].includes(outcome.code)) return 'denied';
  if(['ORGANIZATION_VERSION_CONFLICT','REQUEST_VERSION_CONFLICT','ORGANIZATION_LIMIT_BELOW_USAGE','ORGANIZATION_OWNER_INELIGIBLE','PROJECT_QUOTA_REQUIRED','ORGANIZATION_PAUSED'].includes(outcome.code)) return 'blocked';
  // A handled, explicitly classified domain error is a failed attempt; generic errors are uncertain.
  return outcome.confirmedFailure === true ? 'failed' : 'unknown';
}
export function projectAuditFrame(row) {
  const result=row.outcome==='no_change'?'noop':row.outcome==='denied'?'blocked':row.outcome;
  return {id:`frame:${row.id}`,createdAt:row.occurred_at,actor:{id:row.actor_id??null,name:row.actor_name??null,kind:row.executor_kind||'unknown'},
    organization:{id:row.organization_id??null,name:row.organization_name??null,slug:row.organization_slug??null},route:row.ui_route??null,
    origin:row.technical_origin??null,category:row.category,action:row.action,resource:{type:row.resource_type,id:row.resource_id??null,label:row.resource_label??null},
    result,summary:null,legacy:false};
}

export { ManagementError };
