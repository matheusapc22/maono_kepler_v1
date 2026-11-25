import { expect, test, type Page, type Locator } from '@playwright/test';

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

async function deletionSetup(page:Page, options:{eligible?:boolean;enabled?:boolean;startResponseLost?:boolean;stepFailure?:boolean;role?:string;automatic?:boolean;automaticPaused?:boolean;automaticBlocked?:boolean;withOtherOrganization?:boolean}={}){
  const state=await setup(page,options.role||'super_admin');
  const org={id:1,name:'Organização Sintética Alfa',slug:'qa-alfa',description:'',active:false,version:3,plan:'free',owner:null,projectCount:0,userCount:1,fileCount:0,storageStatus:'DISABLED',updatedAt:'2026-01-01T12:00:00Z',lastActivityAt:null};
  const mutations:{path:string;body:unknown;key:string|undefined}[]=[];
  let deletion:{id:string;organizationId:number;state:string;retryable:boolean;errorCode:string|null;automatic?:boolean;automaticPaused?:boolean;automaticBlocked?:boolean}|null=null;
  let starts=0;
  const managementReads:string[]=[];
  const otherOrganization={...org,id:2,name:'Organização Sintética Beta',slug:'qa-beta',active:true,version:1,storageStatus:'READY'};
  let deletedDetailReads=0;
  await page.route('**/api/admin/organization-management/**',async route=>{
    const r=route.request(),url=new URL(r.url()),path=url.pathname.replace('/api/admin/organization-management','');
    if(r.method()==='POST')mutations.push({path,body:r.postDataJSON(),key:r.headers()['idempotency-key']});
    else managementReads.push(path+url.search);
    if(path==='/organizations'){
      const organizations=[...(deletion?.state==='completed'?[]:[org]),...(options.withOtherOrganization?[otherOrganization]:[])];
      return route.fulfill({json:{ok:true,organizations,pagination:{total:organizations.length,page:1,size:10,pages:1},summary:{organizations:organizations.length,active:options.withOtherOrganization?1:0,users:1,files:0,requests:0},capabilities:{projectQuotaEnforced:true,edits:true,permanentDelete:options.enabled!==false}}});
    }
    if(path==='/organizations/1'||path==='/organizations/2'){
      if(path.endsWith('/1')&&deletion?.state==='completed'){deletedDetailReads++;return route.fulfill({status:404,json:{ok:false,error:{code:'ORGANIZATION_NOT_FOUND',message:'Organização já excluída'}}});}
      return route.fulfill({json:{ok:true,organization:path.endsWith('/2')?otherOrganization:org,policy:{plan:'free',projects:5,storageMb:500,projectOverride:null,used:0,reserved:0,remaining:5,storageUsedMb:0,projectQuotaEnforced:true,informational:[]}}});
    }
    if(path==='/organizations/1/deletion-preview')return route.fulfill({json:{ok:true,organizationId:1,name:org.name,version:3,eligible:options.eligible!==false,blockers:options.eligible===false?[{code:'LINKED_DATA',count:2}]:[],confirmation:'EXCLUIR PERMANENTEMENTE'}});
    if(path==='/organizations/1/permanent-delete'){
      starts++;deletion={id:'delete-synthetic-1',organizationId:1,state:'pending',retryable:true,errorCode:null,automatic:options.automatic,automaticPaused:options.automaticPaused,automaticBlocked:options.automaticBlocked};
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
  if(options.role&&options.role!=='super_admin')return {...state,mutations,managementReads,deletedDetailReads:()=>deletedDetailReads,completeDeletion:undefined};
  await page.getByRole('button',{name:'Organização Sintética Alfa',exact:true}).click();
  return {...state,mutations,managementReads,deletedDetailReads:()=>deletedDetailReads,completeDeletion:()=>{if(deletion)deletion={...deletion,state:'completed'};}};
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
  const state=await deletionSetup(page,{eligible:false});
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeDisabled();
  await expect(page.getByText('A organização possui dados vinculados que impedem a exclusão.',{exact:false})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test('conclusão após Dropbox e banco mantém janela de continuidade e remove entidade excluída',async({page})=>{
  const state=await deletionSetup(page);await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByText('Organização Excluída')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'})).toHaveCount(0);
  expect(state.deletedDetailReads()).toBe(0);
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
  await expect(page.getByText('Organização Excluída',{exact:false})).toBeVisible();
  expect(state.mutations.filter(r=>r.path==='/organizations/1/permanent-delete')).toHaveLength(1);
});

test('falha do Dropbox não vira sucesso e permite retomada explícita',async({page})=>{
  const state=await deletionSetup(page,{stepFailure:true});await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('DROPBOX_DELETE_FAILED');
  await expect(page.getByRole('button',{name:'Retomar exclusão',exact:true})).toBeVisible();
  await expect(page.getByText('Organização Excluída',{exact:false})).toHaveCount(0);
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
  await expect(page.getByText('Organização Excluída',{exact:false})).toBeVisible();
  expect(state.mutations.filter(r=>r.path==='/organizations/1/permanent-delete')).toHaveLength(1);
});

test('permissão revogada ao abrir exclusão remove dados e impede confirmação',async({page})=>{
  const state=await deletionSetup(page);
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeEnabled();
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
  await expect(page.getByText('Organização Excluída',{exact:false})).toHaveCount(0);
  expect(state.mutations.filter(r=>r.path==='/organizations/1/permanent-delete')).toHaveLength(1);
});

test('entrar em exclusão não mantém controles de uma operação anterior',async({page})=>{
  const state=await deletionSetup(page);
  await page.route('**/api/admin/organization-management/operations/previous-pause',route=>route.fulfill({json:{ok:true,id:'previous-pause',kind:'pause',createdAt:'2026-01-01',done:false,items:[{index:0,label:'Pausa anterior',state:'pending',attempts:0,result:null,error:null,code:null,retryable:true}]}}));
  let recoverySteps=0;
  await page.route('**/api/admin/organization-management/operations/previous-pause/step',route=>{recoverySteps++;return route.fulfill({json:{ok:true,id:'previous-pause',kind:'pause',createdAt:'2026-01-01',done:true,items:[{index:0,label:'Pausa anterior',state:'succeeded',attempts:1,result:{id:1},error:null,code:null,retryable:false}]}});});
  await page.goto('/admin?section=organizations&org_id=1&org_operation=previous-pause');
  await expect(page.getByRole('button',{name:'Continuar pendências',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Continuar pendências',exact:true}).click();
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continuar pendências',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Retomar próximo item recuperável',exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);expect(recoverySteps).toBe(1);
});


test('recibo editável não fabrica sucesso e recibo consumido não reaparece',async({page})=>{
  const state=await deletionSetup(page);
  await page.evaluate(()=>{history.replaceState({...history.state,usr:{organizationDeletionReceipt:'forged-receipt'}},'',location.href);dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page.getByText('Organização Excluída',{exact:false})).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByText('Organização Excluída',{exact:false})).toBeVisible();
  const writes=state.mutations.length;
  await page.reload();
  await expect(page.getByText('Organização Excluída',{exact:false})).toHaveCount(0);
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
  await expect(page.getByText('Organização Excluída',{exact:false})).toHaveCount(0);
  expect(state.mutations.filter(value=>value.path.endsWith('/permanent-delete'))).toHaveLength(1);
});


test('exclusão automática confirma uma vez e acompanha somente por leitura até concluir',async({page})=>{
  const state=await deletionSetup(page,{automatic:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await expect(page.getByRole('button',{name:'Retomar exclusão',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await expect(page.getByText('Esta ação remove o cadastro', {exact:false})).toBeVisible();
  await expect(page.getByText('Operação', {exact:false}).filter({has:page.locator('code')})).toHaveCount(0);
  await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toBeVisible();
  await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toHaveValue('EXCLUIR PERMANENTEMENTE');
  await expect(page.getByRole('dialog').locator('.aog-dialog-body')).toHaveAttribute('inert','');
  await expect(page.getByRole('button',{name:'Consultar exclusão',exact:true})).toHaveCount(0);
  expect(state.mutations.map(r=>r.path)).toEqual(['/organizations/1/permanent-delete']);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.getByRole('dialog').locator('.mm-universal-loader__ring')).toHaveCSS('animation-name','none');
  await page.screenshot({path:test.info().outputPath('deletion-gold.png')});
  state.completeDeletion?.();
  await expect(page.getByText('Organização Excluída',{exact:true})).toBeVisible({timeout:10000});
  await expect(page.locator('.aog-deletion-toast')).toHaveCSS('position','fixed');
  await expect(page.getByText('Organização Excluída',{exact:true})).toHaveCount(0,{timeout:4500});
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toBeVisible();
  expect(state.deletedDetailReads()).toBe(0);
  expect(state.mutations).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

for(const mode of ['automaticPaused','automaticBlocked'] as const){
  test(`exclusão automática ${mode} informa bloqueio sem enviar etapas`,async({page})=>{
    const state=await deletionSetup(page,{automatic:true,[mode]:true});
    await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
    await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
    await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
    await expect(page.getByText(mode==='automaticPaused'?'Execução automática pausada pelo administrador.':'A execução automática foi interrompida para verificação administrativa.',{exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Retomar exclusão',exact:true})).toHaveCount(0);
    await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button',{name:'Consultar exclusão',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Consultar exclusão',exact:true}).click();
    expect(state.mutations).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });
}

test('reabrir exclusão automática perdida só consulta e fechar interrompe acompanhamento',async({page})=>{
  const state=await deletionSetup(page,{automatic:true,startResponseLost:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('button',{name:'Consultar exclusão',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  let reads=0;
  page.on('request',request=>{if(request.method()==='GET'&&request.url().includes('/deletions/'))reads++;});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(5500);
  expect(reads).toBe(0);
  expect(state.mutations).toHaveLength(1);
});

test('falha no acompanhamento não indica falha de exclusão e consulta permite recuperar',async({page})=>{
  const state=await deletionSetup(page,{automatic:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await page.route('**/deletions/delete-synthetic-1',route=>route.fulfill({status:503,json:{ok:false,error:{code:'UNAVAILABLE',message:'Indisponível'}}}));
  await expect(page.getByRole('alert')).toContainText('Isso não confirma falha da exclusão.',{timeout:10000});
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
  await expect(page.locator('.aog-deletion-error-toast')).toHaveCSS('position','fixed');
  await page.getByRole('button',{name:'Fechar aviso de erro'}).click();
  await expect(page.locator('.aog-deletion-error-toast')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Consultar exclusão',exact:true})).toBeVisible();
  await page.unroute('**/deletions/delete-synthetic-1');
  state.completeDeletion?.();
  await page.getByRole('button',{name:'Consultar exclusão',exact:true}).click();
  await expect(page.getByText('Organização Excluída',{exact:false})).toBeVisible();
  expect(state.mutations).toHaveLength(1);
});


test('acompanhamento automático invalida painel ao perder autorização',async({page})=>{
  const state=await deletionSetup(page,{automatic:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await page.route('**/deletions/delete-synthetic-1',route=>route.fulfill({status:403,json:{ok:false,error:{code:'FORBIDDEN',message:'Sem acesso'}}}));
  await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:10000});
  expect(state.mutations).toHaveLength(1);
});

test('erro de exclusão expira após dez segundos sem remover a recuperação',async({page})=>{
  await deletionSetup(page,{stepFailure:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.locator('.aog-deletion-error-toast')).toBeVisible();
  await expect(page.locator('.aog-deletion-error-toast')).toHaveCSS('top','24px');
  await expect(page.getByRole('button',{name:'Fechar aviso de erro'})).toBeVisible();
  await expect(page.locator('.aog-deletion-error-toast')).toHaveCount(0,{timeout:12000});
  await expect(page.getByRole('button',{name:'Retomar exclusão',exact:true})).toBeEnabled();
  await expect(page.getByText('A conclusão não foi confirmada.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Retomar exclusão',exact:true}).click();
  await expect(page.locator('.aog-deletion-error-toast')).toBeVisible();
});

test('falha de sessão após exclusão mantém sucesso e recupera continuidade na primeira consulta',async({page})=>{
  const state=await deletionSetup(page,{withOtherOrganization:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.route('**/api/session',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByText('Organização Excluída',{exact:true})).toBeVisible();
  await expect(page.locator('.aog-deletion-error-toast')).toContainText('A exclusão foi concluída');
  await page.getByRole('button',{name:'Fechar aviso de erro'}).click();
  await expect(page.locator('.aog-deletion-error-toast')).toHaveCount(0);
  await expect(page.getByText('Sessão desatualizada. Recarregue a página antes de continuar.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Selecionar organização',{exact:true})).toBeDisabled();
  let recoveredSessions=0;
  await page.route('**/api/session',route=>{
    recoveredSessions++;
    return route.fulfill({json:{authenticated:true,user:{id:1,name:'Operador sintético',email:'qa@example.test',role:'super_admin',activeOrganizationId:2},projects:[],organizations:[],activeOrganization:null}});
  });
  await page.getByRole('button',{name:'Consultar organizações',exact:true}).click();
  await expect(page.getByText('Sessão desatualizada. Recarregue a página antes de continuar.',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Selecionar organização',{exact:true})).toBeEnabled();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toBeVisible();
  expect(recoveredSessions).toBe(1);
  expect(state.mutations.filter(value=>value.path.endsWith('/permanent-delete'))).toHaveLength(1);
  expect(state.deletedDetailReads()).toBe(0);
});

test('toast de exclusão sobrevive refresh lento e troca do contexto ativo da sessão',async({page},info)=>{
  const state=await deletionSetup(page,{automatic:true});
  await page.goto('/admin?section=organizations&org_q=QA%20Exclus%C3%A3o%20Autom%C3%A1tica%2020261117&org_id=1');
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  await page.route('**/api/session',async route=>{
    entered();await pending;
    await route.fulfill({json:{authenticated:true,user:{id:1,name:'Operador sintético',email:'qa@example.test',role:'super_admin',activeOrganizationId:2},projects:[],organizations:[],activeOrganization:null}});
  });
  await page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'}).fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  state.completeDeletion?.();
  await started;
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toHaveValue('EXCLUIR PERMANENTEMENTE');
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.getByText('Organização Excluída',{exact:true})).toHaveCount(0);
  await freezeClock(page);
  release();
  const toast=page.getByText('Organização Excluída',{exact:true});
  await expect(toast).toBeVisible();
  await expect(toast).toBeInViewport();
  await page.screenshot({path:info.outputPath('deletion-toast-after-session-remount.png'),fullPage:true});
  await expect(page).toHaveURL(/org_q=QA[+%]/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toBeVisible();
  expect(state.deletedDetailReads()).toBe(0);
  await page.clock.fastForward(2999);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1);
  await expect(toast).toHaveCount(0);
  expect(state.mutations).toHaveLength(1);
});

for(const outcome of ['succeeded','failed','partial','pending'] as const){
  test(`pausa ${outcome}: formulário persistente e recuperação preservada`,async({page},info)=>{
    await setup(page);
    let currentOrg={id:1,name:'Organização Sintética Alfa',slug:'qa-alfa',description:'Dados de teste',active:true,version:0,plan:'free',owner:null,projectCount:2,userCount:2,fileCount:1,storageStatus:'READY'};
    await page.route('**/api/admin/organization-management/organizations/1',route=>route.fulfill({json:{ok:true,organization:currentOrg,policy:{plan:'free',projects:5,storageMb:500,projectOverride:null,used:2,reserved:0,remaining:3,storageUsedMb:1,projectQuotaEnforced:true,informational:[]}}}));
    let release!:()=>void,entered!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const operation={id:'pause-synthetic',kind:'pause',createdAt:'2026-01-01',done:false,items:[{index:0,label:'Organização Sintética Alfa',state:'pending',attempts:0,result:null,error:null,code:null,retryable:false}]};
    await page.route('**/api/admin/organization-management/operations',route=>route.fulfill({json:{ok:true,...operation}}));
    await page.route('**/api/admin/organization-management/operations/pause-synthetic/step',async route=>{
      entered();await pending;
      if(outcome==='succeeded')currentOrg={...currentOrg,active:false,version:1};
      await route.fulfill({json:{ok:true,...operation,done:outcome!=='pending',items:[{...operation.items[0],state:outcome,result:outcome==='succeeded'?{id:1}:null,retryable:outcome==='failed'||outcome==='partial',error:outcome==='failed'?'Falha sintética recuperável':null}]}});
    });
    await page.getByRole('button',{name:'Organização Sintética Alfa',exact:true}).click();
    await page.getByLabel('Nome',{exact:true}).fill('Rascunho de gestão');
    await page.getByLabel('Justificativa',{exact:true}).fill('Comentário preservado');
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Pausar organização',exact:true}).click();
    await started;
    const dialog=page.getByRole('dialog');
    await expect(dialog.locator('.mm-universal-loader')).toBeVisible();
    await expect(dialog.getByText('pause-synthetic',{exact:true})).toBeHidden();
    await expect(dialog.getByText('A execução avança',{exact:false})).toBeHidden();
    await expect(dialog.getByRole('button',{name:'Pausar organização',exact:true,includeHidden:true})).toBeVisible();
    await expect(dialog.getByLabel('Nome',{exact:true})).toBeVisible();
    await expect(dialog.getByLabel('Nome',{exact:true})).toHaveValue('Rascunho de gestão');
    await expect(dialog.locator('.aog-dialog-body')).toHaveAttribute('inert','');
    if(outcome==='succeeded')await page.screenshot({path:info.outputPath('pause-loading.png'),fullPage:true});
    release();
    if(outcome==='succeeded'){
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.mm-universal-loader')).toHaveCount(0);
      await expect(dialog.getByLabel('Nome',{exact:true})).toHaveValue('Rascunho de gestão');
      await expect(dialog.getByLabel('Justificativa',{exact:true})).toHaveValue('Comentário preservado');
      await expect(page.getByRole('button',{name:'Reativar / verificar armazenamento',exact:true})).toBeVisible();
      await expect(page.getByText('Organização pausada',{exact:true})).toBeVisible();
      await page.screenshot({path:info.outputPath('pause-success.png'),fullPage:true});
    }else{
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.mm-universal-loader')).toBeHidden();
      await expect(page.getByText('Organização pausada',{exact:true})).toBeHidden();
      await expect(dialog.getByRole('button',{name:outcome==='pending'?'Continuar pendências':'Retomar próximo item recuperável',exact:true})).toBeVisible();
      await expectToastAboveDialog(page,page.locator('.aog-deletion-error-toast'));
      await expect(page.locator('.aog-deletion-error-toast')).toContainText(outcome==='failed'?'Falha sintética recuperável':'A conclusão ainda não foi confirmada');
      await expect(dialog.getByLabel('Nome',{exact:true})).toHaveValue('Rascunho de gestão');
      await expect(dialog.getByLabel('Justificativa',{exact:true})).toHaveValue('Comentário preservado');
      await page.getByRole('button',{name:'Fechar aviso de erro',exact:true}).click();
      await expect(dialog.getByRole('button',{name:outcome==='pending'?'Continuar pendências':'Retomar próximo item recuperável',exact:true})).toBeVisible();
    }
  });
}

async function pauseDrainSetup(page:Page,enabled=true){
  await setup(page);
  let org={id:1,name:'Organização Sintética Alfa',slug:'qa-alfa',description:'',active:true,version:3,plan:'free',owner:null,projectCount:0,userCount:1,fileCount:0,storageStatus:'DISABLED',updatedAt:'2026-01-01T12:00:00Z',lastActivityAt:null};
  let draining=true,otherBlocker=false,previewStatus=200,previewReads=0;
  let operation={id:'pause-drain',kind:'pause',createdAt:'2026-01-01',done:false,items:[{index:0,label:'#1',state:'pending',attempts:0,result:{id:1},error:null,code:null,retryable:false}]};
  const posts:string[]=[];
  await page.route('**/api/admin/organization-management/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/admin/organization-management','');
    if(request.method()==='POST')posts.push(path);
    if(path==='/organizations')return route.fulfill({json:{ok:true,organizations:[org],pagination:{total:1,page:1,size:10,pages:1},summary:{organizations:1,active:org.active?1:0,users:1,files:0,requests:0},capabilities:{projectQuotaEnforced:true,edits:true,permanentDelete:enabled}}});
    if(path==='/organizations/1')return route.fulfill({json:{ok:true,organization:org,policy:{plan:'free',projects:5,storageMb:500,projectOverride:null,used:0,reserved:0,remaining:5,storageUsedMb:0,projectQuotaEnforced:true,informational:[]}}});
    if(path==='/operations'||path==='/operations/pause-drain')return route.fulfill({json:{ok:true,...operation}});
    if(path==='/operations/pause-drain/step'){
      org={...org,active:false,version:4};operation={...operation,done:true,items:[{...operation.items[0],state:'succeeded'}]};
      return route.fulfill({json:{ok:true,...operation}});
    }
    if(path==='/organizations/1/deletion-preview'){
      previewReads++;
      if(previewStatus!==200)return route.fulfill({status:previewStatus,json:{ok:false,error:{code:'PREVIEW_UNAVAILABLE',message:'Indisponível'}}});
      const blockers=[...(draining?[{code:'STORAGE_DRAIN_REQUIRED',count:1}]:[]),...(otherBlocker?[{code:'LINKED_DATA',count:2}]:[])];
      return route.fulfill({json:{ok:true,organizationId:1,name:org.name,version:org.version,eligible:!blockers.length,blockers,confirmation:'EXCLUIR PERMANENTEMENTE'}});
    }
    return route.fallback();
  });
  await page.reload();await page.getByRole('button',{name:org.name,exact:true}).click();
  await page.clock.install();
  return {posts,reads:()=>previewReads,release:()=>{draining=false;},block:()=>{otherBlocker=true;},status:(value:number)=>{previewStatus=value;}};
}
async function confirmPause(page:Page){
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Pausar organização',exact:true}).click();
}

test('pausa aguarda liberação do servidor, não relógio; exclusão permanece confirmação separada',async({page})=>{
  const state=await pauseDrainSetup(page);await confirmPause(page);
  await expect.poll(state.reads).toBeGreaterThan(0);
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await expect(page.getByText('pause-drain',{exact:true})).toBeHidden();
  await freezeClock(page,true);
  await page.clock.fastForward(120000);
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true,includeHidden:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true,includeHidden:true})).toBeDisabled();
  const reads=state.reads();state.release();await page.clock.fastForward(5000);
  await expect.poll(state.reads).toBeGreaterThan(reads);
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeEnabled();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
  expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Digite EXCLUIR PERMANENTEMENTE'})).toBeVisible();
  expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
});

test('reload da drenagem retoma só leituras e ESC interrompe acompanhamento',async({page})=>{
  const state=await pauseDrainSetup(page);await confirmPause(page);
  await expect.poll(state.reads).toBeGreaterThan(0);await expect(page).toHaveURL(/org_operation=pause-drain/);
  const before=state.reads();await page.reload();
  await expect.poll(state.reads).toBeGreaterThan(before);
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
  await page.keyboard.press('Tab');
  expect(await page.getByRole('dialog').evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  const after=state.reads();await page.waitForTimeout(5500);expect(state.reads()).toBe(after);
});

for(const scenario of ['blocker','error','denied'] as const){
  test(`fim da drenagem com ${scenario} não libera exclusão indevidamente`,async({page})=>{
    const state=await pauseDrainSetup(page);if(scenario==='blocker')state.block();await confirmPause(page);
    await expect.poll(state.reads).toBeGreaterThan(0);
    await freezeClock(page,true);
    if(scenario==='blocker'){state.block();state.release();}else state.status(scenario==='denied'?403:503);
    await page.clock.fastForward(5000);
    if(scenario==='denied'){
      await expect(page.getByRole('link',{name:'Entrar novamente'})).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }else{
      await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Consultar liberação para exclusão'})).toBeVisible();
      if(scenario==='blocker')await expect(page.getByText('A organização possui dados vinculados que impedem a exclusão.',{exact:false})).toBeVisible();
      else{
        await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar a liberação');
        const dialog=page.getByRole('dialog'),body=dialog.locator('.aog-dialog-body');
        const retry=page.getByRole('button',{name:'Consultar liberação para exclusão',includeHidden:true});
        await retry.scrollIntoViewIfNeeded();
        const origin=await dialogBounds(dialog),content=await body.innerText(),retryNode=await retry.elementHandle();
        let release!:()=>void,entered!:()=>void;
        const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
        await page.route('**/api/admin/organization-management/organizations/1/deletion-preview',async route=>{entered();await pending;await route.fallback();});
        state.status(200);state.release();await retry.click();await started;
        await expect(dialog.locator('.mm-universal-loader')).toBeVisible();
        await expectSameBounds(dialog,origin);await expect(body).toHaveAttribute('inert','');
        expect(await body.innerText()).toBe(content);
        expect(await retryNode!.evaluate(element=>element.isConnected)).toBe(true);
        await expect(retry).toBeVisible();
        release();
        await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeEnabled();
        await expect(dialog).toBeVisible();await expect(dialog.locator('.mm-universal-loader')).toHaveCount(0);
      }
    }
    expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
  });
}

test('limite de cinco minutos encerra espera sem habilitar exclusão',async({page})=>{
  const state=await pauseDrainSetup(page);await confirmPause(page);
  await expect.poll(state.reads).toBeGreaterThan(0);
  await freezeClock(page,true);
  await page.clock.fastForward(300000);
  await expect(page.getByRole('alert')).toContainText('A espera de segurança ainda não foi liberada');
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeDisabled();
  // Drain the request already dispatched before the deadline before asserting no new polls.
  await page.waitForTimeout(100);
  const reads=state.reads();await page.clock.fastForward(10000);await page.waitForTimeout(100);expect(state.reads()).toBe(reads);
  expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
});

for(const invalid of ['identity','contradiction'] as const){
  test(`prévia ${invalid} falha fechada após pausa`,async({page})=>{
    const state=await pauseDrainSetup(page);await confirmPause(page);
    await expect.poll(state.reads).toBeGreaterThan(0);
    await freezeClock(page,true);
    await page.route('**/api/admin/organization-management/organizations/1/deletion-preview',route=>route.fulfill({json:{ok:true,organizationId:invalid==='identity'?2:1,eligible:true,blockers:invalid==='contradiction'?[{code:'STORAGE_DRAIN_REQUIRED',count:1}]:[]}}));
    await page.clock.fastForward(5000);
    await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar a liberação');
    await expect(page.getByRole('button',{name:'Excluir permanentemente organização',exact:true})).toBeDisabled();
    await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
    expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
  });
}

test('pausa sem capability de exclusão mantém conclusão sem consultar drenagem',async({page})=>{
  const state=await pauseDrainSetup(page,false);await confirmPause(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button',{name:'Reativar / verificar armazenamento',exact:true})).toBeVisible();
  await expect(page.getByText('Organização pausada',{exact:true})).toBeVisible();
  expect(state.reads()).toBe(0);
  expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
});

test('voltar durante drenagem cancela leitura sem repetir pausa',async({page})=>{
  const state=await pauseDrainSetup(page);await confirmPause(page);
  await expect.poll(state.reads).toBeGreaterThan(0);
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  const reads=state.reads();await page.waitForTimeout(5500);expect(state.reads()).toBe(reads);
  expect(state.posts).toEqual(['/operations','/operations/pause-drain/step']);
});

async function freezeClock(page:Page,installed=false){
  if(!installed)await page.clock.install();
  // Install before creating timers; pause at a future boundary to avoid clock races.
  const now=await page.evaluate(()=>Date.now());
  await page.clock.pauseAt(new Date(now+1000));
}

async function dialogBounds(dialog:Locator){
  const bounds=await dialog.boundingBox();
  expect(bounds,'O dialog deve ter uma caixa visível').not.toBeNull();
  return bounds!;
}
async function expectSameBounds(dialog:Locator,origin:{x:number;y:number;width:number;height:number}){
  await expect.poll(async()=>{
    const current=await dialogBounds(dialog);
    return Math.max(...(['x','y','width','height'] as const).map(key=>Math.abs(current[key]-origin[key])));
  },{message:'O carregamento não pode mover nem redimensionar o formulário de origem'}).toBeLessThanOrEqual(1);
}
async function expectCenteredDialog(page:Page){
  const bounds=await dialogBounds(page.getByRole('dialog')),viewport=page.viewportSize()!;
  expect(Math.abs(bounds.x+bounds.width/2-viewport.width/2)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.y+bounds.height/2-viewport.height/2)).toBeLessThanOrEqual(1);
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);
}
async function expectToastAboveDialog(page:Page,toast:Locator){
  await expect(toast).toBeVisible();await expect(toast).toBeInViewport();
  const bounds=await dialogBounds(toast);
  expect(await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('.aog-deletion-toast,.aog-deletion-error-toast')),{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2})).toBe(true);
  expect(await toast.evaluate(element=>Boolean(element.closest('dialog[open]'))&&!element.closest('[inert]'))).toBe(true);
}

for(const width of [1280,1440,390]){
  test(`exclusão ${width}px preserva caixa, formulário, rolagem e foco sob o círculo`,async({page},info)=>{
    await page.setViewportSize({width,height:844});
    const state=await deletionSetup(page,{automatic:true});
    await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
    const dialog=page.getByRole('dialog'),body=dialog.locator('.aog-dialog-body');
    const input=page.getByLabel('Digite EXCLUIR PERMANENTEMENTE');
    await input.fill('EXCLUIR PERMANENTEMENTE');
    const button=page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true,includeHidden:true});
    await button.scrollIntoViewIfNeeded();
    await expectCenteredDialog(page);
    const origin=await dialogBounds(dialog),scroll=await body.evaluate(element=>element.scrollTop),content=await body.innerText(),node=await input.elementHandle();
    await page.screenshot({path:info.outputPath(`deletion-origin-${width}.png`)});
    await button.click();
    await expect(dialog.locator('.mm-universal-loader')).toBeVisible();
    await expect(body).toHaveAttribute('inert','');await expect(body).toHaveAttribute('aria-busy','true');
    await expectSameBounds(dialog,origin);await expectCenteredDialog(page);
    await expect(input).toBeVisible();await expect(input).toHaveValue('EXCLUIR PERMANENTEMENTE');
    expect(await node!.evaluate(element=>element.isConnected)).toBe(true);
    expect(await body.innerText()).toBe(content);
    expect(Math.abs(await body.evaluate(element=>element.scrollTop)-scroll)).toBeLessThanOrEqual(1);
    await input.evaluate(element=>element.focus());
    expect(await page.evaluate(()=>Boolean(document.activeElement?.closest('[inert]')))).toBe(false);
    await expect(dialog.getByRole('heading',{name:'Excluir permanentemente organização',exact:true})).toBeFocused();
    await page.keyboard.press('Enter');
    expect(state.mutations.filter(value=>value.path.endsWith('/permanent-delete'))).toHaveLength(1);
    for(let step=0;step<4;step++){
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element=>element.contains(document.activeElement)&&!document.activeElement?.closest('[inert]'))).toBe(true);
    }
    const buttonBox=await button.boundingBox();
    if(buttonBox){await page.mouse.click(buttonBox.x+buttonBox.width/2,buttonBox.y+buttonBox.height/2);}
    expect(state.mutations.filter(value=>value.path.endsWith('/permanent-delete'))).toHaveLength(1);
    await page.screenshot({path:info.outputPath(`deletion-overlay-${width}.png`)});
    state.completeDeletion?.();
    await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toBeVisible();
    await expect(dialog).toBeVisible();await expect(dialog.locator('.mm-universal-loader')).toHaveCount(0);
    await expectToastAboveDialog(page,page.locator('.aog-deletion-toast'));
    await expectCenteredDialog(page);expect(state.deletedDetailReads()).toBe(0);
    await page.screenshot({path:info.outputPath(`deletion-destination-${width}.png`)});
    expect(state.errors).toEqual([]);
  });
}

test('prévia lenta mantém editor e rascunho até a troca única para confirmação',async({page})=>{
  const state=await deletionSetup(page);
  const trigger=page.getByRole('button',{name:'Excluir permanentemente organização',exact:true});
  await expect(trigger).toBeEnabled();
  const name=page.getByLabel('Nome',{exact:true}),description=page.getByLabel('Descrição',{exact:true});
  await name.fill('Rascunho local ainda não salvo');await description.fill('Texto preservado durante a preparação.');
  await trigger.scrollIntoViewIfNeeded();
  const dialog=page.getByRole('dialog'),origin=await dialogBounds(dialog),node=await name.elementHandle();
  let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  await page.route('**/api/admin/organization-management/organizations/1/deletion-preview',async route=>{
    entered();await pending;
    await route.fulfill({json:{ok:true,organizationId:1,name:'Organização Sintética Alfa',version:3,eligible:true,blockers:[],confirmation:'EXCLUIR PERMANENTEMENTE'}});
  });
  await trigger.click();await started;
  await expect(dialog.locator('.mm-universal-loader')).toBeVisible();
  await expect(name).toBeVisible();await expect(name).toHaveValue('Rascunho local ainda não salvo');
  await expect(description).toHaveValue('Texto preservado durante a preparação.');
  await expectSameBounds(dialog,origin);expect(await node!.evaluate(element=>element.isConnected)).toBe(true);
  await expect(page).not.toHaveURL(/org_mode=delete/);
  await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toHaveCount(0);
  release();
  await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toBeVisible();
  await expect(page).toHaveURL(/org_mode=delete/);
  await expect(name).toHaveCount(0);await expect(dialog.locator('.mm-universal-loader')).toHaveCount(0);
  expect(state.mutations).toEqual([]);expect(state.errors).toEqual([]);
});

test('falha na prévia mantém rascunho e erro utilizável no topo do modal aberto',async({page})=>{
  const state=await deletionSetup(page);
  const trigger=page.getByRole('button',{name:'Excluir permanentemente organização',exact:true});
  await expect(trigger).toBeEnabled();
  const name=page.getByLabel('Nome',{exact:true});await name.fill('Rascunho preservado na falha');
  await page.route('**/api/admin/organization-management/organizations/1/deletion-preview',route=>route.fulfill({status:503,json:{ok:false,error:{code:'UNAVAILABLE',message:'Indisponível'}}}));
  await trigger.click();
  const dialog=page.getByRole('dialog');
  await expectToastAboveDialog(page,page.locator('.aog-deletion-error-toast'));
  await expect(dialog).toBeVisible();await expect(dialog.locator('.mm-universal-loader')).toHaveCount(0);
  await expect(name).toHaveValue('Rascunho preservado na falha');
  await expect(page).not.toHaveURL(/org_mode=delete/);
  await page.getByRole('button',{name:'Fechar aviso de erro',exact:true}).click();
  await expect(page.locator('.aog-deletion-error-toast')).toHaveCount(0);
  await expect(name).toHaveValue('Rascunho preservado na falha');await expect(dialog).toBeVisible();
  await page.unroute('**/api/admin/organization-management/organizations/1/deletion-preview');
  await trigger.click();await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toBeVisible();
  expect(state.mutations).toEqual([]);expect(state.errors).toEqual([]);
});

test('conclusão permite abrir outra organização na mesma janela',async({page})=>{
  const state=await deletionSetup(page,{withOtherOrganization:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByLabel('Digite EXCLUIR PERMANENTEMENTE').fill('EXCLUIR PERMANENTEMENTE');
  const dialog=page.getByRole('dialog'),node=await dialog.elementHandle();
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toBeVisible();
  expect(await node!.evaluate(element=>element.isConnected&&(element as HTMLDialogElement).open)).toBe(true);
  await page.getByLabel('Selecionar organização',{exact:true}).selectOption('2');
  await page.getByRole('button',{name:'Abrir organização',exact:true}).click();
  await expect(page.getByLabel('Nome',{exact:true})).toHaveValue('Organização Sintética Beta');
  await expect(dialog).toBeVisible();expect(await node!.evaluate(element=>element.isConnected)).toBe(true);
  expect(state.deletedDetailReads()).toBe(0);
  expect(state.mutations.filter(value=>value.path.endsWith('/permanent-delete'))).toHaveLength(1);
});

test('erro na lista após exclusão concluída preserva resultado e só repete consulta',async({page})=>{
  const state=await deletionSetup(page,{automatic:true});
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.getByLabel('Digite EXCLUIR PERMANENTEMENTE').fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toBeVisible();
  await page.route('**/api/admin/organization-management/organizations?*',route=>route.fulfill({status:503,json:{ok:false,error:{code:'UNAVAILABLE',message:'Indisponível'}}}));
  state.completeDeletion?.();
  await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toBeVisible();
  await expect(page.getByText('Organização Excluída',{exact:true})).toBeVisible();
  await expectToastAboveDialog(page,page.locator('.aog-deletion-error-toast'));
  await page.unroute('**/api/admin/organization-management/organizations?*');
  await page.getByRole('button',{name:'Consultar organizações',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.mm-universal-loader')).toHaveCount(0);
  expect(state.mutations).toHaveLength(1);expect(state.deletedDetailReads()).toBe(0);
});

test('mudança de usuário na atualização de sessão descarta contexto e sucesso anteriores',async({page})=>{
  const state=await deletionSetup(page);
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  await page.route('**/api/session',route=>route.fulfill({json:{authenticated:true,user:{id:2,name:'Outro operador sintético',email:'qa-other@example.test',role:'super_admin',activeOrganizationId:null},projects:[],organizations:[],activeOrganization:null}}));
  await page.getByLabel('Digite EXCLUIR PERMANENTEMENTE').fill('EXCLUIR PERMANENTEMENTE');
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/org_(id|deletion|delete_key)=/);
  await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toHaveCount(0);
  await expect(page.getByText('Organização Excluída',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Continuar gestão',exact:true})).toHaveCount(0);
  expect(state.mutations.filter(value=>value.path.endsWith('/permanent-delete'))).toHaveLength(1);
});

test('conflito de versão conserva rascunhos e consulta explícita não os apaga',async({page})=>{
  await setup(page);
  await page.getByRole('button',{name:'Organização Sintética Alfa',exact:true}).click();
  const name=page.getByLabel('Nome',{exact:true}),reason=page.getByLabel('Justificativa',{exact:true});
  await name.fill('Meu rascunho local');await reason.fill('Justificativa que deve continuar');
  let writes=0;
  await page.route('**/api/admin/organization-management/operations',route=>{
    if(route.request().method()==='POST')writes++;
    return route.fulfill({status:409,json:{ok:false,error:{code:'ORGANIZATION_VERSION_CONFLICT',message:'A organização mudou. Revise os dados.'}}});
  });
  await page.getByRole('button',{name:'Salvar dados',exact:true}).click();
  await expectToastAboveDialog(page,page.locator('.aog-deletion-error-toast'));
  await expect(name).toHaveValue('Meu rascunho local');await expect(reason).toHaveValue('Justificativa que deve continuar');
  await page.route('**/api/admin/organization-management/organizations/1',route=>route.fulfill({json:{ok:true,organization:{id:1,name:'Nome atualizado no servidor',slug:'qa-alfa',description:'Descrição atualizada no servidor',active:true,version:1,plan:'free',owner:null,projectCount:2,userCount:2,fileCount:1,storageStatus:'READY'},policy:{plan:'free',projects:5,storageMb:500,projectOverride:null,used:2,reserved:0,remaining:3,storageUsedMb:1,projectQuotaEnforced:true,informational:[]}}}));
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Consultar versão atual',exact:true}).click();
  await expect(page.getByText('Versão de edição: 1.',{exact:false})).toBeVisible();
  await expect(name).toHaveValue('Meu rascunho local');await expect(reason).toHaveValue('Justificativa que deve continuar');
  await expect(page.getByLabel('Descrição',{exact:true})).toHaveValue('Descrição atualizada no servidor');
  expect(writes).toBe(1);await expect(page.getByRole('dialog')).toBeVisible();
});

for(const invalid of ['identity','contradiction','confirmation','version'] as const){
  test(`prévia preparada com ${invalid} inválida conserva editor sem abrir confirmação`,async({page})=>{
    const state=await deletionSetup(page);
    const trigger=page.getByRole('button',{name:'Excluir permanentemente organização',exact:true});
    await expect(trigger).toBeEnabled();
    await page.getByLabel('Nome',{exact:true}).fill('Rascunho não descartado');
    await page.route('**/api/admin/organization-management/organizations/1/deletion-preview',route=>route.fulfill({json:{ok:true,organizationId:invalid==='identity'?2:1,name:'Organização Sintética Alfa',version:invalid==='version'?-1:3,eligible:true,blockers:invalid==='contradiction'?[{code:'LINKED_DATA',count:1}]:[],confirmation:invalid==='confirmation'?'EXCLUIR':'EXCLUIR PERMANENTEMENTE'}}));
    await trigger.click();
    await expect(page.locator('.aog-deletion-error-toast')).toBeVisible();
    await expect(page.getByLabel('Nome',{exact:true})).toHaveValue('Rascunho não descartado');
    await expect(page.getByLabel('Digite EXCLUIR PERMANENTEMENTE')).toHaveCount(0);
    await expect(page).not.toHaveURL(/org_mode=delete/);
    expect(state.mutations).toEqual([]);
  });
}

test('versão da exclusão desatualizada exige consultar prévia sem repetir envio',async({page})=>{
  const state=await deletionSetup(page);
  await page.getByRole('button',{name:'Excluir permanentemente organização',exact:true}).click();
  const input=page.getByLabel('Digite EXCLUIR PERMANENTEMENTE');
  await input.fill('EXCLUIR PERMANENTEMENTE');
  let starts=0,previews=0;
  await page.route('**/api/admin/organization-management/organizations/1/permanent-delete',route=>{
    starts++;return route.fulfill({status:412,json:{ok:false,error:{code:'ORGANIZATION_VERSION_CONFLICT',message:'A organização mudou. Revise os dados.'}}});
  });
  await page.route('**/api/admin/organization-management/organizations/1/deletion-preview',route=>{
    previews++;return route.fulfill({json:{ok:true,organizationId:1,name:'Organização Sintética Alfa',version:4,eligible:true,blockers:[],confirmation:'EXCLUIR PERMANENTEMENTE'}});
  });
  await page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true}).click();
  await expect(page.locator('.aog-deletion-error-toast')).toBeVisible();
  await expect(input).toHaveValue('EXCLUIR PERMANENTEMENTE');
  await expect(page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true})).toBeDisabled();
  expect(starts).toBe(1);expect(previews).toBe(0);
  await page.getByRole('button',{name:'Consultar prévia atual',exact:true}).click();
  await expect.poll(()=>previews).toBe(1);
  await expect(page.getByRole('button',{name:'Confirmar exclusão permanente',exact:true})).toBeEnabled();
  await expect(input).toHaveValue('EXCLUIR PERMANENTEMENTE');
  expect(starts).toBe(1);expect(state.mutations).toEqual([]);
  expect(state.managementReads.some(value=>value.startsWith('/deletions/by-key?key='))).toBe(true);
});

for(const width of [1280,390]){
  for(const mode of ['requests','operations'] as const){
    test(`modal compartilhado ${mode} em ${width}px mantém centro, foco e fechamento voluntário`,async({page},info)=>{
      await page.setViewportSize({width,height:844});
      const state=await setup(page);
      await page.route('**/api/admin/organization-management/requests?*',route=>route.fulfill({json:{ok:true,requests:[],hasMore:false}}));
      const trigger=mode==='requests'?page.getByRole('button',{name:'Solicitações 0',exact:true}):page.getByRole('button',{name:'Minhas operações',exact:true});
      const title=mode==='requests'?'Solicitações de plano e limites':'Minhas operações';
      await trigger.click();
      const dialog=page.getByRole('dialog');
      await expect(dialog.getByRole('heading',{name:title,exact:true})).toBeVisible();
      await expect(dialog.getByText(mode==='requests'?'Nenhuma solicitação neste estado.':'Nenhuma operação encontrada.',{exact:true})).toBeVisible();
      await expectCenteredDialog(page);
      for(let index=0;index<6;index++){
        await page.keyboard.press(index%2?'Shift+Tab':'Tab');
        expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
      }
      await page.screenshot({path:info.outputPath(`shared-dialog-${mode}-${width}.png`)});
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
      await expect(page).not.toHaveURL(/org_mode=/);
      await trigger.click();await expect(dialog).toBeVisible();
      await dialog.getByRole('button',{name:'Fechar painel',exact:true}).click();
      await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
      expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
    });
  }
}
