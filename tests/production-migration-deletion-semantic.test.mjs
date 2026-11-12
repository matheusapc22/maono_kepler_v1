import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {recognizeDefinition,semanticDiagnostics,SEMANTIC_LIMITS} from '../scripts/migrations/deletion-semantic-diagnostics.mjs';
import {TABLE_COLUMNS,INDEX_DESCRIPTORS} from '../scripts/migrations/deletion-semantic-targets.mjs';
import {DELETION_SCHEMA_QUERIES,evaluateDeletionSchema,assertDeletionSchema} from '../scripts/migrations/organization-deletion-schema-0044.mjs';
const table=(sql,name='tickets')=>({type:'table',name,tbl_name:name,sql});
const index=sql=>({type:'index',name:'idx_user_permissions_unique_org',tbl_name:'user_permissions',sql});
const base='CREATE UNIQUE INDEX idx_user_permissions_unique_org ON user_permissions(user_id,permission,organization_id) WHERE ';
const parsed=o=>{const r=recognizeDefinition(o);assert.equal(r.status,'recognized-subset');assert.equal(r.semanticApproval,false);assert.equal(r.authorizationEffect,'none');return r;};
const blocked=o=>{const r=recognizeDefinition(o);assert.equal(r.status,'unsupported');assert.equal(r.reason,'UNSUPPORTED_DEFINITION');assert.equal(r.semanticApproval,false);return r;};
test('fixed scope: seven tables, 21 simple and three partial indexes',()=>{
 assert.equal(Object.keys(TABLE_COLUMNS).length,7);assert.equal(Object.values(INDEX_DESCRIPTORS).filter(i=>!i.partial).length,21);assert.equal(Object.values(INDEX_DESCRIPTORS).filter(i=>i.partial).length,3);
 for(const [name,d] of Object.entries(INDEX_DESCRIPTORS))parsed({type:'index',name,tbl_name:d.table,sql:`CREATE ${d.unique?'UNIQUE ':''}INDEX ${name} ON ${d.table}(${d.columns.join(',')})${d.partial?' WHERE organization_id IS NOT NULL':''}`});
});
test('constraints, conflict policy, FK ordering and options are represented only',()=>{
 const r=parsed(table(`CREATE TABLE tickets(id INTEGER PRIMARY KEY ON CONFLICT ABORT AUTOINCREMENT, organization_id INTEGER NOT NULL ON CONFLICT FAIL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED, title TEXT COLLATE NOCASE DEFAULT 'Private sentinel', status TEXT CHECK(status IN ('secret one','secret two')), UNIQUE(title COLLATE BINARY DESC) ON CONFLICT IGNORE, FOREIGN KEY(created_by,assigned_to) REFERENCES users(id,id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE) STRICT`));
 assert.equal(r.opaqueLiteralCount,3);assert.equal(r.ast.items[0].constraints[0].autoincrement,true);assert.deepEqual(r.ast.items.at(-1).columns,['created_by','assigned_to']);assert.deepEqual(r.ast.options,['STRICT']);assert.doesNotMatch(JSON.stringify(r),/Private sentinel|secret one|secret two/);
 parsed(table('CREATE TABLE tickets(id INTEGER PRIMARY KEY) WITHOUT ROWID, STRICT'));
});
test('opaque literals preserve differences without disclosure',()=>{
 const a=parsed(table("CREATE TABLE tickets(id INTEGER DEFAULT -1, title TEXT DEFAULT 'a''b -- /* private')"));
 const b=parsed(table("CREATE TABLE tickets(id INTEGER DEFAULT -1.0, title TEXT DEFAULT 'a''b -- /* PRIVATE')"));
 assert.notDeepEqual(a.ast,b.ast);assert.doesNotMatch(JSON.stringify(a),/a'b|private/);
 parsed(table('CREATE TABLE tickets(id INTEGER DEFAULT 1e+3, created_at TEXT DEFAULT CURRENT_TIMESTAMP)'));
});
test('precedence and explicit groups remain in AST',()=>{
 const a=parsed(index(base+'organization_id IS NOT NULL OR project_id IS NULL AND NOT active = 1')).ast.predicate;
 assert.equal(a.kind,'or');assert.equal(a.right.kind,'and');assert.equal(a.right.right.kind,'not');
 const b=parsed(index(base+'(organization_id IS NOT NULL OR project_id IS NULL) AND active = 1')).ast.predicate;
 assert.equal(b.kind,'and');assert.equal(b.left.kind,'group');parsed(index(base+'organization_id NOT IN (1,2,NULL)'));
});
test('declaration quoting is allowlisted; expression DQS fallback is unsupported',()=>{
 parsed(table('CREATE TABLE "tickets" (`id` INTEGER, [title] TEXT)'));parsed(table('CREATE TABLE TICKETS(ID INTEGER)'));
 for(const s of ['CREATE TABLE tickets("private name" TEXT)','CREATE TABLE tickets(id INTEGER DEFAULT "title")','CREATE TABLE tickets(id INTEGER CHECK("title" = 1))'])blocked(table(s));
 blocked(index(base+'"unknown_dqs_string" = organization_id'));blocked(index(base+'"organization_id" IS NULL'));
});
for(const sql of [
 'CREATE TABLE tickets(id INTEGER); SELECT 1', 'CREATE TABLE tickets(id INTEGER);;',
 'CREATE TABLE tickets(id INTEGER /* unfinished',"CREATE TABLE tickets(title TEXT DEFAULT 'unfinished)",'CREATE TABLE tickets("id INTEGER)',
 'CREATE TABLE tickets(id INTEGER)\0','CREATE TABLE t\u0131ckets(id INTEGER)','CREATE TABLE tickets(id INTEGER)\u00a0',
 'CREATE TABLE tickets(id INTEGER, CONSTRAINT private_name UNIQUE(id))','CREATE TABLE tickets(id INTEGER GENERATED ALWAYS AS (1) STORED)',
 'CREATE TABLE tickets(id INTEGER DEFAULT (SELECT 1))',"CREATE TABLE tickets(created_at TEXT DEFAULT (datetime('now')))",
 'CREATE TABLE tickets(id INTEGER DEFAULT 0x123)','CREATE TABLE tickets(id INTEGER DEFAULT (id + 1))','CREATE TABLE tickets(id INTEGER COLLATE private_collation)',
 'CREATE TABLE tickets(id INTEGER ON CONFLICT FAIL)','CREATE TABLE tickets(id INTEGER NOT NULL NOT NULL)','CREATE TABLE tickets(id INTEGER NULL NOT NULL)',
 'CREATE TABLE tickets(id INTEGER PRIMARY KEY, title TEXT PRIMARY KEY)','CREATE TABLE tickets(id INTEGER, UNIQUE(id), UNIQUE(id))',
 'CREATE TABLE tickets(id INTEGER REFERENCES organizations(id) INITIALLY DEFERRED)',
 'CREATE TABLE tickets(id INTEGER REFERENCES organizations(id) ON DELETE CASCADE ON DELETE RESTRICT)',
 'CREATE TABLE tickets(id INTEGER, FOREIGN KEY(id DESC) REFERENCES organizations(id))',
 'CREATE TABLE tickets(id INTEGER) STRICT, STRICT','CREATE TABLE tickets(id INTEGER) WITHOUT ROWID, STRICT, PRIVATE','CREATE TABLE tickets(id INTEGER) WITHOUT ROWID trailing',
 'CREATE TABLE tickets(id INTEGER CHECK(id IS DISTINCT FROM NULL))','CREATE TABLE tickets(id INTEGER CHECK(id BETWEEN 1 AND 2))',
 "CREATE TABLE tickets(title TEXT CHECK(title LIKE 'x'))","CREATE TABLE tickets(title TEXT CHECK(title GLOB 'x'))",'CREATE TABLE tickets(id INTEGER CHECK(abs(id)>1))',
 'CREATE TABLE tickets(id INTEGER CHECK(id IN (SELECT id FROM users)))','CREATE TABLE tickets(id INTEGER CHECK(id & 1))',
 'CREATE VIRTUAL TABLE tickets USING fts5(title)','CREATE TABLE IF NOT EXISTS tickets(id INTEGER)',
])test('rejects '+sql.slice(0,85).replaceAll('\0','NUL'),()=>assert.deepEqual(Object.keys(blocked(table(sql))).sort(),['authorizationEffect','reason','semanticApproval','status']));
test('limits reject without raw errors or recursion overflow',()=>{
 blocked(table(' '.repeat(SEMANTIC_LIMITS.bytes+1)));
 blocked(table('CREATE TABLE tickets(id INTEGER CHECK('+'('.repeat(100)+'id'+')'.repeat(100)+'))'));
 blocked(index(base+Array(100).fill('id = 1').join(' AND ')));
 blocked(table('CREATE TABLE tickets(id INTEGER)'+' /*c*/'.repeat(6000)));
 blocked(table('CREATE TABLE tickets(id INTEGER)'+';'.repeat(SEMANTIC_LIMITS.tokens+1)));
});
test('exact scope and complete definition digest',()=>{
 assert.equal(recognizeDefinition(table('CREATE TABLE evil(id INTEGER)','evil')).status,'out-of-scope');blocked({...table('CREATE TABLE tickets(id INTEGER)'),tbl_name:'users'});
 const a=semanticDiagnostics([table('CREATE TABLE tickets(id INTEGER)')]),b=semanticDiagnostics([table('CREATE TABLE tickets(id INTEGER) /* changed */')]);
 assert.notEqual(a.objects.find(o=>o.name==='tickets').definitionDigest,b.objects.find(o=>o.name==='tickets').definitionDigest);assert.equal(a.authorizationEffect,'none');assert.equal(a.compatibilityAuthority,false);
});
test('recognized historical targets cannot authorize compatibility',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8').split('-- Organization permanent deletion (migration 0044)')[0]);
 for(const name of ['favorite_projects','organization_feature_flags','organization_limits','ticket_comments','tickets'])db.exec(`CREATE TABLE ${name}(${TABLE_COLUMNS[name].map(n=>n+' INTEGER').join(',')});`);
 for(const [name,d] of Object.entries(INDEX_DESCRIPTORS))db.exec(`CREATE ${d.unique?'UNIQUE ':''}INDEX IF NOT EXISTS ${name} ON ${d.table}(${d.columns.join(',')})${d.partial?' WHERE organization_id IS NOT NULL':''};`);
 const snapshot=Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([k,q])=>[k,db.prepare(q).all()]));
 const report=evaluateDeletionSchema(snapshot);assert.equal(report.compatible,false);assert.throws(()=>assertDeletionSchema(report),{code:'DELETION_SCHEMA_BLOCKED'});
 for(const name of [...Object.keys(TABLE_COLUMNS),...Object.keys(INDEX_DESCRIPTORS)])assert.equal(report.semanticDiagnostics.objects.find(x=>x.name===name).semanticApproval,false);
 for(const [name,d] of Object.entries(INDEX_DESCRIPTORS))if(d.partial)assert.equal(report.semanticDiagnostics.objects.find(x=>x.name===name).status,'recognized-subset');
 assert.doesNotMatch(JSON.stringify(report.semanticDiagnostics),/CREATE TABLE/);
});
