# Migration e operação CC-12

Migration preparada: `0035_ticket_report_exports.sql`.
SHA-256: `43029aa0e4126521aa584becb88c12eec5c70c083dd7c2bde9085951ad8e4229`.
D1 produção canônico: `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`.
**Não aplicada remotamente nesta execução. Este hash do arquivo não é o approval hash do audit.**

SQL aditivo: seis tabelas (`generation`, `jobs`, `items`, `parts`, `audit`, `gc` com prefixo `ticket_export_`), índices, duas guardas de imutabilidade e sessenta triggers de geração nas fontes. Sem seed de SLA/h, backfill de clientes ou alteração destrutiva. Risco operacional: custo adicional em escritas nas fontes, contenção da geração global, crescimento dos snapshots/auditoria/GC; medir antes de habilitar. `schema.sql` acompanha instalação nova. Preflight0035 verifica ledger, tabelas/colunas necessárias e ausência de objetos parciais, incluindo digest para detectar drift antes de apply.

## Sequência necessária

1. Revisar e integrar a PR no produto; registrar SHA final e CI. Manter novas flags OFF.
2. Executar operador protegido `production-d1-migration-operator.yml` em main, modo audit, somente0035 e SHA produto fixado.
3. Apresentar relatório real: SHA Git, SHA SQL, identidade D1, risco, ledger/pending digest, migrations anteriores pendentes, quick_check/FKs, bookmark Time Travel e approval hash/texto emitido.
4. Parar. `AGENTS.md` exige autorização humana explícita **posterior ao audit**, identificando migration e approval hash. “Execute CC-12” não supre essa autorização. Nenhum token de escrita de produção vai para o runtime do agente.
5. Somente após autorização correspondente, executar apply isolado de0035 pelo mesmo operador protegido; drift exige novo audit.
6. Pós-validar ledger0035, schema, quick_check=ok, foreign_key_check vazio e bookmark. Não executar diretório inteiro de migrations.
7. Publicar Pages/Worker compatíveis, comprovar SHA servido, bindings e cron. Separar evidência de merge, banco e deploy.
8. Resolver operador de aceite e executar CT41/42 autenticados; aprovar limites, CSV/clientes, semântica e budgets. CC12-C continua bloqueada por CC13.
9. Canário somente na allowlist aprovada; observar taxa de abortos SOURCE_CHANGED, filas/idade, duração, CPU/D1, falhas de upload, órfãos e cleanup. Não declarar SLO cumprido sem medições.

## Configuração

Modelo `wrangler.ticket-exports.toml.example`: cron a cada minuto; binding DB canônico; flags feature e Worker OFF. Não é implantação. Copiar para configuração operacional revisada, confirmar runtime production, segredos Dropbox no ambiente protegido e os parâmetros obrigatórios descritos em `decisions.md`. Nunca commit de credenciais.

Flags: `MAONO_TICKET_EXPORTS_ENABLED`, `MAONO_TICKET_EXPORT_WORKER_ENABLED`, `MAONO_TICKET_EXPORT_ORGANIZATION_IDS`. Quotas: `MAONO_TICKET_EXPORT_TTL_SECONDS`, `MAONO_TICKET_EXPORT_MAX_ROWS`, `MAONO_TICKET_EXPORT_MAX_BYTES`, `MAONO_TICKET_EXPORT_MAX_JOBS_PER_ORG`, `MAONO_TICKET_EXPORT_MAX_ATTEMPTS`, `MAONO_TICKET_EXPORT_CSV_PROFILE=text-v1`. Confirmar ACL seletiva pronta e permissões do ator. Não deduzir outras flags CC03–11.

## Recuperação

Falha antes do apply: conservar audit, não escrever. Resultado de apply incerto: parar e verificar ledger/integridade somente leitura, sem reaplicar às cegas. Falha funcional após implantação: desabilitar novas solicitações/downloads CC12 mantendo ACL e limpeza dos jobs/objetos existentes; não remover triggers/tabelas para improvisar rollback. Recuperação de banco por Time Travel só com procedimento e autorização próprios. Cancelamento/retry são explícitos; novo retry gera outra captura e não muda snapshot antigo. Se o Worker inteiro precisar parar, registrar backlog de GC e reativar limpeza com a allowlist original após correção.
