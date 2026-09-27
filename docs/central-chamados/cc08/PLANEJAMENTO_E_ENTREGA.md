# CC-08 — Vínculos, revisão e reconciliação Chamado–CR

Data: 27/09/2026. Base: ace9e647d7e1042327c234a891b2d182c33149cc.
Branch: feat/cc-08-central. Entrega candidata; não equivale a aceite de produção.

## Planejamento e controle

Pasta: https://drive.google.com/drive/folders/1E4H3_7WNeV7BqmF7gxELeODIJL6EfpId
Controle próprio: https://docs.google.com/spreadsheets/d/1iqI26PDPhc6g9zTIuQgObES7ITyX80hAee-nUxTzhY0/edit
Plano central (21 ações): https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit#gid=27080601

## Inventário e decisões

O produto já contém CR, Viewer, Review, Apply e inbox. Foram examinadas as branches históricas de lifecycle e Large Apply. A migration histórica 0021 foi adaptada: os triggers que fechavam o chamado foram excluídos. As migrations 0021/0022/0023 não são dependências a aplicar por inferência.

No run 36345128266, 0030 foi aplicada e pós-validada, mas 0020_project_change_requests.sql permanecia pendente no ledger. A ausência do ledger não prova ausência das tabelas. O schema remoto precisa de auditoria antes de qualquer SQL. Não houve acesso remoto a D1, alterações de flags ou execução de migrations nesta entrega.

## Implementação

- Contexto de projeto local à requisição; membership organizacional e vínculo real ao projeto verificados antes de usar permissões. Não altera a organização ativa persistida da sessão. Super admin conserva sua regra explícita.
- Vínculos muitos-para-muitos entre chamados e registros de mudança, com unicidade, versão, desvinculação e histórico. Leitura do chamado e do CR não concede Review/Apply. Revalidação em cada leitura/mutação; inbox de Review oculta metadados de chamados sem ticket.view/ACL.
- Registro geral tipado platform/database, proposta versionada, pedido de informações, reenvio, planejamento, aprovação/rejeição e evidência HTTPS de entrega externa. Neste incremento, operações gerais são restritas a super admin. Não há executor de SQL/código ou concessão de acesso.
- MapConfig referencia o CR técnico em relação 1:1. Estado, decisão e revisão aplicada são canônicos no CR, sem uma segunda aprovação no registro geral.
- Lifecycle CR com CAS, journal transacional, decisões imutáveis e applied_revision persistida. Pedido de informações bloqueia aprovação; reenvio cria novo CR imutável, preserva lineage e vínculos autorizados. A interface permite complementar justificativa e reenviar as operações originais; para alterar operações, usa-se uma nova working copy no Viewer e o contrato supersedes.
- Ambos os submitters de CR são cobertos pelos triggers de criação e pelo adapter de reenvio.
- Reconciliação lê o estado canônico atual; eventos atrasados não regridem a projeção. Divergências ficam registradas. Histórico completo fica no journal; notificações de progresso podem agregar transições intermediárias numa atualização genérica, sem expor conteúdo do CR.
- Consumidor scheduled sem endpoint público: OFF por padrão, organizações/ator explícitos, lote padrão10/máximo25, máximo5 tentativas e backoff limitado. Reprocessamento manual autenticado/auditado. Falha não perde o progresso canônico.
- Ticket permanece independente: CR aplicado/rejeitado não fecha atendimento. Encerramento com mudança pendente requer ciência explícita, além dos requisitos de resultado/comunicação da CC-03.
- Aprovação e Apply são ações separadas. Para o novo transporte, a aprovação fixa hash/tamanho/base da proposta. Apply confere o artefato e usa o pipeline de save em blocos, com token de lineage no ledger. Retry retorna a revisão publicada original mesmo se o projeto já avançou. READY sem published_at ou com lineage de outro writer não comprova aplicação.
- Bases acima de12MiB não entram no parser integral do Worker. O navegador prepara o artefato com o motor existente; o Worker recebe blocos e verifica integridade. Limite de transporte100MiB.

