// Actual pinned workerd D1 parser, with ephemeral synthetic local databases.
// This complements the Wrangler HTTP transport mock; neither contacts remote D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { installMigratedOrganizationSchema } from './helpers/organization-schema-history.mjs';
import { ORGANIZATION_SCHEMA_SOURCES } from '../scripts/migrations/organization-schema-references.mjs';
import { WRANGLER_VERSION, sha256Text, PRODUCTION_DATABASE_ID, PRODUCTION_DATABASE_NAME } from '../scripts/migrations/production-migration-lib.mjs';
import { IDENTITY_SNAPSHOT_SQL, IDENTITY_MIGRATION, IDENTITY_MIGRATION_SHA256, validateIdentitySnapshot,
  guardedIdentityMigration, identityApprovalEvidence, collectIdentityEvidence, collectIdentityPostValidation } from '../scripts/migrations/organization-identity-0043.mjs';

const packageDir=resolve(process.env.IDENTITY_WRANGLER_PACKAGE || '.tmp/wrangler-0043/node_modules/wrangler');
const require=createRequire(join(packageDir,'package.json'));
assert.equal(require('./package.json').version,WRANGLER_VERSION);
assert.equal(require('workerd/package.json').version,'1.20260923.1');
assert.equal(require('miniflare/package.json').version,'5.20260923.0-alpha');
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel }=require('miniflare');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const previousSnapshot=read('tests/fixtures/organization-identity-snapshot-union.sql');
assert.equal(sha256Text(previousSnapshot),'792befd8be2c58cac25b8eb66e87d078b41f6dd20faf2da6ad33884bbb4e2fb6');
const source=read('migrations/'+IDENTITY_MIGRATION);
const ledgerTable='CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);';
const ledgerInsert="INSERT INTO d1_migrations(name,applied_at) VALUES(?, '2026-11-10 00:00:00');";

async function fixture(t,profile='canonical',count=2) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  const mf=new Miniflare(convertV4MiniflareOptions({
    modules:true,script:'export default { fetch() { return new Response("synthetic"); } }',
    compatibilityDate:'2026-09-23',host:'127.0.0.1',port:0,cf:false,
    d1Databases:{DB:'synthetic-identity-snapshot'},d1Persist:false,
    outboundService:()=>{throw new Error('No external requests allowed in the offline contract');},
    log:new Log(LogLevel.ERROR),
  }));
  t.after(()=>mf.dispose());
  const d1=await mf.getD1Database('DB');
  // Fixture setup only: let SQLite parse complete statements (including triggers)
  // into D1's batch API. The production snapshot below is never split or mocked.
  async function setup(sql) {
    const statements=[];
    while(!/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/.test(sql)) {
      const statement=sqlite.prepare(sql),first=statement.sourceSQL;
      assert.ok(first.length>0);statement.run();statements.push(d1.prepare(first));sql=sql.slice(first.length);
    }
    if(statements.length)await d1.batch(statements);
  }
  const schema=[];
  // The functional bootstrap already includes 0043; audit/apply fixtures start at 0042.
  if(profile==='canonical')schema.push(read('schema.sql').split('-- Organization creation identity (migration 0043)')[0]);
  else installMigratedOrganizationSchema({exec:sql=>schema.push(sql)});
  for(const sql of [...schema,ledgerTable])await setup(sql);
  const names=profile==='canonical'?['0007_create_organization_limit_requests.sql','0016_map_panel_navigation_and_quota.sql','0042_organization_management.sql']
    :Object.keys(ORGANIZATION_SCHEMA_SOURCES).filter(p=>p.startsWith('migrations/')).map(p=>p.slice(11));
  for(const name of names){sqlite.prepare(ledgerInsert).run(name);await d1.prepare(ledgerInsert).bind(name).run();}
  const insert='INSERT INTO organizations(id,name,slug,dropbox_root_path,active) VALUES(?,?,?,?,?)';
  // Reverse insertion, non-contiguous IDs, paused rows, Unicode and SQL quotes.
  for(let i=count;i>0;i--) {
    const values=[i*3,i===1?"E\u0301quipe 'Synthetic'":i===2?'\uFF21lpha\u00a0Team':'Synthetic '+i,
      'synthetic-'+String(i).padStart(9,'0'),'/synthetic/\u00e9quipe/'+i,i%2];
    sqlite.prepare(insert).run(...values);await d1.prepare(insert).bind(...values).run();
  }
  return {sqlite,d1,setup};
}

