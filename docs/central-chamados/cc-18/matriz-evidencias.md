# Matriz final de rastreabilidade

Snapshot do [controle mestre](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit) em29/09/2026. 40 requisitos e60 casos. Os documentos por etapa registram PR/SHA e validação local; evidência histórica não é aceite do SHA final. O arquivo traceability.json preserva cenário, resultado esperado e evidência da fonte.

## Requisitos

| Requisito | Etapa / prova de implementação | Tema | Casos | Aceite final |
|---|---|---|---|---|
| REQ-CC-01 | [CC-01](../cc-01/README.md) | Baseline verificável | CT-01 | Pendente de evidência final |
| REQ-CC-02 | [CC-01](../cc-01/README.md) | Jornada e critérios de prioridade | CT-02 | Pendente de evidência final |
| REQ-CC-03 | [CC-02](../cc-02/README.md) | Natureza independente do domínio | CT-03, CT-05 | Pendente de evidência final |
| REQ-CC-04 | [CC-02](../cc-02/README.md) | Triagem contextual e resultado esperado | CT-03, CT-04 | Pendente de evidência final |
| REQ-CC-05 | [CC-03](../cc-03/README.md) | Estados e reabertura | CT-06, CT-29 | Pendente de evidência final |
| REQ-CC-06 | [CC-03](../cc-03/README.md) | Espera explícita | CT-06 | Pendente de evidência final |
| REQ-CC-07 | [CC-03](../cc-03/README.md) | Criação idempotente | CT-07, CT-08 | Pendente de evidência final |
| REQ-CC-08 | [CC-03](../cc-03/README.md) | Edição concorrente | CT-09 | Pendente de evidência final |
| REQ-CC-09 | [CC-03](../cc-03/README.md) | Histórico atômico e preservado | CT-09, CT-10, CT-49, CT-57 | Pendente de evidência final |
| REQ-CC-10 | [CC-03](../cc-03/README.md) | Importação legada controlada | CT-05, CT-49 | Pendente de evidência final |
| REQ-CC-11 | [CC-04](../cc-04/README.md) | ACL seletiva e privado | CT-11, CT-12, CT-14, CT-25, CT-44, CT-50 | Pendente de evidência final |
| REQ-CC-12 | [CC-04](../cc-04/README.md) | Etiquetas sem privilégio implícito | CT-13 | Pendente de evidência final |
| REQ-CC-13 | [CC-05](../CC05-execution.md) | Conversa e nota interna | CT-14, CT-15, CT-17 | Pendente de evidência final |
| REQ-CC-14 | [CC-05](../CC05-execution.md) | Rascunho e falha parcial | CT-16, CT-17, CT-23 | Pendente de evidência final |
| REQ-CC-15 | [CC-06](../CC06-execution.md) | Capacidade de anexos atômica | CT-18, CT-19 | Pendente de evidência final |
| REQ-CC-16 | [CC-06](../CC06-execution.md) | Retomada e ciclo do binário | CT-19, CT-20, CT-21, CT-22, CT-23, CT-51, CT-57 | Pendente de evidência final |
| REQ-CC-17 | [CC-07](../cc07/ENTREGA_E_MANUAL.md) | Notificação durável e autorizada | CT-24, CT-25, CT-57 | Pendente de evidência final |
| REQ-CC-18 | [CC-08](../cc08/EVIDENCIAS.md) | CR como entidade distinta | CT-26, CT-27, CT-52 | Pendente de evidência final |
| REQ-CC-19 | [CC-08](../cc08/EVIDENCIAS.md) | Vínculo e navegação sem autorização | CT-26, CT-27 | Pendente de evidência final |
| REQ-CC-20 | [CC-08](../cc08/EVIDENCIAS.md) | Reconciliação Ticket–CR | CT-28, CT-29, CT-52 | Pendente de evidência final |
| REQ-CC-21 | [CC-09](../cc-09/README.md) | Filas e paginação coerentes | CT-30, CT-31 | Pendente de evidência final |
| REQ-CC-22 | [CC-09](../cc-09/README.md) | Deep-link e contexto estável | CT-32 | Pendente de evidência final |
| REQ-CC-23 | [CC-09](../cc-09/README.md) | Controle de WIP e próxima ação | CT-31 | Pendente de evidência final |
| REQ-CC-24 | [CC-10](../cc-10/README.md) | SLA versionado e calendário | CT-33, CT-35, CT-36 | Pendente de evidência final |
| REQ-CC-25 | [CC-10](../cc-10/README.md) | Resposta, pausas e reabertura | CT-33, CT-34, CT-35 | Pendente de evidência final |
| REQ-CC-26 | [CC-11](../cc-11/evidence.md) | Métricas com coortes e denominadores | CT-37, CT-38, CT-40, CT-48 | Pendente de evidência final |
| REQ-CC-27 | [CC-11](../cc-11/evidence.md) | Agregados auditáveis e eficientes | CT-39, CT-40 | Pendente de evidência final |
| REQ-CC-28 | [CC-12](../cc-12/evidence.md) | Relatórios e exportação completa | CT-41 | Pendente de evidência final |
| REQ-CC-29 | [CC-12](../cc-12/evidence.md) | Exportação e download privados | CT-42 | Pendente de evidência final |
| REQ-CC-30 | [CC-13](../cc-13/evidence.md) | Incidente coordenado | CT-43 | Pendente de evidência final |
| REQ-CC-31 | [CC-13](../cc-13/evidence.md) | Problema recorrente e causa | CT-44 | Pendente de evidência final |
| REQ-CC-32 | [CC-14](../cc-14/evidence.md) | Conhecimento revisado | CT-45, CT-46 | Pendente de evidência final |
| REQ-CC-33 | [CC-14](../cc-14/evidence.md) | Resposta reutilizável | CT-46 | Pendente de evidência final |
| REQ-CC-34 | [CC-15](../cc-15/evidence.md) | Resultado, esforço e não resposta | CT-47, CT-48 | Pendente de evidência final |
| REQ-CC-35 | [CC-16](../cc-16/execution.md) | UX acessível e mensagens claras | CT-53, CT-54 | Pendente de evidência final |
| REQ-CC-36 | [CC-16](../cc-16/execution.md) | Validação com usuários | CT-02, CT-54 | Pendente de evidência final |
| REQ-CC-37 | [CC-17](../cc-17/execution.md) | Isolamento e confidencialidade | CT-11, CT-50, CT-51, CT-55 | Pendente de evidência final |
| REQ-CC-38 | [CC-17](../cc-17/execution.md) | Resiliência e desempenho medido | CT-56, CT-57, CT-58 | Pendente de evidência final |
| REQ-CC-39 | [CC-18](execution.md) | Documentação e API interna | CT-59 | Pendente de evidência final |
| REQ-CC-40 | [CC-18](execution.md) | Entrega verificável e migrations | CT-52, CT-58, CT-59, CT-60 | Pendente de evidência final |

