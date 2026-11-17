# Exclusão de organização: continuação automática

## Contrato

Uma confirmação registra a operação e, se `ORGANIZATION_DELETE_AUTOMATIC_ENABLED=true` no Pages, um evento `automatic_requested` na mesma transação. O Worker agendado a cada minuto procura somente operações com esse evento. Não cria exclusões e não adota solicitações antigas. A organização MRA 2 e qualquer operação anterior continuam no fluxo de recuperação manual, sem mudança por esta entrega.

O executor reutiliza `stepDeletion`, com lease e verificações de identidade Dropbox, exclusividade, dependências, autorização e finalização atômica. A autorização consulta novamente o usuário original ativo e super_admin antes das fronteiras destrutivas; nenhuma sessão do navegador é armazenada. Fechar a aba não cancela uma operação aceita.

A espera de drenagem de dois minutos é preservada. Após ela, a execução deve começar no próximo tick, normalmente até mais um minuto, além do tempo do provedor. Não é uma promessa de SLA nem de exclusão instantânea. Interface consulta status sem POST automático. Erros de segurança exigem revisão; falhas do provedor têm no máximo três tentativas, separadas por pelo menos dois minutos. O orçamento contabiliza tentativas manuais anteriores também.

## Implantação controlada (não realizada nesta PR)

1. Revisar/testar a PR. Não é necessária nova migration: usa ledger e tabela de auditoria existentes.
2. Provisionar Worker `workers/organization-deletion.js` com binding D1 correto e os segredos Dropbox existentes, usando `wrangler.organization-deletion.toml.example`. Conferir conta, nome e UUID, sem criar/excluir banco. Flags desligadas por padrão.
3. Validar em ambiente isolado: confirmação única, aba fechada, drenagem, execução repetida, revogação de autor, falha do provedor, isolamento de operação anterior. Confirmar cron funcionando antes de habilitar aceitação no Pages.
4. Publicar código Pages e Worker. Somente após verificar trigger/configuração, habilitar `ORGANIZATION_PERMANENT_DELETE_V1` e `ORGANIZATION_DELETE_AUTOMATIC_ENABLED` no Worker; depois habilitar a segunda no Pages. A flag original Pages mantém sua política existente.
5. Verificar uma nova operação explicitamente autorizada. Não converter pendências existentes por SQL. Acompanhar logs e auditoria; desligar flag automática no Pages e Worker interrompe novos ticks/inscrições, mas não cancela etapa já em execução.

## Limites

Flags do Pages e Worker são independentes: divergir configurações pode deixar operação pendente. Implantação deve verificar ambas. O relógio do cron não substitui observação de falhas. O ledger é a fonte de verdade; ausência de resposta HTTP não deve causar nova solicitação. Incidentes não transitórios ficam bloqueados, nunca em repetição destrutiva infinita.

Não alterar nem excluir `maono_maps`. Não mudar a política de remoção de organização com dados vinculados. Não mesclar, publicar ou retomar operações reais como efeito dos testes desta PR.

## Verificação desta entrega

Testes de backend exercitam HTTP/autenticação/SQLite e adaptador Dropbox sintético, incluindo concorrência, opt-in, operações antigas, drenagem, revogação, backoff e perda/expiração do lease antes de remover armazenamento. Não se conectam ao Dropbox real. O lease é renovado somente enquanto ainda pertence à execução e permanece vigente, antes de remover e finalizar.

A instalação npm sem lock resolveu `@kepler.gl/duckdb` 3.2.6 e encontrou um erro preexistente de export `SqlPanel`. Para validação local foi usada 3.2.0, versão registrada no yarn.lock, sem alteração dos manifestos. A CI deve ser revisada antes de considerar a PR pronta; não confundir testes locais com implantação do Worker.
