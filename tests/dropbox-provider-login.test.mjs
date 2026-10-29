import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Compile the real provider. Only browser and external SDK boundaries are simulated.
const source = readFileSync(new URL('../src/pages/Kepler/cloud-providers/dropbox/dropbox-provider.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
}}).outputText;
function fixture({popup = true, storageError} = {}) {
  const listeners = new Set(); const writes = []; let closed = 0;
  let listening;
  const ready = new Promise(resolve => {listening = resolve;});
  const browser = {
    open: () => popup ? {close: () => closed++} : null,
    addEventListener: (_type, listener) => {listeners.add(listener); listening();},
    removeEventListener: (_type, listener) => listeners.delete(listener),
    localStorage: {setItem: (...args) => {if(storageError) throw storageError; writes.push(args);}},
  };
  const exports = {};
  vm.runInNewContext(compiled, {exports, require(name) {
    if(name === 'global/window') return browser;
    if(name === '@kepler.gl/cloud-providers') return {Provider: class {}, KEPLER_FORMAT: 'keplergl'};
    if(name === 'dropbox') return {};
    if(name === './dropbox-icon') return () => null;
    if(name === '../../constants/default-settings') return {MAP_URI: 'map'};
    throw new Error(`Unexpected import ${name}`);
  }});
  const provider = Object.create(exports.default.prototype);
  const tokens = [];
  provider._authLink = async () => 'https://oauth.invalid/authorize';
  provider._dropbox = {auth: {setAccessToken: token => tokens.push(token)}};
  provider.getUser = async () => ({name: 'Synthetic', email: 'synthetic@example.invalid'});
  return {provider, listeners, writes, tokens, ready, closed: () => closed};
}
test('login settles once after a token and removes its listener even if popup was blocked', async () => {
  for(const popup of [true,false]) {
    const f = fixture({popup}); const pending = f.provider.login();
    await f.ready;
    assert.equal(f.listeners.size,1);
    const listener = [...f.listeners][0];
    await listener({data:{unrelated:true}}); assert.equal(f.listeners.size,1);
    await listener({data:{token:'synthetic-token'}});
    assert.equal((await pending).name,'Synthetic');
    assert.equal(f.listeners.size,0); assert.equal(f.closed(),popup ? 1 : 0);
    assert.deepEqual(f.tokens,['synthetic-token']); assert.equal(f.writes.length,1);
  }
});
test('authorization URL failure rejects before installing a listener', async () => {
  const f=fixture(); const failure = new Error('authorization failed');
  f.provider._authLink=async()=>{throw failure;};
  await assert.rejects(f.provider.login(),error=>error===failure);
  assert.equal(f.listeners.size,0); assert.equal(f.writes.length,0);
});
test('account lookup and storage failures reject rather than leave login pending', async () => {
  for(const stage of ['account','storage']) {
    const failure=new Error(`${stage} failed`); const f=fixture({storageError:stage==='storage'?failure:undefined});
    if(stage==='account') f.provider.getUser=async()=>{throw failure;};
    const pending=f.provider.login(); const rejected=assert.rejects(pending,error=>error===failure);
    await f.ready; await [...f.listeners][0]({data:{token:'synthetic-token'}});
    await rejected; assert.equal(f.listeners.size,0); assert.equal(f.closed(),1);
    assert.equal(f.writes.length,0);
  }
});