test('pinned workerd accepts 5 compound terms, rejects 6 and the exact old 36-term snapshot',async t=>{
  const {d1}=await fixture(t);
  const compound=n=>Array.from({length:n},()=> 'SELECT 1 AS n').join(' UNION ALL ');
  assert.equal((await d1.prepare(compound(5)).all()).results.length,5);
  await assert.rejects(d1.prepare(compound(6)).all(),/too many terms in compound SELECT/);
  assert.equal((previousSnapshot.match(/ UNION ALL /g)||[]).length,35);
  await assert.rejects(d1.prepare(previousSnapshot).all(),/too many terms in compound SELECT/);
  assert.equal((await d1.prepare(IDENTITY_SNAPSHOT_SQL).all()).results[0].total,2);
});

for(const profile of ['canonical','historical'])for(const count of [0,64]) {
  test(`${profile}, ${count} organizations: real workerd preserves pre/post snapshot and operator contracts`,async t=>{
    const {sqlite,d1,setup}=await fixture(t,profile,count);
    const migration={name:IDENTITY_MIGRATION,sha256:IDENTITY_MIGRATION_SHA256};
    let preInventory;
    for(const phase of ['pre','post']) {
      const beforeOrganizations=(await d1.prepare('SELECT * FROM organizations ORDER BY id').all()).results;
      const result=await d1.prepare(IDENTITY_SNAPSHOT_SQL).all();
      assert.equal(result.success,true);assert.equal(result.results.length,1);
      const raw=result.results[0],oldRaw=sqlite.prepare(previousSnapshot).get();
      assert.deepEqual(raw,{...oldRaw}); // Exact JSON strings, not just parsed values.
      assert.deepEqual((await d1.prepare('SELECT * FROM organizations ORDER BY id').all()).results,beforeOrganizations);
      assert.equal(result.meta.rows_written,0);
      const expected=validateIdentitySnapshot(oldRaw,phase),actual=validateIdentitySnapshot(raw,phase);
      assert.deepEqual(actual,expected);
      assert.equal(actual.rows.length,count);
      if(phase==='pre')preInventory=raw.inventory_json;else assert.equal(raw.inventory_json,preInventory);
      const remote={identity:{id:PRODUCTION_DATABASE_ID,name:PRODUCTION_DATABASE_NAME},
        ledger:actual.ledgerRows.map(({applied_at,...r})=>({...r,appliedAt:applied_at})),
        localMigrations:[...new Set([...actual.ledgerRows.map(r=>r.name),IDENTITY_MIGRATION])]};
      let reads=0,bookmarks=0;
      const injected={runProcess:async(command,args)=>{
        assert.equal(command,'npx');
        if(args.includes('time-travel')){bookmarks++;return {stdout:JSON.stringify({bookmark:'synthetic-bookmark-123456'})};}
        assert.equal(args[args.indexOf('--command')+1],IDENTITY_SNAPSHOT_SQL);reads++;
        return {stdout:JSON.stringify([await d1.prepare(IDENTITY_SNAPSHOT_SQL).all()])};
      }};
      const collected=await collectIdentityEvidence('synthetic',remote,migration,phase,injected);
      assert.equal(reads,1);
      const {pending,...report}=collected.report;
      assert.deepEqual({...collected,report},actual);
      assert.equal(pending.selectedPending,phase==='pre');
      if(phase==='pre') {
        const a=guardedIdentityMigration(actual),b=guardedIdentityMigration(expected);
        assert.deepEqual(a,b);assert.equal(identityApprovalEvidence(actual,a),identityApprovalEvidence(expected,b));
        // Transition synthetic fixtures only. Transport/atomic apply remains covered
        // by the separate real-Wrangler contract; this test proves the SQL parser.
        await setup(source);
        sqlite.prepare(ledgerInsert).run(IDENTITY_MIGRATION);
        await d1.prepare(ledgerInsert).bind(IDENTITY_MIGRATION).run();
      } else {
        const post=await collectIdentityPostValidation('synthetic',remote,migration,injected);
        assert.equal(reads,2);assert.equal(bookmarks,1);assert.equal(post.digest,actual.report.digest);
        assert.equal(post.schema.compatible,true);assert.equal(post.pending.selectedPending,false);
      }
    }
  });
}
