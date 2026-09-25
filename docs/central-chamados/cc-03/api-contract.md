# CC-03 — contratos de comandos e jornada

Este contrato complementa a [baseline CC-01](../cc-01) e a [triagem CC-02](../cc-02). A implantação depende da 0026, da reconciliação explícita por organização e das duas flags habilitadas. A flag de comandos tem padrão `false`.

## Superfície HTTP

Prefixo organizacional: `/api/organizations/:id/tickets`.

| Método e recurso | Entrada adicional | Permissão atual | Resultado |
|---|---|---|---|
| POST `/` | `Idempotency-Key`, conteúdo da criação CC-02, `nextAction` opcional | `ticket.create` | 201, Ticket e `Idempotency-Replayed` |
| GET `/:ticketId/state` | — | `ticket.view` | 200 `{ok:true,state}`, ETag forte |
| PATCH `/:ticketId` | `If-Match`, atributos/triagem/próxima ação | `ticket.manage` | 200, Ticket atualizado |
| POST `/:ticketId/transitions` | `If-Match`, `status`, próxima ação ou fechamento | `ticket.manage` | 200, Ticket atualizado |
| POST `/:ticketId/waits` | `If-Match`, `action:start/end`, campos da espera | `ticket.manage` | 200, Ticket atualizado |
| POST `/:ticketId/reopen` | `If-Match`, `reason`, `nextAction` | `ticket.manage` | 200, Ticket em novo ciclo |
| POST `/:ticketId/events/:eventId/corrections` | `If-Match`, `reason`, `correction` | `ticket.manage` | 200, novo evento corretivo |

As mutações retornam `{ok:true,ticket}`. O Ticket inclui `version`, `etag`, `cycle`, `wait`, `closure` e `nextAction`. O detalhe inclui `lifecycleEnabled`, `closureHistory` e `hasPendingChange`. A rota de correção usa o ID do caminho, nunca um ID substituído no corpo. Método incompatível retorna 405 e `Allow`.

IDs organizacionais são conferidos antes de expor dados. A CC-03 preserva o gate de gestão existente; não concede `ticket.close`, `ticket.assign`, reabertura própria nem ACL de objetos por inferência. Essa evolução é a CC-04. O indicador de CR pendente é somente booleano: não inclui identificadores ou conteúdo do CR e não concede Review/Apply.

## Idempotência e concorrência

A chave de criação tem até 200 caracteres e escopo `(organização, ator, operação, chave)`. O fingerprint SHA-256 usa o JSON com chaves ordenadas recursivamente; ordem de arrays e diferenças de conteúdo permanecem significativas. A resposta, com o estado e a apresentação observados na criação, é persistida no mesmo batch. Retry com a mesma intenção devolve esse resultado original, mesmo após uma edição posterior. Chave reutilizada com outro conteúdo retorna 409. Outra organização ou ator tem um escopo independente.

O cliente congela chave e payload antes do primeiro envio. Falha de rede, cancelamento, resposta incompleta ou erro de servidor conserva a intenção, inclusive ao fechar/reabrir o formulário. Uma rejeição definitiva permite iniciar outra intenção por ação explícita. Não há retry automático que altere o conteúdo.

`/state` contém IDs e dados canônicos do Ticket, classificação, versão, ciclo, espera e conclusão. Seu ETag forte é o hash dessa representação. Nomes de usuários, anexos, eventos avulsos e links CR autorizados enriquecem outras representações e não integram esse recurso. O envelope de detalhe **não** recebe um ETag que pretenda validá-lo; fornece somente o token opaco de escrita e é `private, no-store`.

`If-Match` deve conter exatamente o token opaco recebido. Wildcard, lista, ETag fraco, token de outro Ticket ou versão antiga são recusados. A comparação é revalidada por CAS (`version`) no UPDATE do banco. Cada comando vencedor incrementa a versão; uma correção também é comando versionado e troca o token. Não derivar a contagem de eventos da versão: a criação publica a versão 2 após atribuir o código definitivo dentro da mesma transação.

| Condição | HTTP | Comportamento |
|---|---|---|
| Criação sem chave ou conteúdo inválido | 400 | Nenhum comando persistido |
| Mutação sem `If-Match` | 428 | Requer leitura do estado |
| Versão desatualizada / CAS perdedor | 412 | Nenhum evento, auditoria de sucesso ou outbox do perdedor |
| Chave reaproveitada com outro conteúdo | 409 | Não retorna a resposta da intenção anterior |
| Transição inválida / espera incompatível / CR pendente sem ciência | 409 | Corrigir intenção ou consultar estado |
| Flags, schema ou backfill indisponíveis | 503 | Sem fallback de escrita dos comandos |
| Sem permissão | 403 | Registro de negação pode existir; não é sucesso do comando |

