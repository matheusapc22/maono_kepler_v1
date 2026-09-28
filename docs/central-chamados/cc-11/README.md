# CC-11 — Métricas por eventos e agregações

Base: `d7a9af6625f8c73f95c2736d31088469a193405b`, branch `feat/cc-11-central`.
REQ-CC-26/27; CT-37–40. Dependências funcionais CC-07/09/10; seus aceites remotos não são encerrados por esta entrega.

## Entrega e contrato

Cinco famílias: primeira resposta, resolução, idade/espera, reabertura e fluxo. Resultado/esforço continua em CC-15. A seção Métricas do atendimento fica na Central, independente dos filtros da lista. O recorte usa datas UTC em `[início,fim)` e `asOf` explícito, sem inferir fuso do navegador.

- Resposta: coorte de abertura; mensagem pública substantiva, comando/evento humanos correspondentes, autor diferente do solicitante e atendente elegível no roster SLA versionado. Nota, atribuição e comunicação isolada não contam. Sem roster/cobertura suficiente, desconhecido. Sem resposta em histórico coberto, censurado. Revisão original confirma conteúdo; edição posterior não reescreve a primeira resposta.
- Resolução: ciclos encerrados no período, n observado, tickets distintos e outcomes; reabertura preserva o ciclo anterior. Coorte de abertura informa separadamente quantos permanecem abertos. Atendimento total inclui intervalos fechados e não representa esforço.
- Idade: snapshot dos abertos em asOf, idade original e do ciclo ativo. Legado sem ciclo permanece no backlog com idade desconhecida. Espera usa união dos intervalos intersectados com o período, até asOf, por motivo; não é automaticamente pausa SLA.
- Reabertura: ciclos encerrados no período e com janela h totalmente observável. Numerador = próxima abertura vinculada dentro de h; imaturos e desconhecidos separados. h precisa de configuração aprovada/versionada; configuração virtual 0 não possui h nem taxa. Configurações antigas podem ser consultadas por `definitionVersion`.
- Fluxo: WIP com primeiro início de trabalho canônico observado, incluindo esperas; throughput em ciclos e tickets únicos; cycle time entre primeiro trabalho e encerramento. Dimensões natureza e responsável são explicitamente **atuais**, não reconstruções históricas de equipe.

Percentis nearest-rank apenas entre observados, sempre com n/população, faltantes, censurados e cobertura. Sem observações/denominador: null, nunca zero. Horas úteis exigem cobertura integral de calendário/política CC10; prefixo descoberto permanece desconhecido. Não se inventam metas ou natureza de legado. Correções canônicas tornam a partição desconhecida até revisão; não se interpreta texto de correção como novo fato temporal.

## Agregação e segurança

`GET /api/organizations/:id/tickets/metrics?from=...&to=...&asOf=...` exige `ticket.view`, membership ativo e ACL antes de cada consulta. Revalida ACL/membership após snapshot; nunca retorna títulos, corpos ou universo privado negado. Eventos internos não entram nem em contagens/watermark. Cache HTTP private/no-store; UI descarta resultados ao mudar organização, atualizar ou perder acesso.

`POST` exige `ticket.manage`, JSON e origem correspondente quando enviada:
- `{action:'define', expectedVersion, requestId, reopenHours, approved:true, reason}` publica definição imutável com CAS e retry idempotente.
- `{action:'replay', from,to,asOf,definitionVersion}` recompõe somente partições autorizadas. Hash captura fontes, janela e definição; checkpoint retém hash anterior, qualidade, watermark e ator. Repetição exata não duplica. Evento atrasado muda hash mesmo se seu tempo for anterior ao watermark. Concorrência é barrada pela revisão única; rollup e checkpoint são atômicos.

Nesta entrega síncrona, máximo de 200 tickets e 2000 registros de cada fonte. Exceder o limite retorna erro explícito, sem totais parciais. GET recalcula os fatos autorizados e verifica cada rollup contra o cálculo bruto: um agregado antigo nunca serve como evidência atual. Não é uma alegação de otimização em escala; jobs/exports maiores pertencem à CC12, e performance D1 ainda precisa de ensaio. Há uma partição materializada atual por ticket; checkpoints conservam a proveniência das reconstruções anteriores. Leituras não escrevem.

## Implantação

Migration `0034_ticket_metric_rollups.sql`: três tabelas novas, índices e guardas imutáveis, sem seed de política, sem backfill ou alteração de dados de clientes. Preflight verifica dependências e bloqueia schema parcial/drift.

Flags novas, OFF por padrão:
- `MAONO_TICKET_METRICS_ENABLED`
- `MAONO_TICKET_METRICS_ORGANIZATION_IDS` — IDs explícitos; wildcard não habilita.

Requer preparação CC03, acesso seletivo, conversas e SLA habilitados somente na organização autorizada. Não habilitar por inferência. Ver [migration-runbook.md](migration-runbook.md), [acceptance.md](acceptance.md) e [evidence.md](evidence.md).

## Controle

Pasta: https://drive.google.com/drive/folders/1ta4hfk9jebqsoMpH8x6b4GD2aBdWC3ir
Controle: https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit

CC09 permanece aberta: CT30–32 autenticados, sessão/upload, performance D1, cleanup/restauração e rollout. CC10: 0033 aplicada e pós-validada no run36372536511; CT33–36 autenticados, parâmetros operacionais e rollout permanecem pendentes. CC11 não autoriza qualquer migração nem flags remotas.
