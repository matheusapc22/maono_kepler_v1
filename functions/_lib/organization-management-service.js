import { check, object, integer, text, createInput, changeInput, queryInput, requestHash, parseImportCsv, ManagementError } from './organization-management-contract.js';
import { resolveProjectQuotaPolicy } from './organization-limit-service.js';

const db = env => env.DB;
const one = (env, sql, ...args) => db(env).prepare(sql).bind(...args).first();
const all = async (env, sql, ...args) => (await db(env).prepare(sql).bind(...args).all()).results || [];
const now = () => new Date().toISOString();
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const publicRow = (row, env, deps) => ({
  id: row.id, name: row.name, slug: row.slug, description: row.description || '', active: Number(row.active) === 1,
  version: Number(row.management_version), plan: deps.resolvePolicy(row, env).plan,
  owner: row.owner_id ? { id: row.owner_id, name: row.owner_name || row.owner_email, email: row.owner_email } : null,
  projectCount: Number(row.project_count || 0), userCount: Number(row.user_count || 0), fileCount: Number(row.file_count || 0),
  storageStatus: row.storage_status || 'UNKNOWN', updatedAt: row.updated_at,
  lastActivityAt: row.last_activity || null,
});
const CTE = `WITH pc AS (SELECT organization_id,COUNT(*) total FROM projects WHERE active=1 GROUP BY organization_id),
 uc AS (SELECT m.organization_id,COUNT(DISTINCT m.user_id) total FROM organization_users m JOIN users u ON u.id=m.user_id AND u.active=1 GROUP BY m.organization_id),
 fc AS (SELECT organization_id,COUNT(*) total FROM organization_files WHERE active=1 AND deleted_at IS NULL AND purged_at IS NULL AND status='ACTIVE' GROUP BY organization_id),
 ev AS (SELECT organization_id,MAX(created_at) last_activity FROM organization_management_events GROUP BY organization_id)
 `;
const FROM = `FROM organizations o LEFT JOIN pc ON pc.organization_id=o.id LEFT JOIN uc ON uc.organization_id=o.id
 LEFT JOIN fc ON fc.organization_id=o.id LEFT JOIN ev ON ev.organization_id=o.id
 LEFT JOIN organization_users owner_link ON owner_link.organization_id=o.id AND owner_link.user_id=o.management_owner_id AND owner_link.access_level='owner'
 LEFT JOIN users owner ON owner.id=owner_link.user_id AND owner.active=1`;
const SELECT = `SELECT o.*,COALESCE(pc.total,0) project_count,COALESCE(uc.total,0) user_count,COALESCE(fc.total,0) file_count,
 owner.id owner_id,owner.name owner_name,owner.email owner_email,ev.last_activity ${FROM}`;

