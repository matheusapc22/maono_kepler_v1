import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
async function walk(path) {
  const entries = await readdir(join(root, path), { withFileTypes: true });
  const nested = await Promise.all(entries.map(e => e.isDirectory() ? walk(join(path,e.name)) : [join(path,e.name)]));
  return nested.flat().sort();
}
const tests = await Promise.all((await walk("tests")).filter(p => /\.(?:test\.mjs|spec\.ts)$/.test(p)).map(async file => ({file,source:await readFile(join(root,file),'utf8')})));
const inventory=[];
const routes=await readFile(join(root,'src/Routes.tsx'),'utf8');
for(const match of routes.matchAll(/<Route\s+path="([^"]+)"[\s\S]*?(?=\n\s*<Route|\n\s*<\/Routes>)/g)){
  const block=match[0];
  const components=[...block.matchAll(/<([A-Z]\w+)/g)].map(m=>m[1]).filter(x=>!['Route','WithSuspense'].includes(x));
  inventory.push({type:'Interface',route:match[1],file:'src/Routes.tsx',auth:components.includes('AdminRouteGuard')?'AdminRouteGuard (super_admin)':'Controle da página + endpoint; inventário estático',notes:components.join(', ')});
}
for(const file of (await walk('functions')).filter(p=>p.endsWith('.js'))){
 const source=await readFile(join(root,file),'utf8');
 const isMiddleware=file.endsWith('_middleware.js');
 if(!file.startsWith('functions/api/')&&!isMiddleware)continue;
 const methods=[...source.matchAll(/export\s+(?:async\s+)?function\s+onRequest(Get|Post|Put|Patch|Delete|Head|Options)\b/g)].map(m=>m[1].toUpperCase());
 for(const m of source.matchAll(/(?:request\.method\s*(?:===|!==)\s*|case\s*)["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/g))methods.push(m[1]);
 const handlers=[...new Set(methods)];
 const auth=[...new Set([...source.matchAll(/\b(require\w*(?:Permission|Session|Role|Access)|requirePermission|can|assertProjectPersistenceRoute)\s*\(/g)].map(m=>m[1]))];
 const persistence=[...new Set([...source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z_0-9]*)\b/g)].map(m=>m[1]))];
 const related=tests.filter(t=>t.source.includes(file.replace(/^functions\//,''))||t.source.includes(file.split('/').at(-1))&&file.split('/').at(-1)!=='index.js').map(t=>t.file);
 const route='/'+file.replace(/^functions\//,'').replace(/\/index\.js$/, '').replace(/\.js$/,'').replace(/\[([^\]]+)\]/g,':$1');
 inventory.push({type:isMiddleware?'Middleware':'Endpoint',route:(handlers.join(', ')||'onRequest / dispatcher')+' '+route,file,auth:auth.join(', ')||'Verificar handler/delegação; sem inferência',notes:[persistence.length?'SQL direto: '+persistence.join(', '):'Persistência delegada ou ausente',related.length?'Referência estática em: '+related.join(', '):'Sem referência direta detectada nos testes'].join(' | ')});
}
const persistFiles=['auth','permissions','projects','project-service','project-config-service','project-config-revisions','project-large-creation','project-large-config-save','project-large-legacy-config-save','organization-files','organization-lifecycle','organization-storage','organization-storage-recovery','organization-storage-readiness','organization-limit-service','dropbox','dropbox-client','dropbox-map-config-repository','project-lifecycle','project-change-requests'];
for(const name of persistFiles){
 const file=`functions/_lib/${name}.js`;let source;try{source=await readFile(join(root,file),'utf8');}catch{continue;}
 const tables=[...new Set([...source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z_0-9]*)\b/g)].map(m=>m[1]))];
 const external=[...new Set([...source.matchAll(/\b(?:[A-Za-z]*Dropbox[A-Za-z]*|local_storage_objects)\b/g)].map(m=>m[0]))];
 inventory.push({type:'Persistência / domínio',route:name,file,auth:'Biblioteca chamada pelos handlers; revisar autorização no caller',notes:'SQL: '+(tables.join(', ')||'delegado')+' | Storage: '+(external.slice(0,12).join(', ')||'delegado ou ausente')});
}
const result={baseline:'c0864514605b32ac6ff26605e9b35869ad19ed39',method:'Inventário estático de rotas e referências. Não é medição de cobertura dinâmica nem prova de autorização.',counts:Object.fromEntries([...new Set(inventory.map(x=>x.type))].map(type=>[type,inventory.filter(x=>x.type===type).length])),inventory};
const output=join(root,'docs/audits/reliability-2026-09-19');await mkdir(output,{recursive:true});
await writeFile(join(output,'inventory.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.counts));