## PRs e SHAs de implementação

| Etapa | PR | SHA de integração |
|---|---|---|
| CC-01 | [#194](https://github.com/matheusapc22/maono_kepler_v1/pull/194) | b0f62ba6d00b1627ad9fcec45125da9ea3544232 |
| CC-02 | [#195](https://github.com/matheusapc22/maono_kepler_v1/pull/195) | ddaabcb1ea6038b62da9d90a7d1acd20634bd236 |
| CC-03 | [#196](https://github.com/matheusapc22/maono_kepler_v1/pull/196) | be438e02aa5ecd2a6cb200bd0ca40aed8dafbef8 |
| CC-04 | [#200](https://github.com/matheusapc22/maono_kepler_v1/pull/200) | 49c9a9a09cd674fcc83cb6befa340e1d5a477cc1 |
| CC-05 | [#202](https://github.com/matheusapc22/maono_kepler_v1/pull/202) | 72ed1274274ef456bbc152574c9d2e55b13cf15b |
| CC-06 | [#203](https://github.com/matheusapc22/maono_kepler_v1/pull/203) | 9d2f7e26908123f55f8ea379904866b7d1a1904e |
| CC-07 | [#204](https://github.com/matheusapc22/maono_kepler_v1/pull/204) | ace9e647d7e1042327c234a891b2d182c33149cc |
| CC-08 | [#205](https://github.com/matheusapc22/maono_kepler_v1/pull/205) | 43b5d72a9117dc0dc043b066e6e4d03bd3b5577a |
| CC-09 | [#209](https://github.com/matheusapc22/maono_kepler_v1/pull/209) | 9dbe5e1d14e382f198a358a5381ad9aad78d64db |
| CC-10 | [#210](https://github.com/matheusapc22/maono_kepler_v1/pull/210) | d7a9af6625f8c73f95c2736d31088469a193405b |
| CC-11 | [#211](https://github.com/matheusapc22/maono_kepler_v1/pull/211) | 0cb04ade080c097b1d5940baac501767619c51ba |
| CC-12 | [#212](https://github.com/matheusapc22/maono_kepler_v1/pull/212) | 2eef55614d82b2c205a784c694c663563d3e524a |
| CC-13 | [#213](https://github.com/matheusapc22/maono_kepler_v1/pull/213) | d37cd1e9aa95a5f5ea55fdc400a13e96c0bde461 |
| CC-14 | [#214](https://github.com/matheusapc22/maono_kepler_v1/pull/214) | 354d09f828b69de461935b3ea24000a7ceb57a28 |
| CC-15 | [#215](https://github.com/matheusapc22/maono_kepler_v1/pull/215) | 1f37c8c03c12c003a8b0776dab5d07cf4c5e5552 |
| CC-16 | [#216](https://github.com/matheusapc22/maono_kepler_v1/pull/216) | a9fb981d4122ed2d2ddb9eab906770fdf10e3047 |
| CC-17 | [#217](https://github.com/matheusapc22/maono_kepler_v1/pull/217) | f17882fe846b05d97e5b81c7d2547e30574715b4 |

CC08 inclui correções complementares #206/#207/#208 no histórico da baseline. CC18 aponta para a PR/commit desta entrega quando publicada; não há merge CC18 comprovado neste snapshot.

## Casos

| Caso | Etapa | Critério de resultado | Status no registro de origem | Aceite do SHA final |
|---|---|---|---|---|
| CT-01 | CC-01 | Fonte e lacunas registradas; não declarar produção validada. | Aprovado (ver escopo na fonte) | Pendente |
| CT-02 | CC-01 | Ambos identificam próximo passo, responsável e resultado esperado; dúvidas viram ajustes. | Pendente (ver escopo na fonte) | Pendente |
| CT-03 | CC-02 | Classificações independentes e formulário mínimo compatível com cada natureza. | Aprovado (ver escopo na fonte) | Pendente |
| CT-04 | CC-02 | Motivo/ator/antes/depois preservados; natureza e SLA não mudam silenciosamente. | Aprovado (ver escopo na fonte) | Pendente |
| CT-05 | CC-02 | Natureza não inferida; marcado para triagem, provenance e contagem reconciliáveis. | Aprovado (ver escopo na fonte) | Pendente |
| CT-06 | CC-03 | Erros acionáveis nos dois primeiros; reabertura autorizada cria novo ciclo sem apagar fechamento anterior. | Aprovado (ver escopo na fonte) | Pendente |
| CT-07 | CC-03 | Um ticket/um evento de criação; repetição retorna o mesmo ID e resultado. | Aprovado (ver escopo na fonte) | Pendente |
| CT-08 | CC-03 | Divergência no mesmo escopo rejeitada; chaves de escopos distintos não revelam resultados alheios. | Aprovado (ver escopo na fonte) | Pendente |
| CT-09 | CC-03 | Um sucesso; conflito 412 no outro; nenhum evento/outbox/auditoria de alteração inexistente. | Aprovado (ver escopo na fonte) | Pendente |
| CT-10 | CC-03 | Rollback local completo; nenhum ticket/evento inconsistente; referência segura na falha. | Aprovado (ver escopo na fonte) | Pendente |
| CT-11 | CC-04 | Sem corpo, título, existência, contagem ou anexo do item negado. | Pendente (ver escopo na fonte) | Pendente |
| CT-12 | CC-04 | Próxima requisição negada e conteúdo local do drawer removido. Reautorização de notificações fica no escopo da CC-07/CT-25, quando existir consumidor durável. | Pendente (ver escopo na fonte) | Pendente |
| CT-13 | CC-04 | Nenhuma permissão muda; edição de política negada sem capability específica. | Pendente (ver escopo na fonte) | Pendente |
| CT-14 | CC-05 | Negado apesar da leitura do chamado; audiência da mensagem prevalece. | Pendente (ver escopo na fonte) | Pendente |
| CT-15 | CC-05 | Só resposta e anexos autorizados aparecem. Nota/evento automático não é resposta elegível. Intenção outbox não comprova entrega de alerta nem funcionamento de SLA; CT-15 integrado permanece pendente até evidências das entregas dependentes. | Pendente (ver escopo na fonte) | Pendente |
| CT-16 | CC-05 | Rascunho recuperado só no escopo autorizado; revogação impede leitura/envio. | Pendente (ver escopo na fonte) | Pendente |
| CT-17 | CC-05 | Uma mensagem visível, rascunho marcado enviado após confirmação; sem duplicação. | Pendente (ver escopo na fonte) | Pendente |
| CT-18 | CC-06 | Reserva atômica aceita só capacidade disponível; contadores nunca negativos. | Pendente (ver escopo na fonte) | Pendente |
| CT-19 | CC-06 | Limites respeitados; validação não confia em MIME; JSON/GeoJSON continuam recusados no contrato atual. | Pendente (ver escopo na fonte) | Pendente |
| CT-20 | CC-06 | Offset confirmado determina continuação; chunk antigo não é anexado novamente. | Pendente (ver escopo na fonte) | Pendente |
| CT-21 | CC-06 | Metadados/hash de verificação recusam arquivo divergente; sessão só retoma com arquivo correspondente. | Pendente (ver escopo na fonte) | Pendente |
| CT-22 | CC-06 | Reserva liberada uma vez; intenção de limpeza durável; reconciliador conclui sem ressurreição. | Pendente (ver escopo na fonte) | Pendente |
| CT-23 | CC-06 | Número do chamado preservado; sucesso parcial explícito; nenhuma duplicação do ticket/anexo ativo. | Pendente (ver escopo na fonte) | Pendente |
| CT-24 | CC-07 | Entrega posterior e uma notificação visível por destinatário/evento; lease seguro; lag e tentativas observáveis. | Pendente (ver escopo na fonte) | Pendente |
| CT-25 | CC-07 | Sem conteúdo/contador indevido; destinatário revogado suprimido; fila de falhas auditável e reprocessamento sem duplicação. | Pendente (ver escopo na fonte) | Pendente |
| CT-26 | CC-08 | Vínculo não eleva acesso; revisão/aplicação negadas pelos gates próprios. Primeiro usuário usa contexto explícito do projeto sem mutar sessão; segundo é negado em Review/Apply. | Pendente (ver escopo na fonte) | Pendente |
| CT-27 | CC-08 | Versões e decisões mantidas; resultado de planejamento não equivale a aprovação de aplicar. Registro genérico preserva aprovação/entrega e vínculo à PR/runbook; nenhuma execução automática de SQL, código ou concessão de acesso. | Pendente (ver escopo na fonte) | Pendente |
| CT-28 | CC-08 | Projeção não regride nem duplica; divergência registrada para reconciliação. | Pendente (ver escopo na fonte) | Pendente |
| CT-29 | CC-08 | CR aplicado não fecha ticket; encerramento exige motivo e aviso explícito do trabalho pendente. | Pendente (ver escopo na fonte) | Pendente |
| CT-30 | CC-09 | Paginação determinística; todos navegáveis; snapshot/cursor evita duplicações e omissões. | Pendente (ver escopo na fonte) | Pendente |
| CT-31 | CC-09 | Totais reconciliáveis, parcial identificado; limite aplica política e exceção tem motivo. | Pendente (ver escopo na fonte) | Pendente |
| CT-32 | CC-09 | Link não vaza; resposta antiga descartada; transferência mantém escopo ou é cancelada claramente. | Pendente (ver escopo na fonte) | Pendente |
| CT-33 | CC-10 | Tempo útil calculado pelos intervalos UTC do calendário versionado; fuso e eventos explicáveis. | Pendente (ver escopo na fonte) | Pendente |
| CT-34 | CC-10 | Só último evento encerra relógio de primeira resposta; aberturas sem resposta continuam pendentes. | Pendente (ver escopo na fonte) | Pendente |
| CT-35 | CC-10 | Intervalos válidos sem dupla subtração; ciclo novo; primeira resposta global permanece única. | Pendente (ver escopo na fonte) | Pendente |
| CT-36 | CC-10 | Histórico mantém política anterior; eventual migração é evento explícito com regra de segmentação. | Pendente (ver escopo na fonte) | Pendente |
| CT-37 | CC-11 | Percentis só de eventos observados com n explícito; censurados e taxa de cobertura exibidos. | Pendente (ver escopo na fonte) | Pendente |
| CT-38 | CC-11 | Numerador/denominador reproduzíveis; ciclos imaturos separados; sem taxa com denominador zero. | Pendente (ver escopo na fonte) | Pendente |
| CT-39 | CC-11 | Resultados iguais ao cálculo bruto; watermark e correções de partição rastreáveis. | Pendente (ver escopo na fonte) | Pendente |
| CT-40 | CC-11 | Tempo desconhecido não vira zero; itens abertos/espera aparecem em distribuição própria. | Pendente (ver escopo na fonte) | Pendente |
| CT-41 | CC-12 | Todas as linhas autorizadas, manifesto com período/fuso/filtros/versões/qualidade; totals reconciliam. | Pendente (ver escopo na fonte) | Pendente |
| CT-42 | CC-12 | Download negado após revogação; células perigosas neutralizadas no exportador. | Pendente (ver escopo na fonte) | Pendente |
| CT-43 | CC-13 | Restauração e atualização registradas; chamados seguem sua validação; causa desconhecida explícita. | Pendente (ver escopo na fonte) | Pendente |
| CT-44 | CC-13 | Cada agente só vê relações autorizadas; nenhuma contagem/título oculto inferível. | Pendente (ver escopo na fonte) | Pendente |
| CT-45 | CC-14 | Rascunho com audiência restrita; publicação bloqueada; dados sensíveis exigem remoção/revisão. | Pendente (ver escopo na fonte) | Pendente |
| CT-46 | CC-14 | Mensagem conserva referência à v2; revisão humana registrada; retirada impede novas sugestões. | Pendente (ver escopo na fonte) | Pendente |
| CT-47 | CC-15 | Fechamento permanece; unicidade por convite/ciclo; novo ciclo tratado separadamente. | Pendente (ver escopo na fonte) | Pendente |
| CT-48 | CC-15 | n respondentes, convidados elegíveis e taxa de resposta explícitos; não resposta não vira avaliação positiva. | Pendente (ver escopo na fonte) | Pendente |
| CT-49 | CC-03 | Sem duplicação; GET sem escrita de compatibilidade; histórico só admite correção por novo evento. | Aprovado (ver escopo na fonte) | Pendente |
| CT-50 | CC-04 | Negação/revogação prevalece; autenticação e vínculo ativo verificados em toda ação. | Pendente (ver escopo na fonte) | Pendente |
| CT-51 | CC-06 | Estado FINALIZING/RECONCILING preserva intenção; nada ACTIVE sem confirmação; quarentena não vira aprovação automática. | Pendente (ver escopo na fonte) | Pendente |
| CT-52 | CC-08 | CR básico conforme schema disponível; rollout/Apply protegido; nenhuma flag ou migration ativada automaticamente. Pipeline de payload grande mantém memória dentro do orçamento e retry aponta applied_revision original, sem reaplicar. | Pendente (ver escopo na fonte) | Pendente |
| CT-53 | CC-16 | Ordem/foco previsíveis; sucesso, erro e progresso anunciados sem inundar alertas. | Pendente (ver escopo na fonte) | Pendente |
| CT-54 | CC-16 | Resultado e próximo passo compreendidos; evidências de uso registradas; bloqueadores tratados. | Pendente (ver escopo na fonte) | Pendente |
| CT-55 | CC-17 | Cada capacidade segue regra efetiva; nenhum acesso implícito por link, role amplo ou ID. | Pendente (ver escopo na fonte) | Pendente |
| CT-56 | CC-17 | Orçamento aprovado em CC-01 registrado com volume, ambiente, p95/erros; invariantes e UX preservados. | Pendente (ver escopo na fonte) | Pendente |
| CT-57 | CC-17 | Sem perda de histórico/capacidade, duplicação ou vazamento; reconciliação e alertas executáveis. | Pendente (ver escopo na fonte) | Pendente |
| CT-58 | CC-17 | Cliente compatível lê dados; jobs drenados/pausados com segurança; rollback não destrói evidência. | Pendente (ver escopo na fonte) | Pendente |
| CT-59 | CC-18 | Consegue diagnosticar/reprocessar/restaurar em ensaio; evidências identificam banco e ambiente. | Pendente (ver escopo na fonte) | Pendente |
| CT-60 | CC-18 | Gate impede entrega; pendência humana e motivo visíveis; build nunca substitui confirmação de schema. | Pendente (ver escopo na fonte) | Pendente |

## Fechamento

Preencher delivery-template.json sem substituir evidência histórica por PASS implícito. Cada requisito vincula sua PR de implementação, os testes indicados acima e prova do SHA final. Separar ambiente e resultado observado. Registros C17-P01–08 e aceites herdados permanecem em [pendencias.md](pendencias.md). Nenhuma linha desta matriz aprova rollout.
