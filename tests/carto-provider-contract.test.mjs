import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const NativeProvider = require(fileURLToPath(new URL('../node_modules/@kepler.gl/cloud-providers/dist/provider.js', import.meta.url))).default;
const source = readFileSync(new URL('../src/pages/Kepler/cloud-providers/carto/carto-provider.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const record = (extra = {}) => ({id:'map-1',name:'Synthetic map',description:'Description',thumbnail:null,isprivate:true,config:'{"version":"v1"}',lastmodified:'2026-10-27T10:00:00Z',...extra});
const mapData = () => ({map:{datasets:[{version:'v1',data:{id:'synthetic-dataset',allData:[[1,'two']],fields:[{name:'number',type:'integer'},{name:'label',type:'string'}]}}],config:{version:'v1',config:{}},info:{title:'Synthetic map',description:'Description'}},thumbnail:null});

// Execute the real adapter and actual Kepler Provider base. OAuth, storage,
// FileReader and CSV SDK boundaries are controlled; no account or network login.
function fixture(...clientArgs) {
  const clientId = clientArgs.length ? clientArgs[0] : 'synthetic-client';
  const state = {calls:[],logs:[],writes:[],reads:[],clientIds:[],csvCalls:[],containers:[],username:'owner',expired:false,token:'synthetic-token',receipt:record(),visualization:{vis:record(),datasets:[{name:'table',file:'value\n1'}]},visualizations:[],csvResult:'number,label\n1,two',readerResult:'data:image/png;base64,c3ludGhldGlj',readerError:null};
  const storage = {
    async updateVisualization(...args) {assert.equal(this,storage);state.writes.push({operation:'update',args});if(state.writeError)throw state.writeError;return state.receipt;},
    async createVisualization(...args) {assert.equal(this,storage);state.writes.push({operation:'create',args});if(state.writeError)throw state.writeError;return state.receipt;},
    async getVisualization(id) {state.reads.push({operation:'private',id});if(state.readError)throw state.readError;return state.visualization;},
    async getVisualizations() {state.calls.push('list');if(state.listError)throw state.listError;return state.visualizations;},
  };
  const oauth = {
    get expired(){return state.expired;},get token(){return state.token;},
    clear(){state.calls.push('clear');if(state.clearError)throw state.clearError;state.token=null;},
    client:{provider(name){assert.equal(name,'carto');state.calls.push('provider');return {sync(){state.calls.push('sync');if(state.syncError)throw state.syncError;}};}},
  };
  class OAuthApp {
    constructor(...args){state.constructorArgs=args;this.PublicStorageReader={getVisualization:async(owner,id)=>{state.reads.push({operation:'public',owner,id});if(state.readError)throw state.readError;return state.visualization;}};}
    setClientID(id){state.clientIds.push(id);}
    get username(){if(state.usernameError)throw state.usernameError;return state.username;}
    get oauth(){if(state.oauthError)throw state.oauthError;return oauth;}
    login(){state.calls.push('login');return state.loginImpl ? state.loginImpl() : Promise.resolve();}
    async getCustomStorage(){state.calls.push('storage');if(state.storageError)throw state.storageError;return storage;}
  }
  class Reader {
    error=null;result=null;onloadend=null;
    readAsDataURL(blob){state.readerBlob=blob;if(state.readerThrow)throw state.readerThrow;this.error=state.readerError;this.result=state.readerResult;queueMicrotask(()=>this.onloadend());}
  }
  const exports = {};
  vm.runInNewContext(compiled,{exports,FileReader:Reader,window:{location:{protocol:'https:',host:'app.invalid'}},require(name){
    if(name==='@carto/toolkit')return {OAuthApp};
    if(name==='global/console')return {error:message=>state.logs.push(message)};
    if(name==='./carto-icon')return ()=>null;
    if(name==='@kepler.gl/cloud-providers')return {Provider:NativeProvider};
    if(name==='@kepler.gl/utils')return {createDataContainer(rows){const container={rows};state.containers.push(container);return container;}};
    if(name==='@kepler.gl/reducers')return {formatCsv:function(container,fields){assert.equal(this,undefined);state.csvCalls.push({container,fields});if(state.csvError)throw state.csvError;return state.csvResult;}};
    throw new Error(`Unexpected import ${name}`);
  }});
  return {provider:new exports.default(clientId),Provider:exports.default,state};
}

test('preserves the actual Provider prototype, OAuth options and undefined-client no-op',()=>{
  for(const clientId of ['synthetic-client',undefined]){
    const f=fixture(clientId);assert.ok(f.provider instanceof NativeProvider);assert.equal(Object.getPrototypeOf(f.Provider),NativeProvider);
    assert.deepEqual(plain(f.state.constructorArgs),[{authorization:'https://carto.com/oauth2',scopes:'schemas:c datasets:rw:*'},{serverUrlTemplate:'https://{user}.carto.com/',namespace:'keplergl'}]);
    assert.deepEqual(f.state.clientIds,clientId===undefined?[]:[clientId]);
    assert.equal(f.provider.name,'carto');assert.equal(f.provider.hasPrivateStorage(),true);assert.equal(f.provider.hasSharingUrl(),true);
    assert.deepEqual(plain(f.provider.thumbnail),{width:300,height:200});assert.equal(typeof f.provider.getFileConflictError,'function');
  }
});

test('login waits for OAuth before callback and returns the authenticated user to the consumer',async()=>{
  const f=fixture();let release;let settled=false;const callbacks=[];
  f.state.loginImpl=()=>new Promise(resolve=>{release=()=>{f.state.username='authenticated';resolve();};});
  const pending=f.provider.login(name=>callbacks.push(name)).then(value=>{settled=true;return value;});
  await Promise.resolve();assert.equal(settled,false);assert.equal(callbacks.length,0);
  release();assert.deepEqual(plain(await pending),{name:'authenticated',abbreviated:'',email:''});assert.deepEqual(callbacks,['carto']);
  assert.equal((await fixture().provider.login()).name,'owner');
});

test('login propagates synchronous, asynchronous, callback and user-read failures without raw logs',async()=>{
  for(const stage of ['sync','async','callback','user']){
    const f=fixture();const failure=new Error('synthetic-secret-token: login failed');
    if(stage==='sync')f.state.loginImpl=()=>{throw failure;};
    if(stage==='async')f.state.loginImpl=()=>Promise.reject(failure);
    if(stage==='user')f.provider.getUser=async()=>{throw failure;};
    await assert.rejects(f.provider.login(stage==='callback'?()=>{throw failure;}:undefined),e=>e.message===failure.message);
    assert.deepEqual(f.state.logs,['CARTO provider operation failed']);assert.equal(f.state.writes.length,0);
  }
});

test('logout returns a promise, preserves clear/sync order and permits no callback',async()=>{
  for(const callback of [false,true]){
    const f=fixture();const result=f.provider.logout(callback?()=>f.state.calls.push('callback'):undefined);
    assert.equal(typeof result.then,'function');await result;
    assert.deepEqual(f.state.calls,callback?['clear','provider','sync','callback']:['clear','provider','sync']);assert.equal(f.state.token,null);
  }
});

test('logout rejects each failure without running later steps',async()=>{
  for(const stage of ['clear','sync','callback']){
    const f=fixture();const error=new Error(`${stage} failed`);
    if(stage!=='callback')f.state[stage+'Error']=error;
    await assert.rejects(f.provider.logout(()=>{f.state.calls.push('callback');if(stage==='callback')throw error;}),e=>e.message===error.message);
    assert.deepEqual(f.state.calls,stage==='clear'?['clear']:stage==='sync'?['clear','provider','sync']:['clear','provider','sync','callback']);
  }
});

test('upload rejects malformed maps, missing overwrite target and missing owner before storage',async()=>{
  const malformed=[undefined,{}, {...mapData(),map:null}];
  for(const patch of [{datasets:null},{info:null},{info:{title:1,description:''}},{info:{title:'ok',description:null}},{config:null}])malformed.push({...mapData(),map:{...mapData().map,...patch}});
  for(const input of malformed){const f=fixture();await assert.rejects(f.provider.uploadMap({mapData:input,options:{overwrite:false}}),/Invalid CARTO map data/);assert.equal(f.state.calls.length,0);assert.equal(f.state.writes.length,0);}
  const f=fixture();await assert.rejects(f.provider.uploadMap({mapData:mapData()}),/No current CARTO map/);assert.equal(f.state.calls.length,0);
  f.state.username=null;await assert.rejects(f.provider.uploadMap({mapData:mapData(),options:{overwrite:false}}),/No authenticated CARTO map owner/);assert.equal(f.state.calls.length,0);
});

test('create preserves dataset conversion, share-name rules and privacy from the validated receipt',async()=>{
  const f=fixture();const data=mapData();data.map.info.title='keplergl_abc123.json';
  const result=await f.provider.uploadMap({mapData:data,options:{overwrite:false,isPublic:false}});
  assert.equal(f.state.writes.length,1);const write=f.state.writes[0];assert.equal(write.operation,'create');
  assert.deepEqual(plain(write.args[0]),{name:'sharedmap_abc123',description:'Description',thumbnail:null,config:JSON.stringify(data.map.config),isprivate:true});assert.equal(write.args[2],true);
  assert.deepEqual(plain(write.args[1]),[{name:'synthetic-dataset',columns:[{name:'number',type:'integer'},{name:'label',type:'string'}],file:'number,label\n1,two'}]);
  assert.notEqual(f.state.containers[0].rows,data.map.datasets[0].data.allData);assert.equal(f.state.containers[0].rows[0],data.map.datasets[0].data.allData[0]);
  assert.equal(f.state.csvCalls[0].fields,data.map.datasets[0].data.fields);assert.equal(f.provider.currentMap,f.state.receipt);
  assert.equal(new URL(result.shareUrl).searchParams.get('privateMap'),'true');assert.equal(result.folderLink,'https://owner.carto.com/dashboard/maps/external');
});

test('overwrite preserves stored privacy even when isPublic defaults to true',async()=>{
  const f=fixture();f.provider.currentMap=record({id:'existing',isprivate:true});f.state.receipt=record({id:'existing',isprivate:true});
  const response=await f.provider.uploadMap({mapData:mapData()});
  assert.equal(f.state.writes[0].operation,'update');assert.equal(f.state.writes[0].args[0].id,'existing');assert.equal(f.state.writes[0].args[0].isprivate,true);
  assert.equal(new URL(response.shareUrl).searchParams.get('privateMap'),'true');assert.equal(f.provider.currentMap,f.state.receipt);
});

test('public create uses the existing isPublic default and accepts nullable description receipts',async()=>{
  const f=fixture();f.state.receipt=record({isprivate:false,description:null});
  const response=await f.provider.uploadMap({mapData:mapData(),options:{overwrite:false}});
  assert.equal(f.state.writes[0].args[0].isprivate,false);assert.equal(new URL(response.shareUrl).searchParams.get('privateMap'),'false');assert.equal(f.provider.currentMap.description,null);
});

test('null or malformed storage receipts never replace the prior map',async()=>{
  const invalid=[null,undefined,{},...Object.entries({id:'',name:1,description:{},thumbnail:[],isprivate:'true',config:{},lastmodified:null}).map(([key,value])=>record({[key]:value}))];
  for(const receipt of invalid){const f=fixture();const previous=record();f.provider.currentMap=previous;f.state.receipt=receipt;
    await assert.rejects(f.provider.uploadMap({mapData:mapData()}),/Invalid CARTO visualization response/);assert.equal(f.provider.currentMap,previous);assert.equal(f.state.writes.length,1);
  }
});

test('storage acquisition/write failures retain current map and do not log the remote message',async()=>{
  for(const stage of ['storage','write']){const f=fixture();const previous=record();f.provider.currentMap=previous;f.state[stage+'Error']=new Error('synthetic-private-SQL');
    await assert.rejects(f.provider.uploadMap({mapData:mapData()}),/synthetic-private-SQL/);assert.equal(f.provider.currentMap,previous);assert.deepEqual(f.state.logs,['CARTO provider operation failed']);
  }
});

test('dataset field and CSV-return validation fail before storage',async()=>{
  const f=fixture();const data=mapData();data.map.datasets[0].data.fields=[null];
  await assert.rejects(f.provider.uploadMap({mapData:data,options:{overwrite:false}}),/Invalid CARTO dataset field/);assert.equal(f.state.calls.length,0);
  for(const invalid of [null,undefined,{},1]){const f=fixture();f.state.csvResult=invalid;await assert.rejects(f.provider.uploadMap({mapData:mapData(),options:{overwrite:false}}),/Invalid CARTO dataset CSV/);assert.equal(f.state.calls.length,0);}
});

test('thumbnail success and each FileReader failure settle the promise',async()=>{
  const f=fixture();const blob=new Blob(['synthetic']);assert.equal(await f.provider._blobToBase64(blob),f.state.readerResult);assert.equal(f.state.readerBlob,blob);
  for(const invalid of [null,undefined,new ArrayBuffer(2)]){const f=fixture();f.state.readerResult=invalid;await assert.rejects(f.provider._blobToBase64(blob),/Invalid CARTO thumbnail data URL/);}
  for(const field of ['readerError','readerThrow']){const f=fixture();const error=new Error('read failed');f.state[field]=error;await assert.rejects(f.provider._blobToBase64(blob),e=>e===error);}
});

test('upload includes the thumbnail string and does not write after a reader failure',async()=>{
  const f=fixture();const data={...mapData(),thumbnail:new Blob(['synthetic'])};await f.provider.uploadMap({mapData:data,options:{overwrite:false}});assert.equal(f.state.writes[0].args[0].thumbnail,f.state.readerResult);
  const denied=fixture();denied.state.readerResult=null;await assert.rejects(denied.provider.uploadMap({mapData:data,options:{overwrite:false}}),/thumbnail/);assert.equal(denied.state.writes.length,0);
});

test('private download normalizes strings/booleans and requires matching authenticated owner',async()=>{
  for(const flag of [true,' TRUE ','true']){const f=fixture();const response=await f.provider.downloadMap({owner:'owner',mapId:'map-1',privateMap:flag});
    assert.deepEqual(f.state.calls,['login','storage']);assert.deepEqual(f.state.reads,[{operation:'private',id:'map-1'}]);assert.equal(response.format,'csv');assert.equal(response.map.config,f.state.visualization.vis.config);assert.equal(f.provider.currentMap,f.state.visualization.vis);
  }
  const f=fixture();f.state.username='different';await assert.rejects(f.provider.downloadMap({owner:'owner',mapId:'map-1',privateMap:true}),/Can't find map/);assert.deepEqual(f.state.calls,['login']);assert.equal(f.state.reads.length,0);assert.equal(f.provider.currentMap,null);
});

test('public download uses only the public reader and retains only textual dataset descriptions',async()=>{
  for(const flag of [false,' FALSE ','false']){const f=fixture();f.state.visualization.datasets=[{name:'text',file:'a',description:'kept'},{name:'other',file:'b',description:123}];
    const response=await f.provider.downloadMap({owner:'owner',mapId:'map-1',privateMap:flag});assert.deepEqual(f.state.calls,[]);assert.deepEqual(f.state.reads,[{operation:'public',owner:'owner',id:'map-1'}]);assert.equal(response.map.datasets[0].info.description,'kept');assert.equal(response.map.datasets[1].info.description,undefined);assert.equal(response.map.datasets[0].data,'a');
  }
});

test('missing identifiers do no I/O; ambiguous privacy never falls back to public storage',async()=>{
  for(const params of [{},{owner:'owner'},{mapId:'map-1'}]){const f=fixture();assert.equal(await f.provider.downloadMap(params),undefined);assert.equal(f.state.calls.length,0);assert.equal(f.state.reads.length,0);}
  for(const flag of [undefined,null,'','yes',0,{},'true&privateMap=false']){const f=fixture();await assert.rejects(f.provider.downloadMap({owner:'owner',mapId:'map-1',privateMap:flag}),/Invalid CARTO map privacy flag/);assert.equal(f.state.calls.length,0);assert.equal(f.state.reads.length,0);}
});

test('download login/read/missing/malformed responses reject and preserve the prior visualization',async()=>{
  for(const stage of ['login','read','missing','malformed']){const f=fixture();const previous=record();f.provider.currentMap=previous;
    if(stage==='login')f.state.loginImpl=()=>Promise.reject(new Error('login failed'));
    if(stage==='read')f.state.readError=new Error('read failed');
    if(stage==='missing')f.state.visualization=null;
    if(stage==='malformed')f.state.visualization.vis={};
    await assert.rejects(f.provider.downloadMap({owner:'owner',mapId:'map-1',privateMap:true}));assert.equal(f.provider.currentMap,previous);
  }
});

test('map URL APIs retain the record privacy, support both signatures and encode query values',()=>{
  const f=fixture();assert.equal(f.provider.getMapUrl(),undefined);f.provider.currentMap=record({id:'map&privateMap=false',isprivate:true});f.state.username='owner&extra=1';
  const current=new URL(f.provider.getMapUrl());assert.equal(current.searchParams.get('mapId'),'map&privateMap=false');assert.equal(current.searchParams.get('owner'),'owner&extra=1');assert.equal(current.searchParams.get('privateMap'),'true');assert.equal(current.searchParams.has('extra'),false);
  const params={mapId:'selected',owner:'someone',privateMap:' FALSE '};assert.equal(f.provider.getMapUrl(params),'https://app.invalid/demo/map/carto?mapId=selected&owner=someone&privateMap=false');
  assert.equal(f.provider.getMapUrl(false,params),'/demo/map/carto?mapId=selected&owner=someone&privateMap=false');assert.ok(f.provider.getShareUrl().startsWith('/demo/map/carto?'));assert.ok(f.provider.getShareUrl(true).startsWith('https://app.invalid/'));
  assert.throws(()=>f.provider.getMapUrl({mapId:'a',owner:'b',privateMap:'unknown'}),/privacy flag/);
});

test('management/user/token access preserves missing and expired states without raw error logs',async()=>{
  const f=fixture();assert.equal(await f.provider.getAccessToken(),'synthetic-token');assert.equal(f.provider.getUserName(),'owner');assert.equal(f.provider.getManagementUrl(),'https://owner.carto.com/dashboard/maps/external');
  f.state.expired=true;assert.equal(await f.provider.getAccessToken(),null);assert.equal(f.provider.getUserName(),null);
  f.state.username=null;assert.equal(f.provider.getManagementUrl(),'');
  f.state.oauthError=new Error('synthetic-token unavailable');assert.equal(await f.provider.getAccessToken(),null);assert.equal(f.provider.getUserName(),null);assert.ok(f.state.logs.every(message=>!message.includes('synthetic-token')));
});

test('listMaps retains metadata/load parameters and sorts by numeric descending timestamps',async()=>{
  const f=fixture();f.state.visualizations=[record({id:'old',lastmodified:'2026-01-01',thumbnail:'undefined',isprivate:false}),record({id:'new',lastmodified:'2026-10-27'})];
  const result=await f.provider.listMaps();assert.deepEqual(plain(result.map(item=>item.id)),['new','old']);assert.equal(result[1].thumbnail,null);assert.deepEqual(plain(result[1].loadParams),{owner:'owner',mapId:'old',privateMap:'false'});assert.equal(result[0].lastModification.getTime(),Date.parse('2026-10-27'));
  f.state.listError=new Error('list failure');await assert.rejects(f.provider.listMaps(),/list failure/);
});

test('known error translations remain, unknown messages are not printed, and nonthrowing access is explicit',()=>{
  const cases=[['No client ID has been specified','No client ID has been specified'],['Cannot set the client ID more than once','Cannot set the client ID more than once'],['relation "example" does not exist','Custom storage is not properly initialized'],['Failed to copy to keplergl_example: Too many retries',"Failed to upload. You've exceeded the number of datasets allowed with your plan. Consider upgrading your plan."],['Synthetic: DB Quota exceeded',"Failed to upload. You've exceeded your account's disk storage limit. Consider upgrading your plan."],['','']];
  for(const [input,expected] of cases){const f=fixture();assert.throws(()=>f.provider._manageErrors(new Error(input)),e=>e.message===expected);}
  const f=fixture();assert.throws(()=>f.provider._manageErrors(null),/General error/);assert.doesNotThrow(()=>f.provider._manageErrors(new Error('synthetic-secret'),false));assert.ok(f.state.logs.every(message=>!message.includes('synthetic-secret')));
});
