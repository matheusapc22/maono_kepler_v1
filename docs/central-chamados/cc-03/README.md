# CC-03 — transições, concorrência e trilha consistente

## Atualização operacional de 25/09/2026

O usuário confirmou a **migration 0026 em produção**, no D1 `maono_maps` (`5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`): ledger ID 20, `applied_at = 2026-09-25 17:10:33` UTC, `foreign_key_check` vazio e `quick_check = ok`. É confirmação do operador, não leitura remota feita nesta entrega. A confirmação se refere à **migration, não ao merge**: a PR #196 continua em revisão. Dev e Preview exigem evidências próprias.

O próximo gate é o inventário e a reconciliação por organização. O [operador remoto](remote-operator-runbook.md) acrescentado à mesma PR usa o binding D1 nativo por um processo local autenticado, sem publicar endpoint. Mantém inventário como padrão, aplicação explícita por organização e relatórios de execução. O [aceite do operador](operator-acceptance.md) e a [revisão](operator-review.md) complementam as evidências históricas abaixo. Não reaplicar a 0026 em produção; não habilitar flags antes dos gates restantes.

## Base e confirmação recebida

A [PR #195](https://github.com/matheusapc22/maono_kepler_v1/pull/195), CC-02, foi mergeada em `mano_kepler_v1` em 25/09/2026 às 13:15:15 BRT. Base desta entrega: `ddaabcb1ea6038b62da9d90a7d1acd20634bd236`. Branch de implementação: `feat/cc-03-ticket-command-lifecycle`.

O usuário confirmou em 25/09/2026 que a **0025 foi aplicada e validada**, sem afetar 0021/0022/0023. Essa confirmação está registrada no [controle](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit). Não foram informados ambiente, binding, database ID ou ativação da flag; não atribuímos esse relato a todos os ambientes nem alegamos leitura independente do D1.

## Plano técnico e rastreabilidade

| Requisito | Implementação neste lote | Aceite |
|---|---|---|
| REQ-CC-05 | Matriz explícita dos cinco estados, fechamento fundamentado e novo ciclo ao reabrir | CT-06; integração CR ampliada continua CT-29/CC-08 |
| REQ-CC-06 | Espera como intervalo: motivo, responsável, início/fim e próxima ação | CT-06; não criar sexto estado nem pausar SLA automaticamente |
| REQ-CC-07 | Chave de criação por organização/ator/operação, fingerprint e resposta persistida | CT-07/08: replay não duplica; divergência não retorna resultado alheio |
| REQ-CC-08 | Representação canônica de estado, ETag forte e CAS versionado no banco | CT-09: 428 sem precondição, 412 para versão desatualizada |
| REQ-CC-09 | Mutação, evento, auditoria obrigatória e intenção durável na mesma transação D1 | CT-09/10/49: nenhum efeito perdedor; rollback de cada statement; correção por novo evento |
| REQ-CC-10 | Job de importação reexecutável, contagens conciliadas e cutover explícito | CT-49: sem duplicação e sem importação em GET após cutover |

## Contratos de implementação

- `MAONO_TICKET_COMMANDS_ENABLED` fica **desabilitada por padrão**. O caminho atual da CC-02 continua disponível antes do cutover. Ativar os comandos requer schema íntegro, classificação disponível e importação conciliada da organização.
- A criação recebe `Idempotency-Key`; a intenção de retry usa a mesma chave e o mesmo conteúdo. Editar atributos ou executar uma transição exige `If-Match` do estado lido pelo cliente. Conflitos preservam o rascunho e exigem revisão explícita antes de reaplicar.
- `/api/organizations/:id/tickets/:ticketId/state` representa somente os dados canônicos de estado do Ticket. Seu ETag não pretende validar o envelope de detalhe, que contém nomes de pessoas, anexos e vínculo CR autorizado. O detalhe fornece o token opaco de escrita e permanece `private, no-store`.
- Transições, espera, reabertura e correção de evento têm comandos explícitos. O domínio valida pré-condições antes de montar a transação; efeitos duráveis são condicionados ao comando vencedor no próprio SQL.
- Importação e writers atuais de CR preservam procedência legada e ausência de histórico conhecido. Não fabricar natureza, primeira resposta ou ciclos antigos a partir do estado atual.
- O registro da comunicação de fechamento é evidência inserida no chamado pelo atendimento; não se declara envio de e-mail, notificação entregue ou resposta do solicitante sem evidência. Conversas e notificações completas pertencem às CC-05 e CC-07.
- Todos os comandos de gestão preservam `ticket.manage` organizacional. Permissões por ação, reabertura própria e ACL privada são evolução da CC-04. Vínculos não concedem permissão de Review/Apply.

## Sequência de execução

1. Confirmar base, escopo dos seis requisitos/seis testes próprios e compatibilidade com os dois writers de CR.
2. Criar expansão SQL revisável e o núcleo de comandos, incluindo idempotência, CAS, ciclos/esperas, auditoria e intenção durável.
3. Integrar rotas e cliente, com tokens opacos e preservação de intenção/rascunho.
4. Implementar backfill explícito e reconciliação; o modo pós-cutover não usa leituras como gatilho de importação.
5. Validar SQL real, cada ponto de falha transacional, concorrência, autorização das rotas, fronteiras de compatibilidade e jornada no navegador.
6. Publicar o lote consolidado e registrar PR/SHA/CI/evidências no controle. Aceite técnico não substitui ativação, QA autenticado ou produção.

## Nova migration e ativação

**Registro da entrega inicial:** `0026_ticket_command_lifecycle.sql` era necessária e sua aplicação remota não havia sido executada nesta tarefa. A confirmação posterior de produção está na atualização operacional acima; os demais ambientes continuam independentes.

Antes de ativar, identificar o banco/ambiente real, revisar checksum e recuperação, aplicar isoladamente a 0026 pelo processo autorizado, executar e conciliar o backfill e validar os clientes. Preview não prova isolamento de produção. Não aplicar pendências em massa e não alterar 0021/0022/0023 como efeito desta entrega.

Rollback do rollout começa pela desativação dos comandos no ambiente autorizado. Tickets com ciclo já adotado ficam sem edição de core até a reativação, para impedir que o fluxo anterior sobrescreva seu histórico. Preservar registros e colunas aditivos; não apagar histórico, ciclos ou resultados idempotentes. Retenção/redação e recuperação de dados requerem política e operação separadas.

Documentos para revisão: [contratos e jornada](api-contract.md), [implantação e rollback](migration-runbook.md), [backfill](backfill-runbook.md), [revisão independente](review.md) e [aceite técnico](acceptance.md).

## Limites preservados no roadmap

Veja [roadmap-alignment.md](roadmap-alignment.md). O grafo das próximas PRs permanece: ACL e ações granulares CC-04; conversas CC-05; protocolo e publicação de anexos CC-06; consumidor autorizado da outbox CC-07; integração e reconciliação CR CC-08; filas/WIP CC-09; SLA CC-10. Esta PR entrega a transação dos comandos do Ticket, sem prometer atomicidade com Dropbox ou com Apply, nem inviolabilidade contra um administrador do banco.
