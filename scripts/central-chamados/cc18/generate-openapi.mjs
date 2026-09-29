import fs from 'node:fs/promises';
import {discoverRoutes,ROOT} from './route-inventory.mjs';
const routes=await discoverRoutes();
const str=(max)=>({type:'string',...(max?{maxLength:max}:{})}),obj=properties=>({type:'object',properties,additionalProperties:true});
const domain=['map','database','permission','export','support','other'],nature=['question_request','incident','defect','improvement_change','recurring_problem'];
const schemas={
 Envelope:{type:'object',description:'Envelope aditivo; dados variam por operação. A resposta pode conter ticket, state, messages, drafts, sessions, rows ou manifesto. Não inferir propriedades ausentes.',properties:{ok:{type:'boolean'}},additionalProperties:true},
 Error:{type:'object',description:'Erro público sanitizado. Interpretar HTTP e código recebido; nunca exibir detalhes internos do provedor.',additionalProperties:true},
 DomainCommand:{type:'object',description:'Objeto específico do serviço apontado em x-domain-sources. O servidor valida campos/ações e rejeita combinações inválidas; este schema aberto não concede autorização nem permite SQL/shell.',additionalProperties:true},
 TicketCreate:{...obj({subject:str(160),description:str(5000),category:{type:'string',enum:domain},demandNature:{type:'string',enum:nature},expectedResult:str(2000),context:str(2000),impact:{type:'string',enum:['individual','team','organization']},urgency:{type:'string',enum:['flexible','soon','blocked']},priorityReason:str(1000),triageFormVersion:{type:'integer',enum:[1]},triageAnswers:{type:'object',additionalProperties:{type:'string'}},nextAction:str(1000)}),required:['subject','description'],description:'Triagem ativa exige campos estruturados e perguntas da natureza. Comandos ativos exigem Idempotency-Key. Campos legados adicionais continuam sujeitos ao serviço.'},
 Transition:{...obj({status:{type:'string',enum:['open','in_progress','in_review','closed']},reason:str(1000),nextAction:str(1000),closure:obj({outcomeCode:{type:'string',enum:['resolved','answered','fulfilled','rejected','duplicate','withdrawn','no_action']},summary:str(2000),evidence:str(2000),communication:str(2000),pendingChangeAcknowledged:{type:'boolean'}})}),required:['status'],description:'Precondições por origem/destino; fechamento exige closure. Use reabertura separada para closed.'},
 Wait:{...obj({action:{type:'string',enum:['start','end']},reason:str(1000),responsibleId:{type:'integer',minimum:1},nextAction:str(1000),expectedAt:{type:'string',format:'date-time'}}),required:['action','nextAction']},
 Reopen:{...obj({reason:str(1000),nextAction:str(1000)}),required:['reason','nextAction']},
 Message:{...obj({kind:{type:'string',enum:['response','internal']},body:str(),attachmentIds:{type:'array',items:{type:'integer',minimum:1}},draftId:str(),draftVersion:{type:'integer',minimum:1}}),required:['kind','body'],description:'Audiência deriva de kind; uso de draft exige versão e conteúdo coerentes. Permissões de nota são separadas.'},
 ExportCreate:{type:'object',required:['idempotencyKey','from','to','asOf'],additionalProperties:false,properties:{idempotencyKey:{type:'string',pattern:'^[\\w-]{16,100}$'},from:{type:'string',format:'date-time'},to:{type:'string',format:'date-time'},asOf:{type:'string',format:'date-time'},report:{type:'string',enum:['all','backlog','cycles','sla','incidents','causes']},domain:{type:'string',enum:domain},nature:{type:'string',enum:[...nature,'unknown']},definitionVersion:{type:'integer',minimum:0}},description:'from < to <= asOf, sem futuro; janela máxima366 dias. incidents/causes exigem CC13. Corpo até4096 bytes.'},
 ExportRetry:{type:'object',properties:{idempotencyKey:{type:'string',pattern:'^[\\w-]{16,100}$'}},required:['idempotencyKey']},
 NotificationRetry:{type:'object',properties:{outboxId:{type:'string'}},required:['outboxId']},
 FeedbackResponse:{...obj({action:{type:'string',enum:['withdraw']},declined:{type:'boolean'},consent:{type:'boolean'},outcome:str(),effort:{type:'integer',minimum:0},comment:str(2000)}),description:'Retirada usa action=withdraw; recusa declined=true; resposta exige consent=true, outcome/effort válidos no instrumento e comment textual. Corpo até16000 bytes.'}
};
const parameter=(name,loc,description,required=false,schema=str())=>({name,in:loc,description,required,schema});
const hdr=(name,description,required=true)=>parameter(name,'header',description,required);
const ref=name=>({$ref:'#/components/schemas/'+name});
const spec={openapi:'3.0.3',info:{title:'Maõno — Central de Chamados / API interna',version:'cc18-v1',description:'Inventário das rotas de chamados e CR na baseline f17882fe846b05d97e5b81c7d2547e30574715b4. Sessão, vínculo organizacional, capacidades e ACL/audiência são reavaliados pelo servidor. Flags/schema/rollout independentes. Schemas abertos apontam a fonte de domínio; não são permissão para campos arbitrários.'},servers:[{url:'/',description:'Mesmo origin autenticado; não há URL produtiva embutida.'}],security:[{Session:[]}],paths:{},components:{securitySchemes:{Session:{type:'apiKey',in:'cookie',name:'maono_session',description:'Sessão gerenciada pela aplicação; nunca copiar cookie para exemplos/artifacts.'}},schemas}};
for(const r of routes){
 const item={'x-source-file':r.file,'x-source-sha256':r.sourceHash,parameters:[...r.path.matchAll(/\{([^}]+)\}/g)].map(m=>parameter(m[1],'path','Identificador validado no recurso/contexto; não concede acesso.',true))};
 for(const method of r.methods){
  const key=method.toLowerCase(),write=!['GET','HEAD'].includes(method),source=await fs.readFile(ROOT+'/'+r.file,'utf8');
  const op={operationId:key+'_'+r.path.replace(/[^a-zA-Z0-9]+/g,'_'),summary:method+' '+r.path,tags:[r.path.includes('change-requests')?'Change Requests':r.path.includes('ticket-access')?'Acesso':r.path.includes('exports')?'Exportações':r.path.includes('knowledge')?'Conhecimento':r.path.includes('cases')?'Casos':r.path.includes('feedback')?'Feedback':'Chamados'],description:'Implementação: '+r.file+(r.handler?' → '+r.handler:'')+'. '+(write?'Mutação sujeita a capacidades, ACL, readiness, precondições e política de Preview.':'Leitura sujeita a associação/capacidades e ACL; não usar cache compartilhado de conteúdo privado.'),'x-domain-sources':r.dependencies,parameters:[],responses:{default:{description:'Erro público conforme HTTP:400 inválido,401 sessão,403/404 autorização/recurso,409 conflito,412 token antigo,413 limite,415 tipo,428 precondição,429 limite de uso,503 readiness/provedor. Nem todos se aplicam a todas as rotas.',content:{'application/json':{schema:ref('Error')}}}}};
  const binary=r.path.endsWith('/download'),head=method==='HEAD',created=method==='POST'&&(/\/tickets$|\/attachments$|\/drafts$|\/messages$/.test(r.path)),accepted=method==='POST'&&r.path.endsWith('/tickets/exports');
  const status=head?'204':accepted?'202':created?'201':'200';
  op.responses[status]={description:head?'Sessão consultada; sem corpo.':binary?'Conteúdo autorizado; não é URL pública permanente.':'Operação concluída; verificar estado/capabilities no envelope.',...(head?{}:{content:{[binary?'application/octet-stream':'application/json']:{schema:binary?{type:'string',format:'binary'}:ref('Envelope')}}})};
  if(created)op.responses['200']={description:'Replay/resultado persistido quando aplicável, sem duplicar intenção.',content:{'application/json':{schema:ref('Envelope')}}};
  if(method==='GET')for(const [,q]of source.matchAll(/searchParams\.get\(["']([^"']+)["']\)/g))if(!op.parameters.some(x=>x.name===q))op.parameters.push(parameter(q,'query','Filtro/cursor específico do recurso; preservar token opaco.'));
  if(method==='POST'&&(r.path.endsWith('/tickets')||r.path.endsWith('/messages')||r.path.endsWith('/changes')))op.parameters.push(hdr('Idempotency-Key','Chave estável da mesma intenção/payload. Criação core: obrigatória com comandos ativos; header presente exige readiness.',!r.path.endsWith('/tickets')));
  if((method==='PATCH'&&(/\/tickets\/\{ticketId\}$|\/messages\/\{messageId\}$|\/drafts\/\{draftId\}$/.test(r.path)))||(method==='DELETE'&&r.path.includes('/drafts/'))||(method==='POST'&&/\/(transitions|waits|reopen|corrections)$/.test(r.path)))op.parameters.push(hdr('If-Match','Token opaco do recurso canônico; não usar wildcard, lista, token fraco ou derivado de outro recurso.'));
  if(write&&['POST','PUT','PATCH'].includes(method)){
   let schema='DomainCommand';
   if(method==='POST')for(const [suffix,name]of [['/tickets','TicketCreate'],['/transitions','Transition'],['/waits','Wait'],['/reopen','Reopen'],['/messages','Message'],['/tickets/exports','ExportCreate'],['/exports/{exportId}/retry','ExportRetry'],['/ticket-notifications/operations','NotificationRetry'],['/ticket-feedback/{inviteId}','FeedbackResponse']])if(r.path.endsWith(suffix))schema=name;
   const upload=method==='PATCH'&&/\/attachments\/(?:uploads\/\{uploadId\}|\{attachmentId\})$/.test(r.path);
   op.requestBody={required:!r.path.endsWith('/uploads/{uploadId}'),content:{[upload?'application/octet-stream':'application/json']:{schema:upload?{type:'string',format:'binary'}:ref(schema)}}};
   if(r.path.endsWith('/attachments')&&method==='POST'){op.requestBody.content['multipart/form-data']={schema:{type:'object',properties:{file:{type:'string',format:'binary'}}}};op.requestBody.description='JSON inicia reserva/sessão com metadados e contentHash; multipart é legado e é recusado quando resumível está ativo. Limites:5 arquivos,80MiB por arquivo,150MiB/chamado incluindo reservas.';}
  }
  if(r.path.endsWith('/uploads/{uploadId}')){
   if(['PATCH','POST'].includes(method))op.parameters.push(hdr('If-Match','ETag da sessão de upload, separado do token do chamado.'));
   if(method==='PATCH')op.parameters.push(parameter('Upload-Offset','header','Offset confirmado pelo HEAD; chunk de até8MiB.',true,{type:'integer',minimum:0}));
   op.responses[status].headers=Object.fromEntries(['Upload-Offset','Upload-Length','Upload-Expires','ETag'].map(name=>[name,{description:'Estado canônico da sessão após autorização.',schema:{type:'string'}}]));
   if(method==='POST')delete op.requestBody;
  }
  if(r.path.endsWith('/state')&&method==='GET')op.responses['200'].headers={ETag:{description:'ETag forte da representação canônica state; o detalhe não valida o envelope enriquecido.',schema:str()}};
  if(r.path.endsWith('/tickets/metrics')&&method==='GET')op.parameters.push(...['from','to','asOf'].map(n=>parameter(n,'query','Instante ISO; from<to<=asOf, máximo366 dias.',true,{type:'string',format:'date-time'})));
  if(r.handler){const shared=await fs.readFile(ROOT+'/'+r.handler,'utf8');if(method==='GET')for(const [,q]of shared.matchAll(/q\.get\(["']([^"']+)["']\)/g))if(!op.parameters.some(x=>x.name===q))op.parameters.push(parameter(q,'query','Parâmetro do domínio; aplicabilidade depende do recurso.'));}
  item[key]=op;
 }
 spec.paths[r.path]=item;
}
await fs.writeFile(ROOT+'/docs/central-chamados/cc-18/openapi.json',JSON.stringify(spec,null,2)+'\n');
console.log(routes.length+' routes; '+routes.reduce((n,r)=>n+r.methods.length,0)+' operations');
