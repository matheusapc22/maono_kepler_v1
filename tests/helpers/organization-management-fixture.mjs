import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ManagementError} from '../../functions/_lib/organization-management-contract.js';
import {handleOrganizationManagement} from '../../functions/_lib/organization-management-http.js';
export function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,role TEXT,active INTEGER DEFAULT 1);
    CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT,slug TEXT UNIQUE,description TEXT,dropbox_root_path TEXT UNIQUE,active INTEGER DEFAULT 1,storage_status TEXT DEFAULT 'READY',storage_error TEXT,storage_checked_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE organization_users(id INTEGER PRIMARY KEY,organization_id INTEGER REFERENCES organizations,user_id INTEGER REFERENCES users,access_level TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(organization_id,user_id));
    CREATE TABLE projects(id INTEGER PRIMARY KEY,organization_id INTEGER,active INTEGER DEFAULT 1);
    CREATE TABLE organization_files(id INTEGER PRIMARY KEY,organization_id INTEGER,name TEXT,file_type TEXT,size_bytes INTEGER,folder_id INTEGER,is_project INTEGER DEFAULT 0,active INTEGER DEFAULT 1,status TEXT DEFAULT 'ACTIVE',deleted_at TEXT,purged_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE organization_limit_requests(id INTEGER PRIMARY KEY,organization_id INTEGER,request_type TEXT,requested_plan TEXT,reason TEXT,status TEXT DEFAULT 'pending',created_by INTEGER,reviewed_by INTEGER,reviewed_at TEXT,review_notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE organization_resource_reservations(id INTEGER PRIMARY KEY,organization_id INTEGER,resource_type TEXT DEFAULT 'project',status TEXT,expires_at TEXT);
    INSERT INTO users VALUES(1,'Operador','operador@example.test','super_admin',1),(2,'Responsável','owner@example.test','owner',1),(3,'Inativo','inativo@example.test','viewer',0),(4,'Pessoa','pessoa@example.test','viewer',1);
    INSERT INTO organizations(id,name,slug,dropbox_root_path,active) VALUES(1,'Alfa','alfa','/projects/alfa',1),(2,'Beta','beta','/projects/beta',1),(3,'Pausada','pausada','/projects/pausada',0);
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(1,2,'owner'),(2,2,'owner'),(1,3,'viewer'),(1,4,'viewer');
    INSERT INTO projects VALUES(1,1,1),(2,1,1),(3,2,0);
    INSERT INTO organization_files(id,organization_id,name,file_type,size_bytes,deleted_at,purged_at,active) VALUES(1,1,'Visível','pdf',1024,NULL,NULL,1),(2,1,'Lixeira','pdf',2048,'2026-01-01',NULL,1),(3,2,'Expurgado','pdf',4096,NULL,'2026-01-01',1),(4,2,'Desativado','pdf',1024,NULL,NULL,0),(5,2,'Mapa','json',100,NULL,NULL,1);
    INSERT INTO organization_limit_requests(id,organization_id,request_type,requested_plan,reason,created_by) VALUES(1,1,'projects_increase',NULL,'Precisamos de capacidade',2),(2,1,'users_increase',NULL,'Mais pessoas',2);
  `);
  sqlite.exec(readFileSync(new URL('../../migrations/0042_organization_management.sql',import.meta.url),'utf8'));
  let queryCount=0;
  const DB={prepare(sql){queryCount++;const statement=sqlite.prepare(sql);let parameters=[];const execute=()=>statement.columns().length?{results:statement.all(...parameters)}:{results:[],meta:statement.run(...parameters)};return {bind(...args){parameters=args;return this;},first:async()=>statement.get(...parameters)||null,all:async()=>({results:statement.all(...parameters)}),run:async()=>({meta:statement.run(...parameters)}),_execute:execute};},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s._execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,ORGANIZATION_MANAGEMENT_V1:'true',PROJECT_QUOTA_RESERVATION_V1:'true',testStorageFailure:false};
  const actor={id:1,role:'super_admin'};let storageCalls=0;
  // These are synthetic external/lifecycle adapters, not a Dropbox acceptance.
  const deps={resolvePolicy:(row)=>({plan:row.plan||'free',projects:row.project_limit||({free:5,pro:50,enterprise:500}[row.plan||'free']),storageMb:({free:500,pro:10000,enterprise:100000}[row.plan||'free'])}),quotaEnabled:e=>e.PROJECT_QUOTA_RESERVATION_V1==='true',
    authorize:async(_env,_request,id)=>{if(actor.role==='denied')throw new ManagementError('Negado',403,'DENIED');if(id===env.deniedId)throw new ManagementError('Negado',403,'DENIED');return {user:actor};},authorizeGlobal:async()=>{},authorizeOrganization:async id=>{if(id===env.deniedId)throw new ManagementError('Negado',403,'DENIED');},
    async createLifecycle(_env,payload,{management:m}){
      let row=sqlite.prepare('SELECT * FROM organizations WHERE management_create_key=?').get(m.creationKey);
      if(!row){const clash=sqlite.prepare('SELECT 1 FROM organizations WHERE slug=?').get(payload.slug);if(clash)throw new ManagementError('Organização existente',409,'ORGANIZATION_EXISTS');row=sqlite.prepare(`INSERT INTO organizations(name,slug,description,dropbox_root_path,active,storage_status,management_create_key,management_actor_id,management_request_id) VALUES(?,?,?,?,1,'PENDING',?,?,?) RETURNING *`).get(payload.name,payload.slug,payload.description,`/projects/${payload.slug}`,m.creationKey,m.actorId,m.requestId);}
      if(row.active&&row.storage_status!=='READY'){storageCalls++;if(env.testStorageFailure)throw new ManagementError('Armazenamento pendente',503,'ORGANIZATION_STORAGE_NOT_READY',true);sqlite.prepare("UPDATE organizations SET storage_status='READY' WHERE id=?").run(row.id);}
      return {organization:sqlite.prepare('SELECT * FROM organizations WHERE id=?').get(row.id)};
    },
    async updateLifecycle(_env,id,payload,{management:m}){
      const row=sqlite.prepare('SELECT * FROM organizations WHERE id=?').get(id);
      if(!row||row.management_version!==m.expectedVersion)throw new ManagementError('Conflito',412,'ORGANIZATION_VERSION_CONFLICT');
      const active=payload.active==null?row.active:payload.active?1:0;
      const next=sqlite.prepare(`UPDATE organizations SET name=?,description=?,active=?,storage_status=?,management_version=management_version+1,management_actor_id=?,management_request_id=?,management_action=?,management_reason=? WHERE id=? AND management_version=? RETURNING *`).get(payload.name??row.name,payload.description??row.description,active,active?'READY':'DISABLED',m.actorId,m.requestId,m.action,m.reason||null,id,m.expectedVersion);
      if(!next)throw new ManagementError('Conflito',412,'ORGANIZATION_VERSION_CONFLICT');return {organization:next};
    }
  };
  function request(path,body,extra={}){const headers={'Origin':'https://qa.example.test','Content-Type':'application/json','X-Maono-Management':'1',...extra};return new Request(`https://qa.example.test/api/admin/organization-management${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
  async function call(path,body,extra){const response=await handleOrganizationManagement({env,request:request(path,body,extra)},deps);return {status:response.status,headers:response.headers,data:await response.json()};}
  return {env,actor,deps,sqlite,call,request,get queryCount(){return queryCount;},get storageCalls(){return storageCalls;},close:()=>sqlite.close()};
}
