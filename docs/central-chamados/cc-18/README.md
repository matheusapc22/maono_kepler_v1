# CC18 — operação e entrega verificável

REQ-CC-39/40 · CT59/60 · versão documental1 · 29/09/2026.

Públicos: usuários, atendimento, administradores, engenharia e operação. Esta versão descreve o produto sobre `f17882fe846b05d97e5b81c7d2547e30574715b4`. O SHA final da PR/merge é a versão de entrega; cada ensaio deve apontar para esse SHA. Funcionalidade documentada pode continuar desabilitada no ambiente. Consultar capacidades reais, nunca inferir ativação pelo manual.

## Entradas por público

- [Usuário](manual-usuario.md): abrir, acompanhar, conversar, anexar, recuperar falhas e responder pesquisa.
- [Atendimento](manual-atendimento.md): triagem, filas, ciclo, SLA, incidentes, conhecimento e exportação.
- [Administração](manual-admin.md): capacidades, organizações, configuração e limites operacionais.
- [API interna](api-interna.md) e [OpenAPI3.0.3](openapi.json): inventário das rotas existentes, parâmetros e contratos de integração.
- [Operação e CT59](runbook-operacao.md): diagnóstico, reprocessamento e ensaio por terceiro.
- [Migration/backfill](runbook-migration-backfill.md), [rollback](runbook-rollback.md) e [rollout](rollout.md).
- [Rastreabilidade](matriz-evidencias.md), [pendências](pendencias.md), [execução](execution.md).

## Gate local de encerramento

```sh
npm run test:cc18
npm run validate:cc18
# Copiar delivery-template.json para um arquivo de trabalho e preencher com provas reais.
npm run gate:cc18 -- evidencia-real.json SHA_DE_40_CARACTERES .tmp/cc18/entrega-nova.json
```

O gate não acessa produção. Código0 significa **pronto para revisão final**, nunca autorização de release;1 significa pendências e2 entrada/arquivo inválido. Cada execução usa uma saída nova. O template começa pendente. Não preencher aprovação com resultado de fixture, link genérico ou status de merge.

**Sem migration CC18:** não modifica SQL, handlers, flags ou schema. Inventário/ledger do alvo continuam exigidos para encerramento. Os gates históricos de0021/0022/0023 e os aceites herdados permanecem separados. Nenhum ensaio ou rollout é disparado por este pacote.

Planejamento e controle: [pasta](https://drive.google.com/drive/folders/1ao5FrMDtch8h9T93EYlrPTCkw2wkwHfe) · [planilha](https://docs.google.com/spreadsheets/d/1HKWyMYA9npo4lDCcBUlPajlP_ig6nZiEDy-zx51vIGc/edit).
