# Production Acceptance Operator

Preparo do navegador: [instalação isolada, smoke offline e limites](acceptance-browser-setup.md).

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
5. compara flags configuradas e publicadas; altera somente as declaradas que exigirem transição;
6. reconfirma a fila antes do retry e espera terminalidade real;
7. quando houve mudança, recria o mesmo deployment canônico via Cloudflare Pages Retry;
8. espera terminalidade, confirma o novo snapshot e, nas suites duráveis, aguarda as duas flags efetivas no runtime público antes de admitir fixtures;
9. executa os casos registrados;
10. executa a barreira de fechamento da suite; JSON/PNG deixam a limpeza pendente para o humano;
11. restaura as flags para o safe state;
12. quando necessário para restaurar flags, recria novamente o mesmo SHA;
13. confirma que a configuração ficou restaurada, incluindo a leitura efetiva das duas flags duráveis;
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

Não executa a suite. Restaura somente as flags gerenciadas pela suite para o safe state e publica novamente apenas quando necessário. Se os snapshots configurado e canônico já coincidirem, verifica runtime aplicável e relê o control-plane; não faz PATCH nem retry. Isso não prova o fechamento de recursos de uma execução interrompida.

### Leitura efetiva das flags duráveis

Para manifestos que gerenciam `PROJECT_DURABLE_SAVE_V1` ou
`PROJECT_DURABLE_SAVE_INLINE_ENABLED`, o snapshot do control-plane é seguido por
`GET https://maono-kepler-v1.pages.dev/api/health`, na mesma origem usada pelos
fixtures. Nunca se troca para a URL do deployment com hash. O gate também se
aplica à `closure` quando o control-plane já informa o estado seguro.

A resposta deve ser HTTP 200, JSON `no-store`, serviço esperado, runtime
`production`, health OK e D1 acessível; os dois valores de diagnóstico devem
ser booleans. As flags gerenciadas precisam coincidir com o estado desejado:
ativação JSON/PNG `true/false`; restauração `false/true`. O endpoint existente
executa somente `SELECT 1` no banco e expõe presença dos bindings; nenhum
fixture é criado para testar readiness.

Há no máximo 12 GETs, 180 segundos no total, 10 segundos por requisição incluindo
o corpo, intervalo de 5 segundos e 16 KiB de resposta. Esses limites consomem a
fase atual dentro dos budgets existentes de 190 minutos do operador/210 do job.
A leitura não recebe token Cloudflare, cookie ou credencial QA, não segue
redirects e não repete POST, PATCH ou outra mutação. CC-04 e manifestos sem
flags duráveis não passam por esse gate.

Se o runtime não convergir após ativação, `acceptanceExecuted=false`, nenhum
POST de fixture é iniciado e a restauração continua com seu próprio orçamento.
Autenticação e inventário somente leitura podem ter ocorrido antes do gate.
Falha na leitura de restauração mantém `configurationRestored=false`, inclusive
na `closure` sem alteração de flags. O relatório registra `activationRuntime` e
`restorationRuntime` com estado sanitizado, tentativa e os dois booleans quando
válidos; não inclui payload, headers ou valores de secrets.

Esta prova é limitada: `/api/health` não informa SHA/ID de deployment nem as três
flags PNG. `deploymentIdentityVerified=false` e `previewFlagsVerified=false`
deixam essa distinção explícita. SHA, deployment e as demais flags continuam
sendo verificados apenas no control-plane; uma divergência não identifica por
si só binding, alias ou propagação como causa. O preflight continua somente
control-plane e não certifica readiness efetiva.

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

### CC-04: acesso seletivo já habilitado

O manifesto v2 exige SELECTIVE_ACCESS=true antes, durante e depois da janela.
COMMANDS precisa estar explicitamente false nos snapshots configurado e canônico;
o operador não o gerencia nem o habilita. `/state` deve responder 503 com
`TICKET_COMMANDS_DISABLED`: o relatório registra essa cobertura de ACL como
`NOT_EXERCISED`. Demais superfícies CT-11 continuam exigindo ocultação/404.
Um eventual aceite de COMMANDS exige outro contrato e decisão sobre seu alcance global.

Quando a flag já coincide, a entrada e o fechamento são verificações sem
republicação, com releitura para detectar drift. Se a entrada não alterou flags,
o fechamento não sobrescreve alterações concorrentes: falha e exige investigação.
Os controles de SHA, D1, fila quiescente, runtime aplicável e orçamento continuam
valendo. O fluxo normal de restauração permanece para suites que alteraram flags.

Antes de autorizar `run`, escolher organização QA dedicada com storage READY e
três identidades distintas sem papel admin/super_admin. Manager precisa de
ticket.view/create/manage/access.manage; allowed/restricted precisam de ticket.view
e não podem ter ticket.access.manage efetivo. Não inferir identidade dedicada de
um papel editor, membership ou nome de secret. Não colocar credenciais no chat.
O input não secreto `qa_user_ids` fixa os três IDs, na ordem
`manager,allowed,restricted`, aprovados pelo humano. É obrigatório em `run` CC04;
ausência impede qualquer chamada remota. O operador compara as sessões
autenticadas com esses IDs antes de alterar flags ou criar recursos. Os IDs não
criam usuários, não concedem permissões e não substituem a aprovação da janela.

