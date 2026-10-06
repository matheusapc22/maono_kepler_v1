# Production Acceptance Operator

## Objetivo

Executar somente os testes que dependem de ambiente real, autenticação, configuração remota, feature flags, chamadas HTTP ou interface real, sem duplicar os testes unitários/SQLite/CI comuns.

Fluxo:

`CI normal → preflight → aprovação humana → acceptance controlado → cleanup → restauração de configuração → evidência`

O operador é genérico. Cada funcionalidade registra uma **suite versionada** em `scripts/acceptance/suites/`. A primeira suite é `cc04-selective-access`.

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
   - formato atual:

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

Esta é a única suite remota registrada neste snapshot. Ela não executa CT55–58 nem substitui os aceites herdados CC05–16. A CC17 acrescenta automação local e um validador offline de evidências; novos executores remotos de carga/caos exigem contrato versionado, parâmetros aprovados e revisão antes da janela.

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

## Bootstrap da janela limitada de salvamento e PNG

Esta alteração em `main` contém somente o workflow, seu contrato estático e
esta documentação. O código do produto e das suites continua vindo de um SHA
exato de `mano_kepler_v1`, fixado no job sem secrets e revalidado antes do job
protegido. Não copiar frontend, migrations ou runtime da PR de produto para `main`.

O job admite no máximo 210 minutos. Os passos protegidos somam 206 minutos:
checkout 3, drift 1, Node 2, instalação isolada do navegador 5, operador 192,
resumo 1 e artifact 2. O código de produto deve comprovar o orçamento interno
de 190 minutos: preflight 10, ativação 60, suite até 45, cleanup 10, restauração
60 e relatório 5. Se esse contrato não existir no SHA de produto, a validação
falha antes de credenciais ou mudanças remotas. Isso também bloqueia suites
antigas até que o produto receba o operador com orçamento revisado.

Dependências: revisar e mesclar separadamente a PR de produto com o framework
limitado e as suites desejadas; publicar o mesmo SHA pelos procedimentos já
aprovados; só então solicitar o preflight e a janela exata de acceptance.
O bootstrap não executa deploy, não instala Worker, não configura secrets,
não aplica migrations e não autoriza `run` ou ativação permanente.

Falhas normais usam cleanup e restauração com reserva de tempo. Cancelamento
forçado ou perda do runner pode impedir `finally`; nesse caso, não repetir
a janela. Executar `closure` somente com confirmação separada, conferir o
checkpoint do run e reconciliar recursos sintéticos antes de declarar fechamento.
PNG só é comprovado pela futura suite de navegador real no SHA de produto;
a suite JSON e os contratos locais não são evidência PNG de Produção.
