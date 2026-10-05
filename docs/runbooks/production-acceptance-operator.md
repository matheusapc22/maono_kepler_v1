# Production Acceptance Operator

## Objetivo

Executar somente os testes que dependem de ambiente real, autenticação, configuração remota, feature flags, chamadas HTTP ou interface real, sem duplicar os testes unitários/SQLite/CI comuns.

Fluxo:

`CI normal → preflight → aprovação humana → acceptance controlado → cleanup → restauração de configuração → evidência`

O operador é genérico. Cada funcionalidade registra uma **suite versionada** em `scripts/acceptance/suites/`. As suites registradas são `cc04-selective-access` e `durable-project-save`.

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

As contas precisam ser distintas. Cada suite valida as permissões mínimas antes de ativar feature flags.

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
10. executa cleanup da suite;
11. restaura as flags para o safe state;
12. recria novamente o mesmo SHA;
13. confirma que a configuração ficou restaurada;
14. grava artifact sanitizado.

Se qualquer caso, cleanup ou restauração falhar, o resultado é FAIL.

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
- Perfis no mesmo secret QA existente: `creator` editor com `project.create` e
  `administrator` super_admin com `admin.panel.access`. Somente contas dedicadas.
- Baseline/seguro: `PROJECT_DURABLE_SAVE_V1=false` e
  `PROJECT_DURABLE_SAVE_INLINE_ENABLED=true`; janela: true/false, respectivamente.
- Worker agendado e seus bindings precisam de auditoria e autorização de
  deployment independentes. A suite não o provisiona nem faz deploy.
- `PROJECT_QUOTA_RESERVATION_V1` deve estar ausente/desabilitada nos snapshots
  configurado e publicado; a suite bloqueia quota ativa, sem modificar essa flag,
  porque falta cleanup verificável de reservas incompletas pelas APIs atuais.
- Até dois projetos sintéticos, incluindo 94 MiB; cleanup remove projetos e
  desativa arquivos. Objetos imutáveis, recibos e tombstones permanecem retidos.
- `report.runId` identifica os recursos mesmo se o run falhar. Falha ou interrupção
  não permite declarar cleanup completo nem abrir outra janela sem reconciliação.
- Resposta perdida é modelada por descarte do ACK; leitura grande verifica o
  descriptor e recibo validado pelo servidor, sem afirmar download independente.

O antigo workflow de Preview está aposentado e não oferece rota alternativa.
Esta nova suite está preparada em código; não há execução ou rollout implícito.

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
