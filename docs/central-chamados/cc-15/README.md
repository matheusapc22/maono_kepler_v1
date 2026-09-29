# CC15 — Resultado, esforço e feedback

REQ-CC-34 / CT47–48. Base produto: `354d09f828b69de461935b3ea24000a7ceb57a28` (CC14 mergeada; 0037 aplicada, run36608863173). Branch `feat/cc-15-central`.

Implementação: instrumento imutável por organização, convite por solicitante/ciclo canônico encerrado, resposta voluntária com consentimento, recusa, retirada e recibos duráveis. A pesquisa não participa da transação de fechamento. Um POST de reconciliação da gestão emite até 25 convites por página, retomável por cursor; ao concluir, uma nova varredura parte de zero e encontra encerramentos posteriores. Sem cron novo, campanha histórica ou envio externo.

A interface fica em **Resultado, esforço e feedback**, na Central. O botão de abrir chamado conduz à conversa e ao fluxo CC03 existente; uma avaliação negativa não reabre automaticamente. A entrega interna reutiliza a outbox e o consumidor CC07, com destinatário exato, ACL atual e fence transacional. Um convite existe mesmo com entrega pendente, suprimida ou falha.

A sexta família CC11 usa ciclos encerrados na janela UTC `[from,to)`, agrupados por instrumento. Respostas de convites imaturos ficam separadas da taxa madura; recusa, retirada e ausência não são positivas. As fontes entram no hash da projeção CC11; replay reconstrói rollups e checkpoints sem confiar em cache obsoleto. Comentários e identidade do respondente ficam fora de métricas, eventos públicos, notificações e exportações CC12. A definição é uma extensão `feedback:1` do dicionário CC11, preservando seus contratos anteriores.

## Configuração e dependências

- Migration aditiva `0038_ticket_feedback.sql`; nenhuma migration aplicada foi editada.
- `MAONO_TICKET_FEEDBACK_ENABLED=false` e `MAONO_TICKET_FEEDBACK_ORGANIZATION_IDS=` por padrão. Runtime apenas `local` ou `production`; Preview nega ativação.
- CC04 selective ACL ativo; CC03 ciclos canônicos; CC07 para entrega; CC11/SLA para painel de métricas; geração CC12 para fences.
- Instrumento explicitamente aprovado: perguntas, categorias, rótulos/direção ordinal, prazo em horas e consentimento. Não existem valores comerciais implícitos. Publicação exige `ticket.manage`, CAS de versão e chave idempotente.
- Leitura/resposta exige sessão, membro ativo, `ticket.view`, ticket acessível e destinatário exato. Gestão não lê comentários/respostas individuais por este módulo. Agregados exigem `ticket.manage` e ACL antes da contagem; não são anônimos e não aplicam supressão estatística automática de grupos pequenos.

## API

Base `/api/organizations/:id/ticket-feedback`:

| Rota | Método | Contrato |
| --- | --- | --- |
| base | GET | Convites do próprio usuário; `after` e páginas de 25; nenhum write |
| `/instrument` | GET / POST | Instrumento atual / publicar `{expectedVersion,requestKey,definition}` |
| `/reconcile` | POST | `{after:0}`; continuar com `nextCursor`; gestor com ACL |
| `/:inviteId` | POST | `{outcome,effort,comment,consent:true}` ou `{declined:true}` |
| `/:inviteId` | POST | `{action:"withdraw"}` após resposta; retirada imutável |

POST same-origin e JSON limitado a 16KB. Comentário em texto até 2.000 caracteres; nenhuma interpolação HTML. A resposta é única por convite: payload igual recupera recibo; divergente retorna conflito. Retirada não permite uma segunda resposta. Fechamentos com origem `observed_baseline`, anteriores à publicação ou sem destinatário elegível não geram convite.

Consulte [decisões](decisions.md), [aceite](acceptance.md), [migration](migration-runbook.md) e [evidências](evidence.md). A implementação local não encerra gates de produção nem pendências herdadas.
