# CC-07 - Notificações duráveis e operáveis

## Contexto e fronteiras
Base: mano_kepler_v1, 9d2f7e26908123f55f8ea379904866b7d1a1904e, em 27/09/2026.
CC-06: código mergeado e migração 0029 aplicada; acceptance autenticado continua pendente.
CC-07 implementa somente notificações in-app. Não inclui email, push externo, SLA, notificações de anexos incompletos ou envio retroativo.
A homologação isolada foi dispensada pelo usuário: testes SQLite locais e CI são seguidos de acceptance controlado em produção, sujeito aos gates próprios. Preview não autoriza escrever no D1 de produção.

## Decisões de implementação
Reusar ticket_command_outbox. A migration 0030_ticket_notifications.sql adiciona metadados de tentativas/lease e tabelas de candidatos e notificações. Um trigger captura no mesmo commit os candidatos solicitante e responsável, excluindo autor da ação e pessoas fora da organização; isso não concede acesso. Processamento e leitura usam a autorização canônica atual. Notas internas exigem ticket.note.view. Nenhum corpo de mensagem é copiado para a notificação. A lista MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS é obrigatória (até 20 organizações); somente seu escopo participa do consumo/leitura. Workers em Preview ou runtime desconhecido são recusados.
O consumidor usa Worker scheduled sem endpoint público de execução, lotes limitados, claim CAS e token de lease. A entrega e o ACK usam batch D1 atômico, com unicidade por evento/destinatário/canal e fencing. Lote padrão 10, máximo 25 eventos, no máximo dois candidatos/evento e lease de 120 segundos. Falhas transitórias recebem backoff exponencial de 30 segundos até uma hora com jitter de até 5 segundos e limite de cinco tentativas; falhas finais exigem reprocessamento auditado por super admin.
Dois controles independentes: MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED e MAONO_TICKET_NOTIFICATIONS_ENABLED, OFF por padrão. Dependem de acesso seletivo pronto. Marco MAONO_TICKET_NOTIFICATION_START_AT obrigatório e estável durante recuperação: eventos anteriores nunca entram no consumo. Eventos de backfill não são elegíveis. Não mover o marco para trás para reenviar histórico.
Destinatários são capturados no enqueue e não ampliados em retry. Alterações posteriores de responsável não adicionam destinatário ao evento antigo. Revogação suprime entrega e oculta leitura/contagem mesmo após persistência. Deeplink passa novamente pelo endpoint canônico do chamado.

## Sequência de trabalho
1. Pasta, controle e contrato; auditar schema e produtores existentes.
2. Migração aditiva e snapshot transacional de candidatos.
3. Consumidor, lease, dedup, retry, supressão e falhas observáveis.
4. API autenticada, paginação, contadores autorizados e leitura idempotente.
5. Interface acessível na Central e operação administrativa auditada.
6. Testes reais SQLite/HTTP, regressões dos predecessores, typecheck e build.
7. Um push consolidado e PR revisável; registrar CI/Preview sem confundir com acceptance.
8. Após merge: audit da migration no operador protegido, relatório e autorização explícita antes do apply.
9. Acceptance autenticado pelo operador protegido, com suite registrada, dados QA, cleanup e restauração. Rollout separado.

## Critérios de validação
CT-24: consumidor indisponível, concorrência, expiração de lease, crash antes/depois do commit e deduplicação.
CT-25: revogação, isolamento por organização, nota interna, tentativas esgotadas e reprocessamento protegido.
CT-15B: notificações visíveis na Central; leitura/não lida, paginação e abertura do chamado com autorização atual.
Outros: sem efeitos quando OFF; schema ausente falha segura; transação revertida sem candidato; histórico e backfill não reenviados; payloads e logs sem texto privado.
Métricas: quantidade pending/failed, idade do mais antigo, tentativas e supressões. Orçamento de latência/CPU/D1 será medido no acceptance; não presumido aprovado por testes locais.

## Migration e gates
0030_ticket_notifications.sql: expansão para consumidor e notificações no D1 maono_maps, UUID 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db. Pré-requisitos 0026/0027/0028; base de produto inclui 0029. Não aplicada em produção nesta implementação.
AGENTS.md exige auditoria pelo workflow production-d1-migration-operator, SHA fixo, hash SQL, integridade, ledger, pendências e recovery bookmark; autorização humana vinculada ao approval hash, apply isolado e pós-validação.
Desligar flags pausa a funcionalidade e preserva filas/evidências; não executar down migration destrutiva. Nenhum merge ou CI autoriza rollout.

## Pesquisa e fontes primárias
Cloudflare D1 batch: https://developers.cloudflare.com/d1/worker-api/d1-database/ - execução sequencial transacional; falha reverte o batch. A aplicação mantém chaves únicas e predicates CAS.
Cloudflare Cron: https://developers.cloudflare.com/workers/configuration/cron-triggers/ - agendamento do handler scheduled; propagação operacional deve ser verificada.
Handler: https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/ .
Fontes locais: migrations/0026_ticket_command_lifecycle.sql, functions/_lib/ticket-access.js, ticket-conversations.js, ticket-commands.js e tests/helpers/ticket-command-db.mjs.

## Controle
Pasta: https://drive.google.com/drive/folders/1WYs05b8hF11-nHBufqYEe9pXGjxyXX4f
Planilha: https://docs.google.com/spreadsheets/d/1K3VBZ7DsC5Efo-w5bsaqh8aPdtyMrS5ShlbZRx3HZPQ/edit
