import {test,expect,type Browser} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {persistenceFixture,deferred} from '../helpers/project-persistence-fixture.mjs';
import {organizationManagementBrowserServer} from '../helpers/organization-management-browser-server.mjs';
import {digest} from '../../scripts/acceptance/organization-functional-evidence.mjs';
import {verifyObservedCase} from '../../scripts/acceptance/organization-observed-case.mjs';

const currentSha = () => execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const binding = {
  run:Number(process.env.GITHUB_RUN_ID || 1), attempt:Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  workflowSha:process.env.GITHUB_SHA || currentSha(), sha:process.env.B1_PRODUCT || currentSha(),
};
type CollectorMethod = 'start'|'begin'|'finish'|'export';

async function observe(browser:Browser, assets:string, edit:boolean, success:boolean) {
  const cleanups: Array<()=>void> = [];
  const {db,env} = persistenceFixture({after:(f:()=>void)=>cleanups.push(f)});
  const id = edit ? 1 : 2, control = edit ? 2 : 1;
  const scope = randomUUID(), token = randomUUID(), name = 'QA Auditoria '+scope;
  const caseId = edit ? (success?'save_success':'edit_conflict') : (success?'pause_success':'pause_conflict');
  const proposed = 'Texto sintético '+scope;
  const controlDigest = () => digest(db.prepare('SELECT * FROM organizations WHERE id=?').get(control));
  const linksDigest = () => digest(db.prepare('SELECT * FROM organization_users ORDER BY id').all());
  const entered = deferred(), release = deferred();
  const http = {run:binding.run,attempt:binding.attempt,workflowSha:binding.workflowSha,caseId,sessionId:scope,
    actor:0,target:0,operation:'',terminalOperation:'',kind:'',requestedVersion:-1,expectedDescription:null as string|null,
    createStatus:0,stepStatus:0,itemState:'',terminal:false,releaseAt:0,sessionReads:0};
  const context = await browser.newContext({viewport:{width:1280,height:900},locale:'pt-BR',serviceWorkers:'block'});
  let server: Awaited<ReturnType<typeof organizationManagementBrowserServer>>|undefined;
  try {
    Object.assign(env,{ADMIN_AUDIT_OPERATIONS_V1:'true',ORGANIZATION_MANAGEMENT_V1:'true'});
    db.exec("UPDATE users SET role='super_admin' WHERE id=1");
    db.prepare('UPDATE organizations SET name=?,description=? WHERE id=?').run(name,'Estado inicial',id);
    db.prepare('INSERT INTO sessions(token_hash,user_id,active_organization_id,expires_at) VALUES(?,1,1,?)')
      .run(createHash('sha256').update(token).digest('hex'),'2099-01-01T00:00:00Z');
    const controlBefore = controlDigest(), linksBefore = linksDigest();
    server = await organizationManagementBrowserServer(env,assets,async (req:Request,res:Response)=>{
      const path = new URL(req.url).pathname;
      if(path !== '/api/session' && !path.startsWith('/api/admin/')) return;
      expect(req.headers.get('cookie')?.split('; ').includes('maono_session='+token)).toBe(true);
      if(path==='/api/session') {
        http.actor=(await res.json()).user.id; http.sessionReads++;
      } else if(req.method==='POST' && path.endsWith('/operations')) {
        const input=await req.json(), result=await res.json();
        expect(input.items).toHaveLength(1); expect(http.operation).toBe('');
        http.operation=result.id; http.kind=input.kind; http.target=input.items[0].id;
        http.requestedVersion=input.items[0].version; http.createStatus=res.status;
        if(edit) http.expectedDescription=digest([scope,'description',input.items[0].description]);
      } else if(req.method==='POST' && path.endsWith('/step')) {
        const result=await res.json();
        expect(path).toBe('/api/admin/organization-management/operations/'+http.operation+'/step');
        if(result.done) {
          expect(result.items).toHaveLength(1);
          http.terminalOperation=result.id; http.itemState=result.items[0].state;
          http.terminal=result.done;http.stepStatus=res.status;
          entered.resolve(); await release.promise;
        }
      } else if(req.method!=='GET') throw new Error('Unexpected write during observed case');
    });
    await context.addCookies([{name:'maono_session',value:token,url:server.origin,httpOnly:true,sameSite:'Lax'}]);
    await context.route(url=>url.origin!==server!.origin,route=>route.abort());
    const page=await context.newPage();
    // A prompt is expected for the pause itself. Record any discard prompt separately.
    const prompts:string[]=[];
    page.on('dialog',async d=>{prompts.push(d.message().startsWith('Pausar ')?'pause':'other');await d.accept();});
    await page.goto(server.origin+'/admin?section=organizations');
    await page.getByRole('button',{name,exact:true}).click();
    const dialog=page.getByRole('dialog'),description=dialog.getByLabel('Descrição',{exact:true});
    await expect(description).toHaveValue('Estado inicial');
    if(edit) {
      await description.fill(proposed);
      await dialog.getByLabel('Justificativa',{exact:true}).fill('Ensaio descartável');
    }
    if(!success) db.prepare('UPDATE organizations SET management_version=management_version+1 WHERE id=?').run(id);
    await page.addScriptTag({content:await readFile(new URL('../../scripts/acceptance/organization-functional-evidence.js',import.meta.url),'utf8')});
    const collect=(method:CollectorMethod,arg?:unknown)=>page.evaluate(async({method,arg})=>{
      const api=(window as unknown as {MaonoOrganizationEvidence:Record<CollectorMethod,(arg?:unknown)=>Promise<unknown>>}).MaonoOrganizationEvidence;
      return arg === undefined ? api[method]() : api[method](arg);
    },{method,arg});
    await collect('start',{runId:scope,organizationId:id,expectedCommit:binding.sha,expectedDeploymentId:randomUUID(),mode:'functional',requestedCases:[caseId]});
    await collect('begin',caseId);
    const submit=dialog.getByRole('button',{name:edit?'Salvar dados':'Pausar organização',exact:true});
    const originalButton = await submit.elementHandle();
    await submit.click();
    await expect.poll(()=>Boolean(http.terminalOperation),{timeout:10000}).toBe(true);
    await entered.promise;
    await expect(dialog.locator('.aog-dialog-loading-overlay')).toBeVisible();
    expect(await originalButton!.evaluate(node=>node.isConnected && (node.matches(':disabled') || Boolean(node.closest('[inert]'))))).toBe(true);
    await expect(page.locator('.aog-deletion-toast,.aog-deletion-error-toast')).toHaveCount(0);
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    http.releaseAt=await page.evaluate(()=>Date.now());release.resolve();
    const toast=page.locator(success?'.aog-deletion-toast':'.aog-deletion-error-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0,{timeout:15000});
    await page.waitForTimeout(520); // Include stable frames after the toast leaves.
    await collect('finish');const capture=await collect('export');
    if(edit) {
      await expect(description).toHaveValue(proposed);
      if(!success) await expect(dialog.getByLabel('Justificativa',{exact:true})).toHaveValue('Ensaio descartável');
      else {
        await dialog.getByRole('button',{name:'Fechar painel',exact:true}).click();
        await expect(dialog).toHaveCount(0);
      }
    }
    expect(prompts).toEqual(edit?[]:['pause']);
    expect(server.errors).toEqual([]);
    return {capture,http,controlBefore,controlAfter:controlDigest(),linksBefore,linksAfter:linksDigest()};
  } finally {
    release.resolve();
    await context.close(); await server?.close();for(const fn of cleanups.reverse())fn();
  }
}

for(const edit of [true,false]) {
  const kind=edit?'update':'pause',caseId='synthetic-organization-'+kind;
  test('observed '+kind+' via loopback HTTP, UI and persisted audit',async({browser},info)=>{
    test.setTimeout(120000);
    const assets=String(info.project.use.baseURL);
    const success=await observe(browser,assets,edit,true);
    const conflict=await observe(browser,assets,edit,false);
    const bundle={version:3,kind:'organization-observed-loopback',...binding,caseId,productBranch:'mano_kepler_v1',scenarios:{success,conflict}};
    const expected={...binding,caseId};
    verifyObservedCase(bundle,expected);
    // Exercise negatives against the actual measurement, changing one fact per check.
    const mismatch = (change: Partial<typeof success.http>) => ({
      ...bundle, scenarios:{conflict, success:{...success,http:{...success.http,...change}}},
    });
    for (const change of [{target:edit?2:1}, {operation:randomUUID()}, {sessionId:randomUUID()}, {actor:999},
      {run:binding.run+1}, {attempt:binding.attempt+1}, {workflowSha:'0'.repeat(40)}, {terminal:false}, {releaseAt:0}]) {
      expect(()=>verifyObservedCase(mismatch(change),expected)).toThrow();
    }
    const otherCase = edit?'synthetic-organization-pause':'synthetic-organization-update';
    expect(()=>verifyObservedCase(bundle,{...expected,caseId:otherCase})).toThrow('OBSERVED_SCOPE');
    expect(()=>verifyObservedCase(bundle,{...expected,sha:'0'.repeat(40)})).toThrow('OBSERVED_SCOPE');
    const missingEffect = structuredClone(bundle);
    const capture = missingEffect.scenarios.success.capture as {captures:Array<{detail:{organization:{descriptionDigest:string;active:boolean}}}>};
    const persisted = capture.captures.at(-1)!.detail.organization;
    if(edit) persisted.descriptionDigest = capture.captures[0].detail.organization.descriptionDigest;
    else persisted.active = true;
    expect(()=>verifyObservedCase(missingEffect,expected)).toThrow();
    const wrongOperation = randomUUID();
    expect(()=>verifyObservedCase(mismatch({operation:wrongOperation,terminalOperation:wrongOperation}),expected)).toThrow();
    const stale = {...bundle,scenarios:{success:conflict,conflict}};
    expect(()=>verifyObservedCase(stale,expected)).toThrow();
    if(process.env.B1_CASE_OUTPUT) {
      if(process.env.GITHUB_ACTIONS === 'true') expect(currentSha()).toBe(binding.sha);
      const dir=join(process.env.B1_CASE_OUTPUT,kind);
      await mkdir(dir,{recursive:true});
      await writeFile(join(dir,'organization-evidence.json'),JSON.stringify(bundle),{flag:'wx',mode:0o600});
    }
  });
}
