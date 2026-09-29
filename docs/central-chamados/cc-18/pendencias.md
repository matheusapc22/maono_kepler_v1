# Pendências de aceite — CC18

29/09/2026. Implementação/documentação podem avançar; encerramento operacional depende destas provas. Papéis abaixo são propostos; responsáveis nominais/datas ainda devem ser designados no controle.

| ID | Situação / próximo passo | Papel | Critério de baixa |
|---|---|---|---|
| C17-P01 | PR217 mergeada; Pages aprovado. Conferir review independente e alvo canônico autenticado | Revisor / operação | Prova nominal e SHA servido |
| C17-P02 | PR218 mergeada na main; conferir Environment, secrets e preflight protegido | Operação | Artifact do preflight correto; não basta dispatcher existir |
| C17-P03 | Preparar atores dedicados em duas organizações e matriz de capacidades/revogações | QA / segurança | Atores e expected allow/deny revisados |
| C17-P04 | Aprovar budgets, dataset/mix, duração, amostras, concorrência, erro/p95/custo, janela e parada | Produto / operação | D01–D10 CC17 assinadas e datadas |
| C17-P05 | Implementar/revisar executores remotos CT55–58; única suite atual é CC04 | Engenharia / QA | Runs reais por caso no SHA final |
| C17-P06 | Conferir ledger e provar contenção/drenagem, cleanup/restauração | Operação | DB/ambiente e estado final comprovados |
| C17-P07 | Triar heranças CC03–16, leitor de tela CT53, CT54 e15 jornadas reais | Produto / UX / QA | Provas ou impedimentos discriminados por origem; sem baixa por mock |
| C17-P08 | Tratar achados reais e obter aceite final/handoff | Produto / revisor | Bloqueadores resolvidos e retestes |
| C18-P01 | Revisar manuais/OpenAPI e walkthrough com os públicos | Produto / atendimento / revisor | Compreensão e contratos confirmados |
| C18-P02 | Aprovar budgets, alertas/destinos, coorte e rollback | Operação / produto | D01–D08 CC18 com valores reais |
| C18-P03 | Executar CT59 por operador distinto do autor | Operador independente | Diagnóstico/reprocessamento/restauração/cleanup reais |
| C18-P04 | Revisar matriz e completar evidência do SHA final | QA / revisor | REQ01–40/CT01–60, schema/deploy/QA separados |
| C18-P05 | Revisão, merge, publicação e handoff CC18 | Maintainer / operação | PR/SHA servido e aceite nominal; sem migration CC18 |

Fontes: [controle CC17](https://docs.google.com/spreadsheets/d/1H5CUSUDV9VdwiWn1S3sQimUF1qKTa7QNcKY4uB5sJNA/edit), [controle mestre](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit) e [controle CC18](https://docs.google.com/spreadsheets/d/1HKWyMYA9npo4lDCcBUlPajlP_ig6nZiEDy-zx51vIGc/edit). Os nove registros CC16 e32 referências herdadas se cruzam; não somar como41 problemas únicos. Notas históricas que dizem dispatcher ausente foram superadas pelo merge218; os demais bloqueios permanecem.

O AGENTS exige decisão específica `RUN_PRODUCTION_ACCEPTANCE` e aprovação do Environment para janela real; implantação permanente exige outra decisão. A solicitação de executar CC18 autoriza este desenvolvimento, mas não fornece budgets, atores nem atesta ensaios humanos. Nenhuma migration, ativação ou escrita produtiva foi executada aqui.
