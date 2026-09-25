# CC-02 — triagem e classificação

## Objetivo e baseline

Separar a natureza do trabalho da área afetada e coletar o contexto necessário ao atendimento, sem inferir classificações de chamados antigos. Base: merge da [PR #194](https://github.com/matheusapc22/maono_kepler_v1/pull/194), SHA `b0f62ba6d00b1627ad9fcec45125da9ea3544232`, na branch `mano_kepler_v1`. Branch de execução: `feat/cc-02-triage-classification`.

A CC-01 entregou contratos, baseline e um protótipo offline. Seu merge e build Pages foram confirmados, sem prova de aceite humano CT-02, schema remoto ou produção. A execução isolada desta CC-02 foi solicitada pelo usuário; os gates pendentes da entrega anterior continuam registrados no [controle](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit).

## Plano técnico e recorte

| Camada | Implementação | Critério |
|---|---|---|
| D1 | Expansão aditiva por `0025_ticket_triage_classification.sql`, sem renumerar migrations históricas | Categoria e natureza independentes; registros anteriores continuam sem natureza e com origem identificada |
| Domínio | Cinco naturezas, impacto, urgência, resultado esperado, contexto mínimo, respostas versionadas e motivo de prioridade | Payload inválido ou incompatível é rejeitado; nenhuma classificação deduzida do domínio |
| API | Campos aditivos nas rotas existentes; capacidade `triageEnabled` em lista/detalhe | Flag desligada conserva o fluxo antigo; flag ligada exige schema disponível antes de novas escritas |
| Interface | Formulário progressivo na abertura, leitura/edição no detalhe, identificação de triagem pendente | Dúvida tem formulário curto; defeito pede reprodução, resultado observado e versão |
| Histórico | Ator e valores anterior/novo da reclassificação, com motivo | Alterar domínio/prioridade não muda natureza, ciclo, aprovação CR ou política de SLA por inferência |
| Validação | CT-03/04/05 em banco SQLite descartável, contratos e ensaio de interface | Evidências locais separadas de sessão QA, D1 remoto, merge e deploy |

Os códigos de natureza adotados seguem a proposta da CC-01: `question_request`, `incident`, `defect`, `improvement_change`, `recurring_problem`. Os seis domínios e os cinco estados existentes são preservados. `low`, `normal`, `high` continuam prioridades humanas; não equivalem a alvos de SLA.

Os campos são aditivos. Writers antigos de CR e importação de legado continuam operando e geram chamados que precisam de triagem. Dados desconhecidos permanecem desconhecidos. Respostas de uma natureza anterior não são reaproveitadas silenciosamente ao reclassificar.

O [contrato da API](api-contract.md) fixa campos, perguntas, exemplos e erros. A edição compara o snapshot dos campos de triagem entre leitura/validação no servidor e batch para evitar inconsistência de natureza/respostas nessa janela. O cliente ainda não envia versão: um formulário que já estava desatualizado ao iniciar a requisição não é coberto por essa proteção. O contrato geral de concorrência permanece na CC-03.

## Ativação e migrations

**Migration necessária: `0025_ticket_triage_classification.sql`. Aplicação remota pendente de autorização e confirmação por ambiente.** A implementação fica sob `MAONO_TICKET_TRIAGE_ENABLED=false` por padrão. Não alterar a flag antes de conferir schema, binding, dados, limites e autorização do ambiente alvo.

Consulte [migration-runbook.md](migration-runbook.md). As migrations históricas 0021/0022/0023 continuam sob seus próprios gates, sem autorização de aplicação nesta entrega. A CC-02 não depende delas nem as reaplica. Preview pode compartilhar o D1 de produção; a etiqueta do ambiente não prova isolamento.

## Sequência de entrega

1. Revisar contratos, diff, testes e migration; manter feature desligada.
2. Confirmar schema e identidade do banco alvo por leitura autorizada e estabelecer recuperação.
3. Obter autorização específica para a 0025 e aplicá-la isoladamente pelo processo operacional.
4. Conferir resultado, contagens, ausência de classificação inferida e compatibilidade dos writers antigos.
5. Ativar somente no escopo/ambiente autorizado e executar aceite autenticado com os perfis reais.
6. Registrar PR, SHA, CI, migration, aceite e artefato de release no controle. Aprovação local não preenche aprovação remota.

## Escopos preservados para próximas PRs

CC-03 continua responsável pelo contrato geral de comandos, idempotência, CAS/ETag, ciclos, transições e atomicidade de auditoria/outbox. CC-04 entrega ACL de objeto e audiência. CC-08 reconcilia CR e registro geral, sem aprovação por vínculo ou fechamento automático por Apply. CC-10 entrega relógios, calendários e políticas versionadas de SLA. A CC-02 não antecipa esses mecanismos nem declara suas garantias atendidas.

Veja [roadmap-alignment.md](roadmap-alignment.md) para os ajustes de escopo decorrentes da CC-01 e [acceptance.md](acceptance.md) para os comandos e resultados efetivamente verificados.
