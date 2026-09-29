# Manual administrativo — CC18 v1

Público: administradores autorizados de organização e operadores. Nomes de papéis não substituem a decisão efetiva do servidor; o comportamento explícito de super_admin deve ser avaliado conforme o contrato. Não conceder acesso temporário só para um teste passar.

## Acessos e organizações

1. Confirme organização alvo, associação ativa e capacidades necessárias. Revisão de permissões do projeto permanece no contexto do projeto.
2. Para privado, revise principal/grupo/política, allow/deny e audiência; `ticket.manage` não ignora a ACL do objeto. Etiquetas classificam e não concedem privilégios por si.
3. Após mudança/revogação, valide leitura, busca, contagens, links, notas, anexos e download com as identidades dedicadas. Não suspender contas pessoais para ensaiar revogação.
4. Preserve evidência mínima de autor/motivo e resultado. Não use hard delete de usuário, organização ou chamado para recuperar histórico protegido.
5. Cada nova organização precisa de reconciliação e verificação próprias, inclusive depois de ativação de uma flag global. Allowlist vazia não deve ser presumida como todas as organizações.

## Configuração por camada

| Camada | Configuração principal | Pré-requisito |
|---|---|---|
| Triagem/comandos | `MAONO_TICKET_TRIAGE_ENABLED`, `MAONO_TICKET_COMMANDS_ENABLED` | Schema0025/26 e reconciliação por organização; comandos OFF não libera writer legado em adotados. |
| Acesso seletivo | `MAONO_TICKET_SELECTIVE_ACCESS_ENABLED` | Schema0027 e política de privacidade; desligar não é rollback seguro de confidencialidade. |
| Conversa/upload | `MAONO_TICKET_CONVERSATIONS_ENABLED`, `MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED` | Schema0028/29, audiência, storage e limites. |
| Notificações | `MAONO_TICKET_NOTIFICATIONS_ENABLED`, `MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED` | Schema0030, allowlist e `MAONO_TICKET_NOTIFICATION_START_AT`; Worker separado. |
| Fluxo/SLA/métricas | `MAONO_TICKET_FLOW_ENABLED`, `MAONO_TICKET_SLA_ENABLED`, `MAONO_TICKET_METRICS_ENABLED` | Schema0032/33/34, políticas e allowlists correspondentes; dependências anteriores. |
| Exportação | `MAONO_TICKET_EXPORTS_ENABLED`, `MAONO_TICKET_EXPORT_WORKER_ENABLED` | Schema0035, allowlist `MAONO_TICKET_EXPORT_ORGANIZATION_IDS`, limites aprovados e `text-v1`. |
| Casos/conhecimento/feedback | `MAONO_TICKET_CASES_ENABLED`, `MAONO_TICKET_KNOWLEDGE_ENABLED`, `MAONO_TICKET_FEEDBACK_ENABLED` | Schema0036/37/38, ACL seletiva, dependências e allowlists específicas. |

Os nomes exatos das allowlists diferem: `MAONO_TICKET_CASE_ORGANIZATION_IDS` (singular CASE), `MAONO_TICKET_KNOWLEDGE_ORGANIZATION_IDS` e `MAONO_TICKET_FEEDBACK_ORGANIZATION_IDS`. Confirme no módulo da função antes de preparar configuração. O inventário acima não declara o valor remoto atual nem autoriza habilitação. Preview mantém sua política própria de bloqueio de mutações.

## Operadores e responsabilidade

Migration usa Environment `production-d1-migrations` e secret `MAONO_D1_MIGRATION_API_TOKEN`. Aceite usa `production-acceptance`, `MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN` e `MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON`. Configure valores apenas no GitHub; nunca envie credenciais a chat, repositório, comentários ou artifacts.

Os Workers de notificação/exportação têm publicação/configuração independentes do Pages. Os arquivos `wrangler.ticket-*.toml.example` são exemplos, não prova de implantação nem autorização para publicar. Verifique DB, branch/SHA, runtime, allowlist, marco temporal, cron, limites, secrets e responsável antes da ativação.

Budgets, calendário, h de coorte, retenção, janela e carga são decisões humanas a registrar. Falta de valor aprovado mantém o cenário pendente. Use [rollout.md](rollout.md) e [pendencias.md](pendencias.md) para nomear responsáveis e decidir o que falta.
