import {test,expect} from '@playwright/test';
const fixture='/tests/browser/fixtures/notice-board.html';
const item={id:1,ticketId:7,code:'CC-7',subject:'Aviso local de teste',internal:false,createdAt:'2026-10-24T18:00:00.000Z',readAt:null,dismissedAt:null,version:1};
test('missing ticket.view keeps the entry visible without organization requests',async({page})=>{
 let requests=0;await page.route('**/api/organizations/**',r=>{requests++;return r.fulfill({json:{enabled:true,recipientState:true,unread:1,nextCursor:null,items:[item]}});});
 await page.goto(`${fixture}?restricted`);await page.getByRole('button',{name:'Quadro de avisos',exact:true}).click();
 await expect(page.getByText('Você não tem acesso aos avisos nesta organização.')).toBeVisible();
 await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Refetch',exact:true}).click();
 await expect(page.getByRole('button',{name:'Quadro de avisos',exact:true})).toBeVisible();await expect(page.locator('.maono-notice-badge')).toHaveCount(0);expect(requests).toBe(0);
});
test('ticket.view revocation discards a delayed response and stops later requests',async({page})=>{
 let requests=0,delay=false;let release!:()=>void;let entered!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{entered=resolve;});
 await page.route('**/api/organizations/**',async r=>{requests++;if(delay){entered();await pending;}await r.fulfill({json:{enabled:true,recipientState:true,unread:1,nextCursor:null,items:[item]}}).catch(()=>{});});
 await page.goto(fixture);await expect(page.locator('.maono-notice-badge')).toHaveText('1');delay=true;
 await page.getByRole('button',{name:'Refetch',exact:true}).click();await arrived;await page.getByRole('button',{name:'Revogar avisos',exact:true}).click();const before=requests;release();
 await page.getByRole('button',{name:'Quadro de avisos',exact:true}).click();await expect(page.getByText('Você não tem acesso aos avisos nesta organização.')).toBeVisible();
 await expect(page.getByRole('link',{name:/Aviso local/})).toHaveCount(0);await expect(page.locator('.maono-notice-badge')).toHaveCount(0);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Refetch',exact:true}).click();expect(requests).toBe(before);
});
test('always visible, explicit read, reversible per-item deletion and no profile click replacement',async({page})=>{
 let notice={...item,readAt:null as string|null,dismissedAt:null as string|null};let writes=0;
 await page.route('**/api/organizations/*/ticket-notifications*',async r=>{
  if(r.request().method()==='PATCH'){writes++;const b=r.request().postDataJSON();expect(b.version).toBe(notice.version);notice={...notice,version:notice.version+1,readAt:b.action==='read'?'2026-10-24T18:01:00.000Z':notice.readAt,dismissedAt:b.action==='dismiss'?'2026-10-24T18:02:00.000Z':b.action==='restore'?null:notice.dismissedAt};return r.fulfill({json:{ok:true,version:notice.version}});}
  const deleted=new URL(r.request().url()).searchParams.get('folder')==='deleted';
  await r.fulfill({json:{enabled:true,recipientState:true,unread:notice.readAt||notice.dismissedAt?0:1,nextCursor:null,items:deleted===Boolean(notice.dismissedAt)?[notice]:[]}});
 });
 await page.goto(fixture);await expect(page.getByRole('button',{name:'Quadro de avisos, 1 pendentes'})).toBeVisible();
 await page.getByRole('button',{name:'Menu do perfil'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 await page.getByRole('button',{name:/Quadro de avisos/}).click();await expect(page.getByRole('link',{name:/Aviso local/})).toBeVisible();expect(writes).toBe(0);
 await page.getByRole('button',{name:'Confirmar visualização'}).click();await expect(page.getByText('Visualizado',{exact:true})).toBeVisible();expect(writes).toBe(1);
 await expect(page.locator('.maono-notice-badge')).toHaveCount(0);
 await page.getByRole('button',{name:'Excluir',exact:true}).click();await expect(page.getByText('Nenhum aviso por aqui.')).toBeVisible();
 await page.getByRole('button',{name:'Excluídos',exact:true}).click();await expect(page.getByRole('link',{name:/Aviso local/})).toBeVisible();
 await page.getByRole('button',{name:'Restaurar'}).click();await expect(page.getByText('Nenhum aviso excluído.')).toBeVisible();expect(writes).toBe(3);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('button',{name:'Quadro de avisos',exact:true})).toBeFocused();
});
test('zero, disabled module and error retain entry point without fabricated pending count',async({page})=>{
 let mode='zero';await page.route('**/api/organizations/*/ticket-notifications*',r=>mode==='error'?r.fulfill({status:503,json:{error:'unavailable'}}):r.fulfill({json:{enabled:mode!=='off',recipientState:true,unread:0,nextCursor:null,items:[]}}));
 await page.goto(fixture);await page.getByRole('button',{name:'Quadro de avisos',exact:true}).click();await expect(page.getByText('Nenhum aviso por aqui.')).toBeVisible();
 mode='error';await page.getByRole('button',{name:'Atualizar',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText('Nenhum aviso por aqui.')).toHaveCount(0);
 mode='off';await page.getByRole('button',{name:'Atualizar',exact:true}).click();await expect(page.getByText('Os avisos ainda não estão disponíveis nesta organização.')).toBeVisible();
 await page.getByRole('button',{name:'Fechar quadro de avisos'}).click();await expect(page.getByRole('button',{name:'Quadro de avisos',exact:true})).toBeVisible();await expect(page.locator('.maono-notice-badge')).toHaveCount(0);
});
test('revocation and organization/session changes clear notices',async({page})=>{
 let revoked=false;await page.route('**/api/organizations/*/ticket-notifications*',r=>r.fulfill({json:{enabled:true,recipientState:true,unread:revoked||r.request().url().includes('/2/')?0:1,nextCursor:null,items:revoked||r.request().url().includes('/2/')?[]:[item]}}));
 await page.goto(fixture);await page.getByRole('button',{name:/Quadro de avisos/}).click();await expect(page.getByRole('link',{name:/Aviso local/})).toBeVisible();revoked=true;
 await page.getByRole('button',{name:'Atualizar',exact:true}).click();await expect(page.getByText('Nenhum aviso por aqui.')).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Trocar organização'}).click();await expect(page.locator('.maono-notice-badge')).toHaveCount(0);
 await page.getByRole('button',{name:/Quadro de avisos/}).click();await expect(page.getByText('Nenhum aviso por aqui.')).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Encerrar sessão'}).click();await page.getByRole('button',{name:/Quadro de avisos/}).click();await expect(page.getByText('Selecione uma organização com sua sessão ativa.')).toBeVisible();
});

for(const change of ['Trocar usuário','Trocar organização','Encerrar sessão'])test(`delayed old-scope response is discarded after ${change}`,async({page})=>{
 let delay=false,fresh=false;let release!:()=>void;let entered!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{entered=resolve;});
 await page.route('**/api/organizations/*/ticket-notifications*',async r=>{
  const old=!fresh;if(delay&&old){entered();await pending;}
  await r.fulfill({json:{enabled:true,recipientState:true,unread:old?1:0,nextCursor:null,items:old?[item]:[]}}).catch(()=>{});
 });
 await page.goto(fixture);await expect(page.locator('.maono-notice-badge')).toHaveText('1');
 delay=true;await page.getByRole('button',{name:'Refetch',exact:true}).click();await arrived;fresh=true;
 await page.getByRole('button',{name:change,exact:true}).click();release();
 await page.getByRole('button',{name:/Quadro de avisos/}).click();
 await expect(page.getByRole('link',{name:/Aviso local/})).toHaveCount(0);await expect(page.locator('.maono-notice-badge')).toHaveCount(0);
 await expect(page.getByText(change==='Encerrar sessão'?'Selecione uma organização com sua sessão ativa.':'Nenhum aviso por aqui.')).toBeVisible();
});

for(const failure of ['conflict','lost-response'])test(`${failure} requires refetch and repeated clicks do not repeat mutations`,async({page})=>{
 let writes=0,read=false;let release!:()=>void;let entered!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{entered=resolve;});
 await page.route('**/api/organizations/*/ticket-notifications*',async r=>{
  if(r.request().method()==='PATCH'){writes++;entered();await pending;read=true;return failure==='conflict'?r.fulfill({status:409,json:{error:'conflict'}}):r.abort('failed');}
  return r.fulfill({json:{enabled:true,recipientState:true,unread:read?0:1,nextCursor:null,items:[{...item,version:read?2:1,readAt:read?'2026-10-24T18:01:00.000Z':null}]}});
 });
 await page.goto(fixture);await page.getByRole('button',{name:/Quadro de avisos/}).click();
 await page.getByRole('button',{name:'Confirmar visualização'}).evaluate(el=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click();});await arrived;release();
 await expect(page.getByRole('alert')).toBeVisible();expect(writes).toBe(1);await expect(page.getByRole('link',{name:/Aviso local/})).toHaveCount(0);
 await page.getByRole('button',{name:'Atualizar',exact:true}).click();await expect(page.getByText('Visualizado',{exact:true})).toBeVisible();expect(writes).toBe(1);await expect(page.locator('.maono-notice-badge')).toHaveCount(0);
});

