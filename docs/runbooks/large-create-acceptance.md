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

- organização fixa 9 / `maono-preview-qa`, contas QA distintas editor/super_admin;
- até dois projetos sintéticos por UUID, incluindo fixture exata de 94 MiB;
- admission temporariamente true; inline temporariamente false para observar o
  Worker independente publicar após `202 / PAYLOAD_STORED`;
- duplicação, resposta perdida modelada, recibo histórico, CAS obsoleto e cliente
  antigo cobertos sem dados reais;
- cleanup registrado antes da reserva, remoção dos projetos sintéticos e
  desativação dos arquivos gerados, com verificação por leitura;
- objetos imutáveis, recibos e tombstones retidos; nenhum delete no Dropbox;
- restauração das flags para admission false / inline true;
- quota reservation habilitada ou não verificável bloqueia a janela, pois a API
  atual não comprova cleanup de reservas de quota incompletas. A suite não muda
  essa flag.

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