## Validação

Os comandos e resultados finais estão em EVIDENCIAS.md. O ensaio de90MiB usa o pipeline real de revisão/SQLite, com Dropbox simulado, chunks de até4MiB e checksum divergente rejeitado antes de publicação. Não é medição de orçamento real de memória/CPU/D1 em Cloudflare nem acceptance autenticado.

## Migration e ativação

Candidata: 0031_ticket_change_reconciliation.sql. Pré-requisitos: schema0020 compatível,0026/27/28/30. A migration adiciona lifecycle/journal/artefatos, registros gerais, vínculos, lineage, filas e guards. Instalar estes guards exige o writer compatível desta entrega. Manter revisão/Apply bloqueados operacionalmente durante a janela e coordenar o deployment.

1. Revisar a PR, CI e código; merge somente depois dos gates de código.
2. Executar o operador protegido existente em audit para0031. O preflight novo consulta somente sqlite_schema e ledger. Se0020 estiver pendente ou houver expansão0021/22/23/guards legados, grava relatório bloqueado e não emite aprovação.
3. Conferir esse relatório. Auditar0020 separadamente e comparar o schema real; não assumir que IF NOT EXISTS repara divergências. Qualquer adaptação demanda nova revisão. Não executar0031 para contornar o ledger.
4. Após resolver o pré-requisito, repetir audit0031: report, hash, SHA, identidade D1, integridade e bookmark. Aplicar somente após autorização humana específica, pelo Environment production-d1-migrations. O executor recusa drift de schema desde o audit.
5. Pós-validar ledger, quick_check e foreign_key_check. Registrar o bookmark no controle.
6. Preparar e publicar o Worker a partir do exemplo TOML, com flags OFF. Confirmar SHA/binding/cron. Não executar o exemplo automaticamente.
7. Registrar suíteCC08 no Production Acceptance Operator. A PR201 ainda estava aberta na verificação de27/09; a suíteCC08 não é entregue/registrada por esta PR. Fazer preflight, QA sintético e janela aprovada; medir memória/CPU/D1/latência/lag, inclusive falhas/retry90MiB e isolamento real.
8. Cleanup, restauração OFF e evidência por SHA/deployment. Decisão de rollout permanente separada; dependências CC03/04/05/07 continuam com seus próprios aceites.

Flags (OFF por padrão): MAONO_TICKET_CHANGES_ENABLED e MAONO_CHANGE_RECONCILIATION_ENABLED. Para canário, configurar MAONO_RUNTIME_ENV=production, MAONO_TICKET_SELECTIVE_ACCESS_ENABLED conforme aceite, MAONO_CHANGE_RECONCILIATION_ORGANIZATION_IDS e MAONO_CHANGE_RECONCILIATION_ACTOR_ID (super admin ativo). As notificações continuam submetidas às flags/cutoff/allowlist da CC07. Preview/ambiente desconhecido recusam operações da CentralCC08.

## Recuperação

Desligar consumidor e interface; preservar journal, vínculos e outbox. Não remover schema nem voltar a writers de lifecycle antigos sem revisão de compatibilidade. Retry de Apply utiliza o artefato fixado, checksum e ledger publicado; não atribuir revisão com base apenas no head atual. Estados históricos applied sem applied_revision confiável precisam reconciliação operacional baseada em evidência, nunca preenchimento pelo head atual.

## Pendências que impedem encerramento

- Auditoria real do schema CR/ledger0020 e decisão sobre pré-requisitos.
- Merge, migration0031 protegida, pós-validação e deployment identificado.
- Provisionamento/validação do Worker cron e das variáveis de canário.
- Registro/execução da suíte autenticadaCC08 e aceites herdados.
- Medições reais de orçamento, chaos/recovery, cleanup/restauração e decisão de rollout.
- Revisão humana dos privilégios de registros gerais (super admin nesta versão), UX e critérios de liberação.
