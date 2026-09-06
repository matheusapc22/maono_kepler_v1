# P0 — Editor request inbox and Ticket deep-link

## Problema e entrega

O submit do Viewer já cria a Change Request e seu chamado no mesmo batch, mas o Editor não tem uma entrada para descobrir essas solicitações. A entrega usa a relação persistida `ticket_id`, sem inferir IDs pelo título ou pela descrição do chamado.

- Editor → Solicitações → lista por projeto → Abrir Review.
- Central de Chamados → detalhes do chamado → Abrir Review quando autorizado.
- Review → Solicitações para retornar à fila.

## Contrato e implementação

`GET /api/projects/:slug/change-requests/inbox` usa a mesma autorização do Review: sessão válida, organização ativa, projeto acessível, rota Editor e `project.map.edit`. A consulta existente de solicitações próprias do Viewer não muda.

A lista usa `status` (`pending` por padrão, `all` ou um estado válido), `page` e `limit` (25 por padrão, máximo 100). A ordenação é por data de criação e ID, ambos descendentes; `limit + 1` informa `hasMore` sem contar toda a fila. Pendentes inclui submitted, under_review, approved e applying. Estados terminais ficam disponíveis nos filtros de histórico.

A resposta contém metadata, contagem de operações, solicitante, resumo do chamado e URL do Review. Não carrega operações, MapConfig, datasets ou arquivos do storage. A página `/projects/:slug/requests` é carregada separadamente do mapa, cancela requisições obsoletas e reinicia o estado ao trocar usuário, organização ou projeto.

O detalhe do chamado só devolve `changeRequest` após `ticket.view`, existência do chamado e autorização de Review para o projeto vinculado. Negativas 403/404 omitem o link; erros de infraestrutura continuam visíveis. Tanto inbox quanto detalhes do chamado usam `private, no-store`.

## Verificações

Testes com SQLite real e as funções reais de sessão/permissão cobrem paginação, estados, contagem, ausência de payload pesado, Viewer, sessão inválida, organização divergente, remoção de acesso, negativa explícita de edição e ambiente anterior à migration de Change Requests. Incluídos no `test:change-requests` e Foundation Gate.

Validação de interface: abrir Editor e clicar Solicitações; alternar estados/páginas; abrir Review e retornar; abrir um chamado vinculado na Central e usar Abrir Review; conferir ausência do link para Viewer e chamado comum.

## Deploy

Sem migration nova e sem dependência runtime nova. Requer o schema 0020 já usado pelo submit/Review. Sem concessão de `project.save`, aprovação automática ou alteração do Apply. A PR #144 foi descartada e não integra esta entrega. Base: merge da #145 (`4f76a43`).