test('pagination retains total pending count and desktop modal contains keyboard focus',async({page})=>{
 let writes=0;await page.route('**/api/organizations/*/ticket-notifications*',r=>{
  if(r.request().method()!=='GET')writes++;
  const next=new URL(r.request().url()).searchParams.has('before');
  return r.fulfill({json:{enabled:true,recipientState:true,unread:2,nextCursor:next?null:'cursor-1',items:[next?{...item,id:2,subject:'Segundo aviso local'}:item]}});
 });
 await page.setViewportSize({width:1280,height:800});await page.goto(fixture);await page.getByRole('button',{name:/Quadro de avisos/}).click();
 await page.getByRole('button',{name:'Próxima página'}).click();await expect(page.getByRole('link',{name:/Segundo aviso/})).toBeVisible();await expect(page.getByRole('link',{name:/Aviso local de teste/})).toHaveCount(0);await expect(page.locator('.maono-notice-badge')).toHaveText('2');
 await page.getByRole('button',{name:'Voltar ao início'}).focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Fechar quadro de avisos'})).toBeFocused();
 await page.screenshot({path:'test-results/notice-board-desktop.png'});await page.getByRole('button',{name:'Voltar ao início'}).click();await expect(page.getByRole('link',{name:/Aviso local/})).toBeVisible();expect(writes).toBe(0);
});
test('mobile portal is not clipped and Escape/outside close restore focus',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/organizations/*/ticket-notifications*',r=>r.fulfill({json:{enabled:true,recipientState:true,unread:1,nextCursor:null,items:[item]}}));
 await page.goto(fixture);const button=page.getByRole('button',{name:/Quadro de avisos/});await button.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();
 const box=await page.getByRole('dialog').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
 await page.screenshot({path:'test-results/notice-board-mobile.png'});await page.mouse.click(380,820);await expect(page.getByRole('dialog')).not.toBeVisible();await expect(button).toBeFocused();
});
