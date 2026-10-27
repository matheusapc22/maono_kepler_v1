import { ManagementError, check, object, integer, text } from './organization-management-contract.js';
import * as service from './organization-management-service.js';

const base = '/api/admin/organization-management';
const headers = { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff' };
function json(value,status=200,requestId) { return new Response(JSON.stringify(value),{status,headers:{...headers,'X-Request-Id':requestId}}); }
async function readBody(request) {
  check(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/json','Use JSON nesta operação.',415,'MANAGEMENT_CONTENT_TYPE');
  check(request.headers.get('Origin')===new URL(request.url).origin && !['cross-site','same-site'].includes(request.headers.get('Sec-Fetch-Site')),'Origem da operação inválida.',403,'MANAGEMENT_ORIGIN_DENIED');
  check(request.headers.get('X-Maono-Management')==='1','Cabeçalho de operação ausente.',403,'MANAGEMENT_ORIGIN_DENIED');
  const reader=request.body?.getReader(); check(reader,'Corpo ausente.'); let size=0; const chunks=[];
  try {
    for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>256*1024) {await reader.cancel(); throw new ManagementError('Requisição excede 256 KiB.',413,'MANAGEMENT_BODY_TOO_LARGE');} chunks.push(value); }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));} catch {throw new ManagementError('JSON inválido.');}
}
/** Auth/lifecycle dependencies are explicitly injected by the Pages adapter.
 * Tests exercise this handler with real SQLite and synthetic authenticated actors. */
export async function handleOrganizationManagement(context,deps) {
  const {env,request}=context, requestId=crypto.randomUUID();
  try {
    const url=new URL(request.url);check(url.pathname===base || url.pathname.startsWith(base+'/'),'Rota inválida.',404);
    const route=url.pathname.slice(base.length).replace(/^\/+|\/+$/g,'').split('/').filter(Boolean);
    const auth=await deps.authorize(env,request,null);const actor=auth.user;
    check(actor && actor.role==='super_admin','A gestão global é restrita ao Super Admin.',403,'MANAGEMENT_SUPER_ADMIN_REQUIRED');
    await service.requireManagementReady(env);
    const bound={...deps,authorizeGlobal:()=>deps.authorize(env,request,null),authorizeOrganization:id=>deps.authorize(env,request,integer(id))};
    const method=request.method;
    check(['GET','POST'].includes(method),'Método não permitido.',405,'METHOD_NOT_ALLOWED');
    const body=method==='POST'?await readBody(request):null;
    let result;
    if(method==='GET' && route.length===1 && route[0]==='organizations') result=await service.workspace(env,request.url,bound);
    else if(method==='GET' && route[0]==='organizations' && route.length>=2 && route.length<=3) {
      const id=integer(route[1]);await bound.authorizeOrganization(id);
      if(route.length===2) result=await service.detail(env,id,bound);
      else if(route[2]==='people') result={people:await service.people(env,id)};
      else if(route[2]==='documents') result=await service.documents(env,id,request.url);
      else if(route[2]==='activity') result=await service.activity(env,id,request.url);
      else throw new ManagementError('Rota não encontrada.',404,'NOT_FOUND');
    } else if(method==='GET' && route.join('/')==='candidates') result={users:await service.candidates(env,request.url)};
    else if(method==='GET' && route.join('/')==='requests') result=await service.requests(env,request.url);
    else if(method==='POST' && route.join('/')==='import/validate') {object(body,['csv']);result=await service.validateImport(env,body.csv);}
    else if(route.join('/')==='operations') {
      result=method==='GET'?{operations:await service.operations(env,actor)}:await service.startOperation(env,actor,request.headers.get('Idempotency-Key'),body);
    } else if(route[0]==='operations' && route.length===2 && method==='GET') result=await service.operation(env,actor,text(route[1],'Operação',1,80));
    else if(route[0]==='operations' && route.length===3 && route[2]==='step' && method==='POST') {
      object(body,['retry']);check(body.retry===undefined || typeof body.retry==='boolean','Retomada inválida.');
      result=await service.stepOperation(env,actor,text(route[1],'Operação',1,80),body.retry===true,bound);
    } else throw new ManagementError('Rota não encontrada.',404,'NOT_FOUND');
    return json({ok:true,...result},200,requestId);
  } catch(e) {
    const status=Number(e.status||e.statusCode)||500;
    const safe=e instanceof ManagementError?e.message:e.publicMessage || (status===401?'Sessão expirada.':status===403?'Acesso negado.':'Não foi possível concluir a operação.');
    return json({ok:false,error:{message:safe,code:e.code||'ORGANIZATION_MANAGEMENT_FAILED',category:status===401||status===403?'PERMISSION':'INFRASTRUCTURE',retryable:e.retryable===true,requestId}},status>=400&&status<600?status:500,requestId);
  }
}
