import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { persistenceFixture } from './helpers/project-persistence-fixture.mjs';
import { onRequestGet } from '../functions/api/organizations/[id]/files/[fileId]/download.js';
function fixture(t) {
 const f=persistenceFixture(t);const token='document-preview-synthetic-owner';
 f.db.prepare(`INSERT INTO sessions (token_hash,user_id,active_organization_id,expires_at) VALUES (?,1,1,'2099-01-01')`).run(createHash('sha256').update(token).digest('hex'));
 f.db.exec(`UPDATE organizations SET dropbox_root_path='/projects/offline-a' WHERE id=1;
 INSERT INTO organization_files (id,organization_id,name,original_name,file_name,dropbox_path,file_type,mime_type,status,active,size_bytes) VALUES (10,1,'report.pdf','report.pdf','report.pdf','/projects/offline-a/documents/report.pdf','pdf','application/pdf','ACTIVE',1,15);`);
 const invoke=(org=1,cookie=`maono_session=${token}`)=>onRequestGet({env:f.env,params:{id:String(org),fileId:'10'},request:new Request('https://local.test/api/preview/download',{headers:{Cookie:cookie}})});
 return {...f,invoke};
}
test('preview uses unchanged real download authorization and private attachment response',async t=>{
 const f=fixture(t);await f.store('/projects/offline-a/documents/report.pdf',new TextEncoder().encode('%PDF-1.7\n%%EOF'));
 const response=await f.invoke();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Content-Disposition'),/^attachment;/);assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.equal(await response.text(),'%PDF-1.7\n%%EOF');
});
test('unauthenticated and cross-organization preview reads never call storage',async t=>{
 const f=fixture(t);assert.equal((await f.invoke(1,'')).status,401);assert.equal((await f.invoke(2)).status,403);assert.equal(f.calls.length,0);
});
test('download deny defeats owner role; document.view is not a bypass',async t=>{
 const f=fixture(t);f.db.exec("INSERT INTO user_permission_denials(user_id,organization_id,permission,denied_by) VALUES(1,1,'document.download',2)");assert.equal((await f.invoke()).status,403);assert.equal(f.calls.length,0);
});
test('trashed, purged, inactive and unavailable files never reach storage',async t=>{
 const f=fixture(t);
 for(const condition of ["status='TRASHED'","deleted_at='2026-01-01'","purged_at='2026-01-01'","active=0"]){f.db.exec(`UPDATE organization_files SET status='ACTIVE',deleted_at=NULL,purged_at=NULL,active=1;UPDATE organization_files SET ${condition} WHERE id=10`);assert.equal((await f.invoke()).status,404);}
 assert.equal(f.calls.length,0);
});
