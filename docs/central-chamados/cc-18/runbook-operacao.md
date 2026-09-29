# Runbook operacional e ensaio CT59 — CC18 v1

Público: operador que não escreveu o código, com autorização e acesso próprios. Este runbook não concede credenciais nem dispara produção. Leia [migration/backfill](runbook-migration-backfill.md), [rollback](runbook-rollback.md) e [operador protegido](../../runbooks/production-acceptance-operator.md).

## Preflight

1. Identifique incidente/ensaio, operador, organização QA, SHA completo do produto, URL canônica, DB/binding e janela. Confirme que não há deployment produtivo não terminal.
2. Confira CI/review do SHA e disponibilidade do workflow na default `main`. PR218 foi mergeada em29/09/2026 20:02:52 BRT, SHA `988b379d21e5071b59d5e9f0db189f67b096f186`; isso resolve publicação do dispatcher, não secrets/preflight.
3. Actions → Production Acceptance Operator → Run workflow → `main`, `mode=preflight`, suite registrada, organização QA e `confirmation=PREPARE_PRODUCTION_ACCEPTANCE`. Aprovação do Environment segue a política do GitHub. Não escolher `run` como forma de obter preflight.
4. Guardar artifact e conferir SHA publicado, branch, binding D1, baseline das flags e fila quiescente. O operador não lê sozinho todo ledger: anexar a verificação específica do schema.
5. A única suite registrada é `cc04-selective-access`. CT55–58 e CT59 não possuem executores remotos registrados; não selecionar CC04 e renomear seu resultado. Implementação/revisão de suites específicas e decisões operacionais continuam pré-requisitos dos respectivos ensaios.

## Diagnóstico e resposta

| Sinal / fonte | Diagnóstico | Ação controlada | Prova de recuperação |
|---|---|---|---|
| HTTP401/403 ou acesso revogado | Conferir sessão, associação atual, org, capacidade e ACL/audiência; não copiar cookie | Corrigir associação legítima por administrador ou manter negação esperada | Requisição do ator dedicado, esperado/observado sem conteúdo privado |
| 412/428 ou conflito CAS | Ler estado atual e token; preservar rascunho | Comparar e adotar versão explicitamente; repetir intenção apropriada | Uma mutação/evento vencedor, sem sobrescrita silenciosa |
| 503 de readiness | Conferir runtime, flags, schema e reconciliação da org | Conter escrita; resolver pré-requisito por fluxo próprio | Preflight e nova consulta no SHA correto |
| Upload sem progresso/ACK perdido | Consultar HEAD da sessão, offset, expiração, estado e arquivo original | Retomar com offset/token corretos ou reconciliar commit já presente; cancelar somente escopo autorizado | Um anexo confirmado, capacidade íntegra e sem bytes duplicados |
| Notificação atrasada/falha | Consultar operações, estado da outbox, tentativas, Worker, allowlist e marco de ativação | Reprocessar ID específico pela operação autorizada após corrigir causa | Entrega única e reautorizada, backlog/estado final registrados |
| Exportação falhou/vencida | Conferir estado, fonte, definição, limites, Worker e autorização | Retry idempotente de job autorizado; `SOURCE_CHANGED` exige nova geração válida | Manifesto/checksum, totals e download reautorizado |
| Métrica divergente | Comparar eventos autorizados, janela, calendário/definição e watermark | Replay limitado pelo endpoint autorizado; não alterar evento histórico | Agregado reconciliado com fonte e qualidade explícita |

Use UI e [API interna](api-interna.md) já autenticadas no ambiente autorizado. Reprocessamento não é SQL livre: notificações recebem `outboxId`; métricas usam `action=replay`; exports possuem rota de retry e chave no corpo. Respectivas permissões/flags/limites continuam obrigatórios. Não repetir resultado incerto sem antes inspecionar o estado.

## Observabilidade e budgets

Fontes: logs sanitizados Pages/Workers; operação de notificações; estado/manifesto de exportação; sessão de upload; métricas e relatório protegido. Registrar número de requisições/amostras, p95 por fluxo, taxa de erro inicial e final, atraso/backlog, tentativas e custo observado. Benchmark local de cinco amostras não comprova SLO.

Antes da janela, preencher no controle o dono de cada sinal, destino de alerta, horário de acompanhamento, volume/mix, duração, concorrência, p95/erro/custo máximos e parada. Não há novo serviço externo de alerta provisionado nesta CC18. Alertas precisam de validação operacional de quem recebe e do procedimento de resposta; sua implantação/aceite permanece pendência quando não comprovada.

## CT59 por operador independente

Preparação local permitida:

```sh
npm run test:cc18
npm run validate:cc18
node scripts/central-chamados/operator/backfill-d1.mjs --help
```

Ensaio real somente após revisão de procedimento/suite e janela específica:

1. O operador localiza sem ajuda do autor o SHA servido, DB/ambiente e ledger; compara com o alvo autorizado.
2. Recebe um cenário sintético conhecido de falha, identifica causa usando a tabela acima e registra diagnóstico antes da correção.
3. Reprocessa a intenção específica, verifica idempotência/ACL e registra esperado versus observado.
4. Executa contenção e restauração compatíveis, verifica cleanup e estado seguro separadamente; documenta a retomada ou bloqueio.
5. Anexa as quatro provas `diagnosis`, `reprocess`, `restore`, `cleanup`, executor e data em CT-59 do template. Avaliador registra dificuldades/lacunas do runbook e exige reteste após correção.

Se faltar ator, budget, procedimento remoto registrado, aprovação, secret ou acesso, registrar o impedimento e o papel responsável; o ensaio continua pendente. O agente não pode representar o operador humano independente nem certificar um ensaio não realizado.
