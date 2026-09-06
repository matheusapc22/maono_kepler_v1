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

## Bloqueio externo verificado nesta execução

Etapa bloqueada: aplicação/validação remota da migration, antes de merge e pós-merge da PR 1.

Evidências: o ambiente não contém `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` nem `CLOUDFLARE_D1_DATABASE_ID`. Não há configuração autenticada Wrangler disponível. A busca de plugins por Cloudflare não retornou integração. O repositório tem workflows de validação, mas nenhum workflow de aplicação de migrations; os arquivos Wrangler versionados são configurações locais/exemplos. O conector GitHub permite PR/CI/merge, mas não dá acesso ao banco D1.

Ações: sincronização da base e confirmação do deploy; inspeção de workflows/configurações; verificação apenas da presença das variáveis (nenhum segredo foi impresso); descoberta de integrações; implementação de migration, testes SQLite e health check para o rollout. Nenhuma alteração remota de banco foi tentada sem acesso autenticado.

Menor ação humana: disponibilizar acesso autenticado ao Cloudflare/D1 por configuração segura do ambiente, permitindo coordenar a migration e o deploy. Alternativamente, um operador pode aplicar somente 0021 no D1 alvo durante a janela combinada e fornecer o resultado das consultas acima, para que o merge/deploy e sua verificação sejam retomados. Não enviar tokens no chat.
