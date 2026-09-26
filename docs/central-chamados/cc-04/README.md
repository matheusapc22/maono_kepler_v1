# CC-04 — acesso seletivo e chamados privados

## Objetivo

Adicionar um segundo nível de autorização por chamado sem substituir o RBAC organizacional existente. Chamados `organization` preservam o comportamento anterior. Chamados `private` exigem um `allow` explícito de usuário, grupo ou política, e qualquer `deny` aplicável vence os `allow`.

## Feature flag

`MAONO_TICKET_SELECTIVE_ACCESS_ENABLED=true` ativa o enforcement seletivo. O default operacional é **false**.

Com a flag desligada, as rotas existentes continuam no comportamento organizacional anterior e as novas superfícies administrativas da CC-04 permanecem indisponíveis. A flag só pode ser habilitada em um ambiente no qual a migration 0027 tenha sido aplicada e confirmada.

## Superfícies protegidas

- listagem, pesquisa, paginação, total, facets e overdue;
- detalhe do chamado;
- anexos, upload, exclusão e download;
- state, transitions, waits, reopen e correções de eventos;
- etiquetas do chamado.

Um chamado privado negado responde como não encontrado para não revelar existência, título ou metadados.

## Administração

A capacidade `ticket.access.manage` é distinta de `ticket.manage`. Ela controla grupos, políticas e a configuração de visibilidade/ACL do chamado.

Endpoints:

- `GET/POST /api/organizations/:id/ticket-access/groups`
- `PATCH /api/organizations/:id/ticket-access/groups/:groupId`
- `GET/POST /api/organizations/:id/ticket-access/policies`
- `PATCH /api/organizations/:id/ticket-access/policies/:policyId`
- `GET/PUT /api/organizations/:id/tickets/:ticketId/access`
- `GET/PUT /api/organizations/:id/tickets/:ticketId/labels`

Etiquetas são classificatórias. O resolvedor de autorização não consulta `ticket_labels` ou `ticket_label_links`.

## Precedência

- `deny ticket.view` bloqueia leitura e ações dependentes de leitura;
- `deny ticket.comment` bloqueia comentário/anexo;
- `deny ticket.manage` bloqueia mutações de gestão;
- `allow ticket.manage` satisfaz `view` e `comment`;
- `deny` aplicável vence qualquer `allow` de usuário, grupo ou política;
- remoção da organização, suspensão de usuário, remoção de grupo ou desativação de grupo/policy é observada na requisição seguinte.

## Migration

`0027_ticket_selective_access.sql`

Alvos futuros: D1 `maono_maps` de Desenvolvimento, Preview e Produção, com evidência separada por ambiente.

**STATUS: MIGRATION PENDENTE DE CONFIRMAÇÃO.**

Merge, CI verde, Preview ou deploy não autorizam aplicação da migration nem ativação da feature flag.
