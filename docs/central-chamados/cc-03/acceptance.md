# CC-03 — aceite técnico e evidências

Execução local em 25/09/2026 sobre a base `ddaabcb1ea6038b62da9d90a7d1acd20634bd236`. O commit que contém este documento identifica o lote revisado; `evidence/manifest.json` relaciona os hashes dos arquivos. A URL e o SHA da PR e seus checks são registrados no [controle](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit) após a publicação.

## Evidência automatizada

| Execução | Resultado | Registro |
|---|---|---|
| Comandos, cliente, HTTP, retenção administrativa, backfill e regressão de usuários | 143 testes aprovados | `evidence/command-tests.log` |
| Ticket e triagem CC-02, incluindo upgrade literal da 0010/0025 | 52 testes aprovados | `evidence/compatibility-tests.log` |
| Política de escrita do Preview | 23 testes + gate aprovados | `evidence/preview-safety.log` |
| Fluxos existentes de CR | 98 testes aprovados | `evidence/change-request-regression.log` |
| Contratos da CC-01 | Aprovado | `evidence/cc01-regression.log` |
| Snapshot novo × expansão 0010/0025/0026 | Tipos/defaults/FKs equivalentes; `foreign_key_check` aprovado | `evidence/schema-parity.json` |
| Catálogo/apresentação de erros | Ratchet estrito aprovado, sem alterar scanner/baseline | `evidence/error-presentation.json` |
| TypeScript e build Vite | Aprovados; aviso existente de bundles grandes | `evidence/build.log` |
| UI CC-03 com React e cliente reais, HTTP local fictício | Aprovado em Chromium 140; desktop e 390 px, pt-BR | `evidence/command-ui-smoke.json`, `evidence/ui-qa.md`, PNGs |
| Regressão da UI de triagem | Aprovado: dez combinações natureza/domínio e casos adicionais | `evidence/triage-browser-regression.log` |

Total das quatro suítes de teste: **316 testes aprovados**, sem contar novamente a execução independente dos mesmos casos pelos revisores. Testes usam dados fictícios e SQLite real com FKs; não se afirma execução no D1 remoto.

## Requisito → caso → evidência

| Requisito / caso | Resultado demonstrado | Arquivos principais |
|---|---|---|
| REQ-CC-05/06, CT-06 | Matriz de 25 combinações, precondições, espera sem novo status, fechamento com resultado, reabertura preservando ciclo e pendência CR independente | `tests/ticket-commands-integration.test.mjs`, `tests/ticket-commands.test.mjs`, browser |
| REQ-CC-07, CT-07 | Criação concorrente e resposta perdida: mesma chave/payload produz um Ticket; replay conserva resposta persistida mesmo após edição | Integração, HTTP, helper de intenção e browser |
| REQ-CC-07, CT-08 | Conteúdo divergente dá 409; escopos de ator e organização não compartilham resultado; autorização antes de replay | Integração e HTTP |
| REQ-CC-08/09, CT-09 | Sem token dá 428; token antigo/CAS perdedor dá 412; sem evento, auditoria de sucesso ou outbox do perdedor | Integração, HTTP e preservação de rascunho no browser |
| REQ-CC-09, CT-10 | Falha injetada em cada statement de criação, update, fechamento, espera, reabertura e correção reverte todo o batch, inclusive auditoria/outbox | 37 pontos de falha na suíte de integração |
| REQ-CC-10/09, CT-49 | Job paginado/reexecutável, procedência e contagens reais; GET pós-cutover sem DML; guards append-only e correção por novo evento | Backfill, integração e HTTP |

As proteções adicionais cobrem: schemas incompletos, flags incoerentes, nova origem legada após marker, PATCH de próxima ação isolada, CR pendente que surge entre leitura e batch, tentativa antiga após desligar flag e rollback sem sobrescrever o ciclo. Os dois submitters CR foram exercitados com o schema novo, preservando defaults sem inventar classificação ou histórico.

A retenção administrativa foi testada pela rota real: exclusão de participante bloqueada com 409 após rollback integral de sessões/vínculos; desativação continua permitida. Usuário sem histórico continua excluível. Não se afrouxaram triggers para fazer o teste passar.

## Reprodução

```sh
node --experimental-strip-types --test tests/ticket-command*.test.mjs tests/ticket-legacy-backfill.test.mjs tests/user-management*.test.mjs
node --experimental-strip-types --test tests/ticket-center.test.mjs tests/ticket-triage*.test.mjs
npm run test:preview-safety
npm run test:change-requests
node scripts/central-chamados/validate-cc01.mjs
node scripts/audit-user-error-sinks.mjs --baseline scripts/user-error-sink-baseline.json --strict-baseline
npm run build
node scripts/central-chamados/smoke-command-ui.mjs
node scripts/central-chamados/smoke-triage-ui.mjs
```

O workflow `Central de Chamados contracts` executa os contratos, regressões e nova suíte de comandos com Node 22. O build local usa Node 24.19.0 e dependências do lockfile. Chromium precisa estar instalado para os scripts de UI. Logs e testes locais não substituem o resultado de CI no SHA publicado.

## Revisão e limites de aceite

Ver [review.md](review.md) para achados, correções e retestes independentes. Casos locais próprios da CC-03 podem receber aprovação técnica no controle, com esta evidência e o SHA publicado. Review humano, CT-02, QA autenticado e governança pendente mantêm seus gates próprios.

A atomicidade comprovada cobre **comandos Ticket e importação explícita**. Os adapters de CR e a publicação de anexos seguem nas CC-08 e CC-06; compatibilidade de seus writers não significa atomicidade de todo o fluxo. A outbox registra intenção, sem entrega de notificação. CT-29 integrado e CT-57 distribuído permanecem nos donos futuros.

A 0025 foi confirmada pelo usuário, com ambiente ainda não identificado no relato. A **0026 não foi aplicada remotamente**. Seu runbook inclui inspeção por ambiente, reconciliação de cada organização e recuperação. O canal de operador remoto para executar o job não foi implantado; é pré-requisito operacional de ativação, não algo a substituir por um GET.

Publicação da PR/Pages, merge, schema, flags e aceite de produção são evidências distintas. Esta entrega não marca a CC-03 como implantada/concluída nem declara o painel global multi-organização entregue; seu controle e concessão de super admin permanecem no planejamento próprio.