export async function requireManagementReady(env) {
  check(String(env.ORGANIZATION_MANAGEMENT_V1).toLowerCase() === 'true', 'A nova gestão aguarda ativação neste ambiente.', 503, 'ORGANIZATION_MANAGEMENT_DISABLED');
  const columns = await all(env, 'PRAGMA table_info(organizations)');
  check(['management_version','management_create_key','management_owner_id','management_actor_id','management_request_id','management_action','management_reason','project_limit','plan'].every(c => columns.some(r => r.name === c)), 'A gestão aguarda a migration 0042 validada.', 503, 'ORGANIZATION_MANAGEMENT_SCHEMA_REQUIRED');
  const tables = await all(env, `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization_management_events','organization_management_operations','organization_management_operation_items','organization_resource_reservations','organization_management_assertions')`);
  check(tables.length === 5, 'Schema de gestão incompleto.', 503, 'ORGANIZATION_MANAGEMENT_SCHEMA_REQUIRED');
  const requests = await all(env, 'PRAGMA table_info(organization_limit_requests)');
  check(['created_by','reviewed_by','reviewed_at','review_notes','requested_limits_json','review_operation_key','management_version'].every(c=>requests.some(r=>r.name===c)), 'Schema de solicitações incompleto.', 503, 'ORGANIZATION_MANAGEMENT_SCHEMA_REQUIRED');
  const requiredTriggers=['org_management_created','org_management_updated','org_management_legacy_version','org_management_owner_insert','org_management_owner_valid','org_management_owner_delete','org_management_owner_change','org_management_owner_deactivate','org_management_assertion_cleanup','org_management_quota_reserve_insert','org_management_quota_reserve_update'];
  const triggers=await all(env, `SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (${requiredTriggers.map(()=>'?').join(',')})`,...requiredTriggers);
  check(triggers.length===requiredTriggers.length, 'Proteções de integridade da gestão incompletas.', 503, 'ORGANIZATION_MANAGEMENT_SCHEMA_REQUIRED');

}
export async function workspace(env, url, deps) {
  const q = queryInput(url), clauses = ['1=1'], values = [];
  if (q.q) { clauses.push(`(o.name LIKE ? ESCAPE '\\' OR o.slug LIKE ? ESCAPE '\\')`); const term = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`; values.push(term, term); }
  if (q.status !== 'all') { clauses.push('o.active=?'); values.push(q.status === 'active' ? 1 : 0); }
  if (q.plan !== 'all') { clauses.push("COALESCE(o.plan,'free')=?"); values.push(q.plan); }
  const where = clauses.join(' AND '), order = { newest: 'o.created_at DESC,o.id DESC', name: 'o.name COLLATE NOCASE ASC,o.id ASC', updated: 'o.updated_at DESC,o.id DESC' }[q.sort];
  const [count, summary] = await db(env).batch([
    db(env).prepare(`SELECT COUNT(*) total FROM organizations o WHERE ${where}`).bind(...values),
    db(env).prepare(`SELECT (SELECT COUNT(*) FROM organizations) organizations,
      (SELECT COUNT(*) FROM organizations WHERE active=1) active,
      (SELECT COUNT(DISTINCT m.user_id) FROM organization_users m JOIN users u ON u.id=m.user_id AND u.active=1 JOIN organizations o ON o.id=m.organization_id AND o.active=1) users,
      (SELECT COUNT(*) FROM organization_files f JOIN organizations org ON org.id=f.organization_id WHERE f.active=1 AND f.status='ACTIVE' AND f.deleted_at IS NULL AND f.purged_at IS NULL) files,
      (SELECT COUNT(*) FROM organization_limit_requests WHERE status='pending') requests`),
  ]);
  const total = Number(count.results[0].total), pages = Math.max(1, Math.ceil(total / q.size)); q.page = Math.min(q.page, pages);
  const rows = await all(env, `${CTE}${SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...values, q.size, (q.page - 1) * q.size);
  return { organizations: rows.map(r => publicRow(r, env, deps)), pagination: { total, page: q.page, size: q.size, pages }, summary: summary.results[0],
    capabilities: { projectQuotaEnforced: deps.quotaEnabled(env), edits: true, imports: true, permanentDelete: false,
      usersLimitEditable: false, storageLimitEditable: false, exportsLimitEditable: false } };
}
export async function organizationRow(env, id) {
  const row = await one(env, 'SELECT * FROM organizations WHERE id=?', integer(id));
  check(row, 'Organização não encontrada.', 404, 'ORGANIZATION_NOT_FOUND'); return row;
}
async function usage(env, id) {
  return one(env, `SELECT
    (SELECT COUNT(*) FROM projects WHERE organization_id=? AND active=1) used,
    (SELECT COUNT(*) FROM organization_resource_reservations WHERE organization_id=? AND resource_type='project' AND status IN ('RESERVED','PROCESSING') AND expires_at>?) reserved,
    (SELECT COALESCE(SUM(size_bytes),0) FROM organization_files WHERE organization_id=? AND active=1 AND status='ACTIVE' AND deleted_at IS NULL AND purged_at IS NULL) bytes`, id, id, now(), id);
}
export async function detail(env, id, deps) {
  const rows = await all(env, `${CTE}${SELECT} WHERE o.id=?`, integer(id)); check(rows[0], 'Organização não encontrada.', 404, 'ORGANIZATION_NOT_FOUND');
  const row = rows[0], used = await usage(env, row.id), policy = deps.resolvePolicy(row, env);
  return { organization: publicRow(row, env, deps), policy: { ...policy, projectSource: resolveProjectQuotaPolicy(row, env).source, projectOverride: row.project_limit ?? null, used: Number(used.used), reserved: Number(used.reserved), remaining: Math.max(0, policy.projects - used.used - used.reserved), storageUsedMb: Number(used.bytes) / 1048576, projectQuotaEnforced: deps.quotaEnabled(env), informational: ['storageMb', 'users', 'exports'] } };
}
export async function people(env, id) {
  await organizationRow(env, id);
  return all(env, `SELECT u.id,u.name,u.email,u.active,m.access_level accessLevel FROM organization_users m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.name COLLATE NOCASE,u.id`, integer(id));
}
export async function documents(env, id, url) {
  await organizationRow(env, id); const p = new URL(url).searchParams, page = integer(p.get('page') || 1, 'Página');
  const rows = await all(env, `SELECT id,name,file_type fileType,size_bytes sizeBytes,folder_id folderId,is_project isProject,created_at createdAt FROM organization_files WHERE organization_id=? AND active=1 AND status='ACTIVE' AND deleted_at IS NULL AND purged_at IS NULL ORDER BY name COLLATE NOCASE,id LIMIT 21 OFFSET ?`, integer(id), (page - 1) * 20);
  return { files: rows.slice(0,20), page, hasMore: rows.length > 20, readOnly: true };
}
export async function activity(env, id, url) {
  await organizationRow(env, id); const p = new URL(url).searchParams;
  const before = p.has('before') ? integer(p.get('before'), 'Cursor') : Number.MAX_SAFE_INTEGER;
  const rows = await all(env, `SELECT e.id,e.action,e.reason,e.created_at createdAt,e.version,u.name actorName FROM organization_management_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.organization_id=? AND e.id<? ORDER BY e.id DESC LIMIT 21`, integer(id), before);
  return { events: rows.slice(0,20), next: rows.length > 20 ? rows[19].id : null, source: 'management-v1' };
}
export async function candidates(env, url) {
  const term = text(new URL(url).searchParams.get('q') || '', 'Busca', 2, 160);
  return all(env, `SELECT id,name,email FROM users WHERE active=1 AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY email,id LIMIT 20`, `%${term.replace(/[\\%_]/g,'\\$&')}%`, `%${term.replace(/[\\%_]/g,'\\$&')}%`);
}
async function ownerByEmail(env, email) {
  const user = await one(env, 'SELECT id,name,email FROM users WHERE lower(email)=? AND active=1', email);
  check(user, 'Responsável não encontrado ou inativo.', 422, 'ORGANIZATION_OWNER_INELIGIBLE'); return user;
}
export async function validateImport(env, csv) {
  const rows = parseImportCsv(csv), seen = new Set();
  for (const row of rows) {
    if (row.error) continue;
    try {
      check(!seen.has(row.input.slug), 'Identificador repetido no arquivo.'); seen.add(row.input.slug);
      const duplicate = await one(env, 'SELECT id FROM organizations WHERE slug=? OR lower(dropbox_root_path)=lower(?)', row.input.slug, `/projects/${row.input.slug}`);
      check(!duplicate, 'Já existe organização com este identificador ou pasta.', 409, 'ORGANIZATION_EXISTS');
      const owner = await ownerByEmail(env, row.input.ownerEmail); row.ownerId = owner.id;
    } catch (e) { row.error = e.message; }
  }
  return { rows, valid: rows.every(r => !r.error), hash: await requestHash(rows.filter(r => r.input).map(r => r.input)) };
}
function operationInput(input) {
  object(input, ['kind', 'items']); check(['create','import','change','pause','resume','review'].includes(input.kind), 'Operação inválida.');
  check(Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 100, 'Selecione de 1 a 100 itens.');
  check(['import','pause','resume'].includes(input.kind) || input.items.length === 1, 'A operação exige um item.');
  let items;
  if (['create','import'].includes(input.kind)) items = input.items.map(createInput);
  else if (input.kind === 'review') items = input.items.map(value => {
    object(value, ['id','version','decision','reason','organizationVersion','projectLimit']);
    check(['approved','rejected'].includes(value.decision), 'Decisão inválida.');
    return { id: integer(value.id), version: integer(value.version, 'Versão', 0), decision: value.decision, reason: text(value.reason, 'Justificativa', 5, 500), organizationVersion: integer(value.organizationVersion, 'Versão da organização',0), projectLimit: value.projectLimit == null ? null : integer(value.projectLimit,'Limite',1,1000000) };
  });
  else items = input.items.map(item => changeInput(['pause','resume'].includes(input.kind) ? { ...object(item, ['id','version','reason']), active: input.kind === 'resume' } : item));
  check(new Set(items.map(i => i.id ?? i.slug)).size === items.length, 'Itens repetidos na operação.');
  return { kind: input.kind, items };
}
export async function startOperation(env, actor, key, input) {
  key = text(key || '', 'Chave de idempotência', 16, 160); const payload = operationInput(input), hash = await requestHash(payload);
  const current = await one(env, 'SELECT * FROM organization_management_operations WHERE actor_id=? AND idempotency_key=?', actor.id, key);
  if (current) { check(current.payload_hash === hash, 'Chave já usada para outra solicitação.', 409, 'ORGANIZATION_IDEMPOTENCY_CONFLICT'); return operation(env, actor, current.id); }
  const recent = await one(env, `SELECT COUNT(*) total FROM organization_management_operations WHERE actor_id=? AND created_at>datetime('now','-1 hour')`, actor.id);
  check(recent.total < 100, 'Limite temporário de operações atingido.', 429, 'ORGANIZATION_OPERATION_RATE_LIMIT', true);
  const id = crypto.randomUUID();
  await db(env).batch([
    db(env).prepare(`INSERT INTO organization_management_operations(id,actor_id,idempotency_key,payload_hash,kind,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(actor_id,idempotency_key) DO NOTHING`).bind(id,actor.id,key,hash,payload.kind,JSON.stringify(payload.items)),
    ...payload.items.map((_,i) => db(env).prepare(`INSERT INTO organization_management_operation_items(operation_id,item_index) SELECT ?,? WHERE EXISTS(SELECT 1 FROM organization_management_operations WHERE id=?)`).bind(id,i,id)),
  ]);
  const saved = await one(env, 'SELECT id,payload_hash FROM organization_management_operations WHERE actor_id=? AND idempotency_key=?', actor.id,key);
  check(saved.payload_hash === hash, 'Chave já usada para outra solicitação.', 409, 'ORGANIZATION_IDEMPOTENCY_CONFLICT');
  return operation(env, actor, saved.id);
}
export async function operation(env, actor, id) {
  const op = await one(env, 'SELECT * FROM organization_management_operations WHERE id=? AND actor_id=?', text(id,'Operação',1,80),actor.id);
  check(op, 'Operação não encontrada.',404,'ORGANIZATION_OPERATION_NOT_FOUND');
  const payload = parse(op.payload_json,[]), rows = await all(env, 'SELECT * FROM organization_management_operation_items WHERE operation_id=? ORDER BY item_index',id);
  return { id: op.id, kind: op.kind, createdAt: op.created_at, items: rows.map(r => ({ index:r.item_index, label:payload[r.item_index]?.name || `#${payload[r.item_index]?.id}`, state:r.state, attempts:r.attempts, result:parse(r.result_json), error:r.error_message, code:r.error_code, retryable:Boolean(r.retryable) })), done:rows.every(r => ['succeeded','failed','partial'].includes(r.state)) };
}
export async function operations(env, actor) {
  return all(env, 'SELECT id,kind,created_at createdAt FROM organization_management_operations WHERE actor_id=? ORDER BY created_at DESC,id DESC LIMIT 20',actor.id);
}
async function applyPolicy(env, actor, row, payload, requestId, deps, creation = false) {
  check(row.management_version === payload.version, 'A organização mudou. Consulte a versão atual e revise seu rascunho.',412,'ORGANIZATION_VERSION_CONFLICT');
  if ('plan' in payload || 'projectLimit' in payload) check(deps.quotaEnabled(env), 'A política de quota de projetos precisa estar habilitada para editar o plano.',409,'PROJECT_QUOTA_REQUIRED');
  const plans = 'plan' in payload || 'projectLimit' in payload;
  const candidate = { ...row, ...('plan' in payload ? {plan:payload.plan}:{}), ...('projectLimit' in payload ? {project_limit:payload.projectLimit}:{}) };
  const resolved = deps.resolvePolicy(candidate, env), ownerId = payload.ownerId ?? row.management_owner_id;
  if (ownerId != null) {
    const eligible = await one(env, `SELECT u.id FROM users u ${creation ? '' : "JOIN organization_users m ON m.user_id=u.id AND m.organization_id=? AND m.access_level='owner'"} WHERE u.id=? AND u.active=1`, ...(creation ? [] : [row.id]),ownerId);
    check(eligible, 'Selecione um usuário ativo com vínculo de proprietário.',422,'ORGANIZATION_OWNER_INELIGIBLE');
  }
  const u = await usage(env,row.id);
  check(!plans || u.used+u.reserved <= resolved.projects, 'O limite é menor que o uso e as reservas de projetos.',409,'ORGANIZATION_LIMIT_BELOW_USAGE');
  const statements = [];
  // The preceding conditional upsert cannot leave a membership if the later CAS
  // fails: both are in one D1 batch and the assertion row aborts the transaction.
  if (creation && ownerId != null) statements.push(db(env).prepare(`INSERT INTO organization_users(organization_id,user_id,access_level)
    SELECT ?,?,'owner' WHERE EXISTS(SELECT 1 FROM organizations WHERE id=? AND management_version=?)
    ON CONFLICT(organization_id,user_id) DO UPDATE SET access_level='owner'`).bind(row.id,ownerId,row.id,payload.version));
  statements.push(db(env).prepare(`UPDATE organizations SET plan=?,project_limit=?,management_owner_id=?,management_version=management_version+1,
    management_actor_id=?,management_request_id=?,management_action=?,management_reason=?,updated_at=?
    WHERE id=? AND management_version=? AND (?=0 OR
      (SELECT COUNT(*) FROM projects WHERE organization_id=? AND active=1)+
      (SELECT COUNT(*) FROM organization_resource_reservations WHERE organization_id=? AND resource_type='project' AND status IN ('RESERVED','PROCESSING') AND expires_at>?)<=?)`).bind(
    'plan' in payload ? payload.plan : row.plan, candidate.project_limit ?? null, ownerId,actor.id,requestId,creation?'organization.configured':'organization.policy_updated',payload.reason||'Configuração inicial confirmada',now(),row.id,payload.version,plans?1:0,row.id,row.id,now(),resolved.projects));
  statements.push(assertion(env,requestId,row.id));
  try { await db(env).batch(statements); }
  catch (e) { if (/MANAGEMENT_OWNER/.test(String(e))) throw new ManagementError('Responsável perdeu elegibilidade.',422,'ORGANIZATION_OWNER_INELIGIBLE'); if (/CHECK constraint/.test(String(e))) throw new ManagementError('A versão ou a capacidade mudou. Revise os dados.',412,'ORGANIZATION_VERSION_CONFLICT'); throw e; }
}
function assertion(env, requestId, orgId) {
  return db(env).prepare(`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organizations WHERE id=? AND management_request_id=?) THEN 1 ELSE 0 END`).bind(orgId,requestId);
}
async function createItem(env,actor,payload,key,deps) {
  check(deps.quotaEnabled(env), 'A quota de projetos precisa estar habilitada antes da criação gerencial.', 409, 'PROJECT_QUOTA_REQUIRED');
  const owner = await ownerByEmail(env,payload.ownerEmail); let row, storageError;
  try {
    const result = await deps.createLifecycle(env,{name:payload.name,slug:payload.slug,description:payload.description,active:true},
      {correlationId:key,management:{actorId:actor.id,requestId:`${key}:lifecycle`,action:'organization.created',creationKey:key,reason:'Criação de organização confirmada'}});
    row=result.organization;
  } catch(e) {
    row=await one(env,'SELECT * FROM organizations WHERE management_create_key=?',key);
    if(!row) throw e; storageError=e;
  }
  const configured = await one(env,'SELECT 1 FROM organization_management_events WHERE organization_id=? AND request_id=?',row.id,`${key}:configured`);
  if(!configured) {
    try { await applyPolicy(env,actor,row,{version:row.management_version,plan:payload.plan,projectLimit:null,ownerId:owner.id},`${key}:configured`,deps,true); }
    catch(e) { return {state:'partial',result:{id:row.id,name:row.name,storageStatus:row.storage_status},code:e.code||'ORGANIZATION_CONFIGURATION_UNCONFIRMED',
      error:'Cadastro criado, mas a configuração inicial não foi confirmada. Consulte a organização antes de retomar.',retryable:e.retryable===true}; }
  }
  row=await organizationRow(env,row.id);
  const result={id:row.id,name:row.name,storageStatus:row.storage_status,active:Boolean(row.active)};
  if(!row.active) return {state:'partial',result,error:'Cadastro existente foi pausado. Consulte a organização antes de continuar.',code:'ORGANIZATION_PAUSED',retryable:false};
  if(storageError) return {state:'partial',result,error:'Cadastro salvo; armazenamento ainda não confirmado. Retome a operação.',code:storageError.code||'ORGANIZATION_STORAGE_PENDING',retryable:storageError.retryable!==false};
  if(!['READY','ACTIVE','CONFIGURED'].includes(row.storage_status)) return {state:'partial',result,error:'Cadastro salvo; preparação do armazenamento em andamento. Retome a operação.',code:'ORGANIZATION_STORAGE_PENDING',retryable:true};
  return {state:'succeeded',result};
}
async function changeItem(env,actor,payload,key,deps) {
  const done=await one(env,'SELECT 1 FROM organization_management_events WHERE organization_id=? AND request_id=?',payload.id,key);
  if(done) {
    const row=await organizationRow(env,payload.id);
    if(payload.active===true && row.active===1 && !['READY','ACTIVE','CONFIGURED'].includes(row.storage_status)) {
      return {state:'partial',result:{id:row.id,confirmed:true,storageStatus:row.storage_status},
        error:'Reativação cadastral confirmada; armazenamento pendente. Consulte a versão atual e execute Verificar armazenamento.',code:'STORAGE_UNCONFIRMED',retryable:false};
    }
    return {state:'succeeded',result:{id:row.id,confirmed:true,storageStatus:row.storage_status}};
  }
  const row=await organizationRow(env,payload.id);
  check(row.management_version===payload.version,'A organização foi alterada. Consulte e revise antes de repetir.',412,'ORGANIZATION_VERSION_CONFLICT');
  if('name' in payload || 'description' in payload || 'active' in payload) {
    const patch=Object.fromEntries(['name','description','active'].filter(k=>k in payload).map(k=>[k,payload[k]]));
    try {
      const out=await deps.updateLifecycle(env,row.id,patch,{correlationId:key,management:{actorId:actor.id,requestId:key,expectedVersion:payload.version,reason:payload.reason,action:payload.active===false?'organization.paused':payload.active===true?'organization.resumed':'organization.updated'}});
      if(payload.active===true && !['READY','ACTIVE','CONFIGURED'].includes(out.organization.storage_status)) {
        return {state:'partial',result:{id:row.id,storageStatus:out.organization.storage_status},code:'STORAGE_UNCONFIRMED',
          error:'Estado cadastral salvo; armazenamento pendente. Consulte a versão atual e use Verificar armazenamento.',retryable:false};
      }
      return {state:'succeeded',result:{id:row.id,storageStatus:out.organization.storage_status}};
    } catch(e) {
      const changed=await one(env,'SELECT 1 FROM organization_management_events WHERE organization_id=? AND request_id=?',row.id,key);
      if(changed) return {state:'partial',result:{id:row.id},code:e.code||'STORAGE_UNCONFIRMED',error:'Estado cadastral salvo; armazenamento não confirmado. Consulte a organização.',retryable:false};
      throw e;
    }
  }
  await applyPolicy(env,actor,row,payload,key,deps); return {state:'succeeded',result:{id:row.id}};
}
export async function requests(env,url) {
  const p=new URL(url).searchParams,status=p.get('status')||'pending'; check(['pending','approved','rejected'].includes(status),'Status inválido.');
  const page=integer(p.get('page')||1,'Página');
  const rows=await all(env,`SELECT r.id,r.organization_id organizationId,o.name organizationName,r.request_type requestType,r.requested_plan requestedPlan,r.requested_limits_json requestedLimitsJson,r.reason,r.status,r.management_version version,o.management_version organizationVersion,u.name requestedBy,r.created_at createdAt,r.review_notes reviewNotes FROM organization_limit_requests r JOIN organizations o ON o.id=r.organization_id LEFT JOIN users u ON u.id=r.created_by WHERE r.status=? ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET ?`,status,(page-1)*20);
  return {requests:rows.slice(0,20).map(r=>({...r,requestedLimits:parse(r.requestedLimitsJson),approvalSupported:['plan_upgrade','projects_increase'].includes(r.requestType)})),page,hasMore:rows.length>20};
}
async function reviewItem(env,actor,payload,key,deps) {
  const req=await one(env,'SELECT * FROM organization_limit_requests WHERE id=?',payload.id); check(req,'Pedido não encontrado.',404,'REQUEST_NOT_FOUND');
  const row=await organizationRow(env,req.organization_id);
  const done=await one(env,'SELECT 1 FROM organization_management_events WHERE organization_id=? AND request_id=?',row.id,key);
  if(done) return {state:'succeeded',result:{id:req.id,decision:req.status}};
  check(req.status==='pending' && req.management_version===payload.version && row.management_version===payload.organizationVersion,'O pedido ou a organização mudou. Revise a decisão.',412,'REQUEST_VERSION_CONFLICT');
  let candidate={...row};
  if(payload.decision==='approved') {
    check(deps.quotaEnabled(env),'Ative a quota operacional antes de aprovar alterações.',409,'PROJECT_QUOTA_REQUIRED');
    check(['plan_upgrade','projects_increase'].includes(req.request_type),'Este recurso ainda não possui aprovação operacional neste módulo.',422,'REQUEST_TYPE_NOT_SUPPORTED');
    if(req.request_type==='plan_upgrade') { check(['free','pro','enterprise'].includes(req.requested_plan),'Plano solicitado inválido.',422); candidate.plan=req.requested_plan; }
    check(req.request_type!=='projects_increase' || payload.projectLimit!==null,'Revise e informe o limite de projetos aprovado.',422);
    if(payload.projectLimit!==null) candidate.project_limit=payload.projectLimit;
  }
  const policy=deps.resolvePolicy(candidate,env), u=await usage(env,row.id);
  check(payload.decision!=='approved' || u.used+u.reserved<=policy.projects,'O limite aprovado não comporta o uso atual.',409,'ORGANIZATION_LIMIT_BELOW_USAGE');
  const reviewToken=`${key}:request`;
  // Conditional writes share one transaction; an assertion turns zero-row CAS
  // into rollback. Refusal increments metadata version for a genuine audit event.
  try { await db(env).batch([
    db(env).prepare(`UPDATE organization_limit_requests SET status=?,reviewed_by=?,reviewed_at=?,review_notes=?,review_operation_key=?,management_version=management_version+1,updated_at=?
      WHERE id=? AND status='pending' AND management_version=?`).bind(payload.decision,actor.id,now(),payload.reason,reviewToken,now(),req.id,payload.version),
    db(env).prepare(`UPDATE organizations SET plan=?,project_limit=?,management_version=management_version+1,management_actor_id=?,management_request_id=?,management_action=?,management_reason=?,updated_at=?
      WHERE id=? AND management_version=? AND EXISTS(SELECT 1 FROM organization_limit_requests WHERE id=? AND review_operation_key=? AND status=?) AND (?='rejected' OR
      (SELECT COUNT(*) FROM projects WHERE organization_id=? AND active=1)+(SELECT COUNT(*) FROM organization_resource_reservations WHERE organization_id=? AND resource_type='project' AND status IN ('RESERVED','PROCESSING') AND expires_at>?)<=?)`).bind(
      candidate.plan,candidate.project_limit ?? null,actor.id,key,`organization.request_${payload.decision}`,payload.reason,now(),row.id,payload.organizationVersion,req.id,reviewToken,payload.decision,payload.decision,row.id,row.id,now(),policy.projects),
    assertion(env,key,row.id),
  ]); } catch(e) { if(/CHECK constraint/.test(String(e))) throw new ManagementError('Decisão concorrente. Consulte o pedido.',412,'REQUEST_VERSION_CONFLICT'); throw e; }
  return {state:'succeeded',result:{id:req.id,decision:payload.decision}};
}
export async function stepOperation(env,actor,id,retry,deps) {
  const op=await one(env,'SELECT * FROM organization_management_operations WHERE id=? AND actor_id=?',id,actor.id); check(op,'Operação não encontrada.',404,'ORGANIZATION_OPERATION_NOT_FOUND');
  const payload=parse(op.payload_json,[]), timestamp=now();
  const item=await one(env,`SELECT * FROM organization_management_operation_items WHERE operation_id=? AND (state='pending' OR (state='running' AND lease_until<?) OR (?=1 AND state IN ('partial','failed') AND retryable=1)) ORDER BY item_index LIMIT 1`,id,timestamp,retry?1:0);
  if(!item) return operation(env,actor,id);
  const token=crypto.randomUUID(), lease=new Date(Date.now()+5*60*1000).toISOString();
  const claim=await db(env).prepare(`UPDATE organization_management_operation_items SET state='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE operation_id=? AND item_index=? AND (state='pending' OR (state='running' AND lease_until<?) OR (?=1 AND state IN ('partial','failed') AND retryable=1)) RETURNING item_index`).bind(token,lease,timestamp,id,item.item_index,timestamp,retry?1:0).first();
  if(!claim) return operation(env,actor,id);
  const input=payload[item.item_index], key=`${id}:${item.item_index}`; let outcome, deniedError;
  try {
    if(op.kind==='review') {
      const req=await one(env,'SELECT organization_id FROM organization_limit_requests WHERE id=?',input.id); check(req,'Pedido não encontrado.',404);
      await deps.authorizeOrganization(req.organization_id);
      outcome=await reviewItem(env,actor,input,key,deps);
    } else if(['create','import'].includes(op.kind)) {
      await deps.authorizeGlobal(); outcome=await createItem(env,actor,input,key,deps);
    } else { await deps.authorizeOrganization(input.id); outcome=await changeItem(env,actor,input,key,deps); }
  } catch(e) {
    if([401,403,404].includes(Number(e.status||e.statusCode))) deniedError=e;
    const expected=e instanceof ManagementError || (e.status>=400 && e.status<600);
    outcome={state:'failed',error:e instanceof ManagementError?e.message:e.publicMessage||(e.status===401?'Sessão expirada.':e.status===403?'Operação não autorizada para este contexto.':'A operação não foi confirmada. Consulte seu estado antes de repetir.'),code:e.code||'ORGANIZATION_OPERATION_FAILED',retryable:expected?e.retryable===true:false};
  }
  await db(env).prepare(`UPDATE organization_management_operation_items SET state=?,result_json=?,error_code=?,error_message=?,retryable=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE operation_id=? AND item_index=? AND lease_token=?`).bind(outcome.state,JSON.stringify(outcome.result??parse(item.result_json)),outcome.code||null,outcome.error||null,outcome.retryable?1:0,now(),id,item.item_index,token).run();
  if(deniedError) throw deniedError;
  return operation(env,actor,id);
}
