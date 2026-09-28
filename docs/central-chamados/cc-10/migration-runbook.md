# Migration CC10 — 0033_ticket_sla_policies.sql

Somente tabelas, constraints e triggers aditivos: `ticket_sla_policies`, `ticket_sla_assignments`, `ticket_sla_schema`. Não altera tickets, mensagens ou prioridades; não publica políticas, não atribui SLA e não muda flags. Dados imutáveis usam FKs RESTRICT: exclusões físicas de entidades referenciadas serão impedidas, preservando a trilha contratual. Desativação lógica permanece disponível.

Schema novo e upgrade validados localmente. Preflight exige ledger0010/0025/0026/0027/0028 e colunas efetivamente consumidas. Bloqueia schema parcial ou objetos CC10 existentes. Digest de schema é revalidado entre audit e apply. Não depende de aplicar0021/0022/0023.

Após merge na branch de produto `mano_kepler_v1`:

1. Abrir GitHub Actions → **Production D1 migration operator**. Dispatcher na branch `main`; SHA do produto deve ser o merge revisado, sem inferir o SHA desta branch de implementação.
2. Executar `audit` para **0033_ticket_sla_policies.sql**, no SHA fixado. Aprovar o environment `production-d1-migrations` quando o GitHub solicitar.
3. Conferir artefato: nome/hash SQL, Git SHA, DB `maono_maps` UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, conjunto/digest pendente, risco, schema compatível, quick_check=ok, FK=0 e Time Travel bookmark. Audit bem-sucedido com `writes performed: NO` não significa migration aplicada.
4. Registrar autorização humana específica para0033 e approval hash/texto emitido **nesse audit**. AGENTS.md exige essa etapa; a autorização genérica para implementar CC10 não autoriza escrita D1.
5. Executar `apply` com os mesmos parâmetros e approval hash. Em drift, parar e repetir audit; nunca usar hash antigo.
6. Exigir resultado `APPLIED AND POST-VALIDATED`, ledger0033, quick_check=ok, FK=0, artefato e bookmark. Confirmar `selectedMigrationOnly:true` e ausência de política/atribuição seed.
7. Manter flags SLA OFF até os gates de operação/acceptance. Não reaplicar0032, não aplicar outras pendências em lote.

Em falha de apply, ler o relatório antes de repetir: pode haver escrita concluída e pós-validação falha. Verificar ledger e schema read-only, sem remover objetos imutáveis para forçar nova execução. Nenhum comando de restauração foi executado por esta entrega.
