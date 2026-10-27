import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {tableFromArrays} from 'apache-arrow';

const require=createRequire(import.meta.url);
function compile(path){return ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;}
const actionCode=compile('../src/pages/Kepler/actions.ts');
const reducerCode=compile('../src/pages/Kepler/reducers/index.ts');
const turn=()=>new Promise(setImmediate);
function actionsFixture({fetch=async()=>{throw new Error('unexpected fetch');},getState=()=>({})}={}) {
  const events=[]; const exports={}; let finishFiles;
  vm.runInNewContext(actionCode,{exports,File,Blob,require(name){
    if(name==='react-router-redux')return {push:path=>({type:'ROUTE',path})};
    if(name==='global')return {fetch};
    if(name==='@kepler.gl/actions')return {loadFiles:files=>({type:'LOAD_FILES',files}),toggleModal:modal=>({type:'MODAL',modal})};
    if(name==='@kepler.gl/common-utils')return {parseUri:url=>({file:new URL(url).pathname.split('/').pop()})};
    if(name==='@loaders.gl/core')return {load:async()=>[]};
    if(name.startsWith('@loaders.gl/'))return {};
    if(name==='./constants/default-settings')return {MAP_CONFIG_URL:'https://example.invalid/samples.json',LOADING_SAMPLE_ERROR_MESSAGE:'Sample failed',LOADING_SAMPLE_LIST_ERROR_MESSAGE:'List failed'};
    throw new Error(`Unexpected dependency ${name}`);
  }});
  const dispatch=action=>{
    if(typeof action==='function')return action(dispatch,getState);
    events.push(action);
    return action.type==='LOAD_FILES'?new Promise(resolve=>{finishFiles=resolve;}):Promise.resolve();
  };
  return {actions:exports,dispatch,events,finishFiles:()=>finishFiles()};
}
test('remote import retains original file bytes and waits for native loadFiles before clearing loading',async()=>{
  const blob=new Blob(['id,name\n1,Synthetic']); let requests=0;
  const f=actionsFixture({fetch:async()=>{requests++;return {ok:true,blob:async()=>blob};}});
  f.dispatch(f.actions.loadRemoteMap({dataUrl:'https://example.invalid/synthetic.csv'}));
  await turn();
  const imported=f.events.find(e=>e.type==='LOAD_FILES');
  assert.equal(requests,1); assert.equal(imported.files[0].name,'synthetic.csv');
  assert.equal(await imported.files[0].text(),await blob.text());
  assert.deepEqual(f.events.filter(e=>e.type==='SET_SAMPLE_LOADING_STATUS').map(e=>e.isMapLoading),[true]);
  f.finishFiles(); await turn();
  assert.deepEqual(f.events.filter(e=>e.type==='SET_SAMPLE_LOADING_STATUS').map(e=>e.isMapLoading),[true,false]);
});
test('missing remote URL dispatches the existing resource error action without fetching or importing',async()=>{
  let requests=0; const f=actionsFixture({fetch:async()=>{requests++;throw new Error('unexpected');}});
  f.dispatch(f.actions.loadRemoteMap({dataUrl:''})); await turn();
  assert.equal(requests,0); assert.equal(f.events.some(e=>e.type==='LOAD_FILES'),false);
  assert.equal(f.events.at(-1).type,'LOAD_REMOTE_RESOURCE_ERROR');
  assert.equal(f.events.at(-1).error.message,'Missing remote data URL');
});
test('legacy sample routing accepts the current store without an obsolete routing reducer',async()=>{
  const f=actionsFixture(); f.dispatch(f.actions.loadSample({id:'synthetic'})); await turn();
  assert.equal(f.events.find(e=>e.type==='ROUTE').path,'/demo/synthetic');
  const loaded=f.events.find(e=>e.type==='LOAD_REMOTE_RESOURCE_SUCCESS');
  assert.equal(loaded.options.id,'synthetic'); assert.equal(loaded.config,null);
  assert.equal(loaded.response,null); assert.equal(loaded.remoteDatasetConfig,null);
});

