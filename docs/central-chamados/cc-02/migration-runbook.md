# CC-02 — migration 0025 e ativação controlada

## Estado e alvo

Arquivo: `migrations/0025_ticket_triage_classification.sql`. Finalidade: expandir `organization_tickets` para natureza, resultado, contexto, impacto/urgência, respostas versionadas, motivo e proveniência da triagem. Não altera o fluxo de CR nem concede permissões.

**Nenhum comando remoto deve ser executado por este runbook sem autorização explícita para o banco e ambiente identificados.** A implementação da PR e a validação em SQLite descartável não constituem aplicação em D1. Migrations 0021/0022/0023 permanecem pendentes de confirmação e não devem ser executadas como efeito de um comando que aplique todo o diretório.

| Ambiente | Identificação exigida antes da operação | Estado |
|---|---|---|
| Desenvolvimento descartável | Banco SQLite criado e destruído pelos testes | Validar nos testes versionados; não representa um D1 persistente |
| Preview | Binding real, database ID, conta, flag e escopo QA; conferir se compartilha produção | Aplicação/ativação remota pendente |
| Produção | Binding real, database ID, conta, SHA de release e responsável | Aplicação/ativação remota pendente |

## Pré-requisitos

- Ler o histórico de migrations e o schema do banco escolhido. Conferir a base `organization_tickets` e `ticket_events` da 0010; não deduzir aplicação pelo número de arquivo.
- Conferir o diff e o hash SHA-256 do arquivo 0025 no commit candidato. O número 0024 já está ocupado e não deve ser reutilizado.
- Manter `MAONO_TICKET_TRIAGE_ENABLED=false`. Não habilitar mutações Preview nem alterar configuração de D1 por inferência.
- Estabelecer backup/ponto de recuperação compatível com a operação e registrar responsável, instante, evidência e verificação de recuperação.
- Registrar contagens por organização, por categoria e por estado antes da expansão. Registrar também quantidade total e chaves de tickets/CRs para reconciliação.
- Conferir os writers ativos e o período de coexistência de versões. A expansão aceita inserts antigos sem os novos campos; esses registros continuam pendentes de triagem.

## Leitura de schema e reconciliação

Consultas preparadas para revisão humana. Não incluem mutações nem assumem acesso remoto disponível:

```sql
PRAGMA table_info(organization_tickets);
SELECT name, sql FROM sqlite_master
WHERE tbl_name = 'organization_tickets'
  AND type IN ('table', 'index', 'trigger');
SELECT organization_id, category, status, COUNT(*) AS total
FROM organization_tickets GROUP BY organization_id, category, status;
SELECT COUNT(*) AS total FROM organization_tickets;
SELECT COUNT(*) AS events_total FROM ticket_events;
```

Depois da expansão, comparar as contagens e conferir os campos da migration. Chamados antigos de `category='map'`, inclusive descrições ambíguas, devem continuar com `demand_nature IS NULL` e origem legada. Nenhuma heurística textual ou mapeamento categoria→natureza é permitido. O executor deve registrar o histórico oficial da migration seguindo a ferramenta operacional escolhida; não criar uma entrada de ledger manualmente sem verificar o padrão real do ambiente.

Antes de ativar a flag, a verificação abaixo deve reconciliar os mesmos IDs registrados antes da expansão. Escritas posteriores devem ser separadas pela janela operacional, sem atribuí-las ao backfill.

```sql
SELECT organization_id, triage_source, demand_nature, COUNT(*) AS total
FROM organization_tickets
GROUP BY organization_id, triage_source, demand_nature;
SELECT COUNT(*) AS inconsistent_classifications
FROM organization_tickets
WHERE (triage_source = 'legacy' AND demand_nature IS NOT NULL)
   OR (triage_source = 'human' AND
       (demand_nature IS NULL OR trim(expected_result) = ''
        OR impact IS NULL OR urgency IS NULL OR triage_form_version IS NOT 1));
SELECT name FROM sqlite_master
WHERE type = 'index' AND name = 'idx_organization_tickets_triage';
```

## Aplicação e verificação

1. Conferir autorização específica, banco alvo, hash do SQL e evidência de recuperação imediatamente antes de executar.
2. Aplicar somente a 0025 pelo procedimento de migration isolada aprovado. Não usar aplicação indiscriminada das pendências do diretório.
3. Verificar sucesso de todos os statements, schema e ledger. Em caso de aplicação parcial, interromper a ativação e comparar cada coluna/índice antes de planejar reparo; não repetir `ALTER TABLE ADD COLUMN` às cegas.
4. Conciliar as contagens anteriores/posteriores e provar que nenhum ticket antigo recebeu natureza inferida.
5. Testar inserts antigos em escopo descartável/QA autorizado; conferir origem e necessidade de triagem. Não criar chamados reais para verificar compatibilidade.
6. Ativar `MAONO_TICKET_TRIAGE_ENABLED` apenas após a confirmação. Executar as cinco naturezas em dois domínios, mudança de prioridade/domínio e classificação de legado, com sessão QA e organização autorizadas.
7. Registrar execução, confirmação, schema/history e resultado do aceite na planilha. Não copiar um sucesso local para a coluna de aplicação remota.

## Rollback

Desligar primeiro `MAONO_TICKET_TRIAGE_ENABLED` no ambiente autorizado e confirmar que o cliente retorna ao contrato anterior. Reverter o código pelo processo de release se necessário. Manter as colunas e os registros aditivos preservados: não remover evidências, não zerar natureza e não executar `DROP COLUMN` como rollback automático. Uma reversão de dados exige plano separado e recuperação verificada.

Com a flag desligada, payloads contendo novos campos são rejeitados explicitamente, evitando que o cliente acredite ter salvado triagem descartada. Dados já classificados permanecem persistidos; reativação posterior depende de schema íntegro. O fechamento do atendimento, SLA e decisões de CR continuam com seus fluxos e gates próprios.
