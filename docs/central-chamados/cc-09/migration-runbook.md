# Migration CC-09

Arquivo: `0032_ticket_flow_navigation.sql`. SQL aditivo:3 tabelas, índices de snapshot/fila, coluna nullable e2 triggers. Sem backfill de idade, sem WIP predefinido. Custo adicional: materialização temporária de IDs, limpeza de snapshots e UPDATE de idade em mudanças de etapa. Recuperação de banco exige decisão específica; não executar DOWN destrutivo automático.

1. Revisar/mergear a PR de CC-09 no produto `mano_kepler_v1`; aguardar CI/deployment e identificar SHA exato. Manter flags de fluxo desligadas.
2. GitHub Actions → Production D1 migration operator → Run workflow na **main**. Modo `audit`; selecionar exatamente0032 e SHA de produto. O preflight CC09 exige0010/0025/0026/0027 no ledger, colunas base e ausência de objetos0032 parciais.
3. Conferir relatório read-only: arquivo/SHA-256, Git SHA, D1 `maono_maps` (`5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`), risco, ledger, digest de pendentes, anteriores pendentes, quick_check=ok, foreign_key_check vazio, bookmark Time Travel, approval hash/texto.
4. Parar e obter autorização humana para essa migration e esse hash. A autorização genérica para implementar CC09 não serve.
5. Nova execução `apply` com o mesmo arquivo, SHA e autorização. O operador reaudita, compara schema/digest e usa diretório isolado com somente0032. Não aplicar0021/22/23 ou outra migration incidentalmente.
6. Confirmar ledger, integridade, relatório e bookmark. Em falha/resultado incerto, interromper writes e coletar evidência read-only antes de novo apply.
7. Somente depois: janela de acceptance, allowlist de organização QA e flags restauráveis via operador protegido. Rollout permanente é outra decisão.

Não reaplicar0031: CC08 já foi aplicada/postvalidada no run36358061359. Tokens de produção ficam no Environment protegido, nunca no agente.
