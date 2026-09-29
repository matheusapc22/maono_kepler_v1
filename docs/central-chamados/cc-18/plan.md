# Plano CC18 — execução técnica

Base: `f17882fe846b05d97e5b81c7d2547e30574715b4`, produto após PR217. Dispatcher PR218 já na main; preflight e credenciais protegidas não foram atestados. Planejamento aprovado como escopo de desenvolvimento: [controle CC18](https://docs.google.com/spreadsheets/d/1HKWyMYA9npo4lDCcBUlPajlP_ig6nZiEDy-zx51vIGc/edit).

1. B01–B03: fixar baseline, conferir bootstrap e discriminar heranças.
2. B04–B10: manuais por audiência, contrato HTTP, migration/backfill, recuperação e rollback; ligar cada procedimento às implementações existentes.
3. B11–B13: matriz de sinais/ações, rollout por organização e rastreabilidade40/60 sem falsificar aceite.
4. B14–B15: roteiro independente CT59 e gate offline CT60 com testes negativos; revisão de documentação e contratos em CI.
5. B16: preparar handoff e pendências; concluir somente após provas humanas e remotas.

Entregáveis técnicos nesta PR não implementam nem autorizam as suites remotas CT55–58 herdadas. Não há alteração de handler, dado, flag ou SQL. Review, merge, versão servida, schema remoto, budgets, janelas, CT59 real e aceite final permanecem identificados no registro de execução.
