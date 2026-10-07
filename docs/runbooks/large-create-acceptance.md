# Large CREATE — acceptance pelo protocolo durável

## Substituição do runner antigo

O runner `scripts/large-create/preview-acceptance.mjs` e o workflow
`large-create-preview-acceptance.yml` estão aposentados e falham antes de acessar
qualquer endpoint. Um hostname Preview pode compartilhar D1/Dropbox de Produção;
health/runtime, sessão QA e um cookie não comprovam isolamento nem autorizam
mutações. O workflow antigo não recebe mais secrets ou uma ref executável.

A criação pequena e grande usa agora a mesma sequência:

1. `POST /api/projects` com `durableSave:true` reserva a identidade;
2. `POST /api/projects/{slug}/save-operations` registra o manifesto imutável;
3. `PUT /api/projects/{slug}/save-operations/{operationId}/payload` envia os bytes
   exatos, com `X-Maono-Project-Id` estável;
4. o recebimento durável permite consultar o status por GET até o recibo;
5. o recibo histórico continua válido depois de uma revisão posterior.

`PUT /projects/{slug}/config` e o antigo POST de criação inline não são caminhos
alternativos. Contratos antigos recebem 412, com preservação do rascunho.

## Caminho atual de acceptance

Use somente a suite registrada `durable-project-save` no
[Production Acceptance Operator](production-acceptance-operator.md), após os
portões humanos separados de migration, auditoria de bindings, deployment do
Worker e janela de acceptance. Preparar esta documentação ou passar na CI não
executa nem autoriza esses passos.

O contrato completo, a cobertura e o cleanup estão em
[Durable project saving](../ops/durable-project-saving.md#registered-synthetic-acceptance-code-prepared-execution-separately-gated).
Em resumo:

- organização fixa 9 / `maono-preview-qa`; somente editor QA com `project.create`
  no runner, inventário administrativo por humano distinto em sessão existente;
- até dois projetos sintéticos por UUID, incluindo fixture exata de 94 MiB;
- admission temporariamente true; inline temporariamente false para observar o
  Worker independente publicar após `202 / PAYLOAD_STORED`;
- duplicação, resposta perdida modelada, recibo histórico, CAS obsoleto e cliente
  antigo cobertos sem dados reais;
- journal de run UUID/IDs e barreira de fechamento registrados antes da reserva;
  remoção manual dos projetos e desativação dos arquivos apenas após aprovação
  dos IDs exatos, seguidas de exports administrativos read-only e validação offline;
- objetos imutáveis, recibos e tombstones retidos; nenhum delete no Dropbox;
- restauração das flags para admission false / inline true;
- quota reservation habilitada ou não verificável bloqueia a janela, pois a API
  atual não comprova cleanup de reservas de quota incompletas. A suite não muda
  essa flag.

O secret QA existente recebe exatamente `creator` e `manualInventory` (export
`before` recente, vinculado ao SHA/suite/run/org9 e ao `workflowRunId` string com
`workflowRunAttempt:1`), nunca credenciais de
`administrator`. Mesmo com testes funcionais PASS e flags restauradas, o run
termina `MANUAL_CLEANUP_REQUIRED`, incompleto/exit 1. Não repetir a janela para
ficar verde; preservar relatório e gerar o certificado separado após a limpeza
humana comprovada. O helper só admite todos os casos funcionais PASS,
`operationalTestsPassed=true`, `PENDING_MANUAL_CLEANUP` e nenhuma falha de
budget/restauração. Run falho, cancelado ou interrompido preserva IDs/journals para
reconciliação humana read-only e não recebe certificado de cleanup deste helper.
ACK recebido, flags restauradas ou inventário vazio não comprovam término do
Worker. Não excluir recursos antes da prova de terminalidade remota e aprovação
separada dos IDs exatos. Ver [o procedimento de inventário e limpeza](production-acceptance-operator.md#inventário-e-cleanup-humanos-para-jsonpng).

Sequência: autorizar a janela, fazer dispatch, aguardar validação concluída e
aprovação do Environment pendente; só então capturar `before` com o ID da URL do
run e salvar o bundle no secret do Environment `production-acceptance` antes de
aprovar. Não usar fallback de secret do repositório. O job protegido não compila o
app e tem setup limitado a 11 minutos; a validade de 15 minutos é conferida
novamente imediatamente antes da primeira flag, após aguardar fila quiescente.
Vínculo ausente/expirado ou tentativa falha requer novo dispatch/export/UUID após
verificar o estado e ausência de mutações/recursos pendentes ou concluir a
reconciliação separada, mesmo se o preflight interno falhou. Não rerodar nem reutilizar
bundle/UUID ou alterar o secret de job já aprovado/em execução. A vinculação à
primeira tentativa mais a regra humana não são um registro server-side de uso único.

A fixture é gerada em runtime e nunca é commitada no Git. Os testes locais de
SQLite/HTTP/browser são evidência separada da execução real protegida.

## Rollback atual

Pausar novas admissões com `PROJECT_DURABLE_SAVE_V1=false`, mantendo leitores,
status/recibos e o Worker compatível drenando operações aceitas. Não restaurar o
writer legado nem remover tabelas ou objetos. A antiga flag de large-create não
controla o protocolo novo.

## Evidência histórica do fluxo anterior — 2026-09-12

P0 **Criar e persistir novos projetos grandes** encerrado dentro do escopo validado.

Evidências de fechamento:

- acceptance remoto com fixture de aproximadamente 94 MiB concluiu CREATE até `ACTIVE`, revision 1 e replay idempotente;
- leitura da revisão publicada passou a ser validada pelo mesmo delivery `direct` usado pelo frontend;
- correção de ownership do criador permite reabrir e persistir projetos já criados sem backfill de D1;
- smoke real em Production foi concluído e o projeto grande foi reaberto, editado e salvo novamente com persistência confirmada.

Registro histórico das decisões de setembro (não são instruções ou autorizações para o protocolo durável atual):

- manter `PROJECT_CREATE_LARGE_STREAM_V1=true` em Production como comportamento ativo;
- preservar `PROJECT_CREATE_LARGE_STREAM_V1=false` como kill switch operacional, sem rollback de banco;
- manter `MAONO_PREVIEW_MUTATIONS_ENABLED=false` fora de janelas QA explícitas;
- o projeto `qa-smoke-large-create-20260911154238` pode ser removido pela rotina administrativa segura, pois a evidência durável permanece no histórico de rollout/PRs e testes;
- novos incidentes de SAVE devem ser tratados como regressões ou novos bugs, sem reabrir automaticamente este P0.
