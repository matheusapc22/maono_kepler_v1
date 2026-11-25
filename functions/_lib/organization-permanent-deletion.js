import {classifyProtectedMetadata, protectedMetadataName} from './d1-protected-metadata.js';
import {check, integer, object, text, ManagementError} from './organization-management-contract.js';
import {getDropboxMetadata, listDropboxFolderAll} from './dropbox.js';
import {getDropboxClient} from './dropbox-client.js';
import {operationAuditEnabled,requireOperationAuditReady,auditRequestContext,auditFrameStatement,operationAuditIdentity} from './operation-audit.js';

export const DELETION_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE';
const one = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const statement = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const quote = name => { check(/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name), 'Schema desconhecido.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED'); return `"${name}"`; };
const removable = new Set(['organization_access_delegations','organization_users','user_permission_denials','user_permissions']);
const retained = new Set(['organization_management_events','organization_deletions','organization_deleted_management_events','audit_operation_frames','organization_operation_reconciliations']);
export const automaticDeletionEnabled = env => String(env.ORGANIZATION_DELETE_AUTOMATIC_ENABLED)==='true';
export const automaticDeletionBlocked = row => row.state!=='completed' && (
  (Number(row.attempts)>=3 && !(row.lease_token && Date.parse(row.lease_until)>Date.now())) ||
  Boolean(row.error_code && row.error_code!=='ORGANIZATION_DELETE_PROVIDER_FAILED'));
const deletionSelect = `SELECT d.*, EXISTS(SELECT 1 FROM organization_deletion_audit a WHERE a.deletion_id=d.id AND a.event_type='automatic_requested') AS automatic FROM organization_deletions d`;
const publicDeletion = (row,env) => ({id:row.id,organizationId:row.organization_id,state:row.state,retryable:row.state!=='completed',errorCode:row.error_code || null,notBefore:row.not_before,
  automatic:Boolean(row.automatic),automaticPaused:Boolean(row.automatic)&&!automaticDeletionEnabled(env),automaticBlocked:Boolean(row.automatic)&&automaticDeletionBlocked(row)});
