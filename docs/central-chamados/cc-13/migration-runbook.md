# Migration 0036 — Operação protegida

Arquivo `migrations/0036_ticket_incidents_problems.sql`. Schema aditivo: seis tabelas, índices, integridade de tenant, imutabilidade de eventos e geração de exportação. Não migra tickets existentes nem cria notificações históricas. Não foi aplicada remotamente nesta entrega.

Preflight específico exige ledger 0010, 0025–0028, 0030, 0031, 0033–0035, schema das fontes e ausência de objetos parciais CC13. Digest do schema é revalidado antes do apply. Arquivo SQL e fresh schema possuem os mesmos objetos CC13.

## Após merge

1. Confirmar produto `mano_kepler_v1` com SHA de 40 caracteres e checkout limpo. Calcular `sha256sum migrations/0036_ticket_incidents_problems.sql` no SHA fixado. Não usar SHA da branch `main` como SHA produto.
2. Em GitHub Actions, abrir `Production D1 migration operator`, branch `main`, modo `audit`, migration `0036_ticket_incidents_problems.sql`. Usar os inputs/confirmadores exatos do workflow e aprovar o Environment `production-d1-migrations`.
3. Conferir relatório: filename/hash, Git SHA produto, D1 `maono_maps` / `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, risco, ledger, pendentes anteriores/digest, schema preflight, `quick_check=ok`, FK vazio, bookmark Time Travel e approval hash. Reportar e parar. Audit verde não significa escrita executada.
4. Somente depois, obter autorização que identifique 0036 e o approval hash atual. Exemplo a preencher com hash emitido: `Autorizo executar em produção a migration 0036_ticket_incidents_problems.sql, approval <hash>, no D1 maono_maps.` Não reutilizar approval de 0035.
5. Executar `apply` protegido com a migration e o hash exatos. O executor reaudita, recusa drift e aplica diretório temporário contendo somente 0036. Não aplicar toda a pasta de migrations.
6. Confirmar ledger com `applied_at`, integridade e FK, bookmark e relatório de pós-validação; guardar runs de audit/apply, Git SHA e SQL hash. Pendências anteriores permanecem sem autorização implícita.
7. Só então conferir deploy/schema servido e preparar aceite autenticado/rollout conforme `acceptance.md`. Apply não ativa flags.

## Recuperação

Se o resultado da escrita for incerto, parar e verificar ledger/integridade em modo somente leitura antes de qualquer retry. Preservar o bookmark de antes do apply. Não há down migration destrutiva automática. Como contenção de aplicação, manter CC13 OFF e ACL ON; recuperação D1 via Time Travel é ação separada, avaliada pelo operador com escopo/janela explícitos. Após existirem registros CC13, remover tabelas destruiria histórico e afetaria snapshots CC12: não fazer rollback SQL improvisado.

0035 CC12 aplicada/pós-validada em 29/09/2026 15:27:35 UTC no run [36590198344](https://github.com/matheusapc22/maono_kepler_v1/actions/runs/36590198344). Não reaplicar.
