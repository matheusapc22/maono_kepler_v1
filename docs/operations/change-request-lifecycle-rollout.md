# Rollout — lifecycle canônico / migration 0021

## Pré-condições

Base inspecionada: `69dbd8f` (merge #146); deploy da base aprovado no Cloudflare. Esta PR é o primeiro gate da sequência solicitada. Não avançar para Apply grande, Viewer tracking ou release acceptance antes do pós-merge desta etapa.

A migration `migrations/0021_change_request_lifecycle.sql` deve ser aplicada uma única vez, após 0020, no D1 vinculado ao ambiente alvo. Não aplicar indiscriminadamente outras migrations pendentes. Não executar DDL em handlers e não usar o Preview para modificar D1 de produção.

Os novos writers recusam alterações sem o schema completo (`CHANGE_REQUEST_LIFECYCLE_SCHEMA_OUTDATED`, 503). Os triggers exigem versão e decisão canônicas; por isso os writers antigos de Review não são compatíveis depois da migration. Coordenar uma janela curta sem ações de Review/Apply entre aplicação da migration e entrada do deploy novo. Voltar apenas o código antigo não é um rollback compatível: preferir correção adiante e preservar os dados de decisão/feedback. Não remover os campos/journal para apagar evidências.

## Validação SQL read-only após aplicar

```sql
SELECT name FROM sqlite_master
WHERE name IN ('project_change_request_events', 'trg_change_request_lifecycle_guard',
  'trg_change_request_lifecycle_sync', 'trg_change_request_lifecycle_created',
  'trg_ticket_change_request_status_guard');

SELECT r.id, r.status AS request_status, t.status AS ticket_status
FROM project_change_requests r
JOIN organization_tickets t ON t.id = r.ticket_id AND t.organization_id = r.organization_id
WHERE t.status <> CASE r.status
  WHEN 'submitted' THEN 'new' WHEN 'under_review' THEN 'in_review'
  WHEN 'approved' THEN 'in_review' WHEN 'applying' THEN 'in_progress' ELSE 'closed' END
  OR (t.status = 'closed' AND t.closed_at IS NULL)
  OR (t.status <> 'closed' AND t.closed_at IS NOT NULL);
```

Esperado: cinco objetos presentes e zero divergências. Feedback histórico não registrado continua NULL e aparece como “Sem feedback registrado”.

## Validação depois do deploy

`GET /api/health`: `checks.changeRequestLifecycleReady === true`. A verificação inclui todos os campos e os quatro triggers, não apenas existência da tabela. CI e Cloudflare devem estar verdes no SHA mesclado. Em uma organização de QA autorizada, verificar rejeição com feedback e repetição, aprovação, Ticket sincronizado e imutabilidade dos estados terminais.

## Retomada com Repository Secrets — 2026-09-06

O workflow `change-request-d1-preflight.yml` usa exclusivamente `secrets.CLOUDFLARE_API_TOKEN` e `secrets.CLOUDFLARE_ACCOUNT_ID` no runner. A execução controlada na branch da PR é somente leitura; `workflow_dispatch` fica disponível após registro na base. Não há aplicação automática por push ou PR.

Execução inicial: https://github.com/matheusapc22/maono_kepler_v1/actions/runs/34035297692

- Autenticação D1 aprovada; exatamente um banco `maono_maps` na conta configurada.
- Ledger remoto contém 17 migrations; `0021_change_request_lifecycle.sql` não consta como aplicada.
- Tabela `project_change_requests` presente; journal e quatro triggers da 0021 ausentes.
- API Pages `pages/projects/maono-kepler-v1` retorna HTTP 403. O token D1 não permite confirmar o binding atual de produção. Nenhuma escrita remota realizada.

Gate bloqueado: confirmação inequívoca do ambiente alvo, anterior à aplicação da migration da PR #147. Menor ação humana: conceder ao mesmo token `Account / Cloudflare Pages / Read` na conta já autorizada e atualizar o Repository Secret se necessário; alternativamente fornecer evidência do binding Production `DB` no painel do projeto, com nome e UUID do D1 (sem token nem Account ID). O workflow pode então ser reexecutado. Não ampliar para Pages Write.

Esse 403 é da API administrativa Pages, não do endpoint HTTP do preview. A verificação HTTP do preview é executada separadamente, sem enviar credenciais D1, e registra apenas status/redirecionamento e readiness. A permissão Pages Read não substitui eventual autorização Cloudflare Access.

Após confirmar binding: verificar novamente ledger/schema, preparar aplicação isolada da 0021 e coordenar a janela de writers descrita acima. Não mesclar #147 nem iniciar PR 2 enquanto esses gates estiverem pendentes.