const fail = (message,code,status=409) => new ManagementError(message,status,code);
export async function deletionEnabled(env) {
  if (String(env.ORGANIZATION_PERMANENT_DELETE_V1)!=='true') return false;
  const tables=await all(env,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization_deletions','organization_deletion_audit','organization_deleted_management_events')");
  const guards=await all(env,"SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('org_delete_no_recreate','org_delete_no_update','org_delete_finalize_only')");
  return tables.length===3&&guards.length===3;
}
async function ready(env) {
  if(operationAuditEnabled(env))await requireOperationAuditReady(env);
  // deletionEnabled already reads all three required tables and all three root
  // guards. Repeating subsets here adds D1 calls without another safety property.
  // Each invocation still reads schema afresh, and inventory validates every
  // dependency guard again before deletion effects.
  check(await deletionEnabled(env),'A exclusão permanente não está disponível neste ambiente.',503,'ORGANIZATION_DELETE_DISABLED');
}
// D1 counts each batch as one invocation query. Bound metadata/count reads to
// small read-only groups without joining parameters into a large SQL statement.
// No cross-request schema cache: newly added/changed dependencies remain visible.
const INVENTORY_READ_BATCH_SIZE = 64;
async function readStatementBatch(env, statements) {
  const rows=[];
  for(let offset=0;offset<statements.length;offset+=INVENTORY_READ_BATCH_SIZE) {
    const group=statements.slice(offset,offset+INVENTORY_READ_BATCH_SIZE);
    const results=await env.DB.batch(group);
    check(Array.isArray(results)&&results.length===group.length&&results.every(result=>result?.success!==false&&Array.isArray(result?.results)),
      'Inventário de dependências incompleto.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
    rows.push(...results.map(result=>result.results));
  }
  return rows;
}
async function inventory(env,id) {
  const objects=await all(env,"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'");
  const classification=classifyProtectedMetadata(objects);
  check(classification.issues.length===0,'Schema interno desconhecido.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
  const tables=objects.filter(row=>row.type==='table'&&!classification.recognized.includes(row.name));
  const guards=new Set((await all(env,"SELECT name FROM sqlite_master WHERE type='trigger'")).map(r=>r.name));
  const metadata=await readStatementBatch(env,tables.flatMap(({name})=>[
    statement(env,`PRAGMA table_info(${quote(name)})`),
    statement(env,`PRAGMA foreign_key_list(${quote(name)})`),
  ]));
  const blockers=[],business=[];
  for(let index=0;index<tables.length;index++) {
    const {name}=tables[index],columns=metadata[index*2],foreignKeys=metadata[index*2+1];
    check(!foreignKeys.some(fk=>protectedMetadataName(fk.table)),'Dependência interna desconhecida.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
    check(columns.length>0,'Schema de dependências mudou durante a consulta.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
    if(foreignKeys.some(fk=>fk.table==='organizations' && fk.from!=='organization_id' && !(name==='sessions'&&fk.from==='active_organization_id')))blockers.push({code:'UNGUARDED_DEPENDENCY',count:1});
    if(!columns.some(c=>c.name==='organization_id') || retained.has(name))continue;
    // Unknown extensions are never assumed safe, including empty new tables.
    if(!guards.has(`org_delete_guard_${name}_insert`) || !guards.has(`org_delete_guard_${name}_update`)) {
      blockers.push({code:'UNGUARDED_DEPENDENCY',count:1});continue;
    }
    if(removable.has(name))continue;
    business.push(name);
  }
  const counts=await readStatementBatch(env,business.map(name=>statement(env,`SELECT COUNT(*) n FROM ${quote(name)} WHERE organization_id=?`,id)));
  for(const [index,rows] of counts.entries()) {
    check(rows.length===1&&Number.isSafeInteger(Number(rows[0].n))&&Number(rows[0].n)>=0,'Contagem de dependências não confirmada.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
    if(Number(rows[0].n)>0)blockers.push({code:'LINKED_DATA',count:Number(rows[0].n),...(operationAuditEnabled(env)?{resourceType:business[index]}:{})});
  }
  // A grant may also authorize a project outside this organization. Never remove it implicitly.
  const mixed=await one(env,'SELECT COUNT(*) n FROM user_permissions WHERE organization_id=? AND project_id IS NOT NULL',id);
  check(mixed&&Number.isSafeInteger(Number(mixed.n))&&Number(mixed.n)>=0,'Contagem de permissões não confirmada.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
  if(Number(mixed.n)>0)blockers.push({code:'MIXED_SCOPE_PERMISSION',count:Number(mixed.n)});
  const org=await one(env,'SELECT management_create_key FROM organizations WHERE id=?',id);
  const ops=await all(env,`SELECT o.id,o.actor_id,o.kind,o.payload_json,i.item_index,i.state,i.attempts FROM organization_management_operations o JOIN organization_management_operation_items i ON i.operation_id=o.id WHERE i.state<>'succeeded'`);
  const reconciled=operationAuditEnabled(env)?await all(env,'SELECT operation_id,item_index,observed_attempts FROM organization_operation_reconciliations WHERE organization_id=?',id):[];
  const requests=new Map((await all(env,'SELECT id,organization_id FROM organization_limit_requests')).map(row=>[row.id,row.organization_id]));
  for(const op of ops){let input;try{input=JSON.parse(op.payload_json)[op.item_index];}catch{
      // Corrupt payloads have no proven target. Keep them visible as an integrity
      // condition, never pretend a request ID is an organization ID.
      blockers.push({code:'UNRESOLVED_OPERATION',count:1,...(operationAuditEnabled(env)?{operationId:op.id,itemIndex:op.item_index,originalActorId:op.actor_id,integrityUnknown:true}:{})});continue;}
    const target=op.kind==='review'?requests.get(Number(input?.id)):['change','pause','resume'].includes(op.kind)?Number(input?.id):null;
    const associated=target===id || org?.management_create_key===`${op.id}:${op.item_index}`;
    if(associated && !reconciled.some(row=>row.operation_id===op.id&&row.item_index===op.item_index&&row.observed_attempts===op.attempts))
      blockers.push({code:'UNRESOLVED_OPERATION',count:1,...(operationAuditEnabled(env)?{operationId:op.id,itemIndex:op.item_index,originalActorId:op.actor_id}:{})});
  }
  return {blockers,business};
}
function safePath(org) {
  const path=org.dropbox_root_path;
  check(typeof org.slug==='string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(org.slug) && typeof path==='string' && path===`/projects/${org.slug}`,
    'A pasta desta organização precisa de revisão manual.',409,'ORGANIZATION_DELETE_UNSAFE_PATH');
  return path;
}
async function exclusivePath(env,org) {
  const path=safePath(org), others=await all(env,'SELECT id,dropbox_root_path FROM organizations WHERE id<>?',org.id);
  const lower=path.toLowerCase();
  check(!others.some(row=>{const p=String(row.dropbox_root_path||'').replace(/\/+$/,'').toLowerCase();return p&&(p===lower||p.startsWith(lower+'/')||lower.startsWith(p+'/'));}),
    'A pasta é compartilhada ou sobreposta a outra organização.',409,'ORGANIZATION_DELETE_SHARED_PATH');
  return path;
}
async function inspectDeletionPreview(env,id,actor) {
  await ready(env);id=integer(id);
  const org=await one(env,'SELECT * FROM organizations WHERE id=?',id);check(org,'Organização não encontrada.',404,'ORGANIZATION_NOT_FOUND');
  const existing=await one(env,'SELECT * FROM organization_deletions WHERE organization_id=?',id);
  const {blockers,business}=await inventory(env,id);
  if(existing)blockers.push({code:'DELETION_IN_PROGRESS',count:1,...(operationAuditEnabled(env)?{deletionId:existing.id,originalActorId:existing.actor_id}:{})});
  if(org.active!==0)blockers.push({code:'PAUSE_REQUIRED',count:1});
  const pausedAt=Date.parse(String(org.updated_at).replace(' ','T')+(String(org.updated_at).includes('T')?'':'Z'));
  if(!Number.isFinite(pausedAt)||Date.now()-pausedAt<120000)blockers.push({code:'STORAGE_DRAIN_REQUIRED',count:1});
  if(!['READY','DISABLED'].includes(org.storage_status))blockers.push({code:'STORAGE_NOT_SETTLED',count:1});
  try{await exclusivePath(env,org);}catch(e){if(!(e instanceof ManagementError))throw e;blockers.push({code:e.code,count:1});}
  const waitUntil=Number.isFinite(pausedAt)?new Date(pausedAt+120000).toISOString():null;
  return {organization:org,business,preview:{organizationId:id,name:org.name,version:org.management_version,eligible:blockers.length===0,
    blockers:operationAuditEnabled(env)?blockers.map((blocker,index)=>structuredBlocker(blocker,id,org.management_version,waitUntil,actor,index)):blockers,
    ...(operationAuditEnabled(env)?{waitUntil}:{}),confirmation:DELETION_CONFIRMATION}};
}
export async function deletionPreview(env,id,actor) { return (await inspectDeletionPreview(env,id,actor)).preview; }
function structuredBlocker(blocker,organizationId,version,waitUntil,actor,index) {
  const descriptions={PAUSE_REQUIRED:'Pause a organização antes de solicitar a exclusão.',STORAGE_DRAIN_REQUIRED:'Aguarde a conclusão das operações de armazenamento em andamento.',
    UNRESOLVED_OPERATION:'Uma operação anterior precisa ter seu resultado consultado.',DELETION_IN_PROGRESS:'Já existe uma exclusão; acompanhe a mesma solicitação.',
    LINKED_DATA:'Existem registros vinculados que precisam ser tratados.',MIXED_SCOPE_PERMISSION:'Uma permissão também autoriza um projeto e precisa de revisão.',
    STORAGE_NOT_SETTLED:'O armazenamento precisa de verificação administrativa.',UNGUARDED_DEPENDENCY:'Uma dependência de banco requer revisão técnica antes da exclusão.',
    ORGANIZATION_DELETE_UNSAFE_PATH:'A pasta da organização precisa de revisão administrativa.',ORGANIZATION_DELETE_SHARED_PATH:'A pasta está compartilhada ou sobreposta a outra organização.'};
  let action={kind:'review',enabled:false,reason:'Este impedimento exige revisão administrativa; a resolução automática ainda não está disponível.',organizationId};
  if(blocker.code==='PAUSE_REQUIRED')action={kind:'pause',enabled:true,organizationId,expectedVersion:version};
  else if(blocker.code==='STORAGE_DRAIN_REQUIRED')action={kind:'query',enabled:true,organizationId,waitUntil};
  else if(blocker.code==='UNRESOLVED_OPERATION')action={kind:'query',enabled:!blocker.integrityUnknown&&(!actor||Number(actor.id)===Number(blocker.originalActorId)),reason:blocker.integrityUnknown?'O vínculo da operação requer revisão técnica.':actor&&Number(actor.id)!==Number(blocker.originalActorId)?'Somente o autor original pode consultar a recuperação desta operação. O histórico permanece na Auditoria.':null,organizationId,operationId:blocker.operationId,itemIndex:blocker.itemIndex};
  else if(blocker.code==='DELETION_IN_PROGRESS')action={kind:'follow',enabled:!actor||Number(actor.id)===Number(blocker.originalActorId),reason:actor&&Number(actor.id)!==Number(blocker.originalActorId)?'Somente o autor original pode retomar esta exclusão.':null,organizationId,deletionId:blocker.deletionId};
  return {...blocker,key:`${blocker.code}:${blocker.operationId||blocker.deletionId||blocker.resourceType||index}`,organizationId,
    description:descriptions[blocker.code]||'Esta condição exige revisão antes da exclusão.',action};
}
export async function deletionByKey(env,actor,key) {
  await ready(env);const row=await one(env,deletionSelect+' WHERE actor_id=? AND idempotency_key=?',actor.id,text(key,'Chave',16,160));
  return {deletion:row?publicDeletion(row,env):null};
}
export async function getDeletion(env,actor,id) {
  await ready(env);const row=await one(env,deletionSelect+' WHERE d.id=? AND actor_id=?',text(id,'Operação',1,80),actor.id);
  check(row,'Exclusão não encontrada.',404,'ORGANIZATION_DELETION_NOT_FOUND');return row;
}
export async function deletionStatus(env,actor,id){return {deletion:publicDeletion(await getDeletion(env,actor,id),env)};}
export async function startDeletion(env,actor,id,key,input,auditContext) {
  await ready(env);id=integer(id);object(input,['version','confirmation']);
  check(input.confirmation===DELETION_CONFIRMATION,'Digite a confirmação exatamente como indicada.',400,'ORGANIZATION_DELETE_CONFIRMATION_REQUIRED');
  const version=integer(input.version,'Versão',0);key=text(key,'Chave',16,160);
  const previous=await one(env,deletionSelect+' WHERE actor_id=? AND idempotency_key=?',actor.id,key);
  if(previous){check(previous.organization_id===id&&previous.requested_version===version,'Chave de exclusão já usada.',409,'ORGANIZATION_IDEMPOTENCY_CONFLICT');return {deletion:publicDeletion(previous,env)};}
  // One bounded, fresh schema inventory per request. Its business tables are
  // asserted empty again in the atomic claim; there is no cross-request cache.
  const {preview,organization:org,business}=await inspectDeletionPreview(env,id,actor);
  check(preview.version===version,'A organização mudou. Revise os dados.',412,'ORGANIZATION_VERSION_CONFLICT');
  check(preview.eligible,'A organização ainda possui impedimentos para exclusão.',409,'ORGANIZATION_DELETE_BLOCKED');
  const op=crypto.randomUUID();
  // Claim and write exclusion are atomic with the emptiness/version assertions.
  const empty=business.map(name=>`NOT EXISTS(SELECT 1 FROM ${quote(name)} WHERE organization_id=?)`).join(' AND ')||'1';
  const inputId="CASE WHEN json_valid(o.payload_json) THEN CAST(json_extract(o.payload_json,'$['||i.item_index||'].id') AS INTEGER) END";
  const unresolved=`NOT EXISTS(SELECT 1 FROM organization_management_operations o JOIN organization_management_operation_items i ON i.operation_id=o.id
    WHERE i.state<>'succeeded' AND (
      NOT json_valid(o.payload_json) OR (o.kind IN ('change','pause','resume') AND ${inputId}=?) OR
      (o.kind='review' AND EXISTS(SELECT 1 FROM organization_limit_requests r WHERE r.id=${inputId} AND r.organization_id=?)) OR
      (? IS NOT NULL AND ?=o.id||':'||i.item_index))
      ${operationAuditEnabled(env)?'AND NOT EXISTS(SELECT 1 FROM organization_operation_reconciliations r WHERE r.operation_id=o.id AND r.item_index=i.item_index AND r.observed_attempts=i.attempts)':''})`;
  await env.DB.batch([
    statement(env,`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organizations WHERE id=? AND management_version=? AND active=0 AND storage_status IN ('READY','DISABLED') AND julianday(updated_at)<=julianday('now','-2 minutes')) AND ${empty} AND NOT EXISTS(SELECT 1 FROM user_permissions WHERE organization_id=? AND project_id IS NOT NULL) AND ${unresolved} THEN 1 ELSE 0 END`,id,version,...business.map(()=>id),id,id,id,org.management_create_key,org.management_create_key),
    ...(operationAuditEnabled(env)?[auditFrameStatement(env,{source:'organization_deletion',sourceEventId:`${op}:requested`,operationId:op,eventType:'requested',outcome:'requested',
      context:auditContext||auditRequestContext(null,actor,{origin:'domain:organization-deletion'}),organization:org,action:'organization.permanent_delete',version})]:[]),
    statement(env,`UPDATE organizations SET management_owner_id=NULL,management_version=management_version+1,management_actor_id=?,management_request_id=?,management_action='organization.deletion_requested',management_reason='Exclusão permanente confirmada' WHERE id=? AND management_version=?`,actor.id,op,id,version),
    statement(env,`INSERT INTO organization_deletions(id,organization_id,actor_id,idempotency_key,requested_version,name,slug,path,creation_key) VALUES(?,?,?,?,?,?,?,?,?)`,op,id,actor.id,key,version,org.name,org.slug,org.dropbox_root_path,org.management_create_key||null),
    statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id) VALUES(?,'requested',?)`,op,actor.id),
    ...(automaticDeletionEnabled(env)?[statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id) VALUES(?,'automatic_requested',?)`,op,actor.id)]:[]),
  ]);
  return deletionStatus(env,actor,op);
}

// Only Dropbox HTTP is external; tests inject this small provider contract.
const provider={
  metadata:(env,row)=>getDropboxMetadata(env,'/projects',row.slug),
  metadataLegacy:(env,row)=>getDropboxMetadata(env,'/organizations',String(row.organization_id)),
  async metadataId(env,id){
    const response=await getDropboxClient(env).request({operation:'files.get_metadata',url:'https://api.dropboxapi.com/2/files/get_metadata',timeoutMs:5000,buildInit:({accessToken})=>({method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({path:id,include_deleted:false})})});
    if(!response.ok){const body=await response.text();if(response.status===409&&body.includes('path/not_found'))throw Object.assign(new Error('Missing pinned folder'),{code:'DROPBOX_PATH_NOT_FOUND'});throw fail('Identidade do armazenamento não confirmada.','ORGANIZATION_DELETE_PROVIDER_FAILED',503);}
    return response.json();
  },
  list:(env,path)=>listDropboxFolderAll(env,path,{maxPages:10}),
  async remove(env,id){
    const response=await getDropboxClient(env).request({operation:'files.delete_v2',url:'https://api.dropboxapi.com/2/files/delete_v2',timeoutMs:5000,buildInit:({accessToken})=>({method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({path:id})})});
    if(!response.ok){const body=await response.text();if(response.status===409&&body.includes('path_lookup/not_found'))return;throw fail('Não foi possível confirmar a exclusão no armazenamento.','ORGANIZATION_DELETE_PROVIDER_FAILED',503);}
    await response.json();
  }
};
const missing=error=>error?.code==='DROPBOX_PATH_NOT_FOUND';
async function verifyAbsent(env,row,storage){
  let root,pinned;
  try{root=await storage.metadata(env,row);}catch(e){if(!missing(e))throw e;}
  if(row.folder_id){try{pinned=await storage.metadataId(env,row.folder_id);}catch(e){if(!missing(e))throw e;}}
  check(!root&&!pinned,'A pasta original ainda existe ou foi substituída/movida.',409,'ORGANIZATION_DELETE_STORAGE_UNVERIFIED');
}
async function checkEmptyFolder(env,row,storage) {
  const root=await storage.list(env,row.path);
  check(root?.has_more===false&&Array.isArray(root.entries),'Inventário de armazenamento incompleto.',409,'ORGANIZATION_DELETE_STORAGE_UNVERIFIED');
  for(const entry of root.entries){
    check(entry['.tag']==='folder'&&entry.path_lower===`${row.path}/documents`.toLowerCase()&&!entry.sharing_info,'Há dados ou pastas não reconhecidas no armazenamento.',409,'ORGANIZATION_DELETE_STORAGE_NOT_EMPTY');
    const docs=await storage.list(env,`${row.path}/documents`);
    check(docs?.has_more===false&&Array.isArray(docs.entries)&&docs.entries.length===0,'Há documentos no armazenamento.',409,'ORGANIZATION_DELETE_STORAGE_NOT_EMPTY');
  }
}
async function renewDeletionLease(env,id,token) {
  const renewed=await one(env,`UPDATE organization_deletions SET lease_until=? WHERE id=? AND lease_token=? AND julianday(lease_until)>julianday('now') RETURNING id`,new Date(Date.now()+120000).toISOString(),id,token);
  check(renewed,'A posse da exclusão expirou ou mudou.',409,'ORGANIZATION_DELETE_LEASE_LOST');
}
/** Read-only provider inspection. This observes uncertainty before a separately
 * confirmed resume; it neither deletes storage nor changes the previous failure. */
export async function inspectDeletionRecovery(env,actor,id,deps={}) {
  await requireOperationAuditReady(env);
  const row=await getDeletion(env,actor,id);
  check(typeof deps.authorizeGlobal==='function'&&typeof deps.authorizeOrganization==='function','Consulta de recuperação indisponível.',503,'AUDIT_RECOVERY_EXECUTOR_UNAVAILABLE');
  await deps.authorizeGlobal();await deps.authorizeOrganization(row.organization_id);
  check(!row.lease_token||Date.parse(row.lease_until)<=Date.now(),'A exclusão está sendo processada.',409,'ORGANIZATION_DELETE_LEASE_ACTIVE');
  let checkpoint='unconfirmed',code=null;
  const storage=deps.deletionStorage||provider;
  try {
    const org=await one(env,'SELECT * FROM organizations WHERE id=?',row.organization_id);
    check(org&&org.active===0&&org.management_version===row.requested_version+1&&org.dropbox_root_path===row.path,'O alvo precisa de revisão.',409,'ORGANIZATION_DELETE_TARGET_CHANGED');
    await exclusivePath(env,org);
    const {blockers}=await inventory(env,row.organization_id);
    check(blockers.length===0,'Há dependências pendentes.',409,'ORGANIZATION_DELETE_BLOCKED');
    let legacy,root;
    try{legacy=await storage.metadataLegacy(env,row);}catch(error){if(!missing(error))throw error;}
    check(!legacy,'Há armazenamento legado.',409,'ORGANIZATION_DELETE_LEGACY_STORAGE');
    try{root=await storage.metadata(env,row);}catch(error){if(!missing(error))throw error;}
    if(root) {
      check(row.state!=='storage_deleted'&&root['.tag']==='folder'&&typeof root.id==='string'&&root.id.startsWith('id:')&&root.path_lower===row.path.toLowerCase()&&!root.sharing_info&&(!row.folder_id||root.id===row.folder_id),
        'A identidade do armazenamento mudou.',409,'ORGANIZATION_DELETE_STORAGE_UNVERIFIED');
      await checkEmptyFolder(env,row,storage);checkpoint='storage_present_verified';
    } else {await verifyAbsent(env,row,storage);checkpoint='storage_absent_verified';}
  }catch(error){code=error instanceof ManagementError?error.code:'ORGANIZATION_DELETE_INSPECTION_UNCONFIRMED';}
  const context=await operationAuditIdentity(env,actor,id,deps.request,{originalActorId:row.actor_id,origin:'domain:organization-deletion'});
  await env.DB.batch([
    statement(env,`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND attempts=? AND state=? AND requested_version=? AND (lease_token IS NULL OR julianday(lease_until)<=julianday('now'))) THEN 1 ELSE 0 END`,id,row.attempts,row.state,row.requested_version),
    auditFrameStatement(env,{source:'organization_deletion_inspection',sourceEventId:crypto.randomUUID(),operationId:id,eventType:'recovery_inspected',outcome:code?'blocked':'partial',code,
      context,organization:{id:row.organization_id,name:row.name,slug:row.slug},action:'organization.permanent_delete',version:row.requested_version,
      details:{checkpoint,attempt:row.attempts,expectedVersion:row.requested_version}})]);
  return {...await deletionStatus(env,actor,id),inspection:{recoverable:!code,checkpoint,code}};
}
export async function stepDeletion(env,actor,id,deps={}) {
  let row=await getDeletion(env,actor,id);if(row.state==='completed')return {deletion:publicDeletion(row,env)};
  await deps.authorizeOrganization?.(row.organization_id);
  if(!Number.isFinite(Date.parse(row.not_before))||Date.now()<Date.parse(row.not_before))return {deletion:{...publicDeletion(row,env),errorCode:'ORGANIZATION_DELETE_DRAINING'}};
  const token=crypto.randomUUID(),now=new Date().toISOString(),until=new Date(Date.now()+120000).toISOString();
  // Repeat automatic eligibility inside the atomic lease claim: concurrent ticks
  // may have selected the same row before another attempt failed or exhausted its budget.
  if(deps.automatic && !automaticDeletionEnabled(env))return {deletion:publicDeletion(row,env)};
  const automaticFence=deps.automatic?` AND attempts<3
    AND (error_code IS NULL OR error_code='ORGANIZATION_DELETE_PROVIDER_FAILED')
    AND (attempts=0 OR julianday(updated_at)<=julianday('now','-2 minutes'))
    AND EXISTS(SELECT 1 FROM organization_deletion_audit a WHERE a.deletion_id=organization_deletions.id AND a.event_type='automatic_requested')`:'';
  const audited=operationAuditEnabled(env);
  const context=audited?await operationAuditIdentity(env,actor,id,deps.request,{originalActorId:row.actor_id,
    executorKind:deps.automatic?'worker':deps.request?'user':'unknown',origin:deps.automatic?'worker:organization-deletion':'domain:organization-deletion'}):null;
  const previous=audited?await one(env,"SELECT attempt_id FROM audit_operation_frames WHERE operation_id=? AND event_type='attempt_started' ORDER BY id DESC LIMIT 1",id):null;
  const attemptFrame={source:'organization_deletion',operationId:id,attemptId:token,parentAttemptId:previous?.attempt_id,context,
    organization:{id:row.organization_id,name:row.name,slug:row.slug},action:'organization.permanent_delete',version:row.requested_version,details:{attempt:row.attempts+1}};
  const claimStatement=statement(env,`UPDATE organization_deletions SET lease_token=?,lease_until=?,attempts=attempts+1,error_code=NULL WHERE id=? AND state<>'completed' AND (lease_token IS NULL OR lease_until<?)${automaticFence} RETURNING *`,token,until,row.id,now);
  let claimed;
  if(audited){const results=await env.DB.batch([claimStatement,
    auditFrameStatement(env,{...attemptFrame,sourceEventId:`${token}:started`,eventType:'attempt_started',outcome:'running'},
      {sql:'EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND lease_token=?)',args:[id,token]})]);claimed=results[0]?.results?.[0];}
  else claimed=await claimStatement.first();
  if(!claimed)return {deletion:publicDeletion(row,env)};
  row=claimed;const storage=deps.deletionStorage||provider;
  try {
    const {blockers,business}=await inventory(env,row.organization_id);
    check(blockers.length===0,'Há dependências que impedem a exclusão.',409,'ORGANIZATION_DELETE_BLOCKED');
    const org=await one(env,'SELECT * FROM organizations WHERE id=?',row.organization_id);
    check(org&&org.active===0&&org.management_version===row.requested_version+1&&org.dropbox_root_path===row.path,'O alvo da exclusão mudou.',409,'ORGANIZATION_DELETE_TARGET_CHANGED');
    await exclusivePath(env,org);
    let legacyRoot;try{legacyRoot=await storage.metadataLegacy(env,row);}catch(e){if(!missing(e))throw e;}
    check(!legacyRoot,'Há armazenamento legado que requer revisão antes da exclusão.',409,'ORGANIZATION_DELETE_LEGACY_STORAGE');
    if(row.state==='pending') {
      let metadata;
      try{metadata=await storage.metadata(env,row);}catch(e){if(!missing(e))throw e;}
      if(metadata){
        check(metadata['.tag']==='folder'&&typeof metadata.id==='string'&&metadata.id.startsWith('id:')&&metadata.path_lower===row.path.toLowerCase()&&!metadata.sharing_info,
          'Identidade da pasta não confirmada.',409,'ORGANIZATION_DELETE_STORAGE_UNVERIFIED');
        check(!row.folder_id||row.folder_id===metadata.id,'A pasta foi substituída. Intervenção necessária.',409,'ORGANIZATION_DELETE_FOLDER_CHANGED');
        await checkEmptyFolder(env,row,storage);
        const pin=await one(env,`UPDATE organization_deletions SET folder_id=? WHERE id=? AND lease_token=? AND (folder_id IS NULL OR folder_id=?) RETURNING id`,metadata.id,row.id,token,metadata.id);
        check(pin,'A posse da exclusão mudou.',409,'ORGANIZATION_DELETE_LEASE_LOST');
        // Use immutable provider ID, never a caller supplied/replaced path.
        const auth=await deps.authorizeGlobal?.();
        check(!auth||auth.user?.role==='super_admin','A gestão global é restrita ao Super Admin.',403,'MANAGEMENT_SUPER_ADMIN_REQUIRED');
        await deps.authorizeOrganization?.(row.organization_id);
        row.folder_id=metadata.id;
        await renewDeletionLease(env,row.id,token);
        if(audited)await env.DB.batch([auditFrameStatement(env,{...attemptFrame,sourceEventId:`${token}:storage-intent`,eventType:'storage_delete_intent',outcome:'running',details:{checkpoint:'storage_delete_intent'}},
          {sql:'EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND lease_token=? AND julianday(lease_until)>julianday(\'now\'))',args:[row.id,token]}),
          statement(env,`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND lease_token=? AND julianday(lease_until)>julianday('now')) THEN 1 ELSE 0 END`,row.id,token)]);
        await storage.remove(env,metadata.id);
      }
      await verifyAbsent(env,row,storage);
      await renewDeletionLease(env,row.id,token);
      await env.DB.batch([
        statement(env,`UPDATE organization_deletions SET state='storage_deleted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`,row.id,token),
        statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id) SELECT ?,'storage_deleted',? WHERE EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND lease_token=?)`,row.id,actor.id,row.id,token)
      ]);
    }
    await verifyAbsent(env,row,storage);
    const finalAuth=await deps.authorizeGlobal?.();
    check(!finalAuth||finalAuth.user?.role==='super_admin','A gestão global é restrita ao Super Admin.',403,'MANAGEMENT_SUPER_ADMIN_REQUIRED');
    await deps.authorizeOrganization?.(row.organization_id);
    await renewDeletionLease(env,row.id,token);
    // Provider success is checkpointed before the independent D1 transaction.
    const empty=business.map(name=>`NOT EXISTS(SELECT 1 FROM ${quote(name)} WHERE organization_id=?)`).join(' AND ')||'1';
    await env.DB.batch([
      statement(env,`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND state='storage_deleted' AND lease_token=? AND julianday(lease_until)>julianday('now')) AND ${empty} AND NOT EXISTS(SELECT 1 FROM user_permissions WHERE organization_id=? AND project_id IS NOT NULL) THEN 1 ELSE 0 END`,row.id,token,...business.map(()=>row.organization_id),row.organization_id),
      statement(env,`INSERT INTO organization_deleted_management_events SELECT * FROM organization_management_events WHERE organization_id=?`,row.organization_id),
      statement(env,'DELETE FROM organization_management_events WHERE organization_id=?',row.organization_id),
      ...[...removable].map(name=>statement(env,`DELETE FROM ${quote(name)} WHERE organization_id=?`,row.organization_id)),
      statement(env,'UPDATE sessions SET active_organization_id=NULL WHERE active_organization_id=?',row.organization_id),
      statement(env,'DELETE FROM organizations WHERE id=?',row.organization_id),
      statement(env,`UPDATE organization_deletions SET state='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=? AND lease_token=?`,row.id,token),
      statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id) VALUES(?,'completed',?)`,row.id,actor.id),
    ]);
  }catch(error){
    const code=error instanceof ManagementError?error.code:String(error?.code||'').startsWith('DROPBOX_')?'ORGANIZATION_DELETE_PROVIDER_FAILED':'ORGANIZATION_DELETE_INTERRUPTED';
    await env.DB.batch([
      statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id,details_json) SELECT ?,'interrupted',?,? WHERE EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND lease_token=?)`,row.id,actor.id,JSON.stringify({code}),row.id,token),
      statement(env,`UPDATE organization_deletions SET error_code=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`,code,row.id,token),
    ]);
  }
  return deletionStatus(env,actor,row.id);
}
