import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source=readFileSync(new URL('../src/pages/Kepler/cloud-providers/foursquare/foursquare-provider.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function fixture({popup=null,responses=[]}={}) {
  const calls=[]; let options; const loginCalls=[];
  class Auth0Client {
    constructor(value) {options=value;}
    async loginWithPopup(...args) {loginCalls.push(args);}
    async getUser() {return {name:'Synthetic',email:'synthetic@example.invalid'};}
    async getTokenSilently() {return 'synthetic-token';}
  }
  const exports={};
  vm.runInNewContext(compiled,{exports,window:{screenX:0,screenY:0,innerWidth:1366,innerHeight:768,location:{origin:'https://app.invalid'},open:()=>popup},fetch:async(url,options)=>{
    calls.push({url,options}); assert.ok(responses.length,'unexpected fetch');
    return {json:async()=>responses.shift()};
  },require(name){
    if(name==='@auth0/auth0-spa-js') return {Auth0Client};
    if(name==='@kepler.gl/cloud-providers') return {Provider:class {constructor(props){Object.assign(this,props);}},KEPLER_FORMAT:'keplergl'};
    if(name==='./foursquare-icon') return ()=>null;
    throw new Error(`Unexpected import ${name}`);
  }});
  const provider=new exports.default({clientId:'synthetic-client',authDomain:'auth.invalid',apiURL:'https://api.invalid',userMapsURL:'https://maps.invalid'});
  return {provider,calls,loginCalls,options};
}
test('Auth0 receives the existing scopes in its supported authorization parameters',async()=>{
  const f=fixture();
  assert.equal(f.options.authorizationParams.scope,'openid profile email');
  assert.equal(f.options.scope,undefined);
  assert.equal(f.options.authorizationParams.audience,'https://foursquare.com/api/');
  assert.equal(f.options.cacheLocation,'localstorage');
  await f.provider.login();
  assert.equal(f.loginCalls[0][1].popup,undefined);
  assert.equal((await f.provider.getUser()).name,'Synthetic');
  assert.equal(f.calls.length,0);
});
test('download preserves the saved map and format while rejecting paths with no map identifier',async()=>{
  const saved={datasets:[],config:{version:'v1'},info:{title:'Synthetic'}};
  const f=fixture({responses:[{latestState:{data:saved}}]});
  await assert.rejects(f.provider.downloadMap({path:'no-map-id'}),error=>error==='No Map id was provider as part of loadParams');
  assert.equal(f.calls.length,0);
  const result=await f.provider.downloadMap({id:'synthetic-map'});
  assert.equal(result.map,saved); assert.equal(result.format,'keplergl');
  assert.equal(f.calls[0].url,'https://api.invalid/v1/maps/synthetic-map');
  assert.equal(f.calls[0].options.headers.Authorization,'Bearer synthetic-token');
});
test('overwrite keeps the remote state metadata, saved-map receipt and skips thumbnail creation',async()=>{
  const map={datasets:[],config:{version:'v1'},info:{title:'Synthetic',description:'',loadParams:{id:'existing'}}};
  const existing={latestState:{id:'state-id',version:7,data:{old:true}}};
  const created={id:'existing',latestState:{data:map}};
  const f=fixture({responses:[existing,created]});
  const result=await f.provider.uploadMap({mapData:{map,thumbnail:null},options:{overwrite:true}});
  assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].options.method,'GET'); assert.equal(f.calls[1].options.method,'PUT');
  const sent=JSON.parse(f.calls[1].options.body);
  assert.equal(sent.latestState.id,'state-id'); assert.equal(sent.latestState.version,7);
  assert.deepEqual(sent.latestState.data,map); assert.equal(result.info.id,'existing');
  assert.equal(result.datasets,map.datasets);
  assert.equal(f.provider.getMapUrl({}),null);
});
