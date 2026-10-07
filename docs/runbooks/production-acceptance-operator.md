# Production Acceptance Operator

## Objetivo

Executar somente os testes que dependem de ambiente real, autenticação, configuração remota, feature flags, chamadas HTTP ou interface real, sem duplicar os testes unitários/SQLite/CI comuns.

Fluxo:

`CI normal → preflight → aprovação humana → acceptance controlado → cleanup → restauração de configuração → evidência`

O operador é genérico. Cada funcionalidade registra uma **suite versionada** em `scripts/acceptance/suites/`. As suites registradas são `cc04-selective-access`, `durable-project-save` e
`durable-project-preview`. As duas suites duráveis automatizam somente o editor;
inventário administrativo e limpeza são etapas humanas separadas.

## GitHub Environment

Criar o Environment:

`production-acceptance`

Proteções recomendadas:

- Required reviewer: operador humano responsável;
- Prevent self-review: OFF enquanto houver apenas um operador; preferir ON quando existir segundo revisor;
- deployment branch/tag permitida: somente `main`;
- não permitir bypass administrativo se o plano do repositório suportar essa proteção.

### Secrets

O Environment usa dois secrets próprios, separados do operador de migrations:

1. `MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN`
   - token Cloudflare dedicado;
   - permissão mínima: **Pages Write** na conta Maõno;
   - não precisa de D1 Write;
   - usado somente para ler/alterar flags do Pages e recriar o deployment controlado.

2. `MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON`
   - JSON com contas QA dedicadas;
   - nunca usar usuários pessoais ou dados reais;
   - exemplo de perfis exigidos pela suite CC-04:

```json
{
  "manager": { "email": "qa-manager@...", "password": "..." },
  "allowed": { "email": "qa-allowed@...", "password": "..." },
  "restricted": { "email": "qa-restricted@...", "password": "..." }
}
```

Os perfis exigidos por cada suite precisam ter identidades distintas. Cada suite
valida as permissões mínimas antes de ativar feature flags. Para JSON/PNG durável,
o bundle é exatamente `{creator:{email,password},manualInventory:<export before>}`.
`creator` é uma conta QA `editor` com `project.create`; `manualInventory` contém
somente evidência sanitizada. Não incluir `administrator`, outro perfil, senha
administrativa ou cookie. O administrador humano usa sua sessão existente no
navegador, com identidade diferente do editor. Ver o procedimento abaixo.

## Modos

### preflight

Somente control-plane. Confirma:

- SHA publicado;
- branch de Produção;
- binding D1 esperado;
- deployment canônico estável;
- ausência de deployments de Produção não-terminais;
- baseline das flags gerenciadas pela suite.

Confirmação:

`PREPARE_PRODUCTION_ACCEPTANCE`

Não executa casos de acceptance e não altera flags.

### run

Executa a janela controlada.

Confirmação:

`RUN_PRODUCTION_ACCEPTANCE`

Ordem:

1. fixa o SHA de `mano_kepler_v1`;
2. valida deployment/binding/baseline;
3. autentica contas QA e confirma organização/permissões;
4. confirma que a fila de Produção está quiescente;
5. altera somente as flags declaradas pela suite;
6. reconfirma a fila antes do retry e espera terminalidade real;
7. recria o mesmo deployment canônico via Cloudflare Pages Retry;
8. espera terminalidade e confirma o novo snapshot;
9. executa os casos registrados;
10. executa a barreira de fechamento da suite; JSON/PNG deixam a limpeza pendente para o humano;
11. restaura as flags para o safe state;
12. recria novamente o mesmo SHA;
13. confirma que a configuração ficou restaurada;
14. grava artifact sanitizado.

Se qualquer caso, cleanup ou restauração falhar, a execução não fica completa.
Nas suites duráveis, mesmo todos os casos funcionais PASS e flags restauradas
resultam em exit 1, `MANUAL_CLEANUP_REQUIRED` e `DS-CLEANUP=PENDING_MANUAL`.
`operationalTestsPassed` separa o resultado funcional da limpeza. Não repetir a
janela para deixar o job verde; concluir a etapa humana sobre o mesmo relatório.

### closure

Recuperação operacional independente quando uma execução for interrompida antes do finally.

Confirmação:

`RESTORE_PRODUCTION_ACCEPTANCE_SAFE_STATE`

Não executa a suite. Restaura somente as flags gerenciadas pela suite para o safe state e publica novamente o deployment seguro.

