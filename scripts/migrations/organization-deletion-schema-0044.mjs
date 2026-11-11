import {classifyProtectedMetadata, protectedMetadataName} from '../../functions/_lib/d1-protected-metadata.js';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { PRODUCTION_DATABASE_NAME, runWranglerJson, rowsFromD1Json, gateError, sha256Text } from './production-migration-lib.mjs';

export const DELETION_MIGRATION = '0044_organization_permanent_deletion.sql';
const SOURCE_HASHES = Object.freeze({
  'schema.sql':'1b155254bf1db2f50f0c36b3514d7cd1e0d02d7b317d2d9719ce673d0190986b',
  'migrations/0044_organization_permanent_deletion.sql':'0115ce58428c008e5527f57af06e9935810e3a88ba81a0e2848bdac0d8cf8869',
});
// Fixed metadata-only queries: never select application rows or interpolate names.
// Only SQLite-reserved names are excluded. Unknown d1_/_cf_ names remain visible.
const scope = "s.name NOT GLOB 'sqlite_*'";
export const DELETION_SCHEMA_QUERIES = Object.freeze({
  objects:`SELECT s.type,s.name,s.tbl_name,s.sql FROM sqlite_schema s WHERE ${scope} ORDER BY s.type,s.name;`,
  columns:`SELECT s.name AS table_name,p.cid,p.name,p.type,p.\"notnull\",p.dflt_value,p.pk,p.hidden FROM sqlite_schema s JOIN pragma_table_xinfo(s.name) p WHERE s.type='table' AND ${scope} AND s.name NOT IN ('_cf_METADATA','_cf_KV') ORDER BY s.name,p.cid;`,
  foreignKeys:`SELECT s.name AS table_name,p.id,p.seq,p.\"table\" AS parent_table,p.\"from\" AS from_column,p.\"to\" AS to_column,p.on_update,p.on_delete,p.match FROM sqlite_schema s JOIN pragma_foreign_key_list(s.name) p WHERE s.type='table' AND ${scope} AND s.name NOT IN ('_cf_METADATA','_cf_KV') ORDER BY s.name,p.id,p.seq;`,
});
const identifier = value => typeof value==='string' && /^[A-Za-z_][A-Za-z_0-9]{0,127}$/.test(value);
const fail = code => { throw gateError(code,'0044 metadata audit blocked; no production writes performed.'); };
const digest = value => sha256Text(JSON.stringify(value));
// Keep string literals and quoted identifiers intact; normalize only SQL tokens.
const sqlTokens = sql => (String(sql||'').match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g)||[])
  .filter(t=>!t.startsWith('--')&&!t.startsWith('/*')).map(t=>/^[A-Za-z_][A-Za-z_0-9]*$/.test(t)?t.toLowerCase():t);
