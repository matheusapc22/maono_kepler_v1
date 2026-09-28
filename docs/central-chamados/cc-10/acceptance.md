# Acceptance CC10 — preparado, execução remota pendente

Os testes locais não encerram CT33–36 de aceitação autenticada. A base de produto ainda não contém o dispatcher/registry do operador proposto na PR201. Não contornar essa dependência expondo credenciais ao agente nem criando um caminho paralelo de escrita.

## Pré-condições

- Merge, deployment identificado,0033 pós-validada e dependências de fontes/ACL prontas.
- Matheus/operação aprova organização QA isolada, contas de solicitante/atendente/gestor/viewer, janela, metas, calendário e conjunto limitado de tickets. Sem reutilizar clientes reais como fixtures.
- Suíte registrada no operador protegido após o contrato dele estar publicado; tokens permanecem no runner. Fixar SHA, URL e identidade da organização; capturar flags antes da execução.
- Política QA e atribuições são imutáveis: definir retenção auditável da organização QA, sem prometer exclusão física de ledger. Cleanup = encerrar fixtures autorizadas, desativar flag/retirar allowlist e comprovar ausência de dados QA nas organizações reais. Exclusão física/recovery não é implícita.

## Casos controlados

| Caso | Preparação e execução | Evidência requerida |
|---|---|---|
| CT33 | Calendário aprovado com feriado e fuso DST; reproduzir intervalos esperados em fixture controlada | UTC compilado, versão, entrada e resultado; relógio do backend não deve ser adulterado em produção |
| CT34 | Atribuição, evento automático, nota interna, mensagem do solicitante e resposta pública do atendente | Só última mensagem elegível encerra primeira resposta; nenhuma nota vaza para viewer |
| CT35 | Espera autorizada/não autorizada, retomada, encerramento e reabertura | Subtração única, resolução por ciclo, primeira resposta global; comando inválido rejeitado |
| CT36 | Publicar nova versão, alterar prioridade e depois atribuir explicitamente | Primeiros passos preservam versão antiga; nova atribuição inicia segmento auditado e preserva fração consumida |
| ACL | Viewer sem manage, ticket privado sem grant, outra organização, revogação durante leitura | 403/404 sem dados derivados indevidos |
| Resiliência | Retry da mesma intenção, conflito de versão, calendário expirado e histórico limite | Idempotência,412 ou desconhecido explícito; nenhum zero inventado |

Cenários DST/feriados passados exigem harness isolado de replay ou fixtures previamente aprovadas; nunca backdate manual de eventos reais. Suíte futura deve separar replay determinístico de jornadas autenticadas atuais.

## Encerramento

Anexar relatório por SHA, contagens de fixture, auditoria de políticas/atribuições, medidas p95 D1, cleanup lógico e restauração das flags. Registrar desvios e responsável. Só marcar CTs aprovados após evidência autenticada e revisão. CC09 mantém CT30–32 e demais pendências abertas, independentemente do resultado da CC10.