O contrato proposto `preserve-private-v1` exige aprovação junto da janela. Cria no
máximo um chamado, um anexo texto, um grupo e uma etiqueta novos por UUID. Não
aceita IDs existentes como entrada e não executa DELETE nem SQL de exclusão.
O journal registra intenção antes de cada criação e o ID imediatamente após a
resposta, em `report*.resources-*.json`. Falha ao persistir intenção bloqueia a
criação. Resposta perdida permanece incerta, não é repetida nem substituída por
busca/adopção por prefixo.

O fechamento valida ID, organização, nome UUID e autor do chamado; preserva-o
privado para manager, fecha seu status, remove seus vínculos de etiquetas e
desativa/esvazia apenas o grupo recém-criado, depois verifica as respostas reais.
Verifica também a negativa de acesso de allowed/restricted. Anexo, bytes, etiqueta
desvinculada, chamado e histórico ficam preservados; não há prazo de retenção
inventado. `CC04-CLEANUP=PASS` e `cleanupComplete=true` significam que essa
preservação foi verificada, não que registros foram excluídos. O journal identifica
explicitamente os resíduos retidos e falhas de fechamento. Anexo ainda PENDING,
criação incerta, ownership divergente ou negativa de acesso não comprovada impedem
conclusão. Não abrir outra janela para tentar tornar o relatório verde.

A remoção futura exige autorização separada para IDs sintéticos exatos e provas
de pertencimento/terminalidade. A rota atual não oferece DELETE de chamado;
não improvisar exclusão SQL, apagar histórico ou varrer por prefixo. Usar somente
uma janela por vez nessa organização, sem edição humana concorrente das fixtures.
Os templates dos Workers de notificações e reconciliação também preservam
SELECTIVE_ACCESS=true; suas operações continuam desabilitadas. Nenhum Worker
novo é dependência deste lote de acesso seletivo.

### Despacho

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
# CC03 — janela global de comandos e um chamado sintético

`cc03-command-lifecycle` é a suíte API para preparar A-02. O aceite CC04 de
acesso seletivo é A-03 e não autoriza ativar COMMANDS globalmente. Esta suíte não
representa implantação permanente nem prova UI, CR, anexos, SLA ou entrega de
notificações. Não reaplica migrations e não precisa de novos Workers.

O manifesto exige QA9 (`maono-preview-qa`), IDs **5/11/7** na ordem
manager/allowed/restricted, sem bypass administrativo. Usa o bundle protegido
existente; nenhum segredo deve ser copiado para inputs, relatórios ou chat.
O primeiro caso cria **um novo** chamado `QA-CC03-<run UUID>`. Imediatamente após
registrar o ID, privatiza para o gestor e leitor permitido; até essa requisição
o chamado é visível aos usuários com acesso à Central da QA9. Uma interrupção
nesse intervalo pode exigir contenção humana do ID exato. Não usa o chamado
preservado por outro run, nem cria anexo, grupo, etiqueta ou alteração relacionada.

Cobertura API: replay/colisão de idempotência; If-Match obrigatório e CAS
200/428/412; `/state` 200/404 e comando de viewer 403; triagem, progresso,
espera/retomada, revisão, conclusão, reabertura, correção append-only e segunda
conclusão. As versões são lidas de `/state`: gravações de ACL também alteram o
ETag, por isso não se fixa uma contagem anterior de eventos/versões.

## Gates antes de RUN

1. Revisar e publicar o código no produto e o input compatível no dispatcher
   `main`, com CI/revisão; executar preflight protegido do SHA publicado.
2. Obter autorização **nova e específica** para COMMANDS temporariamente global,
   para a pausa de escritores de todas as organizações ativas, horários UTC e
   responsável pela restauração. A aprovação anterior de CC04 não cobre isso.
3. Fazer auditoria somente leitura por SQL agregado, usando acesso já autorizado,
   sem GETs que importem legados. Conferir o conjunto completo de organizações
   ativas, marker ready/v1/completed, pending/skipped zero, pendências reais da
   fonte zero e chamados já adotados sem classificação zero. Conferir também
   schema/triggers/indexes do código publicado. Não consultar nomes/conteúdo
   pessoal, importar ou reparar registros por inferência.
4. Arquivar a evidência sanitizada e calcular seu SHA-256. Fornecer o input
   **não secreto** `cc03_window` descrito abaixo; revisar os agregados contra a
   evidência original antes de aprovar o Environment. Não preencher valores por
   suposição. Mudança de conjunto/estado exige nova auditoria e decisão.
5. Despachar uma única execução `run`, `qa_user_ids=5,11,7`, organização 9,
   confirmação `RUN_PRODUCTION_ACCEPTANCE`; parar no Environment
   `production-acceptance`. Não aprovar automaticamente.

