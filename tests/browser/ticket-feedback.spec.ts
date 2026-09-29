import { test, expect } from "@playwright/test";
const url = "/tests/browser/fixtures/ticket-feedback.html";
const def = {
  resultQuestion: "Resultado alcançado?",
  effortQuestion: "Quanto esforço?",
  outcomes: ["Sim", "Não"],
  effortLabels: ["Baixo", "Alto"],
  effortDirection: "ascending",
  consentText: "Texto <script>alert(1)</script> explícito",
  windowHours: 24,
};
const item = {
  id: "invite-1",
  ticketId: 17,
  cycle: 1,
  version: 1,
  until: "2099-01-01T00:00:00Z",
  definition: def,
  receipt: null,
  state: "open",
};
test("OFF hides feature, mobile plain text and consent prevents accidental submission", async ({
  page,
}) => {
  let enabled = false,
    answer: any = null;
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST") {
      answer = r.request().postDataJSON();
      return r.fulfill({ json: { receipt: "receipt1" } });
    }
    return r.fulfill({
      json: r.request().url().endsWith("instrument")
        ? { version: 1 }
        : {
            enabled,
            items: enabled
              ? [
                  {
                    ...item,
                    state: answer ? "responded" : "open",
                    receipt: answer ? "receipt1" : null,
                  },
                ]
              : [],
            nextCursor: null,
          },
    });
  });
  await page.goto(url + "?viewer");
  await expect(page.getByText("Resultado, esforço e feedback")).toHaveCount(0);
  enabled = true;
  await page.reload();
  await page.getByText("Resultado, esforço e feedback").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText(def.consentText)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar avaliação" }),
  ).toBeDisabled();
  await page.getByLabel("Resultado alcançado?").selectOption("Não");
  await page.getByLabel("Quanto esforço?").selectOption("1");
  await page
    .getByLabel("Concordo com o uso descrito.", { exact: false })
    .check();
  await page.getByRole("button", { name: "Enviar avaliação" }).click();
  await expect(
    page.getByText("Avaliação registrada", { exact: false }),
  ).toBeVisible();
  expect(answer.effort).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("decline is separate and reopen link opens existing lifecycle without automatic transition", async ({
  page,
}) => {
  const calls: any[] = [];
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST") {
      calls.push(r.request().postDataJSON());
      return r.fulfill({ json: { receipt: "declined1" } });
    }
    return r.fulfill({
      json: {
        enabled: true,
        items: [
          {
            ...item,
            state: calls.length ? "declined" : "open",
            receipt: calls.length ? "declined1" : null,
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.goto(url + "?viewer");
  await page.getByText("Resultado, esforço e feedback").click();
  await page
    .getByRole("button", { name: "Abrir chamado para conversar" })
    .click();
  await expect(page.getByText("Chamado aberto: 17")).toBeVisible();
  expect(calls).toHaveLength(0);
  await page.getByRole("button", { name: "Prefiro não responder" }).click();
  expect(calls).toEqual([{ declined: true }]);
});
test("organization change removes stale answers and 403 invalidates displayed form", async ({
  page,
}) => {
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST")
      return r.fulfill({ status: 403, json: { error: "Acesso negado" } });
    return r.fulfill({
      json: {
        enabled: true,
        items: r.request().url().includes("/1/") ? [item] : [],
        nextCursor: null,
      },
    });
  });
  await page.goto(url + "?viewer");
  await page.getByText("Resultado, esforço e feedback").click();
  await page.getByRole("button", { name: "Prefiro não responder" }).click();
  await expect(page.getByText("Chamado 17 · ciclo 1")).toHaveCount(0);
  await page.getByRole("button", { name: "Trocar organização" }).click();
  await page.getByText("Resultado, esforço e feedback").click();
  await expect(page.getByText("Nenhuma pesquisa disponível.")).toBeVisible();
});
test("uncertain retry repeats the identical payload and request key", async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route("**/api/**", (r) => {
    if (r.request().method() === "POST") {
      bodies.push(r.request().postData()!);
      return r.fulfill({
        status: bodies.length === 1 ? 503 : 200,
        json:
          bodies.length === 1 ? { error: "Indisponível" } : { receipt: "same" },
      });
    }
    return r.fulfill({
      json: { enabled: true, items: [item], nextCursor: null },
    });
  });
  await page.goto(url + "?viewer");
  await page.getByText("Resultado, esforço e feedback").click();
  await page.getByRole("button", { name: "Prefiro não responder" }).click();
  await page.getByRole("button", { name: /tentar|repetir/i }).click();
  expect(bodies.length).toBe(2);
  expect(bodies[0]).toBe(bodies[1]);
});

test('withdrawal has an explicit action and preserves response history', async ({page})=>{
 let withdrawn=false;await page.route('**/api/**',r=>{if(r.request().method()==='POST'){expect(r.request().postDataJSON()).toEqual({action:'withdraw'});withdrawn=true;return r.fulfill({json:{receipt:'withdrawn-receipt'}});}return r.fulfill({json:{enabled:true,items:[{...item,state:withdrawn?'withdrawn':'responded',receipt:'original-receipt'}],nextCursor:null}});});
 await page.goto(url+'?viewer');await page.getByText('Resultado, esforço e feedback').click();await page.getByRole('button',{name:'Retirar consentimento'}).click();await expect(page.getByText('Consentimento retirado',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Enviar avaliação'})).toHaveCount(0);
});
test('manager publishes an explicitly approved instrument without defaults or automatic invitation',async({page})=>{
 const commands:any[]=[];await page.route('**/api/**',r=>{if(r.request().method()==='POST'){commands.push(r.request().postDataJSON());return r.fulfill({json:{version:1}});}return r.fulfill({json:r.request().url().endsWith('/instrument')?{version:commands.length}:{enabled:true,items:[],nextCursor:null}});});await page.goto(url);await page.getByText('Resultado, esforço e feedback').click();await page.getByText('Gestão dos convites e instrumento').click();await expect(page.getByRole('button',{name:'Publicar nova versão'})).toBeDisabled();await page.getByLabel('Pergunta de resultado').fill('Resultado?');await page.getByLabel('Resultados — um por linha').fill('Sim\nNão');await page.getByLabel('Pergunta de esforço').fill('Esforço?');await page.getByLabel('Escala de esforço — um rótulo por linha').fill('Baixo\nAlto');await page.getByLabel('Direção da escala').selectOption('ascending');await page.getByLabel('Prazo aprovado em horas').fill('24');await page.getByLabel('Texto de consentimento').fill('Uso explicitamente consentido.');await page.getByLabel('Instrumento, prazo, consentimento e audiências aprovados pela operação').check();await page.getByRole('button',{name:'Publicar nova versão'}).click();await expect(page.getByText('Instrumento publicado.')).toBeVisible();expect(commands).toHaveLength(1);expect(commands[0].definition.windowHours).toBe(24);expect(commands[0].definition.outcomes).toEqual(['Sim','Não']);expect(commands[0].expectedVersion).toBe(0);
});
