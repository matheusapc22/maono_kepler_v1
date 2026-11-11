import {check, integer, object, text, ManagementError} from './organization-management-contract.js';
import {getDropboxMetadata, listDropboxFolderAll} from './dropbox.js';
import {getDropboxClient} from './dropbox-client.js';

export const DELETION_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE';
const one = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const statement = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const quote = name => { check(/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name), 'Schema desconhecido.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED'); return `"${name}"`; };
const removable = new Set(['organization_users','organization_access_delegations','user_permission_denials','user_permissions']);
const retained = new Set(['organization_management_events','organization_deletions','organization_deleted_management_events']);
const publicDeletion = row => ({id:row.id,organizationId:row.organization_id,state:row.state,retryable:row.state!=='completed',errorCode:row.error_code || null,notBefore:row.not_before});
const fail = (message,code,status=409) => new ManagementError(message,status,code);
export async function deletionEnabled(env) {
  if (String(env.ORGANIZATION_PERMANENT_DELETE_V1)!=='true') return false;
  const tables=await all(env,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization_deletions','organization_deletion_audit','organization_deleted_management_events')");
  const guards=await all(env,"SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('org_delete_no_recreate','org_delete_no_update','org_delete_finalize_only')");
  return tables.length===3&&guards.length===3;
}
async function ready(env) {
  check(await deletionEnabled(env),'A exclusão permanente não está disponível neste ambiente.',503,'ORGANIZATION_DELETE_DISABLED');
  const tables = await all(env,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization_deletion_audit','organization_deleted_management_events')");
  check(tables.length===2,'Schema de exclusão incompleto.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
  const names = new Set((await all(env,"SELECT name FROM sqlite_master WHERE type='trigger'")).map(r=>r.name));
  check(['org_delete_no_recreate','org_delete_no_update','org_delete_finalize_only'].every(n=>names.has(n)), 'Proteções de exclusão incompletas.',503,'ORGANIZATION_DELETE_SCHEMA_REQUIRED');
}
async function inventory(env,id) {
  const tables=await all(env,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'");
  const guards=new Set((await all(env,"SELECT name FROM sqlite_master WHERE type='trigger'")).map(r=>r.name));
  const blockers=[],business=[];
  for(const {name} of tables) {
    const columns=await all(env,`PRAGMA table_info(${quote(name)})`);
    const foreignKeys=await all(env,`PRAGMA foreign_key_list(${quote(name)})`);
    if(foreignKeys.some(fk=>fk.table==='organizations' && fk.from!=='organization_id' && !(name==='sessions'&&fk.from==='active_organization_id')))blockers.push({code:'UNGUARDED_DEPENDENCY',count:1});
    if(!columns.some(c=>c.name==='organization_id') || retained.has(name))continue;
    // Unknown extensions are never assumed safe, including empty new tables.
    if(!guards.has(`org_delete_guard_${name}_insert`) || !guards.has(`org_delete_guard_${name}_update`)) {
      blockers.push({code:'UNGUARDED_DEPENDENCY',count:1});continue;
    }
    if(removable.has(name))continue;
    business.push(name);
    const row=await one(env,`SELECT COUNT(*) n FROM ${quote(name)} WHERE organization_id=?`,id);
    if(Number(row.n)>0)blockers.push({code:'LINKED_DATA',count:Number(row.n)});
  }
  const org=await one(env,'SELECT management_create_key FROM organizations WHERE id=?',id);
  const ops=await all(env,`SELECT o.id,o.kind,o.payload_json,i.item_index,i.state FROM organization_management_operations o JOIN organization_management_operation_items i ON i.operation_id=o.id WHERE i.state<>'succeeded'`);
  for(const op of ops){let input;try{input=JSON.parse(op.payload_json)[op.item_index];}catch{blockers.push({code:'UNRESOLVED_OPERATION',count:1});continue;}
    if(Number(input?.id)===id || org?.management_create_key===`${op.id}:${op.item_index}`)blockers.push({code:'UNRESOLVED_OPERATION',count:1});
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
export async function deletionPreview(env,id) {
  await ready(env);id=integer(id);
  const org=await one(env,'SELECT * FROM organizations WHERE id=?',id);check(org,'Organização não encontrada.',404,'ORGANIZATION_NOT_FOUND');
  const existing=await one(env,'SELECT * FROM organization_deletions WHERE organization_id=?',id);
  const {blockers}=await inventory(env,id);
  if(existing)blockers.push({code:'DELETION_IN_PROGRESS',count:1});
  if(org.active!==0)blockers.push({code:'PAUSE_REQUIRED',count:1});
  const pausedAt=Date.parse(String(org.updated_at).replace(' ','T')+(String(org.updated_at).includes('T')?'':'Z'));
  if(!Number.isFinite(pausedAt)||Date.now()-pausedAt<120000)blockers.push({code:'STORAGE_DRAIN_REQUIRED',count:1});
  if(!['READY','DISABLED'].includes(org.storage_status))blockers.push({code:'STORAGE_NOT_SETTLED',count:1});
  try{await exclusivePath(env,org);}catch(e){if(!(e instanceof ManagementError))throw e;blockers.push({code:e.code,count:1});}
  return {organizationId:id,name:org.name,version:org.management_version,eligible:blockers.length===0,blockers,confirmation:DELETION_CONFIRMATION};
}
export async function deletionByKey(env,actor,key) {
  await ready(env);const row=await one(env,'SELECT * FROM organization_deletions WHERE actor_id=? AND idempotency_key=?',actor.id,text(key,'Chave',16,160));
  return {deletion:row?publicDeletion(row):null};
}
export async function getDeletion(env,actor,id) {
  await ready(env);const row=await one(env,'SELECT * FROM organization_deletions WHERE id=? AND actor_id=?',text(id,'Operação',1,80),actor.id);
  check(row,'Exclusão não encontrada.',404,'ORGANIZATION_DELETION_NOT_FOUND');return row;
}
export async function deletionStatus(env,actor,id){return {deletion:publicDeletion(await getDeletion(env,actor,id))};}
export async function startDeletion(env,actor,id,key,input) {
  await ready(env);id=integer(id);object(input,['version','confirmation']);
  check(input.confirmation===DELETION_CONFIRMATION,'Digite a confirmação exatamente como indicada.',400,'ORGANIZATION_DELETE_CONFIRMATION_REQUIRED');
  const version=integer(input.version,'Versão',0);key=text(key,'Chave',16,160);
  const previous=await one(env,'SELECT * FROM organization_deletions WHERE actor_id=? AND idempotency_key=?',actor.id,key);
  if(previous){check(previous.organization_id===id&&previous.requested_version===version,'Chave de exclusão já usada.',409,'ORGANIZATION_IDEMPOTENCY_CONFLICT');return {deletion:publicDeletion(previous)};}
  const preview=await deletionPreview(env,id);
  check(preview.version===version,'A organização mudou. Revise os dados.',412,'ORGANIZATION_VERSION_CONFLICT');
  check(preview.eligible,'A organização ainda possui impedimentos para exclusão.',409,'ORGANIZATION_DELETE_BLOCKED');
  const org=await one(env,'SELECT * FROM organizations WHERE id=?',id), {business}=await inventory(env,id),op=crypto.randomUUID();
  // Claim and write exclusion are atomic with the emptiness/version assertions.
  const empty=business.map(name=>`NOT EXISTS(SELECT 1 FROM ${quote(name)} WHERE organization_id=?)`).join(' AND ')||'1';
  await env.DB.batch([
    statement(env,`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organizations WHERE id=? AND management_version=? AND active=0) AND ${empty} THEN 1 ELSE 0 END`,id,version,...business.map(()=>id)),
    statement(env,`UPDATE organizations SET management_owner_id=NULL,management_version=management_version+1,management_actor_id=?,management_request_id=?,management_action='organization.deletion_requested',management_reason='Exclusão permanente confirmada' WHERE id=? AND management_version=?`,actor.id,op,id,version),
    statement(env,`INSERT INTO organization_deletions(id,organization_id,actor_id,idempotency_key,requested_version,name,slug,path,creation_key) VALUES(?,?,?,?,?,?,?,?,?)`,op,id,actor.id,key,version,org.name,org.slug,org.dropbox_root_path,org.management_create_key||null),
    statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id) VALUES(?,'requested',?)`,op,actor.id),
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
export async function stepDeletion(env,actor,id,deps={}) {
  let row=await getDeletion(env,actor,id);if(row.state==='completed')return {deletion:publicDeletion(row)};
  await deps.authorizeOrganization?.(row.organization_id);
  if(!Number.isFinite(Date.parse(row.not_before))||Date.now()<Date.parse(row.not_before))return {deletion:{...publicDeletion(row),errorCode:'ORGANIZATION_DELETE_DRAINING'}};
  const token=crypto.randomUUID(),now=new Date().toISOString(),until=new Date(Date.now()+120000).toISOString();
  const claimed=await one(env,`UPDATE organization_deletions SET lease_token=?,lease_until=?,attempts=attempts+1,error_code=NULL WHERE id=? AND state<>'completed' AND (lease_token IS NULL OR lease_until<?) RETURNING *`,token,until,row.id,now);
  if(!claimed)return {deletion:publicDeletion(row)};
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
        await storage.remove(env,metadata.id);
      }
      await verifyAbsent(env,row,storage);
      await env.DB.batch([
        statement(env,`UPDATE organization_deletions SET state='storage_deleted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`,row.id,token),
        statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id) SELECT ?,'storage_deleted',? WHERE EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND lease_token=?)`,row.id,actor.id,row.id,token)
      ]);
    }
    await verifyAbsent(env,row,storage);
    const finalAuth=await deps.authorizeGlobal?.();
    check(!finalAuth||finalAuth.user?.role==='super_admin','A gestão global é restrita ao Super Admin.',403,'MANAGEMENT_SUPER_ADMIN_REQUIRED');
    await deps.authorizeOrganization?.(row.organization_id);
    // Provider success is checkpointed before the independent D1 transaction.
    const empty=business.map(name=>`NOT EXISTS(SELECT 1 FROM ${quote(name)} WHERE organization_id=?)`).join(' AND ')||'1';
    await env.DB.batch([
      statement(env,`INSERT INTO organization_management_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM organization_deletions WHERE id=? AND state='storage_deleted' AND lease_token=?) AND ${empty} THEN 1 ELSE 0 END`,row.id,token,...business.map(()=>row.organization_id)),
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
      statement(env,`UPDATE organization_deletions SET error_code=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`,code,row.id,token),
      statement(env,`INSERT INTO organization_deletion_audit(deletion_id,event_type,actor_id,details_json) VALUES(?,'interrupted',?,?)`,row.id,actor.id,JSON.stringify({code})),
    ]);
  }
  return deletionStatus(env,actor,row.id);
}
