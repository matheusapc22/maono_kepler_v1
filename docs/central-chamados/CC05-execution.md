# CC-05 - conversas, notas internas e rascunhos

## Estado de execução

EM IMPLEMENTAÇÃO / PR DRAFT. Não equivale a funcionalidade entregue.
Base de produto: `mano_kepler_v1` em `49c9a9a09cd674fcc83cb6befa340e1d5a477cc1`.

Esta primeira publicação consolida o schema aditivo e contratos puros de audiência,
validação, precondições e rascunhos. Não integra ainda rotas, catálogo de permissões,
leitores legados ou compositor. Não disponibiliza uma API de mensagens nem uma UI.
Nenhuma flag foi criada/alterada. Nenhum dado remoto foi escrito.

MIGRATION PENDENTE DE CONFIRMAÇÃO: `0028_ticket_conversations.sql`.
Alvo futuro: D1 `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`.
Não aplicar por build, Preview, merge ou autorização da migration 0027.
Auditoria e autorização específica seguirão o `AGENTS.md`, através do operador
protegido na default `main`. A migration não está no SHA de produto atual;
portanto não existe aprovação de audit de Produção para este conteúdo.

## Implementado nesta fundação

- Mensagens e revisões com integridade composta de organização/chamado/autor.
- Revisão inicial e revisões de edição geradas por triggers na mesma transação.
  O futuro serviço NÃO deve inserir uma revisão inicial duplicada no batch.
- Audiência, autoria e data original imutáveis; edição exige novo comando, motivo
  e incremento exato de versão. Revisões append-only.
- Rascunho ativo único por organização/chamado/usuário/audiência e atualização CAS.
- Anexo privado desde o início do rascunho; promoção apenas após upload ACTIVE,
  no mesmo escopo e para audiência coerente; não reclassificar arquivo legado.
- Classificação de eventos e relações de mensagem sem alterar conteúdo legado.
- Contratos puros de leitura, escrita, edição, drafts, anexos, eventos e ETag.

As funções de política recebem capacidades resolvidas no servidor. Não são um
substituto da autenticação, do resolvedor canônico ou da ACL CC-04. Não aceitam
papel, autoria ou atribuição como atalho para `ticket.note.view/create`. A flag de
conversas não participa da autorização de dados persistidos.

## Evidências e limites

Teste local inicial: Node 22.16.0, SQLite 3.49.1, 57 testes aprovados, zero falhas,
1 teste de schema completo não executado por ausência do checkout completo.
A fixture local declara explicitamente o subconjunto de colunas parentais que usa;
não representa audit D1 ou teste de todas as migrations anteriores.

O CI executa também a expansão sobre `schema.sql` real. Seu resultado deve ser
consultado antes de classificar esse gate. O workflow conserva snapshot Git sem
`.git`, credenciais ou dados de Produção para validação reproduzível. O download
público do checkout falhou no ambiente local; o snapshot do CI é uma alternativa
para completar a inspeção e a execução técnica. Não é acceptance autenticado.

## Próxima integração e gates (não concluídos)

1. Completar inventário de leitores: detalhe, anexos, downloads, listagens,
   contadores, eventos, arquivos alternativos, erros, logs e outbox. Proteger antes
   de criar conteúdo interno. Código OFF precisa preservar confidencialidade.
2. Integrar catálogo `ticket.note.view` e `ticket.note.create`, sem concessão ampla
   por inferência, e resolvedor por request/retry. Acesso fechado após revogação.
3. Implementar rotas de mensagens/revisões e draft CAS; receipt, mensagem,
   anexos, evento, audit e intenção de notificação no mesmo batch validado.
   Resultado idempotente precisa reautorizar; zero-row CAS é conflito.
4. Integrar compositor, notas explícitas e autosave, preservando texto mais recente
   e sem armazenamento local de notas. Testar perda de resposta e duas abas.
5. Atualizar instalação nova e testar upgrade, HTTP, navegador, typecheck/build,
   regressões e CI. Não transformar testes escritos em testes executados.
6. Publicar OFF somente após revisão completa. Preparar audit protegido, parar para
   autorização da 0028, pós-validar, acceptance próprio e decisão de ativação.

CC-03/CC-04: acceptance continua adiado, não aprovado. A ativação CC-04 foi
confirmada pelo operador, não reconferida por esta execução. Não habilitar
`MAONO_TICKET_TRIAGE_ENABLED` ou `MAONO_TICKET_COMMANDS_ENABLED` por consequência.

CC-05 permanece a próxima etapa correta. Não avançar mecanicamente para CC-06
com o compositor, os leitores ou a validação desta entrega incompletos.
