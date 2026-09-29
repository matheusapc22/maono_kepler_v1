# Rollout controlado — CC18 v1

Público: produto e operação. Esta é uma proposta executável por fases, sem ativação concedida. Homologação isolada permanece dispensada por decisão anterior; o caminho é produção controlada com autorização específica.

| Fase | Entrada | Ação / saída | Quem decide |
|---|---|---|---|
| 0 Preparação | CI/review, inventário e baseline | Fechar bloqueadores CC17, preparar schema, atores, budgets, suites, rollback e observabilidade | Engenharia / QA / operação |
| 1 Ensaio | Janela explícita e Environment aprovado | Casos sintéticos, CT59, cleanup e restauração provados | Operador independente / QA |
| 2 Coorte inicial | Aceite da fase1, allowlist e limites aprovados | Ativação separadamente autorizada, observação pelo período definido e critérios de parada | Produto / operação |
| 3 Expansão | Metas atingidas sem bloqueadores | Ampliar somente organizações aprovadas; repetir verificação de prontidão | Produto / operação |
| 4 Handoff | CT60 e matriz completos | Donos, alertas, runbooks e aceite nominal; revisão de riscos residuais | Produto / responsável operacional |

## Checklist por organização, inclusive após flag global

Registrar ID, vínculo/atores e capacidades; reconciliação do legado/estado vazio comprovada; schema aplicável; storage; ACL/audiências; políticas de fila/SLA; definições/coortes; flags/allowlists efetivas; Workers e parâmetros; ensaio de acesso e rollback; evidência de aprovação e responsável. Nova organização não herda prontidão de outra organização.

Flag de fluxo aceita contrato próprio para wildcard; outras allowlists exigem IDs explícitos. Não usar `*` como conveniência transversal. Ativação da ACL seletiva anteriormente informada pelo usuário não autoriza ligar comandos, conversas, métricas ou outras features.

## Decisões D01–D08

Responsáveis nominais e revisão; alvo/coorte/dataset; budgets/janela; recuperação; expansão por fase; alertas/escalonamento; tratamento de heranças; aceite final. Preencher no controle valor decidido, dono, data e link da aprovação. Não há prazo ou budget presumido.

## Gates e fechamento

G01 base/operador; G02 aceite CC17; G03 documentação/API; G04 schema/deploy; G05 operação/CT59; G06 matriz/CT60; G07 handoff. `gate:cc18` exige prova separada de código, deployment, schema, QA, review, documentação, operação e handoff, além dos40 requisitos/60 casos e CC17 completo.

CT60 deve rejeitar merge verde com migration sem confirmação, ledger ausente, SHA diferente, caso sem prova, review do próprio autor, duplicação de IDs ou pendência humana aberta. O template não é prova. Resultado `READY_FOR_FINAL_REVIEW` exige conferência humana da autenticidade e aplicabilidade de cada link; `releaseAuthorized` permanece false. Qualquer mudança no SHA exige reavaliar evidência do alvo final.
