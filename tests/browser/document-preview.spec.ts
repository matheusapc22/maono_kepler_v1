import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = (name: string) => readFileSync(new URL(`../fixtures/document-preview/${name}`, import.meta.url));
const files = [
 {id:10,name:'Panorama de mercado.pdf',fileType:'pdf',mimeType:'application/pdf',size:10000},
 {id:11,name:'Área de influência.png',fileType:'image',mimeType:'image/png',size:10000},
 {id:12,name:'Planilha de oportunidades.xlsx',fileType:'spreadsheet',size:2000},
 {id:13,name:'Relatório grande.pdf',fileType:'pdf',size:21*1024*1024},
 {id:14,name:'Arquivo inválido.pdf',fileType:'pdf',size:100},
 {id:15,name:'Fotografia.jpg',fileType:'image',mimeType:'image/jpeg',size:10000},
 {id:16,name:'Mapa.webp',fileType:'image',mimeType:'image/webp',size:10000},
];
type Options = { noDownload?: boolean; download?: (route: Route, id: number, index: number) => Promise<void> };
async function setup(page: Page, options: Options = {}) {
 const downloads: string[]=[];let currentOrg=1;
 const organizations=[{id:1,name:'Demonstração Maõno',slug:'demo',active:true},{id:2,name:'Outra organização',slug:'other',active:true}];
 const session=()=>({authenticated:true,user:{id:1,name:'Operador sintético',email:'qa@example.test',role:options.noDownload?'viewer':'super_admin',permissions:options.noDownload?['document.view']:[],activeOrganizationId:currentOrg},projects:[],organizations,activeOrganization:organizations[currentOrg-1]});
 await page.addInitScript(()=>{
  const created:string[]=[];const revoked:string[]=[];
  Object.assign(window,{previewUrlEvents:{created,revoked}});
  const create=URL.createObjectURL.bind(URL);const revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=value=>{const url=create(value);if(value instanceof Blob && value.type.startsWith('image/'))created.push(url);return url;};
  URL.revokeObjectURL=url=>{if(created.includes(url))revoked.push(url);revoke(url);};
 });
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/session')return route.fulfill({json:session()});
  if(url.pathname==='/api/session/active-organization') {currentOrg=JSON.parse(route.request().postData()||'{}').organizationId;return route.fulfill({json:session()});}
  if(url.pathname.endsWith('/document-folders'))return route.fulfill({json:{ok:true,folders:[]}});
  if(/\/files\/\d+\/download$/.test(url.pathname)) {
   downloads.push(url.pathname);const id=Number(url.pathname.split('/').at(-2));
   if(options.download)return options.download(route,id,downloads.length);
   const name=id===11?'area-map.png':id===15?'area-map.jpg':id===16?'area-map.webp':'market-report.pdf';
   return route.fulfill({contentType:id===14?'text/html':id===11?'image/png':id===15?'image/jpeg':id===16?'image/webp':'application/pdf',headers:{'Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="${name}"`},body:id===14?'<html>invalid</html>':fixture(name)});
  }
  if(url.pathname.endsWith('/files'))return route.fulfill({json:{ok:true,files:currentOrg===1?files:[],facets:{types:['pdf','image','spreadsheet'],projects:[],rootCount:7,folderCounts:[]},pagination:{limit:50,total:currentOrg===1?7:0,hasMore:false,nextCursor:null,sort:'updated_desc'},capabilities:{permanentPurgeEnabled:false}}});
  return route.fulfill({json:{ok:true,projects:[],tickets:[],users:[],items:[],organizations,pagination:{total:0,hasMore:false,nextCursor:null}}});
 });
 await page.route(url=>['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
 await page.goto('/projects');
 await page.getByRole('button',{name:'Arquivos e Documentos',exact:true}).click();
 await expect(page.locator('.documents-file-name')).toHaveCount(7);
 return downloads;
}
const open=(page:Page,name:string)=>page.getByRole('button',{name:`Abrir prévia de ${name}`,exact:true}).click();
const modal=(page:Page)=>page.getByRole('dialog',{name:/Panorama|Área|Planilha|Relatório|Arquivo|Fotografia|Mapa/});
async function expectPixels(page:Page) {
 const result=await page.waitForFunction(()=>{
  if(document.querySelector('.mm-preview-dialog [role="alert"]'))return 'error';
  const canvas=document.querySelector<HTMLCanvasElement>('.mm-preview-dialog canvas');
  return canvas?.width && canvas.height && !document.querySelector('.mm-preview-rendering') ? 'ready' : false;
 },undefined,{timeout:12_000});
 const state=await result.jsonValue();
 expect(state).toBe('ready');
}
async function expectSimplifiedPreview(page:Page) {
 await expect(modal(page).getByText('PDF e imagens • leitura segura',{exact:true})).toHaveCount(0);
 await expect(modal(page).getByText('Arquivo original preservado',{exact:true})).toHaveCount(0);
 await expect(modal(page).locator('details,summary,.mm-preview-page-text,.mm-preview-text-fallback')).toHaveCount(0);
 await expect(modal(page).getByText('Esc para fechar',{exact:true})).toBeVisible();
 await expect(modal(page).getByRole('button',{name:'Baixar original'})).toBeVisible();
}

test('PDF real em canvas, páginas, zoom, texto acessível, foco, Escape e retorno na lista',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await setup(page);await open(page,files[0].name);await expectPixels(page);await expectSimplifiedPreview(page);
 await expect(modal(page).getByRole('button',{name:'Fechar prévia'})).toBeFocused();
 await expect(page.getByText('Página 1 de 2',{exact:true})).toBeVisible();
 await modal(page).getByRole('button',{name:'Próxima página'}).click();await expectPixels(page);await expect(page.getByText('Página 2 de 2',{exact:true})).toBeVisible();
 await expect(modal(page).getByRole('img',{name:'Página 2 do documento PDF.',exact:true})).toHaveAccessibleDescription(/Potencial por regiao/);
 await modal(page).getByRole('button',{name:'Página anterior'}).click();await expectPixels(page);
 await page.getByRole('button',{name:'Aumentar zoom'}).click();await expectPixels(page);await expect(page.getByRole('button',{name:'Ajustar à largura'})).toHaveText('125%');
 await page.getByRole('button',{name:'Ajustar à largura'}).click();await expectPixels(page);
 await page.screenshot({path:info.outputPath('preview-pdf-desktop.png'),fullPage:true});
 await expect(modal(page).getByRole('img',{name:'Página 1 do documento PDF.',exact:true})).toHaveAccessibleDescription(/Panorama de mercado/);
 for(const key of ['Tab','Shift+Tab'])for(let i=0;i<14;i++){await page.keyboard.press(key);expect(await modal(page).evaluate(el=>el.contains(document.activeElement))).toBe(true);}
 await page.keyboard.press('Escape');await expect(modal(page)).toHaveCount(0);await expect(page.getByRole('button',{name:`Abrir prévia de ${files[0].name}`})).toBeFocused();expect(errors).toEqual([]);
});

test('grade, imagens reais PNG/JPG/WebP, abre/fecha repetido sem URLs retidas',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Visualização em grade'}).click();
 for(const file of [files[1],files[5],files[6],files[1]]) {
  await open(page,file.name);const img=modal(page).getByRole('img',{name:file.name});await expect(img).toBeVisible();await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(1000);
  await expectSimplifiedPreview(page);
  await page.getByRole('button',{name:'Aumentar zoom'}).click();
  if(file===files[1])await page.screenshot({path:info.outputPath('preview-image-grid.png'),fullPage:true});
  await page.getByRole('button',{name:'Fechar prévia'}).click();await expect(modal(page)).toHaveCount(0);
 }
 const urls=await page.evaluate(()=>(window as any).previewUrlEvents);expect(urls.created.length).toBe(4);expect(new Set(urls.revoked)).toEqual(new Set(urls.created));
});

test('mobile 390px: cabeçalho/controles cabem, PDF navega e zoom rola internamente',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await open(page,files[0].name);await expectPixels(page);await expectSimplifiedPreview(page);
 const box=await modal(page).boundingBox();expect(box!.width).toBeLessThanOrEqual(390);expect(box!.height).toBeLessThanOrEqual(844);
 for(const name of ['Fechar prévia','Aumentar zoom','Baixar original']) {const b=await page.getByRole('button',{name}).boundingBox();expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(390);}
 await page.screenshot({path:info.outputPath('preview-mobile.png'),fullPage:false});
 for(let i=0;i<8;i++)await page.getByRole('button',{name:'Aumentar zoom'}).click();await expectPixels(page);
 expect(await modal(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(modal(page)).toHaveCount(0);
});

test('Office e arquivo grande não leem bytes; MIME inválido nunca abre leitor',async({page})=>{
 const downloads=await setup(page);
 await open(page,files[2].name);await expect(page.getByText('Prévia indisponível para este formato',{exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await open(page,files[3].name);await expect(page.getByText('Arquivo grande para a prévia',{exact:true})).toBeVisible();expect(downloads).toHaveLength(0);await page.keyboard.press('Escape');
 await open(page,files[4].name);await expect(modal(page).getByRole('alert')).toContainText('não corresponde');await expect(modal(page).locator('canvas,img,iframe,object,embed')).toHaveCount(0);
});

test('falha de acesso desativa download; document.view não abre prévia',async({page})=>{
 const requests=await setup(page,{download:route=>route.fulfill({status:403,json:{error:'internal details'}})});await open(page,files[0].name);await expect(modal(page).getByRole('alert')).toContainText('Seu acesso');await expect(page.getByRole('button',{name:'Baixar original'})).toBeDisabled();expect(requests).toHaveLength(1);
 await page.keyboard.press('Escape');await page.unroute('**/api/**');await setup(page,{noDownload:true});await expect(page.getByRole('button',{name:/Abrir prévia/})).toHaveCount(0);
});

test('fechar carregamento cancela; resposta atrasada não substitui o próximo documento',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let waiting=false;
 await setup(page,{download:async(route,id)=>{if(id===10){waiting=true;await gate;}await route.fulfill({contentType:id===10?'application/pdf':'image/png',body:fixture(id===10?'market-report.pdf':'area-map.png')}).catch(()=>{});}});
 await open(page,files[0].name);await expect.poll(()=>waiting).toBe(true);await expect(modal(page).getByRole('status')).toContainText('Carregando documento');await page.keyboard.press('Escape');
 await open(page,files[1].name);await expect(modal(page).getByRole('img',{name:files[1].name})).toBeVisible();release();await page.waitForTimeout(300);
 await expect(modal(page)).toHaveAttribute('aria-labelledby',/.+/);await expect(modal(page).getByRole('heading',{name:files[1].name})).toBeVisible();await expect(modal(page).locator('canvas')).toHaveCount(0);
});

test('download revalida pelo endpoint existente e entrega os mesmos bytes',async({page})=>{
 const requests=await setup(page);await open(page,files[1].name);await expect(modal(page).getByRole('img',{name:files[1].name})).toBeVisible();const completed=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar original'}).click();const downloaded=await completed;expect(downloaded.suggestedFilename()).toBe('area-map.png');expect(readFileSync((await downloaded.path())!)).toEqual(fixture('area-map.png'));expect(requests).toHaveLength(2);
});

test('troca de organização com prévia aberta remove pixels e cancela conteúdo antigo',async({page})=>{
 await setup(page);await open(page,files[1].name);await expect(modal(page).getByRole('img',{name:files[1].name})).toBeVisible();
 // Deliberate programmatic app event models an asynchronous context update while
 // the native top layer makes background user interaction inert.
 await page.locator('.mm-organization-trigger').evaluate((el:HTMLButtonElement)=>el.click());
 await page.locator('.mm-organization-option').filter({hasText:'Outra organização'}).evaluate((el:HTMLElement)=>el.click());
 await expect(modal(page)).toHaveCount(0);await expect(page.locator('.documents-file-name')).toHaveCount(0);const urls=await page.evaluate(()=>(window as any).previewUrlEvents);expect(urls.revoked).toEqual(urls.created);
});

test('download recusado depois da prévia apaga pixels; falha temporária fica visível no modal',async({page})=>{
 let status=503;
 await setup(page,{download:(route,_id,index)=> index===1 ? route.fulfill({contentType:'image/png',body:fixture('area-map.png')}) : route.fulfill({status,json:{ok:false,error:{code:status===403?'FORBIDDEN':'INFRASTRUCTURE_UNEXPECTED_ERROR',message:'Not exposed',retryable:status!==403}}})});
 await open(page,files[1].name);await expect(modal(page).getByRole('img',{name:files[1].name})).toBeVisible();await page.getByRole('button',{name:'Baixar original'}).click();await expect(modal(page).getByRole('alert')).toContainText('Não foi possível baixar');await expect(modal(page).getByRole('img')).toBeVisible();
 status=403;await expect(page.getByRole('button',{name:'Baixar original'})).toBeEnabled();await page.getByRole('button',{name:'Baixar original'}).click();await expect(modal(page).getByRole('alert')).toContainText('Seu acesso');await expect(modal(page).locator('img,canvas')).toHaveCount(0);await expect(page.getByRole('button',{name:'Baixar original'})).toBeDisabled();
});

test('PDF repetido e zoom/páginas rápidos seguidos de fechar não deixam erros ou pixels',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
 for(let i=0;i<3;i++){
  await open(page,files[0].name);await expectPixels(page);
  await page.getByRole('button',{name:'Aumentar zoom'}).click();await modal(page).getByRole('button',{name:'Próxima página'}).click();await modal(page).getByRole('button',{name:'Página anterior'}).click();await page.getByRole('button',{name:'Diminuir zoom'}).click();await page.keyboard.press('Escape');await expect(modal(page)).toHaveCount(0);
 }
 await open(page,files[0].name);await expectPixels(page);await expect(page.getByText('Página 1 de 2',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('download atrasado de organização anterior não é entregue após troca de contexto',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let waiting=false;let saved=0;page.on('download',()=>saved++);
 await setup(page,{download:async(route,_id,index)=>{if(index>1){waiting=true;await gate;}await route.fulfill({contentType:'image/png',headers:{'Content-Disposition':'attachment; filename="area-map.png"'},body:fixture('area-map.png')}).catch(()=>{});}});
 await open(page,files[1].name);await expect(modal(page).getByRole('img',{name:files[1].name})).toBeVisible();await page.getByRole('button',{name:'Baixar original'}).click();await expect.poll(()=>waiting).toBe(true);
 await page.locator('.mm-organization-trigger').evaluate((el:HTMLButtonElement)=>el.click());await page.locator('.mm-organization-option').filter({hasText:'Outra organização'}).evaluate((el:HTMLElement)=>el.click());await expect(modal(page)).toHaveCount(0);release();await page.waitForTimeout(300);expect(saved).toBe(0);
});

test('falha transitória permite nova tentativa e PDF malformado mostra somente a apresentação local',async({page})=>{
 await setup(page,{download:(route,id,index)=>{
  if(index===1)return route.fulfill({status:503,json:{message:'PRIVATE PROVIDER DETAIL'}});
  return route.fulfill({contentType:'application/pdf',body:id===14?'%PDF-1.7\n%%EOF':fixture('market-report.pdf')});
 }});
 await open(page,files[0].name);await expect(modal(page).getByRole('alert')).toContainText('Não foi possível carregar a prévia');await expect(modal(page)).not.toContainText('PRIVATE');await page.getByRole('button',{name:'Tentar novamente'}).click();await expect(modal(page).getByRole('alert')).toHaveCount(0);await expectPixels(page);await page.keyboard.press('Escape');
 await open(page,files[4].name);await expect(modal(page).getByRole('alert')).toContainText('Não foi possível exibir este PDF');await expect(modal(page).getByRole('button',{name:'Baixar original'})).toBeEnabled();
});

test('falha do módulo leitor orienta atualizar a página e preserva o download',async({page})=>{
 await setup(page);await page.route('**/assets/DocumentPdfPreview-*.js',route=>route.abort('failed'));
 await open(page,files[0].name);await expect(modal(page).getByRole('alert')).toContainText('Atualize a página ou baixe o original');await expect(modal(page).getByRole('button',{name:'Baixar original'})).toBeEnabled();await page.keyboard.press('Escape');await expect(modal(page)).toHaveCount(0);
});

test('PDF real mantém texto acessível sem iteração assíncrona de ReadableStream',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(ReadableStream.prototype,Symbol.asyncIterator,{configurable:true,value:undefined});});
 await setup(page);await open(page,files[0].name);await expectPixels(page);await expect(modal(page).getByRole('img',{name:'Página 1 do documento PDF.',exact:true})).toHaveAccessibleDescription(/Panorama de mercado/);await expect(modal(page).getByRole('alert')).toHaveCount(0);await expectSimplifiedPreview(page);
});
