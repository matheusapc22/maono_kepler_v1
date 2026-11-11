import {uploadBufferToDropbox} from '../functions/_lib/organizations.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {ensureDropboxFolder, uploadDropboxBinaryFile, finishDropboxUploadSession} from '../functions/_lib/dropbox.js';
import {finishLargeDropboxUploadSession} from '../functions/_lib/dropbox-large-upload.js';
import {getDropboxClient} from '../functions/_lib/dropbox-client.js';

function fixture(t, installed=true) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const install=()=>db.exec('CREATE TABLE organization_deletions(path TEXT NOT NULL,organization_id INTEGER NOT NULL DEFAULT 99)');
  if(installed)install();
  const env={DROPBOX_APP_KEY:'synthetic',DROPBOX_APP_SECRET:'synthetic',DROPBOX_REFRESH_TOKEN:'synthetic',DB:{
    prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;}};}
  }};
  const writes=[];let onWrite=()=>Response.json({metadata:{'.tag':'folder'}});
  const client=getDropboxClient(env);client.getAccessToken=async()=>'synthetic';client.emitMetric=()=>{};client.sleepFn=async()=>{};
  client.fetchFn=async(url,init)=>{assert.match(url,/files\/create_folder_v2$/);const path=JSON.parse(init.body).path;writes.push(path);return onWrite(path);};
  return {env,db,install,writes,onWrite(fn){onWrite=fn;},tombstone(path='/projects/gone'){db.prepare('INSERT INTO organization_deletions(path) VALUES(?)').run(path);}};
}
const locked={code:'ORGANIZATION_DELETION_LOCKED',retryable:false};
for(const path of ['/projects/gone','/projects/gone/documents','/PROJECTS/GONE/documents','/projects//gone/documents'])test('fences tombstone '+path+' with feature flag off',async t=>{
  const f=fixture(t);f.env.ORGANIZATION_PERMANENT_DELETE_V1='false';f.tombstone();await assert.rejects(ensureDropboxFolder(f.env,path),locked);assert.deepEqual(f.writes,[]);
});
test('unrelated sibling and common ancestor remain usable',async t=>{
  const f=fixture(t);f.tombstone();await ensureDropboxFolder(f.env,'/projects/gone-next/documents');assert.deepEqual(f.writes,['/projects','/projects/gone-next','/projects/gone-next/documents']);
});
test('schema absence preserves legacy and is not cached across folder components',async t=>{
  const f=fixture(t,false);f.onWrite(()=>{f.install();f.tombstone();return Response.json({metadata:{'.tag':'folder'}});});
  await assert.rejects(ensureDropboxFolder(f.env,'/projects/gone/documents'),locked);assert.deepEqual(f.writes,['/projects']);
});
test('checks tombstone before automatic retry, no second provider write',async t=>{
  const f=fixture(t);f.onWrite(()=>{f.tombstone();return Response.json({error_summary:'busy'},{status:503});});
  await assert.rejects(ensureDropboxFolder(f.env,'/projects/gone/documents'),locked);assert.deepEqual(f.writes,['/projects']);
});
test('database read failure is fail closed before provider contact',async t=>{
  const f=fixture(t);f.env.DB.prepare=()=>{throw new Error('offline database');};await assert.rejects(ensureDropboxFolder(f.env,'/projects/gone'),/offline database/);assert.deepEqual(f.writes,[]);
});
test('local storage cannot recreate a tombstoned root either',async t=>{
  const f=fixture(t);f.env.APP_ENV='local';f.env.STORAGE_DRIVER='local-d1';f.tombstone();await assert.rejects(ensureDropboxFolder(f.env,'/projects/gone'),locked);assert.deepEqual(f.writes,[]);
});

for(const [name,write] of [
  ['binary',env=>uploadDropboxBinaryFile(env,'/projects/gone','file.bin',new Uint8Array([1]))],
  ['session finish',env=>finishDropboxUploadSession(env,'synthetic-session',0,'/projects/gone','file.bin',new Uint8Array([1]))],
  ['large session finish',env=>finishLargeDropboxUploadSession(env,'synthetic-session',0,'/projects/gone','file.bin',new Uint8Array([1]))],
])test('commit fence blocks '+name+' after tombstone',async t=>{
  const f=fixture(t);f.tombstone();await assert.rejects(write(f.env),locked);assert.deepEqual(f.writes,[]);
});
test('binary write rechecks tombstone after folders were ensured',async t=>{
  const f=fixture(t);f.onWrite(path=>{if(path==='/projects/gone')f.tombstone();return Response.json({metadata:{'.tag':'folder'}});});
  await assert.rejects(uploadDropboxBinaryFile(f.env,'/projects/gone','file.bin',new Uint8Array([1])),locked);assert.deepEqual(f.writes,['/projects','/projects/gone']);
});

test('legacy exported raw upload helper cannot bypass tombstone',async t=>{
  const f=fixture(t);f.env.DROPBOX_ACCESS_TOKEN='synthetic';f.tombstone();let called=false;
  t.mock.method(globalThis,'fetch',async()=>{called=true;throw new Error('Unexpected external request');});
  await assert.rejects(uploadBufferToDropbox(f.env,'/projects/gone/file.bin',new Uint8Array([1])),locked);assert.equal(called,false);
});

test('legacy organization-id namespace is fenced independently of canonical root',async t=>{
  const f=fixture(t);f.tombstone();f.env.DROPBOX_ACCESS_TOKEN='synthetic';let called=false;
  t.mock.method(globalThis,'fetch',async()=>{called=true;throw new Error('Unexpected external request');});
  await assert.rejects(uploadBufferToDropbox(f.env,'/organizations/99/documents/file.bin',new Uint8Array([1])),locked);
  assert.equal(called,false);
  await ensureDropboxFolder(f.env,'/organizations/100/documents');assert.deepEqual(f.writes,['/organizations','/organizations/100','/organizations/100/documents']);
});
