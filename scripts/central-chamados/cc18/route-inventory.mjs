import {readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const ROOT=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const verbs=['GET','POST','PATCH','PUT','DELETE','HEAD'];
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else if(e.name.endsWith('.js'))out.push(p);}return out;}
export async function discoverRoutes(){
 const files=(await walk(join(ROOT,'functions/api'))).filter(p=>/\/organizations\/\[id\]\/tickets?(?:-|\/|\.js)/.test(p)||/\/projects\/\[slug\]\/change-requests(?:\/|\.js)/.test(p)).sort();
 const rows=[];
 for(const file of files){
  const source=await readFile(file,'utf8'), rel=relative(ROOT,file);let methods=[];let handler=null;
  const factory=source.match(/(?:ticket(?:Export|Case|Knowledge|Feedback)Route)\((?:["']([^"']+)["'])?\)/);
  if(factory){
   const action=factory[1]||'collection',name=factory[0].split('(')[0];
   if(name==='ticketExportRoute'){methods=action==='collection'?['GET','POST']:['cancel','retry'].includes(action)?['POST']:['GET'];handler='ticket-export-http.js';}
   if(name==='ticketCaseRoute'){methods=action==='communicate'?['POST']:['GET','POST'];handler='ticket-case-http.js';}
   if(name==='ticketKnowledgeRoute'){methods=['send','select'].includes(action)?['POST']:['GET','POST'];handler='ticket-knowledge-http.js';}
   if(name==='ticketFeedbackRoute'){methods=['reconcile','response'].includes(action)?['POST']:action==='instrument'?['GET','POST']:['GET'];handler='ticket-feedback-http.js';}
  }else if(source.includes('slaResponse(')){methods=['GET','POST'];handler='ticket-sla-http.js';}
  else methods=verbs.filter(v=>new RegExp(`["']${v}["']`).test(source));
  if(!methods.length)throw Error('Route methods require review: '+rel);
  const dependencies=[...source.matchAll(/from\s+["']([^"']+)["']/g)].map(m=>m[1]).filter(s=>s.startsWith('.')).map(s=>relative(ROOT,resolve(file,'..',s)));
  const handlerPath=handler?'functions/_lib/'+handler:null;
  rows.push({path:'/'+rel.replace(/^functions\//,'').replace(/\.js$/,'').replace(/\[([^\]]+)\]/g,'{$1}'),file:rel,methods:methods.sort(),handler:handlerPath,dependencies,sourceHash:createHash('sha256').update(source+(handler?await readFile(join(ROOT,handlerPath),'utf8'):'')).digest('hex')});
 }
 return rows;
}
