import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/organization-management-fixture.mjs';
import {parseImportCsv,queryInput,changeInput,createInput,requestHash,safeCsvCell} from '../functions/_lib/organization-management-contract.js';
import * as service from '../functions/_lib/organization-management-service.js';
const payload={name:'Nova',slug:'nova',description:'Teste',plan:'free',ownerEmail:'owner@example.test'};
const withDb=(name,fn)=>test(name,async()=>{const f=fixture();try{await fn(f);}finally{f.close();}});
const start=(f,kind,items,key=crypto.randomUUID())=>service.startOperation(f.env,f.actor,key,{kind,items});
const step=(f,op,retry=false)=>service.stepOperation(f.env,f.actor,op.id,retry,f.deps);

withDb('totais globais deduplicam pessoas e excluem lixo/expurgos',async f=>{const out=await service.workspace(f.env,'https://qa.test/?page=1&size=10',f.deps);assert.equal(out.summary.organizations,3);assert.equal(out.summary.active,2);assert.equal(out.summary.users,2);assert.equal(out.summary.files,2);assert.equal(out.summary.requests,2);assert.equal(out.organizations.find(o=>o.id===1).userCount,2);assert.equal(out.organizations.find(o=>o.id===2).userCount,1);assert.equal(f.storageCalls,0);});
withDb('filtros não alteram o escopo global dos indicadores',async f=>{const out=await service.workspace(f.env,'https://qa.test/?q=Alfa&status=active&size=10',f.deps);assert.equal(out.pagination.total,1);assert.equal(out.summary.organizations,3);assert.equal(out.organizations[0].slug,'alfa');});
withDb('paginação é limitada e página alta é ajustada',async f=>{for(let i=4;i<=30;i++)f.sqlite.prepare('INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(?,?,?,?)').run(i,`O ${i}`,`o-${i}`,`/projects/o-${i}`);const out=await service.workspace(f.env,'https://qa.test/?page=999&size=10',f.deps);assert.equal(out.pagination.page,3);assert.equal(out.organizations.length,10);});
withDb('busca parametrizada não transforma wildcard em seleção total',async f=>{const out=await service.workspace(f.env,'https://qa.test/?q=%25',f.deps);assert.equal(out.pagination.total,0);});
withDb('consulta não grava eventos ou operações',async f=>{await service.workspace(f.env,'https://qa.test/',f.deps);await service.detail(f.env,1,f.deps);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_management_events').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n,0);});
withDb('quantidade de statements da listagem não cresce por organização',async f=>{let n=f.queryCount;await service.workspace(f.env,'https://qa.test/',f.deps);const small=f.queryCount-n;for(let i=4;i<=500;i++)f.sqlite.prepare('INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(?,?,?,?)').run(i,`O${i}`,`o-${i}`,`/projects/o-${i}`);n=f.queryCount;await service.workspace(f.env,'https://qa.test/',f.deps);assert.equal(f.queryCount-n,small);});
withDb('criação liga responsável sem promover papel global',async f=>{const op=await start(f,'create',[payload]);const result=await step(f,op);assert.equal(result.items[0].state,'succeeded');const row=f.sqlite.prepare('SELECT * FROM organizations WHERE slug=?').get(payload.slug);assert.equal(row.management_owner_id,2);assert.equal(row.project_limit,null);assert.equal(f.sqlite.prepare('SELECT role FROM users WHERE id=2').get().role,'owner');assert.equal(f.sqlite.prepare('SELECT access_level FROM organization_users WHERE organization_id=? AND user_id=2').get(row.id).access_level,'owner');});
withDb('chave idempotente reproduz a mesma operação',async f=>{const key=crypto.randomUUID();const a=await start(f,'create',[payload],key);await step(f,a);const b=await start(f,'create',[payload],key);assert.equal(a.id,b.id);await step(f,b);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM organizations WHERE slug='nova'").get().n,1);});
withDb('reuso da chave com payload diferente é rejeitado',async f=>{const key=crypto.randomUUID();await start(f,'create',[payload],key);await assert.rejects(start(f,'create',[{...payload,name:'Outro'}],key),e=>e.status===409);});
withDb('falha externa retorna parcial e retomada reutiliza ID',async f=>{f.env.testStorageFailure=true;const op=await start(f,'create',[payload]);let result=await step(f,op);assert.equal(result.items[0].state,'partial');const id=result.items[0].result.id;f.env.testStorageFailure=false;result=await step(f,op,true);assert.equal(result.items[0].state,'succeeded');assert.equal(result.items[0].result.id,id);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM organizations WHERE slug='nova'").get().n,1);});
withDb('criação não persiste se quota exigida está desligada',async f=>{f.env.PROJECT_QUOTA_RESERVATION_V1='false';const op=await start(f,'create',[payload]);const out=await step(f,op);assert.equal(out.items[0].code,'PROJECT_QUOTA_REQUIRED');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM organizations WHERE slug='nova'").get().n,0);});
withDb('não permite responsável inexistente ou inativo',async f=>{const op=await start(f,'create',[{...payload,ownerEmail:'inativo@example.test'}]);const out=await step(f,op);assert.equal(out.items[0].state,'failed');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organizations').get().n,3);});
withDb('pausa preserva vínculos, projetos e arquivos',async f=>{const before={members:f.sqlite.prepare('SELECT COUNT(*) n FROM organization_users').get().n,files:f.sqlite.prepare('SELECT COUNT(*) n FROM organization_files WHERE active=1').get().n,projects:f.sqlite.prepare('SELECT COUNT(*) n FROM projects WHERE active=1').get().n};const op=await start(f,'pause',[{id:1,version:0,reason:'Pausa autorizada'}]);assert.equal((await step(f,op)).items[0].state,'succeeded');assert.equal(f.sqlite.prepare('SELECT active FROM organizations WHERE id=1').get().active,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_users').get().n,before.members);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_files WHERE active=1').get().n,before.files);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM projects WHERE active=1').get().n,before.projects);});
withDb('versão antiga não sobrescreve cadastro',async f=>{const first=await start(f,'change',[{id:1,version:0,name:'Nome novo',reason:'Correção cadastral'}]);await step(f,first);const second=await start(f,'change',[{id:1,version:0,name:'Nome antigo',reason:'Edição concorrente'}]);const out=await step(f,second);assert.equal(out.items[0].code,'ORGANIZATION_VERSION_CONFLICT');assert.equal(f.sqlite.prepare('SELECT name FROM organizations WHERE id=1').get().name,'Nome novo');});
withDb('escrita legada invalida a versão sem atribuir ator errado',async f=>{f.sqlite.prepare("UPDATE organizations SET name='Legado' WHERE id=1").run();assert.equal(f.sqlite.prepare('SELECT management_version FROM organizations WHERE id=1').get().management_version,1);const e=f.sqlite.prepare('SELECT * FROM organization_management_events').get();assert.equal(e.actor_id,null);assert.equal(e.action,'organization.legacy_updated');});
withDb('política considera uso e reservas e não grava downgrade inválido',async f=>{f.sqlite.prepare("INSERT INTO organization_resource_reservations(organization_id,status,expires_at) VALUES(1,'RESERVED','2099-01-01T00:00:00Z')").run();const op=await start(f,'change',[{id:1,version:0,projectLimit:2,reason:'Redução solicitada'}]);const out=await step(f,op);assert.equal(out.items[0].code,'ORGANIZATION_LIMIT_BELOW_USAGE');assert.equal(f.sqlite.prepare('SELECT project_limit FROM organizations WHERE id=1').get().project_limit,null);});
withDb('quota gravada protege reserva com limite antigo',async f=>{const op=await start(f,'change',[{id:1,version:0,plan:'free',projectLimit:2,reason:'Limite revisado'}]);assert.equal((await step(f,op)).items[0].state,'succeeded');assert.throws(()=>f.sqlite.prepare("INSERT INTO organization_resource_reservations(organization_id,status,expires_at) VALUES(1,'RESERVED','2099-01-01T00:00:00Z')").run(),/ORGANIZATION_PROJECT_LIMIT_REACHED/);});
withDb('responsável deve pertencer à organização como owner',async f=>{const op=await start(f,'change',[{id:1,version:0,ownerId:4,reason:'Troca solicitada'}]);assert.equal((await step(f,op)).items[0].code,'ORGANIZATION_OWNER_INELIGIBLE');});
withDb('responsável designado não pode perder vínculo ou ser inativado',async f=>{const op=await start(f,'change',[{id:1,version:0,ownerId:2,reason:'Designação principal'}]);assert.equal((await step(f,op)).items[0].state,'succeeded');assert.throws(()=>f.sqlite.prepare('DELETE FROM organization_users WHERE organization_id=1 AND user_id=2').run(),/REASSIGN/);assert.throws(()=>f.sqlite.prepare('UPDATE users SET active=0 WHERE id=2').run(),/REASSIGN/);});
withDb('recusa registra decisão sem alterar política',async f=>{const op=await start(f,'review',[{id:2,version:0,organizationVersion:0,decision:'rejected',reason:'Solicitação recusada',projectLimit:null}]);const out=await step(f,op);assert.equal(out.items[0].state,'succeeded');assert.equal(f.sqlite.prepare('SELECT status FROM organization_limit_requests WHERE id=2').get().status,'rejected');assert.equal(f.sqlite.prepare('SELECT project_limit FROM organizations WHERE id=1').get().project_limit,null);});
withDb('aprovação grava decisão, política e auditoria juntas',async f=>{const op=await start(f,'review',[{id:1,version:0,organizationVersion:0,decision:'approved',reason:'Capacidade aprovada',projectLimit:10}]);assert.equal((await step(f,op)).items[0].state,'succeeded');assert.equal(f.sqlite.prepare('SELECT status FROM organization_limit_requests WHERE id=1').get().status,'approved');assert.equal(f.sqlite.prepare('SELECT project_limit FROM organizations WHERE id=1').get().project_limit,10);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM organization_management_events WHERE action='organization.request_approved'").get().n,1);});
withDb('aprovação repetida não aplica novamente',async f=>{const item={id:1,version:0,organizationVersion:0,decision:'approved',reason:'Capacidade aprovada',projectLimit:10};await step(f,await start(f,'review',[item]));const second=await step(f,await start(f,'review',[item]));assert.equal(second.items[0].code,'REQUEST_VERSION_CONFLICT');assert.equal(f.sqlite.prepare('SELECT management_version FROM organizations WHERE id=1').get().management_version,1);});
withDb('tipos não operacionais não recebem aprovação fictícia',async f=>{const out=await step(f,await start(f,'review',[{id:2,version:0,organizationVersion:0,decision:'approved',reason:'Pedido revisado',projectLimit:10}]));assert.equal(out.items[0].code,'REQUEST_TYPE_NOT_SUPPORTED');assert.equal(f.sqlite.prepare('SELECT status FROM organization_limit_requests WHERE id=2').get().status,'pending');});
withDb('prévia de importação é somente leitura e detecta duplicidade',async f=>{const out=await service.validateImport(f.env,'nome,slug,descricao,plano,responsavel_email\nNova,nova,,free,owner@example.test\nOutra,nova,,free,owner@example.test');assert.equal(out.valid,false);assert.ok(out.rows[1].error);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organizations').get().n,3);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n,0);});
withDb('lote reautoriza cada organização e relata falha individual',async f=>{f.env.deniedId=2;const op=await start(f,'pause',[{id:1,version:0,reason:'Pausa coletiva'},{id:2,version:0,reason:'Pausa coletiva'}]);await step(f,op);await assert.rejects(step(f,op),e=>e.status===403);const out=await service.operation(f.env,f.actor,op.id);assert.equal(out.items[0].state,'succeeded');assert.equal(out.items[1].state,'failed');assert.equal(f.sqlite.prepare('SELECT active FROM organizations WHERE id=2').get().active,1);});
withDb('operação de outro ator não é visível',async f=>{const op=await start(f,'create',[payload]);await assert.rejects(service.operation(f.env,{id:2},op.id),e=>e.status===404);});
withDb('lease ativo não permite processar item duas vezes',async f=>{const op=await start(f,'create',[payload]);f.sqlite.prepare("UPDATE organization_management_operation_items SET state='running',lease_token='other',lease_until='2099-01-01T00:00:00Z' WHERE operation_id=?").run(op.id);const out=await step(f,op);assert.equal(out.items[0].state,'running');assert.equal(f.storageCalls,0);});
withDb('lease expirado permite retomar item',async f=>{const op=await start(f,'create',[payload]);f.sqlite.prepare("UPDATE organization_management_operation_items SET state='running',lease_token='expired',lease_until='2000-01-01T00:00:00Z' WHERE operation_id=?").run(op.id);assert.equal((await step(f,op)).items[0].state,'succeeded');});
withDb('HTTP nega papel que não é Super Admin',async f=>{f.actor.role='owner';assert.equal((await f.call('/organizations')).status,403);});
withDb('HTTP bloqueia POST de outra origem',async f=>{const out=await f.call('/operations',{kind:'create',items:[payload]},{Origin:'https://evil.example.test','Idempotency-Key':crypto.randomUUID()});assert.equal(out.status,403);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n,0);});
withDb('HTTP exige cabeçalho de mutação e tipo JSON',async f=>{assert.equal((await f.call('/import/validate',{csv:'x'},{'X-Maono-Management':'0'})).status,403);assert.equal((await f.call('/import/validate',{csv:'x'},{'Content-Type':'text/plain'})).status,415);});
withDb('HTTP protege leitura por organização e não fornece cache público',async f=>{f.env.deniedId=2;assert.equal((await f.call('/organizations/2')).status,403);const out=await f.call('/organizations');assert.equal(out.headers.get('Cache-Control'),'private, no-store');assert.equal(out.status,200);});
withDb('flag desligada falha de maneira explícita',async f=>{f.env.ORGANIZATION_MANAGEMENT_V1='false';const out=await f.call('/organizations');assert.equal(out.status,503);assert.equal(out.data.error.code,'ORGANIZATION_MANAGEMENT_DISABLED');});
withDb('rota ignora campos de privilégio no sentido seguro: rejeita-os',async f=>{const out=await f.call('/operations',{kind:'create',items:[{...payload,role:'super_admin'}]},{'Idempotency-Key':crypto.randomUUID()});assert.equal(out.status,400);});
withDb('histórico apresenta eventos reais e nenhum evento fabricado',async f=>{assert.equal((await service.activity(f.env,1,'https://qa.test/')).events.length,0);await step(f,await start(f,'pause',[{id:1,version:0,reason:'Pausa autorizada'}]));const history=await service.activity(f.env,1,'https://qa.test/');assert.equal(history.events[0].action,'organization.paused');assert.equal(history.events[0].actorName,'Operador');});
withDb('documentos excluem lixeira e não consultam Dropbox',async f=>{const out=await service.documents(f.env,1,'https://qa.test/');assert.deepEqual(out.files.map(f=>f.name),['Visível']);assert.equal(out.readOnly,true);assert.equal(f.storageCalls,0);});
test('CSV suporta BOM, vírgulas, aspas escapadas e quebra de linha citada',()=>{const csv='\uFEFFnome,slug,descricao,plano,responsavel_email\r\n"Nova, empresa",nova,"Linha 1\nLinha ""2""",free,owner@example.test';const out=parseImportCsv(csv);assert.equal(out[0].input.name,'Nova, empresa');assert.equal(out[0].input.description,'Linha 1\nLinha "2"');});
test('CSV rejeita cabeçalho inválido e aspas incompletas',()=>{assert.throws(()=>parseImportCsv('nome,senha\na,b'));assert.throws(()=>parseImportCsv('nome,slug,descricao,plano,responsavel_email\n"a,b'));});
test('CSV limita volume e não aceita coluna técnica extra',()=>{const h='nome,slug,descricao,plano,responsavel_email\n';assert.throws(()=>parseImportCsv(h+Array.from({length:101},(_,i)=>`A,a-${i},,free,a@b.com`).join('\n')));assert.throws(()=>parseImportCsv(h+'x'.repeat(131073)));});
test('células exportadas neutralizam fórmulas inclusive após espaço',()=>{for(const v of ['=cmd',' +2','-3','@cmd','\t=cmd'])assert.ok(safeCsvCell(v).startsWith('"\''));assert.equal(safeCsvCell('A"B'),'"A""B"');});
test('normalização rejeita plano, versão, caminho e papel extras',()=>{assert.throws(()=>createInput({...payload,plan:'vip'}));assert.throws(()=>createInput({...payload,dropboxRootPath:'/'}));assert.throws(()=>changeInput({id:1,version:-1,name:'Novo',reason:'Teste'}));assert.throws(()=>queryInput('https://a/?sort=name;DROP'));assert.throws(()=>queryInput('https://a/?size=500'));});
test('hash é estável para ordem de campos e muda com conteúdo',async()=>{assert.equal(await requestHash({a:1,b:2}),await requestHash({b:2,a:1}));assert.notEqual(await requestHash({a:1}),await requestHash({a:2}));});

withDb('arquivos órfãos não entram no total de organizações',async f=>{
 f.sqlite.prepare("INSERT INTO organization_files(id,organization_id,name,size_bytes) VALUES(99,NULL,'Sem organização',1)").run();
 assert.equal((await service.workspace(f.env,'https://qa.test/',f.deps)).summary.files,2);
});
withDb('proteção de schema detecta trigger ausente antes da escrita',async f=>{
 f.sqlite.exec('DROP TRIGGER org_management_quota_reserve_insert');
 const out=await f.call('/operations',{kind:'create',items:[payload]},{'Idempotency-Key':crypto.randomUUID()});
 assert.equal(out.status,503);assert.equal(out.data.error.code,'ORGANIZATION_MANAGEMENT_SCHEMA_REQUIRED');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_management_operations').get().n,0);
});
withDb('rollback da decisão se organização muda entre leitura e batch',async f=>{
 const op=await start(f,'review',[{id:1,version:0,organizationVersion:0,decision:'approved',reason:'Capacidade aprovada',projectLimit:10}]);
 const original=f.env.DB.batch.bind(f.env.DB);let once=true;
 f.env.DB.batch=async statements=>{if(once){once=false;f.sqlite.prepare("UPDATE organizations SET name='Outro administrador' WHERE id=1").run();}return original(statements);};
 const out=await step(f,op);
 assert.equal(out.items[0].code,'REQUEST_VERSION_CONFLICT');
 assert.equal(f.sqlite.prepare('SELECT status FROM organization_limit_requests WHERE id=1').get().status,'pending');
 assert.equal(f.sqlite.prepare('SELECT reviewed_by FROM organization_limit_requests WHERE id=1').get().reviewed_by,null);
 assert.equal(f.sqlite.prepare('SELECT project_limit FROM organizations WHERE id=1').get().project_limit,null);
});
withDb('designar responsável não reduz quota nem exige capacidade livre',async f=>{
 f.sqlite.prepare("UPDATE organizations SET project_limit=1 WHERE id=1").run();
 const version=f.sqlite.prepare('SELECT management_version FROM organizations WHERE id=1').get().management_version;
 const op=await start(f,'change',[{id:1,version,ownerId:2,reason:'Designar responsável'}]);
 assert.equal((await step(f,op)).items[0].state,'succeeded');
 assert.equal(f.sqlite.prepare('SELECT project_limit FROM organizations WHERE id=1').get().project_limit,1);
});
withDb('replay após resposta perdida não reaplica alteração confirmada',async f=>{
 const op=await start(f,'pause',[{id:1,version:0,reason:'Pausa solicitada'}]);await step(f,op);
 f.sqlite.prepare("UPDATE organization_management_operation_items SET state='running',lease_until='2000-01-01T00:00:00Z' WHERE operation_id=?").run(op.id);
 const out=await step(f,op);assert.equal(out.items[0].state,'succeeded');
 assert.equal(f.sqlite.prepare('SELECT management_version FROM organizations WHERE id=1').get().management_version,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM organization_management_events').get().n,1);
});
withDb('histórico pagina eventos sem inventar registros anteriores',async f=>{
 for(let i=0;i<25;i++)f.sqlite.prepare('UPDATE organizations SET name=? WHERE id=1').run(`Alfa ${i}`);
 const first=await service.activity(f.env,1,'https://qa.test/');assert.equal(first.events.length,20);assert.ok(first.next);
 const second=await service.activity(f.env,1,`https://qa.test/?before=${first.next}`);assert.equal(second.events.length,5);
 assert.equal(new Set([...first.events,...second.events].map(e=>e.id)).size,25);
});
withDb('política de organizações não editadas preserva defaults',async f=>{
 const before=await service.detail(f.env,2,f.deps);await step(f,await start(f,'change',[{id:1,version:0,plan:'pro',projectLimit:9,reason:'Plano alterado'}]));
 const after=await service.detail(f.env,2,f.deps);assert.deepEqual(after.policy,before.policy);
});
test('contratos rejeitam identificadores enviados como lista',()=>{
 assert.throws(()=>changeInput({id:[1],version:0,name:'Outro',reason:'Alteração autorizada'}));
});

withDb('justificativa integra a trilha da edição gerencial',async f=>{
 const op=await start(f,'change',[{id:1,version:0,projectLimit:6,reason:'Capacidade revisada pelo operador'}]);
 assert.equal((await step(f,op)).items[0].state,'succeeded');
 assert.equal((await service.activity(f.env,1,'https://qa.test/')).events[0].reason,'Capacidade revisada pelo operador');
});
