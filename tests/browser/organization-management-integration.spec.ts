import {test as base,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {persistenceFixture} from '../helpers/project-persistence-fixture.mjs';
import {organizationManagementBrowserServer} from '../helpers/organization-management-browser-server.mjs';

// Native browser HTTP stays on loopback; sessions, ACL, the management
// route, lifecycle and SQL execute unchanged. Only Dropbox HTTP is simulated.
// No real user, provider, D1 binding or deployed environment is involved.
type Backend=ReturnType<typeof persistenceFixture>&{http:Awaited<ReturnType<typeof organizationManagementBrowserServer>>};
const test=base.extend<{backend:Backend;managementFlag:string;schemaBefore0042:boolean;sessionPresent:boolean;nativeTransport:void}>({
  managementFlag:['true',{option:true}],
  schemaBefore0042:[false,{option:true}],
  sessionPresent:[true,{option:true}],
  baseURL:async({backend},runFixture)=>runFixture(backend.http.origin),
  backend:async({managementFlag,schemaBefore0042},runFixture,testInfo)=>{
    const cleanup:Array<()=>void>=[];
    const schema=readFileSync(new URL('../../schema.sql',import.meta.url),'utf8').split('-- Organization management (migration 0042)');
    expect(schema).toHaveLength(2);
    const backend=persistenceFixture({after:(fn:()=>void)=>cleanup.push(fn)},schemaBefore0042?{schemaSql:schema[0]}:{});
    backend.env.ORGANIZATION_MANAGEMENT_V1=managementFlag;
    backend.db.exec("UPDATE users SET role='super_admin' WHERE id=1; UPDATE organizations SET dropbox_root_path='/projects/'||slug");
    let http:Awaited<ReturnType<typeof organizationManagementBrowserServer>>|undefined;
    try{http=await organizationManagementBrowserServer(backend.env,String(testInfo.project.use.baseURL));await runFixture({...backend,http});expect(http.errors).toEqual([]);}
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
    const write=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/admin/organization-management/operations');
    await dialog.getByRole('button',{name:'Criar organização',exact:true}).click();
    expect((await write).status()).toBe(scenario.status);
    await expect(dialog.getByRole('alert')).toBeVisible();
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
  await expect(dialog.getByText('Concluído',{exact:true})).toBeVisible();
  const row=backend.db.prepare("SELECT * FROM organizations WHERE slug='organizacao-da-interface'").get();
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