// Test the actual reducer/task wiring. Redux/redux-actions are real; SDK
// processors and external ingestion boundaries are explicit controlled doubles.
function reducerFixture() {
  const f=actionsFixture(); const tasks=[]; const processorCalls=[]; const updaterCalls=[];
  const initialMap={visState:{},uiState:{},mapState:{},mapStyle:{},providerState:{}};
  let applicationConfig={plugins:[]};
  const exports={};
  const process=(kind)=>(data)=>{processorCalls.push({kind,data});return {fields:[],rows:[[kind]]};};
  const row=process('rows'),arrow=process('arrow'),geojson=process('geojson');
  vm.runInNewContext(reducerCode,{exports,require(name){
    if(name==='redux'||name==='redux-actions')return require(name);
    if(name==='react-palm/tasks')return {__esModule:true,default:{fromPromise:operation=>input=>({bimap(success,failure){return {run:()=>operation(input).then(success,failure)};}})},withTask:(state,task)=>{tasks.push(task);return state;}};
    if(name==='@kepler.gl/ai-assistant')return {aiAssistantReducer:(state={})=>state};
    if(name==='@kepler.gl/constants')return {EXPORT_MAP_FORMATS:{HTML:'HTML'}};
    if(name==='@kepler.gl/processors')return {processGeojson:geojson,processRowObject:row,processArrowTable:arrow};
    if(name==='@kepler.gl/reducers')return {__esModule:true,default:{initialState:()=>({plugin:()=>((state={map:initialMap})=>state)})},
      combinedUpdaters:{addDataToMapUpdater:(state,action)=>{updaterCalls.push(action.payload);return state;}},
      uiStateUpdaters:{DEFAULT_MAP_CONTROLS:{mapLegend:{}},DEFAULT_EXPORT_MAP:{HTML:{}},addNotificationUpdater:(state,action)=>({...state,notification:action.payload})}};
    if(name==='@kepler.gl/schemas')return {__esModule:true,default:{parseSavedConfig:config=>structuredClone(config.config)}};
    if(name==='@kepler.gl/table')return {KeplerTable:{}};
    if(name==='@kepler.gl/layers')return {LayerClasses:{}};
    if(name==='@kepler.gl/utils')return {getApplicationConfig:()=>applicationConfig};
    if(name==='@kepler.gl/localization')return {LOCALE_CODES:{pt:'pt'}};
    if(name==='../actions')return f.actions;
    if(name==='../constants/default-settings')return {CLOUD_PROVIDERS_CONFIGURATION:{EXPORT_MAPBOX_TOKEN:''}};
    if(name==='../clustering/point-cluster-adaptive-layer.ts')return {};
    if(name==='../utils/strings')return {generateHashId:()=> 'generated'};
    if(name==='./filter-enabled-compatibility.ts')return {reconcileFilterEnabledState:state=>state};
    throw new Error(`Unexpected dependency ${name}`);
  },structuredClone});
  return {...f,reducer:exports.default,tasks,processorCalls,updaterCalls,setTable:table=>{applicationConfig={...applicationConfig,table};}};
}
test('row and Arrow task adapters forward data unchanged and preserve sample map bounds',async()=>{
  for(const shape of ['object-row-table','arrow-table']){
    const f=reducerFixture(); let state=f.reducer(undefined,{type:'INIT'});
    const response={shape,data:shape==='arrow-table'?{batches:[{synthetic:true}]}:[{id:1}]};
    const config={version:'v1',config:{mapState:{minZoom:2,maxZoom:18}}};
    const request=f.actions.loadRemoteResourceSuccess(response,config,{id:'synthetic',dataUrl:'https://example.invalid/data'},null);
    state=f.reducer(state,request); assert.equal(f.tasks.length,1);
    const processed=await f.tasks[0].run();
    assert.equal(f.processorCalls[0].data,shape==='object-row-table'?response.data:response);
    assert.equal(f.processorCalls[0].kind,shape==='object-row-table'?'rows':'arrow');
    state=f.reducer(state,processed);
    assert.equal(f.updaterCalls[0].config.mapState.minZoom,2); assert.equal(f.updaterCalls[0].config.mapState.maxZoom,18);
    assert.equal(f.updaterCalls[0].datasets.info.id,'synthetic'); assert.equal(state.app.isMapLoading,false);
    assert.equal(state.app.currentSample.id,'synthetic');
  }
});
test('custom Arrow processors receive batches and a remote dataset config bypasses processing',async()=>{
  const f=reducerFixture(); const batches=[{synthetic:true}]; let supplied;
  f.setTable({getFileProcessor:data=>{supplied=data;return {processor:async value=>({fields:[],rows:[[value===batches]]})};}});
  const state=f.reducer(undefined,{type:'INIT'});
  f.reducer(state,f.actions.loadRemoteResourceSuccess({shape:'arrow-table',data:{batches}},null,{dataUrl:'https://example.invalid/data'},null));
  const result=await f.tasks[0].run(); assert.equal(supplied,batches); assert.equal(result.payload.datasets.data.rows[0][0],true);
  const config={info:{id:'tiles'},data:{fields:[],rows:[]}};
  f.reducer(state,f.actions.loadRemoteResourceSuccess(null,null,{},config));
  const remote=await f.tasks[1].run(); assert.equal(remote.payload.datasets,config); assert.equal(f.processorCalls.length,0);
  f.reducer(state,remote); assert.equal(f.updaterCalls.at(-1).config,null);
});

test('an Apache Arrow Table reaches the custom processor with its original record batches',async()=>{
  const f=reducerFixture(); const arrow=tableFromArrays({id:[1,2],name:['first','second']}); let received;
  f.setTable({getFileProcessor:batches=>{received=batches;return {processor:async()=>({fields:[],rows:[]})};}});
  const state=f.reducer(undefined,{type:'INIT'});
  f.reducer(state,f.actions.loadRemoteResourceSuccess({shape:'arrow-table',data:arrow},null,{dataUrl:'https://example.invalid/data.arrow'},null));
  assert.equal(received,arrow.batches);
  assert.equal(received[0].numRows,2);
  await f.tasks[0].run();
});

test('malformed Arrow data is rejected before calling the table plugin or scheduling work',()=>{
  for(const data of [null,undefined,'invalid',{}, {batches:null}, {batches:{}}]){
    const f=reducerFixture(); let calls=0;
    f.setTable({getFileProcessor:()=>{calls++;throw new Error('must not run');}});
    const state=f.reducer(undefined,{type:'INIT'});
    assert.throws(()=>f.reducer(state,f.actions.loadRemoteResourceSuccess({shape:'arrow-table',data},null,{dataUrl:'https://example.invalid/data.arrow'},null)),/Remote Arrow table must contain record batches/);
    assert.equal(calls,0); assert.equal(f.tasks.length,0);
    assert.equal(f.processorCalls.length,0); assert.equal(f.updaterCalls.length,0);
  }
});
