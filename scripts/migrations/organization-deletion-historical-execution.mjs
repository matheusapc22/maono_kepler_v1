// Pure local-proof renderer. No operator integration or authority to execute.
import {DELETION_SCHEMA_QUERIES} from './organization-deletion-schema-0044.mjs';
import {assertDeletionLedgerPrestate,sha256Text} from './production-migration-lib.mjs';
export const HISTORICAL_EXECUTION_SOURCE_SHA256='b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa';
export const HISTORICAL_EXECUTION_QUERIES=Object.freeze({
 catalog:'SELECT rowid,type,name,tbl_name,sql FROM sqlite_schema ORDER BY rowid',
 ledger:'SELECT id,name,applied_at FROM d1_migrations ORDER BY id',
 indexList:DELETION_SCHEMA_QUERIES.indexes.replace(/;$/,''),
});
const fail=()=>{throw Object.assign(new Error('Historical execution proof blocked.'),{code:'HISTORICAL_EXECUTION_INVALID'});};
const requireValue=x=>{if(!x)fail();};
const keys=(row,fields)=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join()===fields.slice().sort().join();
const name=x=>typeof x==='string'&&/^[A-Za-z_][A-Za-z_0-9]{0,127}$/.test(x);
const literal=x=>x===null?'NULL':typeof x==='number'?String(x):`CAST(X'${Buffer.from(x,'utf8').toString('hex')}' AS TEXT)`;
const assertion=p=>`SELECT CASE WHEN (${p}) THEN 1 ELSE abs(-9223372036854775808) END;\n`;
// Returns SQL payload, NOT JSON HTTP bytes. requestSha256 below preserves this explicit domain.
export function historicalWranglerRequest(sql){requireValue(typeof sql==='string');return sql+`\nINSERT INTO "d1_migrations" (name)\nvalues ('0044_organization_permanent_deletion_historical.sql');`;}
export function renderHistoricalExecution(state,sourceSql){
 requireValue(typeof sourceSql==='string'&&sha256Text(sourceSql)===HISTORICAL_EXECUTION_SOURCE_SHA256);
 requireValue(state&&/^[0-9a-f]{64}$/.test(state.fullSnapshotDigest||''));
 requireValue(Array.isArray(state.catalog)&&state.catalog.length>0&&state.catalog.length<=10000);
 const ids=new Set(),names=new Set();
 for(const r of state.catalog){
  requireValue(keys(r,['rowid','type','name','tbl_name','sql'])&&Number.isSafeInteger(r.rowid)&&r.rowid>0&&!ids.has(r.rowid)&&
   ['table','index','trigger','view'].includes(r.type)&&name(r.name)&&name(r.tbl_name)&&!names.has(r.name.toLowerCase())&&
   (r.sql===null||(typeof r.sql==='string'&&Buffer.byteLength(r.sql)<=40000)));
  ids.add(r.rowid);names.add(r.name.toLowerCase());
 }
 requireValue(names.has('d1_migrations'));
 assertDeletionLedgerPrestate(state.ledger);
 requireValue(keys(state.pragmas,['foreign_keys','recursive_triggers','defer_foreign_keys'])&&state.pragmas.foreign_keys===1&&state.pragmas.defer_foreign_keys===0&&[0,1].includes(state.pragmas.recursive_triggers));
 requireValue(Array.isArray(state.indexList)&&state.indexList.length<=20000);
 const indexKeys=['table_name','index_name','seq','unique','origin','partial','index_count'],seen=new Set();
 for(const r of state.indexList){
  requireValue(keys(r,indexKeys)&&name(r.table_name)&&names.has(r.table_name.toLowerCase())&&Number.isSafeInteger(r.index_count)&&r.index_count>=0&&r.index_count<=20000);
  requireValue(r.index_count===0?['index_name','seq','unique','origin','partial'].every(k=>r[k]===null):name(r.index_name)&&Number.isSafeInteger(r.seq)&&r.seq>=0&&r.seq<r.index_count&&[0,1].includes(r.unique)&&['c','u','pk'].includes(r.origin)&&[0,1].includes(r.partial));
  const key=r.table_name+':'+r.seq;requireValue(!seen.has(key));seen.add(key);
 }
 const statements=[];let bytes=Buffer.byteLength(sourceSql);
 const push=statement=>{const size=Buffer.byteLength(statement);requireValue(size<=90000&&bytes+size<=8000000);bytes+=size;statements.push(statement);};
 const add=(sql,rows,fields)=>{
  push(assertion(`(SELECT COUNT(*) FROM (${sql}))=${rows.length}`));
  for(const row of rows)push(assertion(`EXISTS(SELECT 1 FROM (${sql}) WHERE ${fields.map(k=>`"${k}" IS ${literal(row[k])} COLLATE BINARY`).join(' AND ')})`));
 };
 add(HISTORICAL_EXECUTION_QUERIES.catalog,state.catalog,['rowid','type','name','tbl_name','sql']);
 add(HISTORICAL_EXECUTION_QUERIES.ledger,state.ledger.map(r=>({id:r.id,name:r.name,applied_at:r.appliedAt})),['id','name','applied_at']);
 add(HISTORICAL_EXECUTION_QUERIES.indexList,state.indexList,indexKeys);
 for(const key of ['foreign_keys','recursive_triggers','defer_foreign_keys'])push(assertion(`(SELECT "${key}" FROM pragma_${key})=${state.pragmas[key]}`));
 requireValue(statements.every(s=>Buffer.byteLength(s)<=90000));
 const sql=statements.join('')+sourceSql;requireValue(Buffer.byteLength(sql)<=8000000);
 return {sql,sha256:sha256Text(sql),requestSha256:sha256Text(historicalWranglerRequest(sql)),requestHashDomain:'concatenated-sql-payload',requestBodySha256:sha256Text(JSON.stringify({sql:historicalWranglerRequest(sql)})),sourceSha256:HISTORICAL_EXECUTION_SOURCE_SHA256,fullSnapshotDigest:state.fullSnapshotDigest,assertionCount:statements.length,bytes:Buffer.byteLength(sql),operationalApproval:false};
}
