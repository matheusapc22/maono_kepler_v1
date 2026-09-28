# CC-09 — Filas completas, navegação e gestão de fluxo

Implementação de REQ-CC-21/22/23, baseada no produto `19657297397c9b06aed5cf54841f39011464b3db` (PR208). A entrega prepara código, SQL e testes; não comprova aceite autenticado nem autoriza migração/ativação em produção.

## Inventário e decisão

- `ticket-center.js`: consulta compartilhada, filtros, ACL e facetas. Antes: OFFSET sobre ordenação mutável; Kanban/calendário começavam em 100 registros sem ordem congelada.
- `ticket-commands.js`: comandos com If-Match, eventos/outbox na mesma transação. Reutilizados para movimentos, responsável e próxima ação.
- `TicketsSection`, lista/Kanban/calendário: consultas, carregamento incremental e detalhe. Antes: filtros apenas em memória e detalhe podia sobreviver à troca de organização.
- `Projects.tsx` e sessão: entrada por link restaura organização autorizada antes de abrir a seção. O parâmetro da URL não concede acesso.
- CC-09 adiciona `ticket-flow.js`, `TicketKanbanBoard`, `TicketFlowSettings`, `ticket-navigation.ts` e migration0032.

## Contrato de consulta

`GET /api/organizations/:id/tickets` conserva os filtros existentes; aceita `snapshot` e `queue` (`open`, `in_progress`, `in_review`, `closed`). `queue=open` reúne new/open e é intersectada com os demais filtros. Limite máximo100; interface usa50 em lista/calendário e25 por coluna.

Com fluxo habilitado, a primeira requisição grava IDs e posições no D1 por15min. Todos os sorts têm desempate por ID. O token é opaco e vinculado a usuário, organização e consulta. Próximas páginas usam posições congeladas. Inserções/alterações não mudam a composição nem a ordem; conteúdo, estado e ACL continuam atuais. Atualizar cria nova consulta. Exclusões/revogações deixam lacunas, sem repor com itens que duplicariam outra página. `total`/facetas contam membros atualmente acessíveis; `totalPages`/`hasMore` percorrem posições originais, podendo haver página vazia. Token inválido, expirado, de outro ator/org/filtro:409 `TICKET_QUERY_EXPIRED`, com atualização explícita.

Não há corte em100 registros nem busca automática de todos os objetos. A criação materializa IDs no banco por INSERT SELECT; o navegador recebe somente a página. Até100 consultas ativas por usuário/organização; ao exceder,429 até expiração. A limpeza por expiração ocorre na criação da próxima consulta, com FK cascade. Sem dados de conteúdo na tabela de posições. Snapshot não vai para URL compartilhável, nem é credencial.

Kanban compartilha o snapshot raiz e tem paginação/ordinal por coluna com total/carregado visível. A partição da fila também é congelada, evitando duplicações/perdas durante movimentos concorrentes. Lista e calendário usam a mesma consulta e incluem sem prazo quando existe filtro de período. Calendário agrupa por dia UTC de `due_at`, lista sem data separada e agenda dos itens carregados; navegar meses altera os filtros compartilhados, trocar visualização não os altera. Se a situação atual mudou, o cartão indica a mudança e permanece na partição original até atualizar a consulta. Uma atualização cria nova partição para todas as colunas.

URL usa `cc_org`, `cc_view`, `cc_ticket` e filtros `cc_*`. Preserva parâmetros externos e fragmento. Valores inválidos são descartados. Troca de organização pela sessão valida associação; organização indisponível exibe erro sem abrir chamado. Componentes são remontados por organização/usuário; requisições antigas são abortadas e sequenciadas. Envios são interrompidos no navegador; eventual sessão persistida continua na organização original, para verificar/retomar. Abort não desfaz uma gravação já confirmada pelo servidor.

## Fluxo e WIP

Filas correspondem às etapas existentes, sem novo ciclo de vida. WIP configurável para trabalho ativo (`in_progress`, `in_review`); entrada e concluídos não têm limite operacional. Sem limites iniciais inventados. `ticket.manage` configura políticas via GET/PUT `.../tickets/flow`, com versão CAS, limite1–10000 ou null e justificativa10–1000 caracteres. Reduzir limite abaixo da ocupação não remove chamados: bloqueia novas entradas.

O UPDATE do comando verifica capacidade na mesma transação do CAS; conta toda a organização, inclusive itens privados, sem expor suas contagens ao solicitante. Exceder retorna409. Gestor pode enviar `wipExceptionReason` de10–1000 caracteres no comando; motivo registrado no evento e mostrado no histórico. Conflito de versão permanece412. Desligar fluxo com políticas existentes bloqueia entradas nas filas controladas, em vez de contornar WIP.

`queue_entered_at` começa nas futuras criações/mudanças de etapa. Chamados históricos sem instante observado mostram “Início não observado”; não se inventa antiguidade. Responsável, próxima ação e espera reutilizam CC-03 e aparecem nos cartões.

## Ativação

`MAONO_TICKET_FLOW_ENABLED=true` **e** `MAONO_TICKET_FLOW_ORGANIZATION_IDS=<IDs separados por vírgula>` são necessários. Allowlist vazia não ativa nenhuma organização; `*` exige decisão explícita para todas. Dependem de comandos/triagem preparados e migration0032. Não foram configurados ambientes remotos nesta entrega.

Leia [migração](migration-runbook.md), [aceite e pendências](acceptance.md) e [evidência local](evidence/validation.json).
