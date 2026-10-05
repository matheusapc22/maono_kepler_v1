# Kanban: atualização imediata de chamados

## Causa corrigida

`TicketsSection` alterava apenas seu vetor de chamados. `TicketKanbanBoard` carregava páginas próprias por fila, sem receber a alteração otimista nem o objeto retornado pelo PATCH. O cartão só era reposicionado quando a seção era remontada.

## Contrato de atualização

- Toda mudança local recebe uma revisão e o escopo dos filtros. A projeção visual é separada das páginas originais do servidor.
- O cartão e os contadores mudam antes da resposta HTTP. Um bloqueio síncrono por ID impede pedidos duplicados, inclusive entre o cartão e o detalhe, sem bloquear a gravação de outro chamado.
- A resposta canônica substitui a projeção. Falhas fazem rollback somente daquele ID; 403/404 retiram o item e invalidam um detalhe que ainda esteja carregando. O erro continua visível.
- Abertura do detalhe, alterações salvas nele, comandos de lifecycle confirmados, criação e remoções por perda de acesso alimentam o mesmo mecanismo. O lifecycle continua exigindo seus campos e sua confirmação antes do comando.
- Leituras anteriores à gravação não podem sobrepor a revisão mais recente. Mudanças de consulta ou organização não recebem cartões de uma operação antiga.

## Snapshots, paginação e autorização

O backend congela a associação à fila e sua ordenação no snapshot, mas retorna os campos atuais do chamado. A origem do cartão carregado é, portanto, a fila da página original, não necessariamente seu status atual.

Após as gravações pendentes terminarem, o quadro consulta um snapshot novo e compartilhado pelas quatro filas. As páginas já carregadas são recuperadas no mesmo snapshot e instaladas de uma vez. Uma fila que falhou mantém a projeção anterior e permite nova tentativa sem deixar as outras em loading permanente. A nova tentativa de snapshot expirado começa uma consulta nova.

Um cartão movido pode ficar além da primeira página do destino. Para mantê-lo visível, a leitura de detalhe revalida seu acesso antes de reter essa exceção visual no snapshot novo. Um ID ausente de uma página nunca é presumido autorizado. A paginação posterior deduplica esses IDs.

Uma negação de acesso à consulta retira o quadro; a negação individual não restaura a cópia anterior do cartão. Nenhuma decisão de acesso, regra de lifecycle/WIP, API, migration ou flag de produção foi modificada.

## Verificações

- `tests/ticket-live-state.test.mjs`: projeção, rollback isolado, filtros, contadores, dados canônicos, origem congelada e ausência de autorização.
- `tests/ticket-access.test.mjs`: remoção de dados obsoletos do detalhe e da consulta.
- `tests/browser/ticket-center-visual.spec.ts`: aplicação real e handlers React com HTTP controlado; resposta retida durante drag, duplicidade, seletor/teclado, ETag, concorrência, organização, filtro, detalhe/lifecycle, snapshots, paginação, falhas e perda de acesso.

A reprodução original falhou no app compilado da base: com o PATCH retido, o cartão permaneceu fora da coluna de destino. Testes com dados sintéticos não constituem aceite autenticado em produção.
