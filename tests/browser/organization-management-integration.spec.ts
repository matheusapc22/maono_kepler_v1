import {test as base,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {getDropboxClient} from '../../functions/_lib/dropbox-client.js';
import {persistenceFixture} from '../helpers/project-persistence-fixture.mjs';
import {organizationManagementBrowserServer} from '../helpers/organization-management-browser-server.mjs';

// Native browser HTTP stays on loopback; sessions, ACL, the management
// route, lifecycle and SQL execute unchanged. Only Dropbox HTTP is simulated.
// No real user, provider, D1 binding or deployed environment is involved.
type Backend=ReturnType<typeof persistenceFixture>&{http:Awaited<ReturnType<typeof organizationManagementBrowserServer>>;advanceDeletionClock:()=>void};
const test=base.extend<{backend:Backend;managementFlag:string;schemaBefore0042:boolean;sessionPresent:boolean;nativeTransport:void}>({
  managementFlag:['true',{option:true}],
  schemaBefore0042:[false,{option:true}],
  sessionPresent:[true,{option:true}],
  baseURL:async({backend},runFixture)=>runFixture(backend.http.origin),
  backend:async({managementFlag,schemaBefore0042},runFixture,testInfo)=>{
    const cleanup:Array<()=>void>=[];
    const schema=readFileSync(new URL('../../schema.sql',import.meta.url),'utf8').split('-- Organization management (migration 0042)');
    expect(schema).toHaveLength(2);
    let advanceDeletionClock=false;
    const backend=persistenceFixture({after:(fn:()=>void)=>cleanup.push(fn)},{...(schemaBefore0042?{schemaSql:schema[0]}:{}),
      afterSql:({sql,db}:{sql:string;db:{exec:(query:string)=>unknown}})=>{
        // Synthetic time advancement only; production drain remains enforced and unit tested.
        if(advanceDeletionClock&&sql.includes('INSERT INTO organization_deletions('))db.exec("UPDATE organization_deletions SET not_before='2020-01-01T00:00:00.000Z'");
      }});
    backend.env.ORGANIZATION_MANAGEMENT_V1=managementFlag;
    backend.db.exec("UPDATE users SET role='super_admin' WHERE id=1; UPDATE organizations SET dropbox_root_path='/projects/'||slug");
    let http:Awaited<ReturnType<typeof organizationManagementBrowserServer>>|undefined;
    try{http=await organizationManagementBrowserServer(backend.env,String(testInfo.project.use.baseURL));await runFixture({...backend,http,advanceDeletionClock:()=>{advanceDeletionClock=true;}});expect(http.errors).toEqual([]);}
    finally{await http?.close();for(const fn of cleanup.reverse())fn();}
  },
  nativeTransport:[async({page,backend,sessionPresent},runFixture)=>{
    if(sessionPresent)await page.context().addCookies([{name:'maono_session',value:'offline-session-1',domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
    await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
    try{await runFixture();expect(backend.http.requests.some(request=>request.path==='/api/session'&&request.cookiePresent===sessionPresent)).toBe(true);}
    finally{await page.unrouteAll({behavior:'wait'});}
  },{auto:true}],
});

test.describe('transporte nativo sem cookie de sessão',()=>{
  test.use({sessionPresent:false});
  test('mantém a negativa de sessão e não fabrica acesso ao workspace',async({page,backend})=>{
    const before=backend.db.prepare('SELECT total_changes() AS writes').get().writes;
    const sessionResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/session');
    await page.goto('/admin?section=organizations');
    expect((await (await sessionResponse).json()).authenticated).toBe(false);
    await expect(page.getByRole('heading',{name:'ACESSE SUA CONTA',exact:true})).toBeVisible();
    expect(backend.http.requests.some(request=>request.path.startsWith('/api/admin/organization-management/'))).toBe(false);
    expect(backend.db.prepare('SELECT total_changes() AS writes').get().writes).toBe(before);
    expect(backend.calls).toHaveLength(0);
  });
});

for(const scenario of [
  {name:'API desativada',flag:'false',oldSchema:false,status:503},
  {name:'schema anterior à 0042',flag:'true',oldSchema:true,status:503},
]) test.describe(`UI compilada ON com ${scenario.name}`,()=>{
  test.use({managementFlag:scenario.flag,schemaBefore0042:scenario.oldSchema});
  test('expõe indisponibilidade e rejeita cadastro sem escrita ou sucesso fictício',async({page,backend})=>{
    const before=backend.db.prepare('SELECT total_changes() AS writes').get().writes;
    const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/organization-management/organizations');
    await page.goto('/admin?section=organizations');
    expect((await read).status()).toBe(scenario.status);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button',{name:'Offline A',exact:true})).toHaveCount(0);
    await expect(page.getByText('Consulta não concluída',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Nova organização',exact:false})).toBeDisabled();
    // A restored form URL must still fail at the server boundary. Do not force
    // activation of the disabled creation control or fabricate capabilities.
    await page.goto('/admin?section=organizations&org_mode=create');
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Nome',{exact:true}).fill('Cadastro não disponível');
    await dialog.getByLabel('E-mail do responsável',{exact:false}).fill('other@offline.invalid');
    await dialog.getByRole('checkbox',{name:'Confirmo o cadastro',exact:false}).check();
    await expect(dialog.getByRole('button',{name:'Criar organização',exact:true})).toBeDisabled();
    await expect(dialog.getByText('Não foi possível verificar o nome.',{exact:true})).toBeVisible();
    const rejected=await page.request.post('/api/admin/organization-management/operations',{headers:{Origin:backend.http.origin,'X-Maono-Management':'1','Idempotency-Key':'disabled-schema-attempt'},data:{kind:'create',items:[{name:'Blocked',ownerEmail:'other@offline.invalid',plan:'free'}]}});
    expect(rejected.status()).toBe(scenario.status);
    await expect(dialog.getByText('Concluído',{exact:true})).toHaveCount(0);
    expect(backend.db.prepare('SELECT total_changes() AS writes').get().writes).toBe(before);
    expect(backend.calls).toHaveLength(0);
    expect(backend.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

test('cadastro compilado grava organização, responsável e operação pelo handler real',async({page,backend})=>{
  await page.goto('/admin?section=organizations');
  await page.getByRole('button',{name:'Nova organização',exact:false}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Nome',{exact:true}).fill('Organização da interface');
  await dialog.getByLabel('E-mail do responsável',{exact:false}).fill('other@offline.invalid');
  await dialog.getByRole('checkbox',{name:'Confirmo o cadastro',exact:false}).check();
  await dialog.getByRole('button',{name:'Criar organização',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Organização criada com sucesso.',{exact:true})).toBeVisible();
  const row=backend.db.prepare("SELECT * FROM organizations WHERE name='Organização da interface'").get();
  expect(row.slug).toMatch(/^organizacao-da-interface-\d{9}$/);
  expect(row.management_owner_id).toBe(2);expect(row.storage_status).toBe('READY');
  expect(backend.db.prepare('SELECT access_level FROM organization_users WHERE organization_id=? AND user_id=2').get(row.id).access_level).toBe('owner');
});

test('conflito real preserva rascunho e recarrega apenas após decisão do operador',async({page,backend})=>{
  await page.goto('/admin?section=organizations');
  await page.getByRole('button',{name:'Offline A',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Nome',{exact:true}).fill('Meu rascunho');
  await dialog.getByLabel('Justificativa',{exact:true}).fill('Correção cadastral');
  backend.db.exec("UPDATE organizations SET name='Edição concorrente' WHERE id=1");
  await dialog.getByRole('button',{name:'Salvar dados',exact:true}).click();
  await expect(dialog.getByText('Falhou',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Nome',{exact:true})).toHaveValue('Meu rascunho');
  expect(backend.db.prepare('SELECT name FROM organizations WHERE id=1').get().name).toBe('Edição concorrente');
  page.once('dialog',async d=>d.accept());
  await dialog.getByRole('button',{name:'Consultar versão atual'}).click();
  await expect(dialog.getByLabel('Nome',{exact:true})).toHaveValue('Edição concorrente');
});

test('pausa e reativação pela interface preservam vínculos',async({page,backend})=>{
  const links=backend.db.prepare('SELECT * FROM organization_users ORDER BY id').all();
  await page.goto('/admin?section=organizations');
  page.on('dialog',async d=>d.accept());
  await page.getByRole('button',{name:'Offline A',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Pausar organização',exact:true}).click();
  await expect(dialog.getByText('Concluído',{exact:true})).toBeVisible();
  expect(backend.db.prepare('SELECT active FROM organizations WHERE id=1').get().active).toBe(0);
  expect(backend.db.prepare('SELECT * FROM organization_users ORDER BY id').all()).toEqual(links);
  await dialog.getByRole('button',{name:'Fechar painel'}).click();
  await page.getByRole('button',{name:'Offline A',exact:true}).click();
  dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Reativar / verificar armazenamento',exact:true}).click();
  await expect(dialog.getByText('Concluído',{exact:true})).toBeVisible();
  expect(backend.db.prepare('SELECT active FROM organizations WHERE id=1').get().active).toBe(1);
  expect(backend.db.prepare('SELECT * FROM organization_users ORDER BY id').all()).toEqual(links);
});

test('sessão revogada limpa registros anteriores na consulta seguinte',async({page,backend})=>{
  await page.goto('/admin?section=organizations');
  await expect(page.getByRole('button',{name:'Offline A',exact:true})).toBeVisible();
  backend.db.exec('UPDATE users SET active=0 WHERE id=1');
  await page.getByRole('textbox',{name:'Buscar',exact:true}).fill('Offline');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Offline A',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Entrar novamente'})).toBeVisible();
});

test('exclusão compilada usa sessão, ACL, handler e D1 reais com Dropbox sintético',async({page,backend})=>{
  backend.env.ORGANIZATION_PERMANENT_DELETE_V1='true';backend.advanceDeletionClock();
  backend.db.exec(`INSERT INTO organizations(id,name,slug,dropbox_root_path,active,storage_status,updated_at)
    VALUES(3,'Exclusão sintética','delete-qa','/projects/delete-qa',0,'DISABLED','2020-01-01 00:00:00');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(3,2,'owner');
    UPDATE organizations SET management_owner_id=2 WHERE id=3;
    UPDATE organizations SET updated_at='2020-01-01 00:00:00' WHERE id=3;`);
  const historyBefore=backend.db.prepare('SELECT COUNT(*) n FROM organization_management_events WHERE organization_id=3').get().n;
  expect(historyBefore).toBeGreaterThan(0);
  const otherBefore=backend.db.prepare('SELECT * FROM organizations WHERE id=2').get();
  const otherLinks=backend.db.prepare('SELECT * FROM organization_users WHERE organization_id=2').all();
  const providerCalls:string[]=[];let folderExists=true;
  // Only the external provider HTTP is simulated; no deletion route/session/SQL interception.
  getDropboxClient(backend.env).fetchFn=async(url:string,init:RequestInit)=>{
    const target=new URL(url);expect(target.hostname).toBe('api.dropboxapi.com');
    const args=JSON.parse(String(init.body));providerCalls.push(target.pathname);
    if(target.pathname==='/2/files/get_metadata'){
      if(args.path==='/organizations/3')return Response.json({error_summary:'path/not_found/'},{status:409});
      expect(['/projects/delete-qa','id:delete-qa']).toContain(args.path);
      return folderExists?Response.json({'.tag':'folder',id:'id:delete-qa',path_lower:'/projects/delete-qa'}):Response.json({error_summary:'path/not_found/'},{status:409});
    }
    if(target.pathname==='/2/files/list_folder'){
      expect(args.path).toBe('/projects/delete-qa');return Response.json({entries:[],has_more:false});
    }
    if(target.pathname==='/2/files/delete_v2'){
      expect(args.path).toBe('id:delete-qa');folderExists=false;return Response.json({metadata:{id:'id:delete-qa'}});
    }
    throw Error('Unexpected synthetic Dropbox request: '+target.pathname);
  };
  await page.goto('/admin?section=organizations');
  await page.getByRole('button',{name:'Exclusão sintética',exact:true}).click();
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByText('Organização excluída permanentemente. Exclusão confirmada no banco e no Dropbox.')).toBeVisible();
  expect(folderExists).toBe(false);
  expect(providerCalls.filter(path=>path==='/2/files/delete_v2')).toHaveLength(1);
  expect(backend.db.prepare('SELECT id FROM organizations WHERE id=3').get()).toBeUndefined();
  expect(backend.db.prepare('SELECT * FROM organizations WHERE id=2').get()).toEqual(otherBefore);
  expect(backend.db.prepare('SELECT * FROM organization_users WHERE organization_id=2').all()).toEqual(otherLinks);
  expect(backend.db.prepare('SELECT id FROM users WHERE id=2').get().id).toBe(2);
  expect(backend.db.prepare('SELECT COUNT(*) n FROM organization_deleted_management_events WHERE organization_id=3').get().n).toBeGreaterThanOrEqual(historyBefore);
  expect(backend.db.prepare('SELECT state FROM organization_deletions WHERE organization_id=3').get().state).toBe('completed');
  expect(backend.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
