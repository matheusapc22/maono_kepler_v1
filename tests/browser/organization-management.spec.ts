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
  await page.getByPlaceholder('Nome ou identificador…').fill('Alfa');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Organização Sintética Beta',exact:true})).toHaveCount(0);
  await expect(page.locator('.aog-metric').filter({hasText:'Organizações'}).locator('strong')).toHaveText('2');
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
  await page.getByPlaceholder('Nome ou identificador…').fill('Beta');
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
  const search=page.getByPlaceholder('Nome ou identificador.');
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

test('arquivo que não é UTF-8 é rejeitado antes da validação remota',async({page})=>{
  const state=await setup(page);await page.getByRole('button',{name:'Importar',exact:true}).click();
  await page.getByLabel('Arquivo CSV').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from([0xff,0xfe,0x61])});
  await expect(page.getByRole('alert')).toContainText('CSV UTF-8');
  await expect(page.getByRole('button',{name:'Validar arquivo'})).toBeDisabled();
  expect(state.writes).toEqual([]);
});
