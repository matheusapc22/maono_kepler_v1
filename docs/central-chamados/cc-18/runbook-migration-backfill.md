# Runbook de schema, migration e backfill — CC18 v1

Público: engenharia e operação. Fonte normativa: [AGENTS.md](../../../AGENTS.md). **Esta CC18 não contém SQL nova.** Isso não comprova o ledger remoto nem permite reaplicar0038. Schema, backfill e flags são decisões separadas.

## Conferir antes de qualquer escrita

1. Fixar branch `mano_kepler_v1` e SHA completo do produto; confrontar diff de `migrations/` e `schema.sql`.
2. Identificar ambiente e binding. Produção canônica: D1 `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`. Preview e fixtures não são esse banco por inferência.
3. Consultar ledger e integridade por caminho protegido/autorizado; guardar evidência sanitizada de `quick_check=ok`, nenhuma violação FK, schema aplicável e bookmark atual. Relatório de apply antigo não prova sozinho o estado atual.
4. Para CC18, registrar `migrationDisposition=none`, diff revisado e lista vazia de SQL novas. Pendências anteriores continuam inventariadas. Não liberar0021/0022/0023 por consequência deste pacote.

## Se uma correção exigir nova migration

Use Actions → Production D1 migration operator, workflow na `main`, Environment `production-d1-migrations`. Prepare/revise a SQL e testes locais. Execute primeiro `audit` para o arquivo exato e SHA fixado; apresente filename, SHA-256, Git SHA, DB, risco, digest das pendentes, integridade, bookmark e hash/texto de autorização.

Pare para autorização humana específica do hash auditado. Só depois selecione `apply` com o mesmo arquivo/hash. O operador reaudita e rejeita drift; o diretório isolado contém uma única SQL. Confirme ledger, quick_check, FK e relatório pós-apply. Resultado incerto exige investigação somente leitura antes de repetir. Nunca executar apply genérico sobre todas as migrations.

## Backfill por organização

O operador existente e seu procedimento estão em [remote-operator-runbook.md](../cc-03/remote-operator-runbook.md) e [reconcile-empty.md](../cc-03/reconcile-empty.md). Não é parte automática do operador de migrations nem do aceite.

Em estação humana autorizada, instale o runtime fixado e consulte a ajuda sem credencial no comando:

```sh
npm ci --prefix scripts/central-chamados/operator --no-audit --no-fund
node scripts/central-chamados/operator/backfill-d1.mjs --help
```

O modo padrão `inventory` é somente leitura. Antes de aplicar: revisar inventário, confirmar ID da organização, operador super_admin e eventual autor substituto membro; obter autorização específica e atestar suspensão real dos writers. `--writers-paused` é declaração humana, não verificação automática.

`apply` processa páginas limitadas (`--page-size`, `--max-pages`) com relatório novo e bookmark. Saída2 pode conter efeitos duráveis parciais: consultar relatório/checkpoint e inventário antes de retomar; não apagar cursor nem inventar ciclo/primeira resposta. `reconcile-empty` serve só para fonte elegível realmente vazia e rejeita autor substituto. Não usar para pular migração de fonte não vazia.

Depois, conferir contagens/proveniência, associação, leitura sem importação pelo GET e guard de chamados adotados; só então registrar prontidão daquela organização. Ativação global não dispensa esse passo para organizações futuras. Credencial de escrita permanece fora do runtime do agente; backfill remoto não foi executado nesta entrega.
