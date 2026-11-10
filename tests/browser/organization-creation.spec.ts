import {test,expect,type Page} from '@playwright/test';

type Scenario='success'|'partial'|'failed'|'running'|'unconfirmed'|'lost-response'|'refresh-failed'|'lost-start'|'timeout';
async function setup(page:Page,scenario:Scenario='success'){
  let starts=0,steps=0,created=false,held=false;
  const requests:string[]=[];
  const owner={id:2,name:'Responsável sintético',email:'responsavel@example.test'};
  const org={id:9,name:'Organização sintética',slug:'organizacao-sintetica-123456789',description:'',active:true,version:1,plan:'free',owner,projectCount:0,userCount:1,fileCount:0,storageStatus:'READY',updatedAt:null,lastActivityAt:null};
  let operation={ok:true,id:'synthetic-operation',kind:'create',done:false,createdAt:'2026-11-06',items:[{index:0,label:org.name,state:'pending',result:null as {id:number}|null,error:null as string|null,code:null as string|null,attempts:0,retryable:false}]};
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;requests.push(`${req.method()} ${path}${url.search}`);
    if(path==='/api/session')return route.fulfill({json:{authenticated:true,user:{id:1,name:'Operador sintético',email:'operador@example.test',role:'super_admin',activeOrganizationId:1},projects:[],organizations:[],activeOrganization:null}});
    if(path.endsWith('/name-availability')){
      const name=url.searchParams.get('name')||'';
      if(name==='Consulta indisponível')return route.fulfill({status:503,json:{ok:false}});
      if(name==='Nome antigo')await new Promise(resolve=>setTimeout(resolve,700));
      return route.fulfill({json:{ok:true,available:!['Duplicado','Nome antigo'].includes(name)}});
    }
    if(path.endsWith('/candidates')){
      const q=url.searchParams.get('q')||'';
      if(q==='erro')return route.fulfill({status:503,json:{ok:false}});
      return route.fulfill({json:{ok:true,users:q==='ausente'?[]:[owner]}});
    }
    if(path.endsWith('/operations/by-key'))return route.fulfill({json:{ok:true,operation:starts?operation:null}});
    if(path.endsWith('/operations')&&req.method()==='POST'){
      starts++;expect(req.postDataJSON().items[0]).not.toHaveProperty('slug');if(scenario==='lost-start')return route.abort('failed');return route.fulfill({json:operation});
    }
    if(path.endsWith('/step')){
      steps++;held=true;await new Promise(resolve=>setTimeout(resolve,scenario==='timeout'?21000:scenario==='success'?1500:600));held=false;
      const state=scenario==='partial'?'partial':scenario==='failed'?'failed':scenario==='running'?'running':'succeeded';
      operation={...operation,done:state!=='running',items:[{...operation.items[0],state,result:state==='failed'||state==='running'?null:{id:9},retryable:state==='partial',error:state==='failed'?'Responsável não encontrado ou inativo.':null}]};
      created=state==='succeeded';
      if(scenario==='lost-response'&&steps===1)return route.abort('failed');
      return route.fulfill({json:operation});
    }
    if(path.endsWith('/operations/synthetic-operation'))return route.fulfill({json:operation});
    if(path.endsWith('/organizations/9'))return route.fulfill({json:{ok:true,organization:org,policy:{plan:'free'},creationConfirmed:scenario!=='unconfirmed',creationOperationId:operation.id}});
    if(path.endsWith('/organizations')){
      if(scenario==='refresh-failed'&&created)return route.fulfill({status:503,json:{ok:false}});
      return route.fulfill({json:{ok:true,organizations:[],pagination:{total:0,page:1,size:10,pages:1},summary:{organizations:created?1:0,active:created?1:0,users:0,files:0,requests:0},capabilities:{projectQuotaEnforced:true}}});
    }
    return route.fulfill({json:{ok:true,enabled:false,projects:[],users:[],organizations:[],access:[],notifications:[],unreadCount:0,operations:[]}});
  });
  await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
  await page.goto('/admin?section=organizations&org_q=filtro-preservado');
  await page.getByRole('button',{name:'Nova organização',exact:false}).click();
  return {requests,get starts(){return starts;},get steps(){return steps;},get held(){return held;}};
}
async function fill(page:Page){
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Nome',{exact:true}).fill('Organização sintética');
  await dialog.getByRole('combobox',{name:'E-mail do responsável'}).fill('responsavel@example.test');
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByRole('button',{name:'Criar organização',exact:true})).toBeEnabled();
  return dialog;
}
test('nome invalida imediatamente, ignora resposta antiga e consulta falha sem liberar criação',async({page})=>{
  await setup(page);const d=await fill(page),name=d.getByLabel('Nome',{exact:true}),submit=d.getByRole('button',{name:'Criar organização',exact:true});
  await expect(d.getByLabel('Identificador',{exact:true})).toHaveCount(0);
  await name.fill('Duplicado');await expect(submit).toBeDisabled();await expect(d.getByText('Nome já utilizado.',{exact:true})).toBeVisible();
  await name.fill('Nome antigo');await page.waitForRequest('**/name-availability?name=Nome%20antigo');await name.fill('Nome atual');
  await expect(d.getByText('Nome disponível.',{exact:true})).toBeVisible();await page.waitForTimeout(800);await expect(submit).toBeEnabled();
  await name.fill('Consulta indisponível');await expect(d.getByText('Não foi possível verificar o nome.',{exact:true})).toBeVisible();await expect(submit).toBeDisabled();
  await expect(d.getByRole('button',{name:'Verificar nome novamente'})).toBeVisible();
});
test('autocomplete tem nome/email, teclado, Escape local, seleção explícita e invalidação',async({page},info)=>{
  const state=await setup(page);const d=page.getByRole('dialog'),owner=d.getByRole('combobox',{name:'E-mail do responsável'});
  await d.getByLabel('Nome',{exact:true}).fill('Organização sintética');await d.getByRole('checkbox').check();
  await owner.fill('res');const option=d.getByRole('option',{name:'Responsável sintético responsavel@example.test'});await expect(option).toBeVisible();
  await expect(d.getByRole('button',{name:'Criar organização',exact:true})).toBeDisabled();
  await page.screenshot({path:info.outputPath('autocomplete.png'),fullPage:true});
  await owner.press('Escape');await expect(d).toBeVisible();await expect(d.getByRole('listbox')).toHaveCount(0);
  await owner.press('ArrowDown');await owner.press('Enter');await expect(owner).toHaveValue('responsavel@example.test');expect(state.starts).toBe(0);
  await expect(d.getByRole('button',{name:'Criar organização',exact:true})).toBeEnabled();
  await owner.fill('ausente');await expect(d.getByRole('button',{name:'Criar organização',exact:true})).toBeDisabled();await expect(d.getByText('Nenhum usuário ativo encontrado.',{exact:true})).toBeVisible();
  await owner.fill('erro');await expect(d.getByText('Não foi possível consultar os usuários.',{exact:true})).toBeVisible();
});
test('loading exclusivo no dialog, fechamento confirmado, filtros e foco preservados',async({page},info)=>{
  const state=await setup(page);const d=await fill(page);await d.getByRole('button',{name:'Criar organização',exact:true}).click();
  const loader=d.getByRole('status').filter({hasText:'Criando e validando organização'});await expect(loader).toBeVisible();
  await expect(d.getByLabel('Nome',{exact:true})).toBeHidden();await expect(d.getByText('synthetic-operation',{exact:false})).toHaveCount(0);await expect(d.locator('.aog-operation-items')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('loading.png'),fullPage:true});
  await expect(d).toHaveCount(0);await expect(page.getByText('Organização criada com sucesso.',{exact:true})).toBeVisible();
  await expect(page).toHaveURL(/org_q=filtro-preservado/);expect(new URL(page.url()).searchParams.has('org_operation')).toBe(false);expect(new URL(page.url()).searchParams.has('org_mode')).toBe(false);
  await expect(page.getByRole('button',{name:'Nova organização',exact:false})).toBeFocused();expect(state.starts).toBe(1);expect(state.steps).toBe(1);
  await page.screenshot({path:info.outputPath('success.png'),fullPage:true});
});
for(const scenario of ['partial','failed','running','unconfirmed'] as Scenario[])test(`${scenario} mantém painel e permite recuperação sem novo cadastro`,async({page},info)=>{
  const state=await setup(page,scenario),d=await fill(page);await d.getByRole('button',{name:'Criar organização',exact:true}).click();
  await expect(d.getByRole('button',{name:'Retomar criação'})).toBeVisible();await expect(d).toBeVisible();await expect(page.getByText('Organização criada com sucesso.',{exact:true})).toHaveCount(0);
  await expect(d.getByLabel('Nome',{exact:true})).toHaveValue('Organização sintética');await expect(d.locator('.aog-operation-items')).toHaveCount(0);
  await d.getByRole('button',{name:'Retomar criação'}).click();await expect(d.getByRole('button',{name:'Retomar criação'})).toBeVisible();expect(state.starts).toBe(1);
  if(scenario==='partial')await page.screenshot({path:info.outputPath('partial.png'),fullPage:true});
});
test('resposta perdida consulta operação antes de repetir e fecha com resultado persistido',async({page})=>{
  const state=await setup(page,'lost-response'),d=await fill(page);await d.getByRole('button',{name:'Criar organização',exact:true}).click();
  await d.getByRole('button',{name:'Retomar criação'}).click();await expect(d).toHaveCount(0);expect(state.starts).toBe(1);expect(state.steps).toBe(1);
  expect(state.requests.some(r=>r==='GET /api/admin/organization-management/operations/synthetic-operation')).toBe(true);
});
test('falha da listagem após sucesso não reabre criação nem apaga confirmação',async({page})=>{
  const state=await setup(page,'refresh-failed'),d=await fill(page);await d.getByRole('button',{name:'Criar organização',exact:true}).click();
  await expect(d).toHaveCount(0);await expect(page.getByText('Organização criada com sucesso.',{exact:true})).toBeVisible();await expect(page.getByRole('alert')).toBeVisible();expect(state.starts).toBe(1);
});


