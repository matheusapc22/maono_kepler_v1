# CC18 — registro de execução

29/09/2026 · `feat/cc-18-central` → `mano_kepler_v1` · REQ-CC-39/40.

## Implementação

- Manuais separados para usuário, atendimento e administração, com procedimentos de falha parcial, audiência, capacidade, ciclo, SLA, métricas, exportação, incidentes, conhecimento e feedback.
- Runbooks de diagnóstico/reprocessamento, schema/migration/backfill e rollback compatível; checklist de ensaio CT59 por operador independente e rollout por coorte/nova organização.
- OpenAPI3.0.3:51 caminhos/81 operações existentes, autenticação de sessão, tipos de upload, idempotência, CAS e schemas dos fluxos críticos; fontes de domínio explícitas para payloads abertos. Validador fixado e isolado, sem dependência adicional da aplicação.
- Matriz40 requisitos/60 casos com fonte histórica e pendência do SHA final. Status anterior de teste local não é convertido em aceite produtivo.
- Gate offline CT60 exige código/merge, SHA servido, DB/ledger/integridade, disposition de migration, QA, review independente, documentação, operação, handoff, evidências40/60, CC17 e pendências resolvidas. Sempre retorna `releaseAuthorized=false`.
- CI adiciona job `cc18-operational-delivery`; paths e métodos são confrontados com rotas atuais; alteração de wrapper/fábrica exige revisão do contrato publicado.

## Estado operacional

PR217 mergeada no produto, baseline `f17882fe846b05d97e5b81c7d2547e30574715b4`. PR218 mergeada na main às20:02:52 BRT, SHA `988b379d21e5071b59d5e9f0db189f67b096f186`. Isso regulariza o dispatcher; Environment, secrets, preflight, suites remotas faltantes e janela continuam pendentes.

**Sem migration CC18.** O diff não altera SQL, schema, handlers nem configuração produtiva. Nenhuma credencial foi solicitada; nenhum ensaio, deploy, migration, backfill ou ativação remota foi disparado nesta execução.

## Validação

| Verificação | Resultado local |
|---|---|
| `npm run test:cc18` | 42 testes aprovados; inclui CT60 negativo, completude, evidências separadas, entrada inválida e preservação de saída existente |
| `npm run validate:cc18` | OpenAPI3.0.3 válido;51 caminhos/81 operações,40 requisitos/60 casos e links locais sem divergência |
| `npm run test:cc17` | 45 testes aprovados; gate integrado e operador preservados |
| `npm run test:expanded` | 1981 testes aprovados, zero falhas; inclui as suites acima, não somar contagens |
| `git diff --check` | Sem erros de whitespace |

Não houve alteração de aplicação/handlers/SQL; build e publicação ficam demonstrados pelos checks da PR. Contratos locais não substituem walkthrough, leitor de tela, CT55–59 reais ou revisão independente. O gate permanece pendente com o template real vazio; fixtures PASS existem somente nos testes unitários.

## Pendências

Ver [pendencias.md](pendencias.md). B01 e preparação documental avançam; B02 exige preflight; B03 exige triagem humana; B04–B13 exigem revisão/decisões conforme cada critério; B14 exige operador independente; B15 inclui gate local mas review/QA final continuam abertos; B16 aguarda aceite. Não marcar toda CC18 concluída pela presença desses arquivos.

[Planejamento](plan.md) · [Matriz](matriz-evidencias.md) · [Controle](https://docs.google.com/spreadsheets/d/1HKWyMYA9npo4lDCcBUlPajlP_ig6nZiEDy-zx51vIGc/edit).
