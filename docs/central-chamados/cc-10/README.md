# CC-10 — SLA, calendário e políticas versionadas

Implementação sobre `mano_kepler_v1` em `9dbe5e1d14e382f198a358a5381ad9aad78d64db`. REQ-CC-24/25, CT33–36. Status: implementação e validação local; aceite integrado e produção pendentes.

## Comportamento entregue

- Políticas imutáveis por organização, publicação aprovada e auditada, versão sequencial/CAS e repetição idempotente. Nenhuma meta é inferida da prioridade, data prevista ou idade da fila.
- Calendário IANA de até 366 dias, sete dias de expediente, até oito intervalos por dia, exceções/feriados locais. Intervalos noturnos são divididos entre dias. Lacunas e repetições DST usam os instantes UTC reais. Intervalos UTC compilados ficam na versão publicada, sem reinterpretação por futuras versões de tzdb. A interface cadastra um expediente diário e feriados; a API também aceita expedientes múltiplos e exceções com expediente.
- Atribuição explícita por ciclo, iniciada no instante da gravação; histórico anterior é exibido sem cobertura. Publicar uma política ou alterar prioridade não troca a atribuição. Troca explícita soma as frações consumidas em cada segmento (`tempo útil / meta do segmento`), sem zerar o consumo. Essa regra também precisa da concordância operacional antes do rollout.
- Primeira resposta global única, acumulada entre ciclos: somente resposta pública de atendente humano do elenco aprovado, diferente do solicitante, com mensagem + comando + evento coerentes. Nota interna, atribuição e eventos automáticos não contam. Mensagem anterior à primeira atribuição usa o elenco dessa primeira política para reconhecer a resposta, mas não inventa duração para o prefixo descoberto. Sem política no ciclo, não há elenco para classificar mensagens daquele ciclo.
- Resolução por ciclo observado; reabertura exige nova atribuição. Pausas dependem da correspondência exata do motivo aprovado, intersectam o expediente e são unidas antes da subtração. Intervalos invertidos são rejeitados. O serviço não cria pausas, não reabre nem fecha chamados.
- GET realiza replay em lote de fontes canônicas, sem gravar projeções. Correções históricas explícitas retornam desconhecido para revisão; não há reconstrução a partir de `updated_at`. Calendário vencido retorna desconhecido. Limite de 2.000 registros por fonte; excesso retorna indisponibilidade explícita, sem truncar silenciosamente.
- ACL atual de chamado, isolamento por organização, revalidação antes de retornar dados e `private, no-store`. Publicação/atribuição exigem `ticket.manage`; escolha de atendentes na interface usa a permissão existente `users.view`. Resposta pública da API não contém corpo de mensagens, notas ou motivos privados de espera.
- UI com versão, fuso, metas, consumo, pausas e cobertura. Tentativa ambígua conserva o mesmo identificador e corpo até a confirmação. Troca de organização descarta o componente e respostas antigas. O SLA é um retrato com horário de cálculo e atualização explícita, separado do prazo visual.

## Rotas

- `GET/POST /api/organizations/:id/tickets/sla-policies`: últimas 100 políticas; `hasMore` indica história adicional. POST: `requestId`, `expectedVersion`, `reason`, `approved:true`, `policy`.
- `GET/POST /api/organizations/:id/tickets/:ticketId/sla`: projeção ou atribuição. POST: `requestId`, `expectedVersion` da sequência de atribuições, `policyVersion`, `cycle`, `reason`.
- Política: `name`, metas `responseMinutes`/`resolutionMinutes` (nulo = sem meta), `responders` (IDs ativos aprovados), `pauseReasons`, `calendar:{timeZone,from,through,weekly,exceptions}`. Não há política padrão nem atribuição automática.

## Ativação e recuperação

`MAONO_TICKET_SLA_ENABLED=true` **e** `MAONO_TICKET_SLA_ORGANIZATION_IDS=<IDs explícitos separados por vírgula>`; sem wildcard. Padrão OFF. Exige readiness CC03, selective access CC04 e conversations CC05. Nenhuma flag remota foi alterada nesta entrega.

Canário somente após schema, parâmetros, fontes e acceptance aprovados. Monitorar erros `TICKET_SLA_*`, cobertura vencendo e latência p95 sob histórico representativo. Orçamento p95 e janela do canário ainda precisam de definição operacional. Interromper o canário diante de vazamento ACL, cálculo divergente ou indisponibilidade; desativar a flag/retirar a organização da allowlist preserva o histórico. Não executar DOWN para apagar políticas imutáveis. Recuperação do banco exige decisão própria e bookmark auditado.

## Pendências preservadas

CC09: CT30–32 autenticados, sessão/upload e troca de organização remota, p95 D1, cleanup/restauração e rollout. A migration0032 já foi aplicada e pós-validada no run28; não reaplicar. CC08: CT26–29/52 e operação do Worker/reconciliação continuam pendentes. A CC10 não aprova nem substitui esses gates.

CC10: revisão/merge, migration0033 via operador protegido, aprovação de metas/calendário/pausas/elenco/escopo, publicação do operador de acceptance (PR201), integração da suíte CC10 ao contrato definitivo do operador, acceptance autenticado e rollout. Não publicar metas sintéticas em produção.

## Evidências

Ver `evidence.md`, `acceptance.md` e `migration-runbook.md`. Os três itens novos do ratchet `diagnostic-id` são referências internas ao `requestId` no estado e serialização HTTP de `TicketSlaPanel`; nenhum identificador diagnóstico é renderizado ao usuário. Baseline atualizado apenas para essas três ocorrências revisadas.