test('perda da resposta inicial recupera pela chave idempotente sem segunda operação',async({page})=>{
  const state=await setup(page,'lost-start'),d=await fill(page);
  await d.getByRole('button',{name:'Criar organização',exact:true}).click();
  await d.getByRole('button',{name:'Retomar criação'}).click();await expect(d).toHaveCount(0);
  expect(state.starts).toBe(1);expect(state.steps).toBe(1);expect(state.requests.some(r=>r.includes('/operations/by-key?key='))).toBe(true);
});

test('clique duplo mantém uma única tentativa',async({page})=>{
  const state=await setup(page),d=await fill(page);
  await d.getByRole('button',{name:'Criar organização',exact:true}).click({clickCount:2});
  await expect(d).toHaveCount(0);expect(state.starts).toBe(1);expect(state.steps).toBe(1);
});

test('timeout encerra loading e consulta o resultado salvo antes de retomar',async({page})=>{
  const state=await setup(page,'timeout'),d=await fill(page);
  await d.getByRole('button',{name:'Criar organização',exact:true}).click();
  await expect(d.getByRole('button',{name:'Retomar criação'})).toBeVisible({timeout:25000});
  await expect(d.locator('.aog-create-loading')).toHaveCount(0);
  await expect.poll(()=>state.held).toBe(false);
  await d.getByRole('button',{name:'Retomar criação'}).click();await expect(d).toHaveCount(0);
  expect(state.starts).toBe(1);expect(state.steps).toBe(1);
});
