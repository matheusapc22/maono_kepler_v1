import {readFile,access,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {discoverRoutes,ROOT} from './route-inventory.mjs';

export async function validateDocs(){
 const directory=resolve(ROOT,'docs/central-chamados/cc-18'),issues=[];
 const spec=JSON.parse(await readFile(resolve(directory,'openapi.json'),'utf8'));
 const routes=await discoverRoutes();const documented=Object.keys(spec.paths).sort();
 if(JSON.stringify(documented)!==JSON.stringify(routes.map(r=>r.path).sort()))issues.push('API route coverage drift');
 for(const route of routes){
  const item=spec.paths[route.path];
  if(!item)continue;
  const methods=Object.keys(item).filter(x=>['get','post','put','patch','delete','head'].includes(x)).map(x=>x.toUpperCase()).sort();
  if(JSON.stringify(methods)!==JSON.stringify(route.methods))issues.push(route.path+': method drift');
  if(item['x-source-sha256']!==route.sourceHash)issues.push(route.path+': source changed; review contract');
 }
 const matrix=JSON.parse(await readFile(resolve(directory,'traceability.json'),'utf8'));
 for(const[k,prefix,count]of [['requirements','REQ-CC-',40],['tests','CT-',60]]){
  const expected=Array.from({length:count},(_,i)=>prefix+String(i+1).padStart(2,'0'));
  if(matrix[k].length!==count||expected.some(id=>matrix[k].filter(r=>r.id===id).length!==1))issues.push(k+': missing/duplicate ID');
 }
 for(const r of matrix.requirements){if(!r.tests.length||r.tests.some(id=>!matrix.tests.some(t=>t.id===id&&t.requirements.includes(r.id))))issues.push(r.id+': test linkage mismatch');}
 for(const t of matrix.tests){if(t.requirements.some(id=>!matrix.requirements.some(r=>r.id===id&&r.tests.includes(t.id))))issues.push(t.id+': requirement linkage mismatch');}
 for(const file of await readdir(directory))if(file.endsWith('.md')){
  const content=await readFile(resolve(directory,file),'utf8');
  for(const [,href]of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){
   if(/^https:\/\//.test(href)||href.startsWith('#'))continue;
   try{await access(resolve(directory,href.split('#')[0]));}catch{issues.push(file+': missing link '+href);}
  }
 }
 return {routes:routes.length,operations:routes.reduce((n,r)=>n+r.methods.length,0),requirements:matrix.requirements.length,tests:matrix.tests.length,issues};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const {default:SwaggerParser}=await import('@apidevtools/swagger-parser');
  await SwaggerParser.validate(resolve(ROOT,'docs/central-chamados/cc-18/openapi.json'),{resolve:{external:false}});
  const result=await validateDocs();console.log(JSON.stringify(result,null,2));process.exitCode=result.issues.length?1:0;
 }catch(error){console.error('CC18_DOC_CONTRACT_FAILED:',error.message);process.exitCode=2;}
}
