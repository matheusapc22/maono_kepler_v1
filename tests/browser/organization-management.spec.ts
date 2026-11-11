import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, role = 'super_admin') {
  const writes: string[] = [], reads: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const organizations = [
    {id:1,name:'Organização Sintética Alfa',slug:'qa-alfa',description:'Dados de teste',active:true,version:0,plan:'free',owner:null,projectCount:2,userCount:2,fileCount:1,storageStatus:'READY',updatedAt:'2026-01-01T12:00:00Z',lastActivityAt:null},
    {id:2,name:'Organização Sintética Beta',slug:'qa-beta',description:'',active:true,version:0,plan:'pro',owner:null,projectCount:0,userCount:1,fileCount:1,storageStatus:'READY',updatedAt:'2026-01-01T12:00:00Z',lastActivityAt:null},
  ];
  await page.route('**/api/**', async route => {
    const request=route.request(), url=new URL(request.url());
    if(request.method()!=='GET') {writes.push(`${request.method()} ${url.pathname}`);return route.fulfill({status:403,json:{ok:false,error:{message:'Escrita não prevista pela fixture',code:'FIXTURE_WRITE_BLOCKED'}}});}
    reads.push(url.pathname+url.search);
    if(url.pathname==='/api/session')return route.fulfill({json:{authenticated:true,user:{id:1,name:'Operador sintético',email:'qa@example.test',role,activeOrganizationId:1},projects:[],organizations,activeOrganization:organizations[0]}});
    if(url.pathname==='/api/admin/organization-management/organizations'){
      const q=(url.searchParams.get('q')||'').toLowerCase();
      const items=organizations.filter(o=>o.name.toLowerCase().includes(q));
      return route.fulfill({json:{ok:true,organizations:items,pagination:{total:items.length,page:1,size:10,pages:1},summary:{organizations:2,active:2,users:2,files:2,requests:0},capabilities:{projectQuotaEnforced:true,edits:true,imports:true}}});
    }
    if(url.pathname==='/api/admin/organization-management/organizations/1')return route.fulfill({json:{ok:true,organization:organizations[0],policy:{plan:'free',projects:5,storageMb:500,projectOverride:null,used:2,reserved:0,remaining:3,storageUsedMb:1,projectQuotaEnforced:true,informational:['storageMb']}}});
    if(url.pathname.endsWith('/organizations/1/activity'))return route.fulfill({json:{ok:true,events:[],next:null}});
    if(url.pathname.endsWith('/organizations/1/documents'))return route.fulfill({json:{ok:true,files:[],hasMore:false}});
    if(url.pathname.endsWith('/organizations/1/people'))return route.fulfill({json:{ok:true,people:[]}});
    return route.fulfill({json:{ok:true,enabled:false,projects:[],users:[],organizations:[],access:[],notifications:[],unreadCount:0,operations:[]}});
  });
  await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname), route=>route.abort());
  await page.goto('/admin?section=organizations');
  return {reads,writes,errors};
}
for (const [width,height] of [[1774,887],[1366,768],[1920,1080],[768,1024],[390,844]]) {
  test(`workspace ${width}px — consulta sem escrita`,async({page},info)=>{
    await page.setViewportSize({width,height});
    const state=await setup(page);
    await expect(page.getByRole('button',{name:'Organização Sintética Alfa',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Nova organização',exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Atualizar',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(state.reads.some(path=>/^\/api\/admin\/(projects|users|access)(\?|$)/.test(path))).toBe(false);
    expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
    await page.screenshot({path:info.outputPath(`organizations-${width}.png`),fullPage:true});
  });
}
test('filtros confirmados mantêm totais globais',async({page})=>{
  await setup(page);await expect(page.getByRole('button',{name:'Organização Sintética Beta',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Buscar',exact:true}).fill('Alfa');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Organização Sintética Beta',exact:true})).toHaveCount(0);
  await expect(page.getByRole('article',{name:'Todas as organizações, inclusive pausadas.',exact:true}).locator('strong')).toHaveText('2');
  await expect(page).toHaveURL(/org_q=Alfa/);
});
test('detalhe não lê módulos secundários antes da escolha',async({page})=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'Organização Sintética Alfa',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.reads.some(path=>path.endsWith('/activity')||path.endsWith('/documents'))).toBe(false);
  await page.getByRole('button',{name:'Histórico',exact:true}).click();
  await expect(page.getByText('Sem registro nesta gestão.',{exact:true})).toBeVisible();
  expect(state.reads.some(path=>path.endsWith('/activity'))).toBe(true);
  expect(state.writes).toEqual([]);
});
test('seleção em página é limpa ao aplicar busca',async({page})=>{
  await setup(page);await expect(page.getByRole('button',{name:'Organização Sintética Alfa',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'Selecionar a página atual'}).check();
  await expect(page.getByText('2 selecionados nesta página',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Buscar',exact:true}).fill('Beta');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByText('0 selecionados nesta página',{exact:true})).toBeVisible();
});
test('viewer não alcança API global do workspace',async({page})=>{
  const state=await setup(page,'viewer');
  await expect(page.locator('.admin-organizations-workspace')).toHaveCount(0);
  expect(state.reads.some(path=>path.startsWith('/api/admin/organization-management/'))).toBe(false);
  expect(state.writes).toEqual([]);
});

test('rascunho e filtros aplicados acompanham voltar e avançar',async({page})=>{
  await setup(page);
  const search=page.getByRole('textbox',{name:'Buscar',exact:true});
  await search.fill('Alfa');
  await expect(page.getByRole('button',{name:'Organização Sintética Beta',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Organização Sintética Beta',exact:true})).toHaveCount(0);
  await page.goBack();await expect(search).toHaveValue('');
  await expect(page.getByRole('button',{name:'Organização Sintética Beta',exact:true})).toBeVisible();
  await page.goForward();await expect(search).toHaveValue('Alfa');
  await expect(page.getByRole('button',{name:'Organização Sintética Beta',exact:true})).toHaveCount(0);
});

test('dialog mantém foco pelo teclado e o devolve ao acionador',async({page})=>{
  await setup(page);
  const trigger=page.getByRole('button',{name:'Organização Sintética Alfa',exact:true});
  await trigger.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  for(let i=0;i<18;i++){
    await page.keyboard.press(i%2?'Tab':'Shift+Tab');
    expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  }
  page.once('dialog',async confirmation=>confirmation.accept());
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('importação removida da interface e de links antigos sem escrita',async({page})=>{
  const state=await setup(page);
  await expect(page.getByRole('button',{name:'Importar',exact:true})).toHaveCount(0);
  await page.goto('/admin?section=organizations&org_mode=import');
  await expect(page.getByRole('button',{name:'Organização Sintética Alfa',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Arquivo CSV')).toHaveCount(0);
  expect(state.reads.some(path=>path.includes('/import/'))).toBe(false);
  expect(state.writes).toEqual([]);
});

test.describe('interação por toque',()=>{
  test.use({hasTouch:true,viewport:{width:390,height:844}});
  test('abre e fecha o painel em 390px',async({page})=>{
    await setup(page);
    await page.getByRole('button',{name:'Organização Sintética Alfa',exact:true}).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    page.once('dialog',async confirmation=>{
      expect(confirmation.message()).toBe('Descartar as alterações não salvas?');
      await confirmation.accept();
    });
    await page.getByRole('button',{name:'Fechar painel'}).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});

test('resposta antiga não restaura dados após acesso revogado em consulta mais recente',async({page})=>{
  await setup(page);
  await expect(page.getByRole('button',{name:'Organização Sintética Alfa',exact:true})).toBeVisible();
  let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  await page.route('**/api/admin/organization-management/organizations?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('q')==='Alfa'){
      entered();await pending;
      await route.fulfill({json:{ok:true,organizations:[{id:99,name:'Resposta antiga',slug:'old',active:true,version:0,plan:'free',owner:null,projectCount:0,userCount:0,fileCount:0,storageStatus:'READY',lastActivityAt:null}],pagination:{total:1,page:1,size:10,pages:1},summary:{organizations:1,active:1,users:0,files:0,requests:0},capabilities:{projectQuotaEnforced:true}}}).catch(()=>{});
    }else await route.fulfill({status:403,json:{ok:false,error:{message:'Acesso revogado',code:'FORBIDDEN'}}});
  });
  await page.getByRole('textbox',{name:'Buscar',exact:true}).fill('Alfa');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();await started;
  await page.getByRole('textbox',{name:'Buscar',exact:true}).fill('Beta');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByRole('link',{name:'Entrar novamente'})).toBeVisible();
  release();await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button',{name:'Resposta antiga',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Entrar novamente'})).toBeVisible();
});

test('falha remota exibe apresentação segura sem detalhes técnicos',async({page})=>{
  await setup(page);
  await expect(page.getByRole('button',{name:'Organização Sintética Alfa',exact:true})).toBeVisible();
  await page.route('**/api/admin/organization-management/organizations?*',route=>route.fulfill({
    status:500,headers:{'X-Request-Id':'private-reference'},
    json:{ok:false,error:{code:'UNKNOWN_PROVIDER_FAILURE',message:'secret-provider-trace',details:{token:'secret-provider-trace'}}},
  }));
  await page.getByRole('textbox',{name:'Buscar',exact:true}).fill('Alfa');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  const notice=page.getByRole('alert');await expect(notice).toBeVisible();
  await expect(notice).not.toContainText(/secret-provider-trace|private-reference|UNKNOWN_PROVIDER_FAILURE/);
  await expect(page.getByRole('button',{name:'Tentar novamente',exact:true})).toBeVisible();
});

async function deletionSetup(page:Page, options:{eligible?:boolean;enabled?:boolean;startResponseLost?:boolean;stepFailure?:boolean;role?:string}={}){
  const state=await setup(page,options.role||'super_admin');
  const org={id:1,name:'Organização Sintética Alfa',slug:'qa-alfa',description:'',active:false,version:3,plan:'free',owner:null,projectCount:0,userCount:1,fileCount:0,storageStatus:'DISABLED',updatedAt:'2026-01-01T12:00:00Z',lastActivityAt:null};
  const mutations:{path:string;body:unknown;key:string|undefined}[]=[];
  let deletion:{id:string;organizationId:number;state:string;retryable:boolean;errorCode:string|null}|null=null;
  let starts=0;
  await page.route('**/api/admin/organization-management/**',async route=>{
    const r=route.request(),url=new URL(r.url()),path=url.pathname.replace('/api/admin/organization-management','');
    if(r.method()==='POST')mutations.push({path,body:r.postDataJSON(),key:r.headers()['idempotency-key']});
    if(path==='/organizations')return route.fulfill({json:{ok:true,organizations:deletion?.state==='completed'?[]:[org],pagination:{total:deletion?.state==='completed'?0:1,page:1,size:10,pages:1},summary:{organizations:deletion?.state==='completed'?0:1,active:0,users:1,files:0,requests:0},capabilities:{projectQuotaEnforced:true,edits:true,permanentDelete:options.enabled!==false}}});
    if(path==='/organizations/1')return route.fulfill({json:{ok:true,organization:org,policy:{plan:'free',projects:5,storageMb:500,projectOverride:null,used:0,reserved:0,remaining:5,storageUsedMb:0,projectQuotaEnforced:true,informational:[]}}});
    if(path==='/organizations/1/deletion-preview')return route.fulfill({json:{ok:true,organizationId:1,name:org.name,version:3,eligible:options.eligible!==false,blockers:options.eligible===false?[{code:'LINKED_DATA',count:2}]:[],confirmation:'EXCLUIR PERMANENTEMENTE'}});
    if(path==='/organizations/1/permanent-delete'){
      starts++;deletion={id:'delete-synthetic-1',organizationId:1,state:'pending',retryable:true,errorCode:null};
      if(options.startResponseLost&&starts===1)return route.fulfill({status:503,json:{ok:false,error:{code:'SYNTHETIC_RESPONSE_LOST',message:'Resposta indisponível'}}});
      return route.fulfill({json:{ok:true,deletion}});
    }
    if(path==='/deletions/by-key'||path==='/deletions/delete-synthetic-1')return route.fulfill({json:{ok:true,deletion}});
    if(path==='/deletions/delete-synthetic-1/step'){
      if(!deletion)throw Error('Missing synthetic operation');
      deletion=options.stepFailure?{...deletion,retryable:true,errorCode:'DROPBOX_DELETE_FAILED'}:{...deletion,state:deletion.state==='pending'?'storage_deleted':'completed'};
      return route.fulfill({json:{ok:true,deletion}});
    }
    return route.fallback();
  });
  await page.reload();
  if(options.role&&options.role!=='super_admin')return {...state,mutations};
  await page.getByRole('button',{name:'Organização Sintética Alfa',exact:true}).click();
  return {...state,mutations};
}

test('exclusão só aparece para Super Admin com capacidade habilitada',async({page})=>{
  const state=await deletionSetup(page,{enabled:false});
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  await page.goto('/admin?section=organizations&org_id=1&org_mode=delete');
  await expect(page.getByText('Exclusão permanente indisponível neste contexto.')).toBeVisible();
  expect(state.mutations).toEqual([]);
});

test('admin comum nunca vê exclusão mesmo com capability forjada',async({page})=>{
  const state=await deletionSetup(page,{role:'admin'});
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test('exclusão exige frase literal e Enter não envia operação',async({page},info)=>{
  const state=await deletionSetup(page);await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  const input=page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}),button=page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true});
  for(const value of ['','excluir permanentemente',' EXCLUIR PERMANENTEMENTE','EXCLUIR PERMANENTEMENTE ','EXCLUIR  PERMANENTEMENTE']){
    await input.fill(value);await expect(button).toBeDisabled();
  }
  await input.fill('EXCLUIR PERMANENTEMENTE');await expect(button).toBeEnabled();await input.press('Enter');
  for(const width of [1280,390]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:info.outputPath(`organization-deletion-${width}.png`),fullPage:true});}
  expect(state.mutations).toEqual([]);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test('dados vinculados bloqueiam exclusão sem chamar API mutável',async({page})=>{
  const state=await deletionSetup(page,{eligible:false});await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await expect(page.getByText('Exclusão bloqueada.',{exact:false})).toBeVisible();
  await expect(page.getByText('Dados vinculados, inclusive inativos ou históricos (2)')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test('conclusão só após etapas Dropbox e banco e remoção da lista',async({page})=>{
  const state=await deletionSetup(page);await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByText('Organização excluída permanentemente. Exclusão confirmada no banco e no Dropbox.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Organização Sintética Alfa',exact:true})).toHaveCount(0);
  expect(state.mutations.map(r=>r.path)).toEqual(['/organizations/1/permanent-delete','/deletions/delete-synthetic-1/step','/deletions/delete-synthetic-1/step']);
  expect(state.mutations[0].body).toEqual({version:3,confirmation:'EXCLUIR PERMANENTEMENTE'});
  expect(state.mutations[0].key).toBeTruthy();expect(state.errors).toEqual([]);
});

test('resposta perdida conserva chave; reload consulta sem excluir automaticamente',async({page})=>{
  const state=await deletionSetup(page,{startResponseLost:true});await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('button',{name:'Consultar exclusão',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/org_delete_key=/);expect(state.mutations).toHaveLength(1);
  await page.reload();await expect(page.getByRole('button',{name:'Retomar exclusão',exact:true})).toBeVisible();
  expect(state.mutations).toHaveLength(1);
  await page.getByRole('button',{name:'Retomar exclusão',exact:true}).click();
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toBeVisible();
  expect(state.mutations.filter(r=>r.path==='/organizations/1/permanent-delete')).toHaveLength(1);
});

test('falha do Dropbox não vira sucesso e permite retomada explícita',async({page})=>{
  const state=await deletionSetup(page,{stepFailure:true});await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('DROPBOX_DELETE_FAILED');
  await expect(page.getByRole('button',{name:'Retomar exclusão',exact:true})).toBeVisible();
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toHaveCount(0);
  expect(state.mutations).toHaveLength(2);
});

test('histórico de importação não oferece retomada nem nova escrita',async({page})=>{
  const state=await setup(page);
  await page.route('**/api/admin/organization-management/operations/old-import',route=>route.fulfill({json:{ok:true,id:'old-import',kind:'import',createdAt:'2026-01-01',done:false,items:[{index:0,label:'Importação antiga',state:'pending',attempts:0,result:null,error:null,code:null,retryable:true}]}}));
  await page.goto('/admin?section=organizations&org_mode=operation&org_operation=old-import');
  await expect(page.getByText('Importação descontinuada.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continuar pendências'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Retomar próximo item recuperável'})).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('duplo clique na confirmação produz uma única exclusão',async({page})=>{
  const state=await deletionSetup(page);await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toBeVisible();
  expect(state.mutations.filter(r=>r.path==='/organizations/1/permanent-delete')).toHaveLength(1);
});

test('permissão revogada ao abrir exclusão remove dados e impede confirmação',async({page})=>{
  const state=await deletionSetup(page);
  await page.route('**/api/admin/organization-management/organizations/1/deletion-preview',route=>route.fulfill({status:403,json:{ok:false,error:{code:'MANAGEMENT_SUPER_ADMIN_REQUIRED',message:'Acesso negado'}}}));
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await expect(page.getByRole('link',{name:'Entrar novamente'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Organização Sintética Alfa',exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test('espera pós-confirmação não indica sucesso nem retoma sozinha',async({page})=>{
  const state=await deletionSetup(page);
  await page.route('**/api/admin/organization-management/deletions/delete-synthetic-1/step',route=>route.fulfill({json:{ok:true,deletion:{id:'delete-synthetic-1',organizationId:1,state:'pending',retryable:true,errorCode:'ORGANIZATION_DELETE_DRAINING',notBefore:'2099-01-01T00:00:00.000Z'}}}));
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByText('Aguardando até',{exact:false})).toBeVisible();
  await expect(page.getByText('A pasta ainda não foi removida.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retomar exclusão',exact:true})).toBeEnabled();
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toHaveCount(0);
  expect(state.mutations.filter(r=>r.path==='/organizations/1/permanent-delete')).toHaveLength(1);
});

test('entrar em exclusão não mantém controles de uma operação anterior',async({page})=>{
  const state=await deletionSetup(page);
  await page.route('**/api/admin/organization-management/operations/previous-pause',route=>route.fulfill({json:{ok:true,id:'previous-pause',kind:'pause',createdAt:'2026-01-01',done:false,items:[{index:0,label:'Pausa anterior',state:'pending',attempts:0,result:null,error:null,code:null,retryable:true}]}}));
  await page.goto('/admin?section=organizations&org_id=1&org_operation=previous-pause');
  await expect(page.getByRole('button',{name:'Continuar pendências',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continuar pendências',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Retomar próximo item recuperável',exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});


test('recibo editável não fabrica sucesso e recibo consumido não reaparece',async({page})=>{
  const state=await deletionSetup(page);
  await page.evaluate(()=>{history.replaceState({...history.state,usr:{organizationDeletionReceipt:'forged-receipt'}},'',location.href);dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toBeVisible();
  const writes=state.mutations.length;
  await page.reload();
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toHaveCount(0);
  expect(state.mutations).toHaveLength(writes);
});


test('atualização de sessão após exclusão respeita navegação posterior',async({page})=>{
  const state=await deletionSetup(page);
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  await page.route('**/api/session',async route=>{entered();await pending;await route.fallback();});
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await started;
  await page.evaluate(()=>{history.pushState(history.state,'','/admin?section=organizations&org_q=other');dispatchEvent(new PopStateEvent('popstate'));});
  release();await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/org_q=other/);
  await expect(page.getByText('Organização excluída permanentemente.',{exact:false})).toHaveCount(0);
  expect(state.mutations.filter(value=>value.path.endsWith('/permanent-delete'))).toHaveLength(1);
});
