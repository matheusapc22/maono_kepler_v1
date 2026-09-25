# CC-03 — implantação, validação e rollback

## Estado desta entrega

A 0025 foi confirmada pelo usuário como aplicada e validada em 25/09/2026, sem impacto em 0021/0022/0023. O relato não identifica ambiente, binding, database ID ou flags. Não executar nem reaplicar pendências por inferência.

A **0026_ticket_command_lifecycle.sql é nova**. Este lote desenvolve e testa sua aplicação local. Nenhuma execução D1 remota, modificação de flags, autorização de produção ou QA autenticado faz parte das evidências locais. O hash exato do arquivo consta em `evidence/manifest.json` ao consolidar a entrega.

## Preparação por ambiente

1. Registrar ambiente, conta, binding `DB`, database ID, SHA do código e operador no controle. Conferir a identidade por leitura independente antes de qualquer escrita autorizada.
2. Conferir ledger real e schema da 0010/0025, incluindo constraints da triagem. A 0026 também usa `audit_logs`; não criar sucesso sem essa tabela. A presença de `schema.sql` no repositório não é ledger do D1.
3. Obter backup/restore point e definir restauração verificada. Identificar escritores legados e ambas origens de Ticket por CR. Evitar escrita legada durante a reconciliação final.
4. Revisar SQL/checksum e os efeitos permanentes dos guards de histórico. A migration é aditiva, sem inferir natureza, ciclos antigos, espera ou primeira resposta. Sua reexecução não é idempotente (`ALTER TABLE`); uma aplicação parcial exige inventário antes de retomar.
5. Obter a autorização de aplicação no alvo real. Aplicar somente a 0026 pelo procedimento do operador. Não usar comando que execute automaticamente todas as migrations pendentes; 0021/0022/0023 não pertencem a esta mudança.

## O que muda no schema

| Grupo | Mudança |
|---|---|
| Ticket | Versão, ID do último comando, projeções de ciclo/espera/conclusão, próxima ação e tombstone |
| Histórico | Referência de comando/versão/correção nos eventos; guards append-only |
| Ciclos e espera | Tabelas e vínculos organizacionais, uma espera ativa por Ticket |
| Idempotência | Ledger de comandos, chave única por organização/ator/operação, fingerprint e resultado persistido |
| Entrega posterior | Outbox com evento/intenção durável, sem consumidor nesta PR |
| Cutover | Marcadores de reconciliação por organização, contagens, execução e status |
| Compatibilidade | Trigger incrementa versão em alterações de core por escritores antigos; outro guard impede transição antiga em ciclo adotado |

Confirmar tabelas, colunas, índices e triggers contra o arquivo versionado. Validar `PRAGMA foreign_key_check` e integridade na cópia/local; no D1 usar as consultas suportadas pelo operador. Conferir zero perda de Tickets/eventos/anexos/CR e a preservação de defaults para escritores antigos.

## Reconciliação e ativação

Seguir [backfill-runbook.md](backfill-runbook.md). O CLI entregue ensaia em SQLite local explícito; a biblioteca de job usa `env.DB` e pode ser chamada pelo operador D1 controlado. **Não foi entregue nem implantado um endpoint público de importação ou um canal remoto de operador.** Esse canal precisa revisão operacional antes da ativação remota. Um relatório local não grava o marker remoto.

O job deve ser executado explicitamente para cada organização alcançada, inclusive quando a fonte `tickets` não existir. Exigir `ready`, schema version 1, zero pendências/skips e data de conclusão. Verificar a segunda execução sem novas linhas/eventos. Falhas parciais preservam somente linhas completas; corrigir a causa e retomar, sem apagar a fonte.

Habilitar `MAONO_TICKET_TRIAGE_ENABLED=true` e só então `MAONO_TICKET_COMMANDS_ENABLED=true`, no ambiente autorizado, após a reconciliação. Ausência de flag significa comandos desabilitados. Não ativar em Preview por considerá-lo isolado: verificar o binding efetivo e a política de escrita do Preview.

A flag é por ambiente; portanto **todas as organizações alcançadas precisam de marker**, não somente a usada no teste. Uma organização criada depois da ativação também exige reconciliação explícita. A CC-18 deve incorporar esse passo ao procedimento operacional de onboarding. Um legado novo sem correspondência canônica faz o gate falhar; GET não importa essa linha.

## Validação autenticada no alvo autorizado

- Conferir capabilities, `private, no-store`, leitura organizacional permitida e negação cruzada.
- Abrir um Ticket com chave, repetir a mesma intenção e comprovar uma criação; divergência deve dar 409.
- Executar triagem, assumir atendimento, espera/retomada, verificação, fechamento fundamentado e reabertura. Conferir ciclo anterior intacto.
- Enviar duas alterações com a mesma versão: uma vence, outra recebe 412 sem eventos/intenção de envio do perdedor. Sem token: 428.
- Conferir criação de evento, auditoria e outbox juntos; simulação de falha deve ser feita somente em ambiente descartável controlado.
- Verificar que concluir Ticket com CR pendente exige ciência e não altera aprovação/aplicação do CR.
- Confirmar leitura sem DML após cutover; inspecionar fila da outbox sem confundir intenção pendente com notificação enviada.
- Conferir clientes antigos e os dois writers CR; Tickets originados deles continuam sem classificação/ciclos inferidos.

Registrar operador, horário, identidade do banco, SHA, casos executados e evidências na planilha. Resultado local/CI ou publicação Pages não substituem essa etapa.

## Rollback e preservação

Primeiro interromper a ativação dos comandos no ambiente autorizado. Chamados com ciclo adotado ficam **sem edição de core** enquanto a flag estiver desligada; leituras permanecem disponíveis. Chamados ainda sem ciclo mantêm o caminho CC-02. Isso evita que o fluxo anterior reabra/feche um Ticket sobrescrevendo a conclusão já registrada.

Clientes com uma intenção idempotente ou token `If-Match` não podem cair silenciosamente no caminho antigo. Requisições desses clientes falham fechadas até restabelecer a capacidade; não trocar a chave para contornar indisponibilidade. Um rollback de código precisa preservar esse guard/read-only: não restaurar um writer anterior irrestrito depois de adotar ciclos. A barreira SQL também impede transições legadas em ciclos adotados, mas não substitui o procedimento completo de recuperação.

O rollback da flag **não remove os efeitos do schema**. Guards de eventos/auditoria podem bloquear hard delete de usuário/organização/Ticket porque cascatas ou `SET NULL` tentariam editar a trilha. Usar desativação de usuário e preservar identidade. Não remover triggers para liberar exclusões; retenção/redação/tombstones requerem decisão e operação próprias. A interface administrativa recebe conflito acionável para a preservação de histórico.

Preservar colunas e tabelas aditivas, comandos, ciclos, intervalos e outbox. Não fazer down migration destrutiva. Se for necessária restauração integral, reconciliar tudo que foi gravado após o restore point, com aprovação específica; backup antigo pode eliminar atendimento real. Retomar somente após resolver a causa, reconciliar markers e repetir os casos afetados.

## Saída e monitoramento

Acompanhar erros 503 de readiness, conflitos 412, colisões de chave 409 e quantidade/idade da outbox pendente. A CC-07 implementará o consumidor e o monitoramento de entrega; SLAs/KPIs serão definidos nas CC-10–12. Não converter automaticamente espera em pausa, atribuição em resposta ou conclusão técnica em aceite do solicitante.

Encerrar a entrega na planilha somente quando review, CI, QA autenticado, migrations por ambiente e aceite/deploy exigidos estiverem comprovados. PR mergeada não significa feature ativada.