Na CC17, `closure` exige o SHA esperado e não declara recursos limpos sem inventário do run interrompido. Para uma suite `controlled_mutation`, pode retornar `configurationRestored=true`, `cleanupComplete=false`, `RESOURCE_CLEANUP_UNVERIFIED` e exit 1. Isso exige reconciliar os recursos sintéticos e anexar a prova antes de outra janela; não significa que se deva repetir a ativação. Restaurar flags não comprova cleanup.

O workflow precisa existir na default `main` para dispatch. A PR de bootstrap deve conter o workflow, framework e seus testes coerentes; o job remoto continua fazendo checkout do SHA fixado de `mano_kepler_v1`. Merge apenas na branch de produto não disponibiliza esse dispatch na default. Revisar primeiro o produto e depois o bootstrap, sem disparar `run` automaticamente.

As correções CC17 também verificam capacidades negadas, revalidam o SHA imediatamente antes de alterar configuração e recusam sucesso se o relatório não puder ser persistido. Cleanup HTTP inesperado permanece erro, mesmo se outros callbacks conseguirem terminar.

## Suites

Uma suite declara:

- `id` e versão;
- `mutationMode`;
- perfis QA necessários;
- permissões mínimas por perfil;
- feature flags gerenciadas, com `requiredBefore`, `activeValue` e `safeValue`;
- se precisa de navegador real;
- casos obrigatórios;
- executor e cleanup.

Suites `read_only` são tecnicamente impedidas pelo framework de fazer `POST`, `PUT`, `PATCH` ou `DELETE`. Suites sem feature flags gerenciadas não provocam redeploy só por participar do framework.

Não existe input de shell, URL ou código arbitrário no workflow. O usuário seleciona apenas uma suite já versionada no repositório.

## CC-04

Suite: `cc04-selective-access`

Esta suite não executa CT55–58 nem substitui os aceites herdados CC05–16. A CC17 acrescenta automação local e um validador offline de evidências; novos executores remotos de carga/caos exigem contrato versionado, parâmetros aprovados e revisão antes da janela.

Casos:

- CT-11: ocultação completa de chamado privado sem grant;
- CT-12: revogação na próxima requisição e limpeza real do drawer;
- CT-13: etiquetas não concedem acesso e gestão de ACL exige permissão separada;
- CT-50: deny explícito vence allow e revogação de vínculo remove acesso.

A suite detecta as capabilities reais de triagem/lifecycle antes de montar o payload e usa apenas dados sintéticos identificados pelo `runId`. O cleanup:

- remove anexos sintéticos;
- limpa etiquetas;
- devolve o chamado para `visibility=organization`;
- esvazia/desativa o grupo sintético.

O chamado sintético pode permanecer como registro de QA na organização dedicada; nunca deve conter informação real ou sensível.

## Salvamento durável de projetos