Após 412/428, a interface conserva o rascunho e o token antigo. Consultar a versão atual não troca silenciosamente o token do rascunho: o usuário compara a situação e escolhe explicitamente adotar a versão antes de reaplicar.

## Estados, espera e reabertura

| Origem | Destino | Exigência |
|---|---|---|
| `new` | `open` | Triagem humana, responsável válido, próxima ação |
| `open` | `in_progress` | Responsável válido e próxima ação |
| `in_progress` | `open` | Responsável válido, motivo e próxima ação |
| `in_progress` | `in_review` | Responsável válido, resultado/evidência e próxima ação |
| `in_review` | `in_progress` | Responsável válido, motivo e próxima ação |
| Qualquer não concluído | `closed` | Resultado, resumo, evidência e comunicação registrada; ciência explícita quando CR pendente |
| `closed` | `open` | Comando de reabertura, motivo e próxima ação; cria outro ciclo |

O responsável atual acompanha a verificação nesta etapa. Filas, WIP, seleção de verificadores e coordenação ampliada pertencem à CC-09. Um PATCH genérico não altera o estado; usar o comando correspondente.

Fechamento recebe `closure:{outcomeCode,summary,evidence,communication,pendingChangeAcknowledged}`. Resultados: `resolved`, `answered`, `fulfilled`, `rejected`, `duplicate`, `withdrawn`, `no_action`. Não exigir execução fictícia para recusa, duplicidade ou desistência; exigir justificativa verificável. Resumo/evidência/comunicação aceitam até 2.000 caracteres cada. O registro de comunicação é declaração do atendimento, não prova de e-mail enviado. O fechamento não aprova, aplica, rejeita ou cancela um CR.

Espera é um intervalo, não um sexto estado. Início exige `reason`, `responsibleId` organizacional ativo e `nextAction`; `expectedAt` é opcional. Término exige próxima ação e aceita motivo opcional. Motivo/próxima ação: até 1.000 caracteres. Só uma espera ativa por Ticket; concluir encerra a espera preservando o intervalo. Esperar não pausa SLA automaticamente.

Tickets novos começam com ciclo observado desde a criação. Dados antigos/CR mantêm ciclo zero até uma ação efetivamente observada; a primeira mutação de um Ticket não concluído registra `observed_baseline`. Não reconstruir ciclos históricos, primeira resposta ou duração a partir de datas incompletas. Reabertura conserva conclusões anteriores, sem reescrever o ciclo encerrado.

## Consistência e armazenamento

`organization_tickets` mantém projeção atual e versão. `ticket_cycles` preserva os ciclos; `ticket_wait_intervals`, os intervalos. `ticket_commands` guarda intenção/fingerprint/resultado. `ticket_events` e `audit_logs` recebem os registros obrigatórios. `ticket_command_outbox` guarda intenção de processamento posterior; a CC-07 implementará o consumidor, suas permissões e entrega.

O batch D1 contém a mutação, atualizações de ciclo/espera, comando, evento, auditoria e outbox. O token do comando vencedor condiciona todas as inserções relacionadas. Falha em qualquer statement desfaz o batch; não basta capturar um erro de auditoria e retornar sucesso.

Triggers bloqueiam UPDATE/DELETE de eventos e da auditoria `ticket.*`. Correção insere `ticket.event.corrected` referenciando o evento original no mesmo Ticket/organização. Isso protege a trilha pelas operações normais do banco; não é garantia contra um administrador que altere schema/triggers. Retenção, redação de dados e tombstones exigem política explícita. Exclusões em cascata/`SET NULL` podem ser bloqueadas pelos guards: não usar hard delete de usuário/organização/Ticket como rotina de recuperação.

## Exemplo de jornada

1. Criar uma Dúvida sobre exportação com chave estável, resultado esperado e responsável. A natureza descreve o trabalho; `category:export` descreve o domínio.
2. Ler o token e passar de Novo para Aberto com próxima ação “Conferir o formato solicitado”.
3. Iniciar atendimento e registrar espera pelo arquivo do solicitante, indicando quem acompanha. Encerrar espera quando o arquivo chegar; não computar pausa de SLA por inferência.
4. Registrar resultado para verificação, depois concluir como `answered`, com evidência e comunicação. Se houver CR pendente, registrar ciência sem mudar o CR.
5. Se o mesmo problema retornar, reabrir com motivo em outro ciclo. O encerramento anterior continua disponível no histórico.
6. Um segundo atendente com token antigo recebe 412; seu rascunho permanece até comparar e adotar explicitamente o estado atual.

## Evoluções preservadas

Os dois writers atuais de CR permanecem compatíveis com defaults e sem classificação/ciclos inventados. Eles ainda não usam integralmente a transação de comandos; adapter e reconciliação são CC-08. Anexos/Dropbox têm protocolo próprio, tratado na CC-06. Métricas e SLAs devem consumir eventos observados, com políticas/calendários versionados nas CC-10–12; atribuição e importação não são primeira resposta.