O token Pages não permite comprovar esses agregados em D1. O operador valida
estrutura, identidade, completude declarada e frescor, mas **não autentica a
origem do snapshot nem consulta D1**. O relatório identifica isso como
`HUMAN_SUPPLIED_AGGREGATES_NOT_LIVE_D1`; `evidenceSha256` registra o hash declarado
do arquivo que o humano deve conferir, e `inputSha256` identifica exatamente o
JSON recebido. Isso não é substituto para auditoria e revisão humana. Preflight
expõe esses gates como pendentes e não faz logins QA.

## Contrato de `cc03_window`

JSON de objeto, sem campos extras, URLs, SQL, nomes de secrets ou credenciais:

| Campo | Valor exigido |
| --- | --- |
| `version` | `1` |
| `expectedCommit` | SHA completo publicado e fixado pelo workflow |
| `databaseId` | `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db` |
| `observedAt` | Horário da evidência, ISO UTC com milissegundos |
| `startsAt`, `endsAt` | Janela explicitamente aprovada, mesmo formato UTC |
| `globalCommandsApproved`, `writersPaused` | `true`, após decisão e pausa reais |
| `restorationOwner` | Login GitHub do dono que despacha e responde pela restauração |
| `evidenceSha256` | SHA-256 do arquivo sanitizado revisado, 64 hex minúsculos |
| `schemaCompatible` | `true` após conferir tabelas/colunas, triggers e índices exigidos pelo SHA |
| `allActiveOrganizations` | `true` somente com conjunto completo conferido |
| `activeOrganizationCount` | Contagem real do conjunto de organizações ativas |
| `organizations` | Uma linha por organização ativa, sem duplicatas; inclui QA9 |

Cada linha contém exatamente `id`, `status` (`ready`), `schemaVersion` (`1`),
`pendingCount` (`0`), `skippedCount` (`0`), `completedAt` (UTC normalizado),
`actualPendingCount` (`0`) e `unclassifiedAdoptedCount` (`0`). Preservar a
evidência original dos horários ao normalizar o formato. Não copiar o inventário
histórico como evidência atual. O limite de payload é 20 KB/100 linhas por segurança
de parsing; se o conjunto real exceder isso, é necessário revisar código, nunca
truncar a auditoria.

Evidência deve ter no máximo **10 minutos** antes dos logins e novamente antes
da primeira alteração de flags; fila/aprovação demoradas podem invalidá-la.
Não usar “Re-run jobs”: somente attempt 1 é aceito. Conferir o resultado anterior
antes de qualquer novo despacho autorizado.

O prazo aprovado pode apenas **encurtar** o orçamento técnico de 190 minutos;
não amplia os 210 minutos do job. Mantêm-se os tetos de fase e as reservas de
10 minutos de cleanup + 60 de restauração + 5 de relatório. Uma janela curta
demais para essas reservas é recusada antes da alteração de flags. Esses tetos
não são uma duração operacional escolhida pelo usuário nem uma garantia contra
interrupção abrupta do runner. Registrar responsável e canal de incidente na
aprovação; este input não envia notificações.

## Contenção e fechamento

Ao final ou em falha, conferir propriedade do ID observado, restringir ACL ao
gestor, ler ETag atual e fechar via `/transitions` com os campos de conclusão,
**antes** de restaurar COMMANDS=false. Não usar PATCH de status. Uma resposta de
fechamento perdida é conferida por leitura antes de qualquer conclusão; não há
repetição cega. Se já estiver fechado, não se cria outra conclusão.

Preservam-se chamado, ciclos, esperas, eventos originais/correções, auditoria e
outbox, sem DELETE, descarte de bytes ou prazo de retenção inventado. Verificam-se
ACL final e 404 dos dois perfis negativos em detalhe e `/state`. Falha de cleanup
continua FAIL mesmo que a restauração tenha sucesso. Se o create não devolver ID
verificável, o diário mantém `unknownCreation`; nunca procura/adota por prefixo.

Restauração mantém TRIAGE=true e SELECTIVE_ACCESS=true e retorna COMMANDS=false,
publicando o mesmo SHA. Isso não desfaz comandos nem entrega de outbox; tickets
com ciclo adotado podem ficar indisponíveis para escrita com COMMANDS=false.
Por isso escritores externos devem estar pausados. Desligar SELECTIVE_ACCESS
nunca é rollback de confidencialidade. Consumers de outbox e demais Workers são
um lote posterior com escopo/data de início próprios, antes de qualquer entrega.

Interrupção dura pode impedir finally: conferir primeiro journal, ID, flags e
deployments; contenção de recursos e closure exigem o escopo autorizado. O modo
closure restaura configuração mas não prova cleanup e não autoriza nova janela.
Acceptance real, rollout permanente e exclusão de contas continuam decisões
separadas. Testes locais com SQLite/fetch sintéticos não substituem esse aceite.