Suite: `durable-project-save`. Contrato detalhado:
[Durable project saving](../ops/durable-project-saving.md#registered-synthetic-acceptance-code-prepared-execution-separately-gated).

- Organização fixa: 9 / `maono-preview-qa`; `project_slug` vazio.
- Único perfil automatizado no secret QA existente: `creator`, papel `editor`,
  permissão global `project.create`. Direitos sobre o projeto próprio são
  confirmados pelas APIs reais; não exigir permissões globais artificiais de mapa.
- Inventário anterior feito por humano `super_admin`, fornecido em `manualInventory`;
  a conta/sessão administrativa nunca entra no runner.
- Baseline/seguro: `PROJECT_DURABLE_SAVE_V1=false` e
  `PROJECT_DURABLE_SAVE_INLINE_ENABLED=true`; janela: true/false, respectivamente.
- Worker agendado e seus bindings precisam de auditoria e autorização de
  deployment independentes. A suite não o provisiona nem faz deploy.
- `PROJECT_QUOTA_RESERVATION_V1` deve estar ausente/desabilitada nos snapshots
  configurado e publicado; a suite bloqueia quota ativa, sem modificar essa flag,
  porque falta cleanup verificável de reservas incompletas pelas APIs atuais.
- Até dois projetos sintéticos, incluindo 94 MiB; o journal registra o escopo
  para posterior remoção humana dos projetos e desativação dos arquivos.
  Objetos imutáveis, recibos e tombstones permanecem retidos.
- `report.runId` identifica os recursos mesmo se o run falhar. Falha ou interrupção
  não permite declarar cleanup completo nem abrir outra janela sem reconciliação.
- Resposta perdida é modelada por descarte do ACK; leitura grande verifica o
  descriptor e recibo validado pelo servidor, sem afirmar download independente.

O antigo workflow de Preview está aposentado e não oferece rota alternativa.
Esta nova suite está preparada em código; não há execução ou rollout implícito.

## Inventário e cleanup humanos para JSON/PNG

Este fluxo não altera runtime/ACL, não cria secret, input ou workflow e não pede
credenciais administrativas ao CI. A janela ainda exige preflight, aprovação
explícita e o Environment protegido. Preparar estes arquivos não autoriza execução.

### Antes da janela

1. Concluir o `preflight` separado, confirmar SHA completo/suite e obter a
   autorização explícita da janela. Fazer dispatch de `run` com a confirmação
   existente `RUN_PRODUCTION_ACCEPTANCE`. Aguardar o job de validação terminar
   e o job protegido ficar **esperando aprovação** de `production-acceptance`.
   **Não aprovar ainda.** O job de validação não referencia o secret QA.
2. Abrir a URL desse run no Actions e copiar o ID decimal após `/actions/runs/`.
   Esse é `workflowRunId`, uma string; não confundir com o UUID sintético `runId`.
   Usar somente a primeira tentativa (`GITHUB_RUN_ATTEMPT=1`). Na origem canônica
   `https://maono-kepler-v1.pages.dev`, o humano usa sua sessão `super_admin`
   existente e organização ativa **9 / maono-preview-qa**. Não copiar cookie/token.
3. Revisar e executar no console o conteúdo versionado de
   `scripts/acceptance/manual-admin-evidence.js`. Ele instala somente
   `MaonoAcceptanceEvidence.before`, `.inspect` e `.after`, sem requisições ao
   instalar. As três funções fazem apenas GET same-origin nas rotas fixadas;
   não acessam cookies, localStorage ou sessionStorage, nem executam limpeza.
4. Capturar agora o inventário, vinculado ao run que aguarda aprovação:

   ```js
   const before = await MaonoAcceptanceEvidence.before({
     suite: "durable-project-save", // ou durable-project-preview
     expectedCommit: "<SHA completo de 40 caracteres hexadecimais>",
     workflowRunId: "<ID decimal do run Actions que aguarda aprovação>"
   });
   JSON.stringify(before, null, 2);
   ```

   O export inclui `schemaVersion:1`, `kind:qa-before-inventory`, suite, SHA,
   `workflowRunId`, `workflowRunAttempt:1`, UUID sintético novo, administrador
   humano, origem, organização ativa, horário e arrays sanitizados. Não editá-lo.
5. Salvar exatamente `creator` e `manualInventory` no secret **do Environment
   `production-acceptance`** chamado `MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON`;
   `manualInventory` recebe o export completo. Não usar fallback de secret do
   repositório/organização. Senha somente nos controles seguros do GitHub.
   Confirmar que a atualização foi salva **antes de aprovar** o job.
6. Só então aprovar o Environment. O operador exige `GITHUB_RUN_ID` igual ao
   export e `GITHUB_RUN_ATTEMPT` exatamente `1`. O relatório preserva ambos.
   O inventário precisa ter no máximo **15 minutos** ao preparar a execução,
   e novamente imediatamente antes da primeira alteração de flags, após esperar
   a fila ficar quiescente. O job protegido não compila o app; seus passos de setup
   somam tetos de até 11 minutos. A revalidação antes da reserva admite até
   75 minutos para acomodar até 60 minutos de ativação limitada após a admissão
   fresca, sem ampliar o prazo inicial.
7. O editor faz GET `/api/projects` e confirma o escopo visível. Projetos
   sintéticos anteriores, arquivos ativos/vinculados, UUID reutilizado ou
   evidência divergente bloqueiam a janela. Tombstones históricos inativos e
   desvinculados são aceitos.

O GitHub lê secrets de Environment quando o job correspondente inicia; eles
ficam inacessíveis ao job protegido antes da aprovação. Secrets de repositório
são lidos antes, quando o run entra na fila, e não servem a esta sequência.
Fontes: [momento da leitura](https://docs.github.com/en/actions/reference/security/secrets#when-github-actions-reads-secrets)
e [acesso após aprovação](https://docs.github.com/en/actions/concepts/security/secrets#organization-level-secrets).

Se faltar o vínculo, a evidência expirar ou a tentativa falhar, preservar/verificar
o estado antes de continuar. Confirmar ausência de mutações/recursos pendentes
ou concluir a reconciliação separada antes de outra janela. Uma nova tentativa
exige **novo dispatch, novo
export e novo UUID**, mesmo se a anterior parou no preflight interno. Nunca usar
Re-run jobs, reaproveitar bundle/UUID ou alterar o secret para tentar corrigir um
job já aprovado/em execução. Vincular run e primeira tentativa, junto dessa regra
humana, reduz replay ordinário; não há registro server-side de uso único nem
atestado criptográfico. Não acrescentar inputs, workflows ou secrets.

O UUID do export vira `report.runId`. Checkpoint e `report.json.journal-NNN.json`
registram as intenções antes do POST e os IDs conhecidos após o ACK, junto de
nome/slug, organização, criador, SHA e vínculo com run/tentativa do Actions. Os journals fazem parte do artifact pelo
padrão existente `report*.json`; não contêm credenciais ou payloads.

### Depois da execução, antes de qualquer exclusão

Este procedimento só admite relatório final com todos os casos funcionais PASS,
`operationalTestsPassed=true`, `acceptanceStatus=PENDING_MANUAL_CLEANUP`, erro
`MANUAL_CLEANUP_REQUIRED`, `configurationRestored=true` e nenhuma falha de budget
ou restauração. O runner não usa APIs administrativas nem apaga recursos. Para
PNG, a barreira de fechamento do navegador/requisições também precisa ter passado.

**Run falho, cancelado ou interrompido não está pronto para cleanup.** IDs e
journals são material para reconciliação humana separada, somente leitura. Um ACK
recebido, navegador fechado, flags restauradas ou inventário vazio não provam que
operações já aceitas pelo Worker terminaram. `inspect` e o certificado rejeitam
esses runs; não editar o relatório para contornar a barreira. Não excluir nada
antes de comprovar terminalidade das operações remotas e obter aprovação separada
dos IDs exatos. Este fluxo não fornece reparo D1 nem um novo operador.

Baixar o `report.json` original do run GitHub correto e preservar seus bytes.
Na mesma sessão administrativa, fornecer esse JSON à função read-only:

```js
const inspection = await MaonoAcceptanceEvidence.inspect(report);
JSON.stringify(inspection, null, 2);
```

Ela reconcilia inventário, detalhes, criador, nome/slug, projeto e arquivo
vinculado, e devolve os IDs exatos. ACK perdido, ID ausente/incerto, alteração de
identidade ou ambiguidade não pode ser resolvido por um inventário vazio: a
requisição original ainda pode concluir. Interromper e investigar, preservando
os artifacts; não procurar/apagar indiscriminadamente por prefixo.

### Ação manual com aprovação dos IDs exatos

A tela Admin atual não oferece os controles necessários de exclusão de projeto
ou desativação de arquivo; `/admin/files` redireciona para Gestão de Organizações.
Não usar a tela legada como prova de capacidade. Após revisar `inspection`, pedir
aprovação explícita de **cada projectId e organizationFileId**, método e efeito.
Somente o humano efetua a exclusão irreversível usando sua sessão existente:

- `DELETE /api/admin/projects/{projectId}`, sem query: remoção definitiva de
  metadata do projeto e vínculos `user_projects`; não tem desfazer pela UI.
  Resposta esperada: HTTP 200, `ok:true`, `deleted:true`, `deactivated:false`.
  Confirmar depois GET do mesmo ID com HTTP 404. `?deactivate=true` não substitui
  esta etapa para projetos de lifecycle e pode retornar 409.
- Depois, `PATCH /api/admin/organization-files/{organizationFileId}` com somente
  `{"active":false,"isProject":false}`. É alteração reversível de flags de
  metadata; não restaura o projeto excluído. Resposta esperada: HTTP 200,
  `ok:true`, `file` do mesmo ID e ambas as flags false.

Não executar DELETE de arquivo, `dropbox=true`, exclusão física, purge, GC,
varredura em lote, alteração de ACL ou recurso fora da lista aprovada. JSON/PNG
imutáveis, recibos e tombstones permanecem retidos. Nem o helper nem o certificado
fazem essas mutações. Aprovação da janela não substitui aprovação desta limpeza.

### Comprovação de fechamento

Depois das ações aprovadas, executar somente leitura:

```js
const after = await MaonoAcceptanceEvidence.after(report, inspection);
JSON.stringify(after, null, 2);
```

`after` exige projeto 404, arquivo exato inativo e sem vínculo em inventário novo,
sem outros sintéticos ativos. Guardar o export como `after.json`. No checkout do
mesmo código revisado, sem rede/credenciais, validar o relatório original e export:

```sh
node scripts/acceptance/verify-manual-cleanup.mjs \
  --report report.json --evidence after.json --output cleanup-certificate.json
```

O export posterior deve ser recente (até 30 minutos), a inspeção posterior ao
relatório final, e a coleta posterior à inspeção. O comando cria um certificado
separado e não sobrescreve arquivos. Exit 0/`complete:true` exige todos os casos
funcionais PASS, `operationalTestsPassed=true`, estado `PENDING_MANUAL_CLEANUP`,
flags comprovadamente seguras e somente `MANUAL_CLEANUP_REQUIRED` no relatório
original, sem falha de budget/restauração. Falha funcional, cancelamento ou
interrupção são rejeitados; este helper não emite certificado de cleanup para eles.

Vincular certificado e exports ao run/SHA original. Não editar o relatório,
transformar `DS-CLEANUP` em PASS à mão ou executar outra janela para ficar verde.
Os hashes vinculam o conteúdo; **não autenticam criptograficamente a coleta
humana**. Conferir procedência do artifact GitHub e da sessão/export de origem.
Se houver interrupção, usar `closure` autorizado para restaurar flags e preservar
IDs/journals para reconciliação humana read-only. Não excluir recursos até provar
que operações remotas terminaram e aprovar separadamente os IDs exatos; `closure`
não prova terminalidade do Worker nem limpeza.

## Feature flags e rollback

O operador não considera “flag OFF” um rollback de confidencialidade de dados reais. Por isso:

- somente dados sintéticos podem ser usados nas janelas;
- uma suite precisa declarar o safe state explicitamente;
- ativação temporária para acceptance não autoriza ativação permanente;
- o operador sempre tenta restaurar o safe state em `finally`;
- o modo `closure` existe para interrupções do runner.

## Uso

GitHub → Actions → Production Acceptance Operator → Run workflow.

Exemplo CC-04:

- branch do workflow: `main`;
- mode: `preflight` ou `run`;
- suite: `cc04-selective-access`;
- organization_id: organização QA dedicada;
- project_slug: vazio na CC-04 atual;
- confirmation: conforme o modo.

O job protegido para no Environment `production-acceptance` até aprovação humana.

## Evidência

O artifact contém somente informação sanitizada:

- suite e versão;
- SHA do produto;
- organização alvo;
- IDs sintéticos;
- casos PASS/FAIL;
- estado de cleanup;
- estado de restauração;
- erro público, quando houver.

Senhas, cookies e tokens nunca são gravados no artifact ou Job Summary.


## Orçamento de execução e interrupções

Os limites revisados por fase são 10 min de preflight, 60 de ativação, 45 de
mutações da suite, 10 de cleanup, 60 de restauração e 5 de relatório: até 190 min.
O job protegido tem 210 min. Os próprios passos de setup somam no máximo 11 min;
o operador tem teto de 192 min; resumo/artifact somam 3 min. A soma dos tetos de
passos é 206 min, com 4 min adicionais de margem do job. Setup lento falha antes
da entrega de secrets ao operador; não consome silenciosamente a reserva final.

Cada requisição, leitura de resposta e espera respeita o deadline da fase. A
admissão exige reserva de cleanup/restauração, e esses passos recebem deadlines
novos depois de timeout da suite. Após autenticar o QA, há checkpoint sanitizado
e run ID no log antes de alterar flags ou recursos da suite. Interrupção dura pode impedir finally e upload de artifacts;
o checkpoint/log identifica o run, mas não comprova fechamento. Usar closure com
aprovação separada e verificar recursos. Uma reserva sem resposta confirmada
continua incerta mesmo com inventário vazio, pois a requisição original pode
concluir depois. Recursos sintéticos de runs anteriores bloqueiam nova janela.

## PNG real vinculado ao recibo JSON

A suite `durable-project-preview` exige navegador real, organização QA9, slug
vazio e cinco flags explícitas com restauração segura. Usa um projeto novo com
três pontos sintéticos, Save do editor publicado, GET/decode/hash do PNG,
reabertura, ordenação histórica e falha PNG sem perder JSON confirmado.

Consulte [o contrato e os pré-requisitos de PNG](../ops/production-png-acceptance.md).
CI local não é aceite integrado: accounts/storage de CI são fixtures e nenhum
`run` real acontece em pull requests. Migration, Worker, secrets, janela real,
merge, deploy e ativação permanente continuam com autorizações separadas.
