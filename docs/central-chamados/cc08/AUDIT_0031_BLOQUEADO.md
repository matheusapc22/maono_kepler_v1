# Auditoria 0031 bloqueada — 27/09/2026

Execução: https://github.com/matheusapc22/maono_kepler_v1/actions/runs/36350246364
Produto: 43b5d72a9117dc0dc043b066e6e4d03bd3b5577a (merge PR205).
Modo: audit. Resultado: CC08_SCHEMA_PREFLIGHT_BLOCKED.
D1: maono_maps / 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db.

O relatório confirma writesPerformed=false e readyForAuthorization=false; não emitiu autorização. quick_check=ok e foreign_key_check sem violações. Bookmark capturado: 0000039b-00000002-000050f3-ce173d5c969b1e7a35c3a3a206baa8e7.

Há uma pendência real: 0020_project_change_requests.sql ausente no ledger. A tabela project_change_requests existe. Isso exige comparar o schema completo antes de qualquer aplicação isolada de0020.

Foi identificado também um defeito no coletor: o filtro por nome change_request excluía project_change_operations, seus índices e triggers, embora o validador exigisse esses objetos. Logo, missingObjects nesse relatório não comprova sua ausência remota. A correção inclui a família change_operations e objetos associados às duas tabelas por tbl_name, mantendo bloqueios de ledger, expansão histórica e drift.

Validação da correção:45 testes aprovados (28 CC08 +17 gates de migration), incluindo consulta real em SQLite com0020 completa, ledger pendente, trigger realmente ausente e alteração do digest. Nenhuma migration SQL alterada.

Próximo passo: revisar/mergear a correção e repetir audit0031, main, approval_hash vazio. O audit deve continuar bloqueando se0020 permanecer pendente, mas produzirá inventário completo. Após comparar definições, auditar0020 separadamente se necessário; qualquer apply depende de relatório e autorização específica conforme AGENTS.md. Não aplicar0021/22/23 por inferência, não editar ledger manualmente, não usar hash anterior nem ativar flags.
