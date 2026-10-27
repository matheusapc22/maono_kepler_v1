import {test as base,expect} from '@playwright/test';
import {persistenceFixture} from '../helpers/project-persistence-fixture.mjs';
import {onRequest as management} from '../../functions/api/admin/organization-management/[[path]].js';
import {onRequest as session} from '../../functions/api/session.js';

// Browser transport is intercepted locally, but sessions, ACL, the management
// route, lifecycle and SQL execute unchanged. Only Dropbox HTTP is simulated.
// No real user, provider, D1 binding or deployed environment is involved.
const test=base.extend<{backend:ReturnType<typeof persistenceFixture>}>({
  backend:async({page},runFixture)=>{
    const cleanup:Array<()=>void>=[];
    const backend=persistenceFixture({after:(fn:()=>void)=>cleanup.push(fn)});
    backend.env.ORGANIZATION_MANAGEMENT_V1='true';
    backend.db.exec("UPDATE users SET role='super_admin' WHERE id=1; UPDATE organizations SET dropbox_root_path='/projects/'||slug");
    await page.context().addCookies([{name:'maono_session',value:'offline-session-1',domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
    await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
    await page.route('**/api/**',async route=>{
      const input=route.request(),url=new URL(input.url());
      const request=new Request(input.url(),{method:input.method(),headers:input.headers(),body:input.postData()});
      if(url.pathname==='/api/session'||url.pathname.startsWith('/api/admin/organization-management/')){
        const response=await (url.pathname==='/api/session'?session:management)({env:backend.env,request});
        await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      }else if(input.method()==='GET'){
        await route.fulfill({json:{ok:true,enabled:false,notifications:[],unreadCount:0}});
      }else{
        throw new Error(`Unexpected browser mutation: ${input.method()} ${url.pathname}`);
      }
    });
    try{await runFixture(backend);}finally{await page.unrouteAll({behavior:'wait'});for(const fn of cleanup.reverse())fn();}
  },
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
