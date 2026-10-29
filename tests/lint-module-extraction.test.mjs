import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {restoreLintModuleExtraction} from './helpers/lint-module-extraction-preservation.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/lint-extracted-definitions.json',import.meta.url),'utf8'));
assert.equal(fixture.base,'e47deac18888195b945a244dadb9e27c5902638f');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const printer=ts.createPrinter({removeComments:true});
function digestDeclaration(source,name){
  const file=ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const matches=file.statements.filter(node=>(node.name?.text??(ts.isVariableStatement(node)?node.declarationList.declarations[0]?.name.getText(file):null))===name);
  assert.equal(matches.length,1,`one definition of ${name}`);
  return createHash('sha256').update(printer.printNode(ts.EmitHint.Unspecified,matches[0],file).replace(/^export /,'')).digest('hex');
}
for(const item of fixture.definitions)test(`extracted ${item.name} retains independently pinned product definition`,()=>{
  assert.equal(digestDeclaration(read(item.path),item.name),item.sha256);
});
test('preservation detects a mutation in moved policy and in its original caller',()=>{
  const definition=fixture.definitions.find(item=>item.name==='loadAccessGovernance');
  const source=read(definition.path); const mutation=source.replace('data?.ok === false','data?.ok === true');
  assert.notEqual(mutation,source);
  assert.notEqual(digestDeclaration(mutation,definition.name),definition.sha256);
  const path='src/pages/Projects.tsx', original=read(path);
  assert.throws(()=>restoreLintModuleExtraction(path,original.replace("import {sameProject,mergeProjectSnapshot}","import {sameProject,otherSnapshot}")),/exact lint extraction/);
});
test('controller store cleanup does not detach a newer controller',()=>{
  let snapshots; const exports={};
  const compiled=ts.transpileModule(read('src/pages/Kepler/clustering/point-cluster-controller-store.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,{exports,require(name){
    assert.equal(name,'react');
    return {useSyncExternalStore(subscribe,getSnapshot,serverSnapshot){snapshots={subscribe,getSnapshot,serverSnapshot};return getSnapshot();}};
  }});
  assert.equal(exports.usePointClusterController(),null);
  let notifications=0; const unsubscribe=snapshots.subscribe(()=>notifications++);
  const first={name:'first'},second={name:'second'};
  const releaseFirst=exports.attachPointClusterController(first);
  assert.equal(snapshots.getSnapshot(),first);
  const releaseSecond=exports.attachPointClusterController(second);
  releaseFirst(); assert.equal(snapshots.getSnapshot(),second);
  releaseSecond(); assert.equal(snapshots.getSnapshot(),null);
  assert.equal(snapshots.serverSnapshot(),null); assert.equal(notifications,3);
  unsubscribe(); exports.attachPointClusterController(first); assert.equal(notifications,3);
});