function validate(snapshot) {
  if(!snapshot || Object.keys(snapshot).sort().join()!==Object.keys(DELETION_SCHEMA_QUERIES).sort().join())fail('DELETION_METADATA_INVALID');
  for(const key of Object.keys(DELETION_SCHEMA_QUERIES))if(!Array.isArray(snapshot[key])||snapshot[key].length>20000)fail('DELETION_METADATA_INVALID');
  const fields={objects:['type','name','tbl_name','sql'],columns:['table_name','cid','name','type','notnull','dflt_value','pk','hidden'],foreignKeys:['table_name','id','seq','parent_table','from_column','to_column','on_update','on_delete','match']};
  for(const [key,rows] of Object.entries(snapshot))for(const row of rows)if(!row||typeof row!=='object'||Object.keys(row).sort().join()!==fields[key].sort().join())fail('DELETION_METADATA_INVALID');
  const names=new Set();
  for(const row of snapshot.objects){
    if(!['table','index','trigger','view'].includes(row.type)||!identifier(row.name)||!identifier(row.tbl_name)||names.has(row.name)||typeof row.sql!=='string'||row.sql.length>200000)fail('DELETION_METADATA_INVALID');
    names.add(row.name);
  }
  const tables=new Set(snapshot.objects.filter(r=>r.type==='table').map(r=>r.name));
  if(!tables.has('organizations'))fail('DELETION_METADATA_INCOMPLETE');
  for(const row of snapshot.columns)if(!tables.has(row.table_name)||!identifier(row.name)||!Number.isSafeInteger(row.cid)||row.cid<0||typeof row.type!=='string'||![0,1].includes(row.notnull)||!Number.isSafeInteger(row.pk)||![0,1,2,3].includes(row.hidden)||(row.dflt_value!==null&&typeof row.dflt_value!=='string'))fail('DELETION_METADATA_INVALID');
  const protectedNames=new Set(classifyProtectedMetadata(snapshot.objects).recognized);
  for(const table of tables)if(!protectedNames.has(table)&&!snapshot.columns.some(r=>r.table_name===table))fail('DELETION_METADATA_INCOMPLETE');
  if(new Set(snapshot.columns.map(r=>r.table_name+':'+r.cid)).size!==snapshot.columns.length)fail('DELETION_METADATA_INVALID');
  for(const row of snapshot.foreignKeys)if(!tables.has(row.table_name)||!identifier(row.parent_table)||!identifier(row.from_column)||(row.to_column!==null&&!identifier(row.to_column))||!Number.isSafeInteger(row.id)||row.id<0||!Number.isSafeInteger(row.seq)||row.seq<0||!['NO ACTION','RESTRICT','SET NULL','SET DEFAULT','CASCADE'].includes(row.on_delete)||!['NO ACTION','RESTRICT','SET NULL','SET DEFAULT','CASCADE'].includes(row.on_update)||row.match!=='NONE')fail('DELETION_METADATA_INVALID');
  return tables;
}
const readSource = path => readFileSync(new URL('../../'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export function deletionSchemaReference(read=readSource){
  const source=Object.fromEntries(Object.entries(SOURCE_HASHES).map(([path,hash])=>{let text;try{text=read(path);}catch{fail('DELETION_SOURCE_DRIFT');}if(typeof text!=='string'||sha256Text(text)!==hash)fail('DELETION_SOURCE_DRIFT');return [path,text];}));
  const parts=source['schema.sql'].split('-- Organization permanent deletion (migration 0044)');
  if(parts.length!==2)fail('DELETION_SOURCE_DRIFT');
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(parts[0]);
    const before=Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([key,sql])=>[key,db.prepare(sql).all()]));
    db.exec(source['migrations/'+DELETION_MIGRATION]);
    const guards=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'org_delete_*' ORDER BY name").all();
    return {before,guards,sources:SOURCE_HASHES};
  }finally{db.close();}
}
export function evaluateDeletionSchema(snapshot,reference=deletionSchemaReference()){
  const tables=validate(snapshot);validate(reference.before);
  const classification=classifyProtectedMetadata(snapshot.objects);
  const mismatches=[...classification.issues];
  for(const fk of snapshot.foreignKeys)if(protectedMetadataName(fk.parent_table))mismatches.push({code:'PROTECTED_METADATA_REFERENCE',name:fk.table_name});
  // The ledger is outside schema.sql but has a fixed, narrow non-business shape.
  // Do not exclude a prefix: arbitrary d1_ and _cf_ objects can reference tenants.
  const ledger=snapshot.objects.find(r=>r.name==='d1_migrations');
  let compared=snapshot;
  if(ledger){
    const cols=snapshot.columns.filter(r=>r.table_name==='d1_migrations');
    const valid=ledger.type==='table'&&cols.length===3&&cols[0].name==='id'&&cols[0].type.toUpperCase()==='INTEGER'&&cols[0].pk===1&&
      cols[1].name==='name'&&cols[1].type.toUpperCase()==='TEXT'&&cols[1].pk===0&&
      cols[2].name==='applied_at'&&['TEXT','TIMESTAMP'].includes(cols[2].type.toUpperCase())&&cols[2].pk===0&&
      cols.every(c=>c.hidden===0)&&!snapshot.foreignKeys.some(f=>f.table_name==='d1_migrations');
    if(!valid)mismatches.push({code:'LEDGER_SCHEMA',name:'d1_migrations'});
    else compared={objects:snapshot.objects.filter(r=>r.name!=='d1_migrations'),columns:snapshot.columns.filter(r=>r.table_name!=='d1_migrations'),foreignKeys:snapshot.foreignKeys};
  }
  compared={...compared,objects:compared.objects.filter(r=>!classification.recognized.includes(r.name))};
  const expected=new Map(reference.before.objects.map(r=>[r.name,r]));
  const observed=new Map(compared.objects.map(r=>[r.name,r]));
  for(const [name,want] of expected){const got=observed.get(name);if(!got||got.type!==want.type||got.tbl_name!==want.tbl_name||digest(sqlTokens(got.sql))!==digest(sqlTokens(want.sql)))mismatches.push({code:'OBJECT_DEFINITION',name});}
  for(const row of compared.objects)if(!expected.has(row.name))mismatches.push({code:'UNREVIEWED_OBJECT',name:row.name});
  for(const key of ['columns','foreignKeys'])if(digest(compared[key])!==digest(reference.before[key]))mismatches.push({code:'METADATA_SHAPE',name:key});
  const retained=new Set(['organization_management_events','organization_deletions','organization_deleted_management_events']);
  const direct=new Set(snapshot.columns.filter(r=>r.name==='organization_id').map(r=>r.table_name));
  for(const row of snapshot.foreignKeys)if(row.parent_table==='organizations')direct.add(row.table_name);
  const linked=new Set(['organizations',...direct]);
  for(let changed=true;changed;){changed=false;for(const row of snapshot.foreignKeys)if(linked.has(row.parent_table)&&!linked.has(row.table_name)){linked.add(row.table_name);changed=true;}}
  const planned=new Set(reference.guards.map(r=>r.name));
  const dependencies=[...linked].filter(n=>n!=='organizations').sort().map(name=>{
    const orgColumn=snapshot.columns.some(c=>c.table_name===name&&c.name==='organization_id');
    const covered=orgColumn&&planned.has(`org_delete_guard_${name}_insert`)&&planned.has(`org_delete_guard_${name}_update`);
    const handling=retained.has(name)?'retained':name==='sessions'?'session-detach':covered?'guarded-by-0044':direct.has(name)?'UNGUARDED':'indirect';
    if(handling==='UNGUARDED')mismatches.push({code:'UNGUARDED_DEPENDENCY',name});
    return {name,handling,foreignKeys:snapshot.foreignKeys.filter(r=>r.table_name===name)};
  });
  // Raw definitions/default literals never leave the runner in the evidence.
  const report={version:1,migration:DELETION_MIGRATION,compatible:mismatches.length===0,mismatches,
    protectedInternals:classification.recognized.map(name=>({name,classification:'workerd-protected',introspection:'not-permitted',definitionDigest:digest(sqlTokens(snapshot.objects.find(r=>r.name===name).sql))})),
    tableCount:tables.size,tables:[...tables].sort(),dependencies,
    objects:snapshot.objects.map(({type,name,tbl_name,sql})=>({type,name,table:tbl_name,definitionDigest:digest(sqlTokens(sql))})),
    metadataDigest:digest(snapshot),plannedGuards:reference.guards.map(r=>({name:r.name,definitionDigest:digest(sqlTokens(r.sql))})),
    referenceSources:reference.sources,remoteQueriesReadOnly:true,applicationRowsRead:false,atomicDatabaseSnapshot:false};
  return {...report,digest:digest(report)};
}
export function assertDeletionSchema(report){if(!report?.compatible)fail('DELETION_SCHEMA_BLOCKED');}
export async function readDeletionSchema(configPath,injected={}){
  const reference=deletionSchemaReference(); // Validate sources before any remote access.
  const stages={objects:'DELETION_OBJECTS',columns:'DELETION_COLUMNS',foreignKeys:'DELETION_FOREIGN_KEYS'};
  const read=async()=>{const result={};for(const [key,sql] of Object.entries(DELETION_SCHEMA_QUERIES)){
    result[key]=rowsFromD1Json(await runWranglerJson(['d1','execute',PRODUCTION_DATABASE_NAME,'--remote','--command',sql],configPath,injected,stages[key]));
    if(key==='objects'&&classifyProtectedMetadata(result.objects).issues.length)fail('DELETION_PROTECTED_METADATA_BLOCKED');
  }validate(result);return result;};
  const first=await read(),second=await read();
  if(digest(first)!==digest(second))fail('DELETION_METADATA_DRIFT');
  return evaluateDeletionSchema(second,reference);
}
