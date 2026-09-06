# PR 1 — synchronize review and Ticket lifecycle (P0)

## Estado atual e causa
A base 69dbd8f contém a inbox da #146. Review altera `project_change_requests.status` por CAS, mas grava eventos do Ticket posteriormente em modo best-effort; não altera o status do chamado. A rejeição armazena o comentário apenas no evento do Ticket. Retries de rejeição falham mesmo após sucesso; conflitos podem duplicar eventos; Tickets podem ser fechados manualmente independentemente da solicitação. A revisão aplicada idempotente retorna o HEAD atual, que pode já ter avançado.

## Estado desejado e fontes canônicas
- `project_change_requests`: estado, decisão (approved/rejected), feedback, autor/data da decisão, versão do lifecycle e revisão efetivamente aplicada.
- Ticket: projeção do estado canônico, sem decisão independente. Outros campos operacionais (atendente, prazo, prioridade) continuam editáveis.
- Histórico de transições: journal durável associado à solicitação; evento do Ticket referencia a versão, sem outra cópia mutável de feedback.

## Abordagem
Migration 0021 aditiva para os campos e journal. Trigger SQLite/D1 sincroniza Ticket e journal atomicamente com a atualização de estado; se qualquer parte falhar, a instrução inteira falha. CAS exige estado e versão observados. O serviço valida a máquina de estados, grava decisão/feedback junto da transição e identifica repetição idêntica; uma repetição com feedback diferente falha 409. O serviço genérico do Ticket bloqueia alterações divergentes de estado e um trigger mantém a proteção contra concorrência/outros escritores.

Mapeamento: submitted→new; under_review/approved→in_review; applying→in_progress; applied/rejected/conflict/superseded→closed. Conflito não equivale a rejeição; a decisão anterior fica preservada. Histórico legado só recupera feedback quando há evento explícito; dados ausentes continuam nulos, nunca inventados.

## Arquivos afetados
Migration 0021; serviço de lifecycle novo; serviços Review/Change Requests/Ticket; API e tipos de Review/Ticket; detalhe do Ticket; testes de integração SQLite; test:change-requests; documentação de rollout.

## Implementação e invariantes
1. Acrescentar schema e backfill limitado às solicitações existentes.
2. Centralizar transições e serialização dos campos canônicos.
3. Integrar start/approve/reject/applying/conflict/applied; remover eventos de transição best-effort duplicados, manter auditoria secundária.
4. Expor decisão/feedback no Review e Ticket; bloquear estado manual do Ticket vinculado.
5. Preservar imutabilidade de operações, restrição de organização, permissões Editor/Viewer, contrato Review v2 leve e CAS de revisão no Apply.
6. Persistir applied_revision para retries mesmo após avanço posterior do HEAD.

## Testes e edge cases
SQLite real: mapeamento de todos os estados; rollback quando journal/evento falha; repetição idêntica; feedback divergente; dois revisores concorrentes; versão obsoleta; update direto de Ticket; solicitação sem Ticket; feedback legado ausente; estado terminal; revisão aplicada estável. Rodar suíte Change Requests, gates exigidos e build/typecheck; lint nos componentes alterados. Migration em banco fixture e validação read-only de schema/estado após rollout.

## Critérios de conclusão e rollout
CI/build/deploy verdes; migration aplicada no ambiente alvo por acesso autorizado antes da ativação de novos writers; nenhuma divergência request/Ticket nos smoke tests. Não avançar para PR 2 sem merge e pós-merge saudáveis. Não executar DDL automático em requests nem usar preview para modificar D1 de produção. Ausência de acesso D1 é blocker externo de rollout, a ser registrado com evidências após preparar o diff revisável.
