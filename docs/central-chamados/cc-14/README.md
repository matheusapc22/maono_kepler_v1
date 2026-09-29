# CC-14 — Conhecimento e respostas reutilizáveis

Implementa REQ-CC-32/33 e CT45/46 sobre o merge CC13 `d37cd1e9aa95a5f5ea55fdc400a13e96c0bde461`. Planejamento: [pasta CC14](https://drive.google.com/drive/folders/104j9jF-IOnhsIMGUWKqQ6ibMooy7BRlI), [controle](https://docs.google.com/spreadsheets/d/1p3nw94HMlBrkZjO7GEHIVfz4y5oroscUZAGgTk5ODqE/edit).

## Entrega

- Artigos, revisões imutáveis, revisão independente, publicação/retirada explícitas e histórico paginado.
- Audiência privada (autor/revisor) ou organização; rascunho sempre nasce privado. Vínculo de origem ticket/incidente/problema exige acesso próprio e não copia conteúdo automaticamente.
- Busca pesquisa somente a versão autorizada: leitores organizacionais não veem termos de rascunhos. Nenhuma API pública/anônima.
- Reuso dentro da conversa: selecionar artigo publicado cria seleção durável e rascunho editável; o humano revisa o texto/destinatários e confirma envio. A seleção não envia mensagens.
- CC05 mantém mensagem/evento/outbox/proveniência atômicos; CC07 continua responsável por reautorizar entregas. A mensagem guarda a revisão usada mesmo após retirada.
- UI de criação, revisão, comparação, publicação e retirada na Central; compositor de reuso separado do rascunho ordinário para não substituir conteúdo/anexos existentes.

## Ativação

`MAONO_TICKET_KNOWLEDGE_ENABLED=false` e `MAONO_TICKET_KNOWLEDGE_ORGANIZATION_IDS=` são os defaults documentados. Nenhuma configuração remota foi alterada. Ativação exige runtime `local|production`, ACL seletiva ativa e schema0037 completo. Preview permanece bloqueado. Reuso/envio depende também de CC05 ativo e das permissões efetivas de conversa.

Migration nova: **0037_ticket_knowledge.sql**. Somente preparada/testada; não aplicada remotamente. 0036 já aplicada; não reaplicar. Ver [runbook](migration-runbook.md), [decisões](decisions.md), [evidências](evidence.md) e [aceite/pendências](acceptance.md).

## API

Base `/api/organizations/:id/ticket-knowledge`:

| Rota                 | Método | Contrato                                                                                                     |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| base                 | GET    | `q`, `after`, `suggestions=true`; 20 itens por página, sem total irrestrito                                  |
| base                 | POST   | `action:create`, `title`, `body`, `reviewerId`, `source?`, `idempotencyKey`                                  |
| `/:articleId`        | GET    | Detalhe autorizado; `before` pagina revisões (20), `eventsBefore` decisões (100)                             |
| `/:articleId`        | POST   | `revise`, `submit`, `approve`, `reject`, `publish`, `withdraw`, `reviewer`; versão opaca e chave idempotente |
| `/:articleId/select` | POST   | `revisionId`, `ticketId`, `kind`, `idempotencyKey`; devolve seleção/texto para revisão                       |
| `/:articleId/send`   | POST   | `selectionId`, `body`, `reviewed:true`; reautoriza e envia uma única vez                                     |

Comandos editoriais exigem `ticket.manage` além de `ticket.view`. Criador/revisor delimitam o domínio privado; somente autor cria revisões/submete, somente revisor independente aprova/devolve. Revisor precisa ser membro ativo com ambas capacidades. Seleção/envio usa acesso ao artigo e ticket + permissões CC05; nota interna exige suas capacidades próprias. Não foram ampliados papéis nem criados usuários.
