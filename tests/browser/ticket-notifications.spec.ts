import {expect,test} from '@playwright/test';
const fixture='/tests/browser/fixtures/ticket-notifications.html';
test('CC07 local UI opens, marks read, paginates and supports keyboard focus',async({page})=>{
 let read=false;
 await page.route('**/api/organizations/1/ticket-notifications*',async route=>{
  if(route.request().method()==='PATCH'){
   read=route.request().postDataJSON().read;
   return route.fulfill({json:{ok:true}});
  }
  const old=new URL(route.request().url()).searchParams.has('before');
  await route.fulfill({json:{ok:true,enabled:true,unread:read?0:1,nextCursor:old?null:'2',items:[{id:old?1:2,ticketId:7,code:'CC-7',subject:old?'Antiga':'Nova resposta',internal:false,createdAt:'2026-09-27T00:00:00.000Z',readAt:read?'2026-09-27T00:00:00.000Z':null}]}});
 });
 await page.goto(fixture);
 const toggle=page.getByRole('button',{name:'Notificações (1 não lidas)'});
 await expect(toggle).toBeVisible();await toggle.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Marcar como lida',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/CC-7: Nova resposta/}).click();
 await expect(page.getByLabel('Chamado aberto')).toHaveText('7');
 await expect(page.getByRole('button',{name:'Notificações (0 não lidas)'})).toBeVisible();
 await page.getByRole('button',{name:'Mais antigas'}).click();
 await expect(page.getByRole('button',{name:/CC-7: Antiga/})).toBeVisible();
});
test('CC07 OFF hides notification surface',async({page})=>{
 await page.route('**/api/organizations/1/ticket-notifications*',r=>r.fulfill({json:{ok:true,enabled:false,items:[],unread:0,nextCursor:null}}));
 await page.goto(fixture);await expect(page.getByRole('button',{name:/Notificações/})).toHaveCount(0);
});
test('CC07 refresh removes revoked content and count',async({page})=>{
 let revoked=false;
 await page.route('**/api/organizations/1/ticket-notifications*',r=>r.fulfill({json:{ok:true,enabled:true,unread:revoked?0:1,nextCursor:null,items:revoked?[]:[{id:1,ticketId:7,code:'CC-7',subject:'Conteúdo antes da revogação',internal:true,readAt:null}]}}));
 await page.goto(fixture);await page.getByRole('button',{name:'Notificações (1 não lidas)'}).click();
 await expect(page.getByRole('button',{name:/Conteúdo antes da revogação/})).toBeVisible();
 revoked=true;await page.getByRole('button',{name:'Atualizar',exact:true}).click();
 await expect(page.getByText('Nenhuma notificação.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/Conteúdo antes da revogação/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Notificações (0 não lidas)'})).toBeVisible();
});
