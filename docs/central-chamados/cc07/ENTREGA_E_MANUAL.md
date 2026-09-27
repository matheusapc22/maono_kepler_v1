# CC-07 - Entrega técnica e manual operacional

## Entrega implementada
Branch feat/cc-07-central, baseada em mano_kepler_v1. Data: 27/09/2026.
Implementados: schema aditivo 0030, candidatos transacionais no enqueue, consumidor agendado com CAS/lease e fencing, deduplicação, retries limitados, falhas auditáveis, API de inbox e leitura, central in-app e operação administrativa para super admin.
Sem envio de corpo de mensagem em notificações/logs. Solicitante e responsável são candidatos fixos, excluindo o autor. Acesso seletivo, permissão de leitura e permissão de nota interna são reavaliados no processamento e em cada leitura/contagem. O endpoint original do chamado reautoriza sua abertura.
A PR e os resultados remotos devem ser consultados na planilha de controle. Este documento registra entrega técnica; não declara rollout nem acceptance em produção.

## Evidências locais
26 testes de integração SQLite/HTTP passaram, executando SQL e serviços reais: entrega única, rollback, consumidores concorrentes, lease reclamado/expirado, perda de ACK, revogação, isolamento, nota interna, retry auditado, cutoff, canário e schema completo.
232 regressões de comandos, ACL, conversas e anexos passaram.
23 testes de segurança de Preview passaram; ratchet de mensagens de erro aprovado.
3 testes Chromium locais passaram: teclado, abertura e leitura, paginação, superfície OFF e remoção de conteúdo/contador após refresh. A API da fixture de navegador é simulada; isso não substitui acceptance autenticado em produção.
Typecheck e build de produção aprovados. Build emitiu avisos de dependências e tamanho de chunks já pertencentes à cadeia existente; não houve erro bloqueante.

## Como reproduzir a validação local
Instalar as dependências pelo lockfile do projeto no ambiente de desenvolvimento. Executar na raiz:
- npm run test:ticket-notifications
- node --experimental-strip-types --test tests/ticket-command*.test.mjs tests/ticket-access*.test.mjs tests/ticket-conversation*.test.mjs tests/ticket-attachment*.test.mjs
- npm run test:preview-safety
- npm run build
- npx playwright install chromium
- npx playwright test tests/browser/ticket-notifications.spec.ts --project=chromium
Nenhum desses comandos aplica uma migração remota ou habilita flags.

## Configuração e operação
Modelo: wrangler.ticket-notifications.toml.example. O Worker possui somente scheduled, sem endpoint público de consumo. Configurar cron a cada minuto somente no ciclo de implantação aprovado.
MAONO_RUNTIME_ENV: production no Worker de produção; local nos testes. Preview e runtime desconhecido recusam o consumidor.
MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED: false por padrão; controla processamento.
MAONO_TICKET_NOTIFICATIONS_ENABLED: false por padrão; controla inbox e operação pela aplicação.
MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: pré-requisito obrigatório e schema CC-04 pronto.
MAONO_TICKET_NOTIFICATION_START_AT: timestamp UTC ISO completo, por exemplo formato AAAA-MM-DDTHH:MM:SS.sssZ. Definir o valor real na janela autorizada; nunca recuar para reenviar histórico.
MAONO_TICKET_NOTIFICATION_ORGANIZATION_IDS: IDs explícitos separados por vírgula, até 20; começar pelo escopo QA/canário autorizado. Mesmo cutoff e lista nos bindings da aplicação e do Worker.
Lote padrão 10 eventos (máximo 25); lease 120s; cinco tentativas; backoff inicial 30s com jitter de até 5s, limitado a uma hora. Não aumentar limites sem medir CPU/D1/latência.
As notificações ficam na Central de Chamados, com atualizar, não lidas, marcação de leitura e mais antigas. Clique abre o chamado pela consulta canônica atual. Revalidação visual ocorre ao atualizar, focar a janela e a cada 60 segundos enquanto visível; conteúdo já renderizado não é apagado instantaneamente por revogação remota.
Somente super admin usa Operação de notificações: contagens, idade mais antiga, estados dos destinatários e até 50 falhas. Reprocessar uma falha faz reset das tentativas com audit log atômico; autorização atual e dedup continuam obrigatórias. Não há operação de replay de histórico.

## Migration pendente
Arquivo: 0030_ticket_notifications.sql.
SHA-256: f51481a8ed6798fd5d6f49fd3b87438ba5fbe6ae2683576a32ee277c8302b484.
Finalidade: metadados de lease/retry na outbox, tabela de candidatos, notificações e trigger de snapshot. Nenhum candidato é criado para outbox já existente antes da migration. Eventos futuros elegíveis capturam apenas IDs, mesmo com consumidor OFF.
Banco de produção: maono_maps, UUID 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db. Pré-requisitos: 0026, 0027 e 0028; base inclui 0029.
Situação: validada localmente; NÃO aplicada em produção. O hash acima não é um approval token.
Após merge na branch de produto, executar audit no operador production-d1-migration-operator fixando o SHA mergeado. Reportar ledger, SQL hash, pendências, integridade, bookmark e approval hash. AGENTS.md exige autorização explícita vinculada a esse audit antes de aplicar somente 0030 e pós-validar. Não usar migrations apply remoto sobre a pasta inteira.

## Acceptance e encerramento pendentes
A suite CC-07 ainda precisa ser registrada/revisada no production-acceptance-operator. A integração desse operador (PR #201) é dependência operacional e não foi incorporada silenciosamente nesta PR de produto.
Depois do schema e deployments identificados: preflight, autorização da janela, aprovação do Environment production-acceptance, identidades QA sintéticas e escopo restrito. Credenciais somente no Environment protegido, nunca no chat/runtime.
Provar CT-24, CT-25 e CT-15B no ambiente real; medir latência p95, CPU e D1 rows_read e definir orçamento antes do teste. Confirmar cleanup dos dados sintéticos, restauração das flags e fechamento da janela.
Não há autorização de ativação permanente. CC-06 e os aceites herdados relevantes de CC-03/04/05 continuam com seus próprios gates; não marcar encerrados por esta implementação.

## Pausa, rollback e retomada
Pausar MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED interrompe novos lotes; trabalhos já iniciados podem terminar até expirar o lease. Desligar MAONO_TICKET_NOTIFICATIONS_ENABLED oculta a interface e bloqueia mutações de leitura/retry. Confirmar publicação/configuração efetiva dos dois serviços; somente editar o arquivo exemplo não muda produção.
Manter schema, outbox, candidatos e evidências; não executar down migration ou apagar filas. Corrigir a causa e reprocessar falhas explicitamente mantendo o mesmo cutoff/lista autorizada. A unicidade evita duplicação visível.
Flag OFF não é apagamento de dados nem substituto de controles de confidencialidade. Para incidente de acesso, preservar ACL canônica e manter a leitura de notificações desligada enquanto investiga.
