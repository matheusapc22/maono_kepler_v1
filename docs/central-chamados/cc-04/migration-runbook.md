# CC-04 — runbook da migration 0027

Migration: `0027_ticket_selective_access.sql`.

Finalidade: adicionar `organization_tickets.visibility` e as estruturas de grupos/membros, policies/entries, vínculo Ticket–policy, ACL, labels/links, índices e triggers de escopo da CC-04.

Pré-requisitos: `0010_ticket_center.sql`, `0025_ticket_triage_classification.sql` e `0026_ticket_command_lifecycle.sql` aplicadas no ambiente alvo.

Ordem de rollout:

1. publicar o código com `MAONO_TICKET_SELECTIVE_ACCESS_ENABLED=false`;
2. validar CI/Preview sem habilitar selective access;
3. auditar a 0027 no ambiente alvo conforme a política de migrations do repositório;
4. obter autorização humana explícita específica para a 0027 e para o relatório/hash auditado;
5. aplicar somente a 0027 pelo operador isolado do ambiente;
6. pós-validar ledger, `PRAGMA quick_check` e `PRAGMA foreign_key_check`;
7. smoke com flag ainda OFF;
8. somente em janela autorizada, habilitar a flag e executar CT-11, CT-12, CT-13 e CT-50 autenticados;
9. em falha de aplicação/acceptance, manter/desligar a flag. Não executar rollback destrutivo de schema.

Produção segue obrigatoriamente `AGENTS.md` e `.github/workflows/production-d1-migration-operator.yml`. Nenhum token de escrita de Produção deve ser fornecido ao agente.

**STATUS: MIGRATION PENDENTE DE CONFIRMAÇÃO.**
