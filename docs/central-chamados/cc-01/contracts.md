# CC-01 — contratos atuais e alvo da Central de Chamados

## Escopo e evidência

Inventário estático de `mano_kepler_v1` no SHA `eec3a7a8fa78ab259b5522d3531d3cec942cb63f`, em 25/09/2026. [contracts.json](contracts.json) mantém a versão estruturada, fontes relativas ao repositório, métodos e handlers verificáveis. Este documento implementa o desenho de contratos da CC-01; **não implementa novas rotas, permissões, estados ou SQL**. Não comprova schema remoto, produção ou aceite com usuários reais.

Os blocos **Atual** descrevem o código lido. **Proposto** é trabalho das PRs posteriores e deve passar pelos gates indicados. Os cinco estados atuais são preservados; natureza e espera não serão introduzidas como novas colunas de status. A jornada e o protótipo da CC-01 devem usar os mesmos conceitos.

## 1. Atual — modelo, consultas e limites

| Contrato | Valor atual | Fonte |
|---|---|---|
| Estados | new, open, in_progress, in_review, closed | `functions/_lib/ticket-center.js` e `ticket-types.ts` |
| Prioridades | low, normal, high; padrão normal | `normalizePriority` |
| Domínios/categorias | map, database, permission, export, support, other; padrão support | `normalizeCategory` |
| Aliases legados de status | pending→open; progress→in_progress; review→in_review; resolved→closed | `normalizeTicketStatus` |
| Criação | subject/title obrigatório ≤ 160; description/body obrigatório ≤ 5.000; priority/category/dueAt/assignedTo | `validateTicketCreatePayload` |
| Alteração | campos parciais subject/description/status/priority/category/dueAt/assignedTo; desconhecidos ignorados; patch vazio rejeitado | `validateTicketPatchPayload` |
| Responsável | ID positivo de usuário ativo pertencente à organização; null/vazio remove | `validateAssignee` |
| Identificação | inserção em new; código TKT- seguido do ID preenchido até seis dígitos | `createTicket` |
| Intervalo de consulta | from/to filtram due_at; início 00:00:00.000Z/fim 23:59:59.999Z; includeUndated inclui sem prazo | `parseTicketListOptions`, `buildTicketWhere` |
| Paginação | page ≥ 1, limit padrão 50, máximo 100; OFFSET/LIMIT; resposta total/totalPages/hasMore | `listTickets` |
| Facetas | todos os filtros exceto status; por status e vencidos; não representam apenas cartões carregados | `listTickets` |
| Busca/ordenação | q ≤ 160 em code/subject/description; updated_desc/updated_asc/due_asc/priority_desc | `SORT_SQL`, `buildTicketWhere` |
| Rate limit | COUNT anterior à escrita:10 criações e 20 inícios de anexos por usuário/organização em 10 min | `enforceRateLimit` |
| Histórico | GET detalhe retorna até 200 eventos; não é prova de histórico completo ou imutável | `listTicketEvents` |
| Anexos | cinco; 80 MiB/arquivo; 150 MiB/chamado; chunk 8 MiB; multipart 10 MiB;PENDING expira 2 h na checagem de capacidade | constantes/helper de anexos |

O objeto público Ticket expõe id, organizationId, code, subject, description, status, priority, category, dueAt, closedAt, createdAt, updatedAt, createdBy, assignedTo e attachmentsCount. Ainda não contém natureza, objetivo estruturado, versão de concorrência, política SLA, espera/ciclo ou ACL privada. TicketAttachment expõe IDs de organização/ticket/anexo, nome, MIME, tamanho, status, data e uploadedBy; não é URL pública do Dropbox.

Allowlist atual: PDF, PNG, JPG/JPEG, WEBP, CSV, XLS/XLSX, ZIP, DOCX e TXT, com validação de MIME/assinatura onde implementada. JSON/GeoJSON não faz parte. Os limites são bytes binários; textos atuais usam “MB”, mas80 MiB = 83.886.080 bytes e150 MiB = 157.286.400 bytes. Assinatura não é antivirus. PENDING/ACTIVE contam na capacidade; o fluxo consulta soma/quantidade antes de inserir e não prova reserva atômica sob concorrência.

GET lista/detalhe pode chamar migrateLegacyTickets e gravar legado. O helper verifica schema e não aplica migrations. `updateTicket` grava a linha, depois eventos/auditoria; não existe versão/If-Match nem matriz origem/destino nesse PATCH. `closed_at` é setado ao fechar e limpo ao sair de closed. Alteração de Ticket não verifica CR para autorizar status; não confundir esse fato com o contrato futuro de fechamento.

## 2. Atual — contratos HTTP

B = `/api/organizations/:id/tickets`; Q = `/api/projects/:slug/change-requests`. Todos os IDs de rotas Ticket passam por parsePositiveInteger. Sessão/capacidades/contexto e existência do recurso são verificados no servidor; nome do perfil sozinho não é autorização.

### ACT-HTTP-01 · GET `/api/organizations/:id/tickets`

**Fonte:** `functions/api/organizations/[id]/tickets.js` → `onRequestGet`. **Autorização:** ticket.view.

**Entrada:** {"query": ["q", "status", "priority", "assigneeId", "from", "to", "overdueOnly", "sort", "page", "limit", "includeUndated"], "body": null}

**Saída:** {"status": [200], "shape": "{ok,tickets,pagination,facets,range,assignees,attachmentLimits}"}

**Códigos específicos principais:** INVALID_STATUS, INVALID_PRIORITY, INVALID_ASSIGNEE, INVALID_DATE, FIELD_TOO_LONG.

GET chama migrateLegacyTickets e pode gravar legado. Facetas usam os filtros, exceto status; intervalo é due_at em UTC.

### ACT-HTTP-02 · POST `/api/organizations/:id/tickets`

**Fonte:** `functions/api/organizations/[id]/tickets.js` → `onRequestPost`. **Autorização:** ticket.create.

**Entrada:** {"contentType": "application/json", "body": "CreateTicketPayload"}

**Saída:** {"status": [201], "shape": "{ok:true,ticket:Ticket}"}

**Códigos específicos principais:** REQUIRED_FIELD, FIELD_TOO_LONG, INVALID_PRIORITY, INVALID_CATEGORY, INVALID_DATE, INVALID_ASSIGNEE, ASSIGNEE_NOT_IN_ORGANIZATION, TICKET_RATE_LIMITED.

Não lê Idempotency-Key neste fluxo. Insere new; código TKT- com id preenchido até seis dígitos; mutação/evento/auditoria sequenciais.

### ACT-HTTP-03 · GET `/api/organizations/:id/tickets/:ticketId`

**Fonte:** `functions/api/organizations/[id]/tickets/[ticketId].js` → `onRequestGet`. **Autorização:** ticket.view.

**Entrada:** {"body": null}

**Saída:** {"status": [200], "shape": "{ok,ticket,attachments,events,assignees,attachmentLimits,changeRequest}", "headers": {"Cache-Control": "private, no-store"}}

**Códigos específicos principais:** TICKET_NOT_FOUND.

GET também pode importar legado. changeRequest null sem tabela/vínculo ou autorização de Review; link não autoriza. Eventos limitados aos 200 mais recentes no helper.

### ACT-HTTP-04 · PATCH `/api/organizations/:id/tickets/:ticketId`

**Fonte:** `functions/api/organizations/[id]/tickets/[ticketId].js` → `onRequestPatch`. **Autorização:** ticket.manage.

**Entrada:** {"contentType": "application/json", "body": "UpdateTicketPayload"}

**Saída:** {"status": [200], "shape": "{ok:true,ticket:Ticket}"}

**Códigos específicos principais:** TICKET_NOT_FOUND, EMPTY_PATCH, REQUIRED_FIELD, FIELD_TOO_LONG, INVALID_STATUS, INVALID_PRIORITY, INVALID_CATEGORY, INVALID_DATE, INVALID_ASSIGNEE, ASSIGNEE_NOT_IN_ORGANIZATION.

Não exige If-Match/version; valida status-alvo, sem matriz origem/destino. closed_at é preenchido ao fechar e limpo ao sair de closed. Não verifica CR vinculado para autorizar transição.

### ACT-HTTP-05 · GET `/api/organizations/:id/tickets/:ticketId/attachments`

**Fonte:** `functions/api/organizations/[id]/tickets/[ticketId]/attachments.js` → `onRequestGet`. **Autorização:** ticket.view.

**Entrada:** {"body": null}

**Saída:** {"status": [200], "shape": "{ok:true,attachments:TicketAttachment[]}"}

**Códigos específicos principais:** TICKET_NOT_FOUND.

Retorna somente ACTIVE não apagados, no escopo organização/ticket.

### ACT-HTTP-06 · POST `/api/organizations/:id/tickets/:ticketId/attachments`

**Fonte:** `functions/api/organizations/[id]/tickets/[ticketId]/attachments.js` → `onRequestPost`. **Autorização:** ticket.view AND (ticket.create OR ticket.manage).

**Entrada:** {"variants": [{"contentType": "application/json", "body": {"name": "string; fileName aceito como alias", "mimeType": "string; type aceito como alias", "size": "inteiro positivo até 83886080"}}, {"contentType": "multipart/form-data", "body": {"file": "File até 10485760 bytes"}}]}

**Saída:** {"status": [201], "variants": ["{ok:true,attachment,upload:{attachmentId,offset:0,chunkSize,size}}", "{ok:true,attachment}"]}

**Códigos específicos principais:** ATTACHMENT_UPLOAD_FORBIDDEN, TICKET_CLOSED, ATTACHMENT_COUNT_LIMIT, ATTACHMENT_TOTAL_LIMIT, ATTACHMENT_TYPE_NOT_ALLOWED, ATTACHMENT_MIME_NOT_ALLOWED, ATTACHMENT_SIGNATURE_INVALID, ATTACHMENT_EMPTY, ATTACHMENT_TOO_LARGE, ATTACHMENT_FORM_INVALID, ATTACHMENT_REQUIRED, ATTACHMENT_CHUNK_UPLOAD_REQUIRED, TICKET_RATE_LIMITED, ATTACHMENT_UPLOAD_SESSION_INVALID.

Sessão exige storage READY; multipart faz upload completo e assinatura. Início em partes valida metadados e reserva PENDING após checar capacidade; não é reserva atômica. MIME application/octet-stream tem tolerância no caminho JSON que não é idêntica ao multipart.

### ACT-HTTP-07 · PATCH `/api/organizations/:id/tickets/:ticketId/attachments/:attachmentId`

**Fonte:** `functions/api/organizations/[id]/tickets/[ticketId]/attachments/[attachmentId].js` → `onRequestPatch`. **Autorização:** ticket.view AND (ticket.create OR ticket.manage) AND dono da sessão.

**Entrada:** {"contentType": "application/octet-stream", "headers": {"Upload-Offset": "inteiro >=0; cliente envia; parser atual Number(null) aceita 0 quando ausente"}, "body": "bytes; 1..8388608 por chunk"}

**Saída:** {"status": [200], "shape": "{ok:true,attachment:TicketAttachment|null,offset:number,complete:boolean}"}

**Códigos específicos principais:** TICKET_CLOSED, ATTACHMENT_UPLOAD_NOT_FOUND, ATTACHMENT_UPLOAD_FORBIDDEN, ATTACHMENT_UPLOAD_OFFSET_INVALID, ATTACHMENT_UPLOAD_OFFSET_MISMATCH, ATTACHMENT_CHUNK_EMPTY, ATTACHMENT_CHUNK_TOO_LARGE, ATTACHMENT_UPLOAD_SIZE_MISMATCH, ATTACHMENT_SIGNATURE_INVALID, ATTACHMENT_UPLOAD_SESSION_INVALID.

Assinatura verificada no primeiro chunk; offset salvo em dropbox_rev enquanto PENDING. Erro de offset possui expectedOffset internamente, mas serializador Ticket não expõe campo estruturado extra. Não há endpoint HEAD atual nem retomada persistida no cliente; não alegar conformidade tus.

### ACT-HTTP-08 · DELETE `/api/organizations/:id/tickets/:ticketId/attachments/:attachmentId`

**Fonte:** `functions/api/organizations/[id]/tickets/[ticketId]/attachments/[attachmentId].js` → `onRequestDelete`. **Autorização:** ticket.view AND (ticket.manage OR autor elegível do anexo).

**Entrada:** {"body": null}

**Saída:** {"status": [200], "shape": "{ok:true,deleted:true}"}

**Códigos específicos principais:** TICKET_NOT_FOUND, ATTACHMENT_NOT_FOUND, ATTACHMENT_DELETE_FORBIDDEN.

Autor pode cancelar seu PENDING mesmo em ticket fechado; remover ACTIVE próprio apenas enquanto aberto. Gestor pode remover ACTIVE fechado; exclusão ACTIVE exige storage READY. PENDING vira FAILED; ACTIVE vira DELETED; segunda exclusão não é comprovadamente idempotente e pode retornar 404.

### ACT-HTTP-09 · GET `/api/organizations/:id/tickets/:ticketId/attachments/:attachmentId/download`

**Fonte:** `functions/api/organizations/[id]/tickets/[ticketId]/attachments/[attachmentId]/download.js` → `onRequestGet`. **Autorização:** ticket.view.

**Entrada:** {"body": null}

**Saída:** {"status": [200], "shape": "stream binário", "headers": "fileDownloadHeaders: Content-Type, Content-Disposition attachment e Cache-Control private/no-store"}

**Códigos específicos principais:** TICKET_NOT_FOUND, ATTACHMENT_NOT_FOUND.

Exige ACTIVE e storage READY; verifica organização/ticket/anexo e registra download na auditoria.

### ACT-HTTP-10 · GET `/api/projects/:slug/change-requests`

**Fonte:** `functions/api/projects/[slug]/change-requests.js` → `onRequestGet`. **Autorização:** sessão + projeto autorizado + project.view + filtro requested_by_user_id.

**Entrada:** {"query": ["limit"], "body": null}

**Saída:** {"status": [200], "shape": "{ok:true,items:ProjectChangeRequest[]}"}

**Códigos específicos principais:** PROJECT_NOT_FOUND, PROJECT_VIEW_FORBIDDEN, PROJECT_CHANGE_REQUEST_SCHEMA_OUTDATED.

Lista próprias solicitações; limite padrão 50, clamp1..100; não é inbox geral.

### ACT-HTTP-11 · POST `/api/projects/:slug/change-requests`

**Fonte:** `functions/api/projects/[slug]/change-requests.js` → `onRequestPost`. **Autorização:** sessão + projeto autorizado + project.view + rota efetiva Viewer.

**Entrada:** {"contentType": "application/json", "headers": {"Idempotency-Key": "obrigatória; máximo200 caracteres"}, "body": {"baseRevision": "inteiro >=0", "reason": "texto obrigatório até2.000", "operations": "1..100 operações tipadas; cada JSON normalizado até262144 bytes"}}

**Saída:** {"status": [200, 201], "shape": "{ok:true,replayed:boolean,changeRequest:ProjectChangeRequest}"}

**Códigos específicos principais:** PROJECT_NOT_FOUND, PROJECT_VIEW_FORBIDDEN, CHANGE_REQUEST_VIEWER_ROUTE_REQUIRED, CHANGE_REQUEST_FIELD_REQUIRED, CHANGE_REQUEST_FIELD_TOO_LONG, CHANGE_REQUEST_BASE_REVISION_INVALID, CHANGE_REQUEST_OPERATION_COUNT_INVALID, CHANGE_REQUEST_OPERATION_INVALID, CHANGE_REQUEST_OPERATION_UNSUPPORTED, CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED, CHANGE_REQUEST_OPERATION_TOO_LARGE, CHANGE_REQUEST_IDEMPOTENCY_KEY_REUSED, PROJECT_CHANGE_REQUEST_SCHEMA_OUTDATED.

Rota chama submitAnalysisAwareProjectChangeRequest, não apenas o registro base de operações. Valida operações de análise/lifecycle/visualização/mutação persistente nos módulos próprios; não executar código arbitrário. Criação CR+ticket+operações em batch; idempotência já existe aqui, diferente do POST Ticket.

### ACT-HTTP-12 · GET `/api/projects/:slug/change-requests/:id`

**Fonte:** `functions/api/projects/[slug]/change-requests/[id].js` → `onRequest`. **Autorização:** sessão + projeto autorizado + project.view + autor da CR.

**Entrada:** {"body": null}

**Saída:** {"status": [200], "shape": "{ok:true,changeRequest:ProjectChangeRequest com operations}"}

**Códigos específicos principais:** PROJECT_NOT_FOUND, PROJECT_VIEW_FORBIDDEN, CHANGE_REQUEST_NOT_FOUND, PROJECT_CHANGE_REQUEST_SCHEMA_OUTDATED.

Não substitui endpoint Review de editor.

### ACT-HTTP-13 · GET `/api/projects/:slug/change-requests/:id/review`

**Fonte:** `functions/api/projects/[slug]/change-requests/[id]/review.js` → `onRequestGet`. **Autorização:** project.view + rota Editor + project.map.edit.

**Entrada:** {"body": null}

**Saída:** {"status": [200], "shape": "{ok:true,review:workspace}", "headers": {"Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Request-Id": "id da requisição"}}

**Códigos específicos principais:** PROJECT_NOT_FOUND, PROJECT_VIEW_FORBIDDEN, CHANGE_REQUEST_REVIEW_FORBIDDEN, PROJECT_CHANGE_REQUEST_SCHEMA_OUTDATED.

canApply é calculado via project.save; GET não concede permissão.

### ACT-HTTP-14 · POST `/api/projects/:slug/change-requests/:id/review`

**Fonte:** `functions/api/projects/[slug]/change-requests/[id]/review.js` → `onRequestPost`. **Autorização:** project.view + rota Editor + project.map.edit.

**Entrada:** {"contentType": "application/json", "body": {"action": "start|approve|reject", "comment": "motivo obrigatório em reject"}}

**Saída:** {"status": [200], "shape": "{ok:true,review:workspace}", "headers": "mesmos headers privados de GET Review"}

**Códigos específicos principais:** PROJECT_VIEW_FORBIDDEN, CHANGE_REQUEST_REVIEW_FORBIDDEN, CHANGE_REQUEST_REJECTION_REASON_REQUIRED, CHANGE_REQUEST_REVIEW_STATE_CONFLICT.

approve verifica conflito de revisão e ensureApproved; reject aceita submitted/under_review; transição usa condição de estado. Comentários/decisões no Ticket são best-effort; não há conversa geral de Ticket.

### ACT-HTTP-15 · POST `/api/projects/:slug/change-requests/:id/apply`

**Fonte:** `functions/api/projects/[slug]/change-requests/[id]/apply.js` → `onRequest`. **Autorização:** project.view + rota Editor + project.map.edit + project.save.

**Entrada:** {"body": "rota não lê body; projeto/CR vêm do path"}

**Saída:** {"status": [200], "shape": "{ok:true,appliedRevision:number,idempotent:boolean,projectIdentity:object|null,review:workspace}"}

**Códigos específicos principais:** PROJECT_VIEW_FORBIDDEN, CHANGE_REQUEST_REVIEW_FORBIDDEN, CHANGE_REQUEST_APPLY_FORBIDDEN, CHANGE_REQUEST_REVIEW_STATE_CONFLICT.

Apply pode chamar ensureApproved; não confundir com aprovação via vínculo. Revisão base é materializada/parsing integral no helper atual; retry applied usa revisão corrente do projeto. Erros de conflito/storage/base/validação adicionais dependem dos helpers; catálogo aqui é recorte essencial, não enum exaustivo.

### ACT-HTTP-16 · GET `/api/projects/:slug/change-requests/inbox`

**Fonte:** `functions/api/projects/[slug]/change-requests/inbox.js` → `onRequest`. **Autorização:** project.view + rota Editor + project.map.edit.

**Entrada:** {"query": {"status": "pending (padrão)|all|estadoCR", "page": "inteiro1..10000 (padrão1)", "limit": "inteiro1..100 (padrão25)"}}

**Saída:** {"status": [200], "shape": "{ok:true,project,items,pagination:{page,limit,hasMore}}", "headers": {"Cache-Control": "private, no-store"}}

**Códigos específicos principais:** CHANGE_REQUEST_INBOX_INVALID_OPTIONS, CHANGE_REQUEST_REVIEW_FORBIDDEN, PROJECT_VIEW_FORBIDDEN.

Consulta limit+1; pending=submitted/under_review/approved/applying; não traz payload completo de operação.

### Formatos de falha e compatibilidade

Ticket serializa `{ok:false,error:string,code,requestId,stage?}`, com `X-Request-Id`; detalhes extras do objeto interno não são copiados automaticamente. Exemplos: `expectedOffset` fica no erro interno de offset; `retryAfter: 600` fica no erro interno de rate limit. Não prometer esses campos/headers como contrato HTTP atual. Erro 5xx recebe publicMessage ou texto genérico, com diagnóstico no log.

Review/Apply usam formato distinto: `{ok:false,error:{code,message,retryable,requestId,details?}}`. O cliente deve preservar compatibilidade com ambos. Erros comuns adicionais vêm de autenticação, parsing de IDs/JSON, FORBIDDEN 403, recurso ausente, schema não preparado e storage. O inventário de códigos por rota é deliberadamente essencial, não enumeração exaustiva de falhas dos providers/helpers. 405 retorna Allow para métodos suportados.

Chunk exige dono da sessão; o cliente envia Upload-Offset. O parser atual usa Number(header) e ausência vira 0: não descrevê-lo como rejeição obrigatória já implementada. Offset divergente é 409, bytes vazios 400, chunk > 8 MiB retorna 413. Não existe HEAD de consulta/retomada no endpoint atual. XHR acompanha cancelamento/progresso, exibe 100% após confirmação e não define timeout nesse helper. DELETE repetido pode dar 404; não presumir idempotência atual.

## 3. Atual — matriz de autorização por perfil e ação

`can()` permite super_admin antes das negações específicas. Para os outros perfis, exige organização de contexto igual à ativa e aplica negação explícita antes de grants. Owner/admin têm permissões organizacionais nativas sob sua relação; editor/viewer dependem de vínculo e grants aplicáveis. A migration 0010 é apenas seed, não descrição completa da política atual e não evidência de aplicação remota.

| Perfil | Regra atual | Consequência para evolução |
|---|---|---|
| super_admin | can() permite todas as capacidades normalizadas; recursos, schema e estado ainda são validados | não remover acesso global nativo por inferência; ações sensíveis auditadas; grants globais delegados são escopo separado |
| admin | membro da organização ativa tem permissões nativas OWNER_ORGANIZATION_PERMISSIONS, incluindo seis ticket.*; negação explícita prevalece | capacidade por ação mais ACL por objeto/audiência; governança de privados explícita |
| owner | exige relação isOwner na organização ativa; permissões nativas ticket.*; negação explícita prevalece | não tornar ticket.manage bypass implícito de privado; eventual exceção exige política explícita |
| editor | membro da ativa; view/create via grant configurado/explícito (0010 semeia role); management requer grant explícito; negar explícito prevalece | atendente não é novo role obrigatório; responde/atribui/fecha conforme capacidade e ACL |
| viewer | membro da ativa; grant explícito/configurado pode permitir; 0010 não semeia Ticket; não afirmar proibição absoluta por role | solicitante com create/read/comment/reopen_own explicitamente concedidos e audiência adequada |

Ações efetivamente usadas: view para ler/listar/baixar; create para abrir; manage para editar status/atribuição/atributos. Upload exige view+(create OU manage), além do autor da sessão no PATCH; exclusão admite gestor ou autor nas condições de estado. comment/close/assign constam no catálogo, mas esse fato não implementa conversa nem granularidade no PATCH. O autor com PENDING pode cancelar mesmo fechado; ACTIVE próprio pode ser excluído enquanto aberto; gestor mantém administração com validação de storage.

Review/inbox exigem projeto autorizado, project.view, rota Editor e project.map.edit. Apply acrescenta project.save. O solicitante pode criar CR apenas na rota Viewer e consultar suas próprias solicitações. O perfil global de usuário não basta para determinar rota de projeto. `getTicketReviewLink` chama a autorização de revisor e devolve null quando negada 403/404; ler o Ticket não outorga Review.

## 4. Proposto — contrato de evolução (não implementado nesta PR)

- **PROP-INV-01 / CC-02:** Preservar cinco estados e seis categorias; natureza é campo separado com cinco valores sem reinterpretar legado automaticamente.
- **PROP-INV-02 / CC-03:** Ticket fechado exige resultado/motivo e comunicação verificável; CR aplicado não fecha Ticket automaticamente, e fechar Ticket não cancela/aprova CR.
- **PROP-INV-03 / CC-03:** Idempotência da criação Ticket, versão/CAS e transação local são garantias independentes; nenhum evento de alteração quando CAS afeta zero linhas.
- **PROP-INV-04 / CC-03:** Reabertura preserva histórico e abre ciclo; espera tem motivo/início/fim/próxima ação e não pausa SLA automaticamente.
- **PROP-INV-05 / CC-04:** ACL de objeto e audiência entram antes de lista/facetas/busca/download/notificação/exportação; etiqueta comum nunca concede privilégio.
- **PROP-INV-06 / CC-04:** Negação por padrão; concessão administrativa controlada; revisão humana da matriz futura antes de ativar privados; manter regra super_admin explicitamente avaliada.
- **PROP-INV-07 / CC-08:** Vincular ou ler Ticket não concede review/Apply/mapa/GeoJSON, gestão de usuários ou grants.
- **PROP-INV-08 / CC-08:** map_project tem decisão/revisão/applied_revision canônicas no CR técnico; registro geral só projeta com sequence/version, sem segunda aprovação ou segunda execução.
- **PROP-INV-09 / CC-08:** platform/database têm decisão canônica no change_record geral e execução externa por PR/runbook autorizado; nenhum executor arbitrário de SQL/código/grants.
- **PROP-INV-10 / CC-08:** Concessão global não cria membership/permissão de projeto; contexto explícito revalida projeto sem alterar organização ativa da sessão.
- **PROP-INV-11 / CC-08:** Não portar 0021 intacta: trigger histórico de fechamento em applied conflita com atendimento independente; primeiro verificar ledger/schema e compatibilidade de writers.
- **PROP-INV-12 / CC-01:** Nenhuma migration, flag Preview, rollout CR ou promessa SLA é autorizada implicitamente por estes documentos.

### Preparação da CC-02

Natureza é independente de category/domain: `question_request`, `incident`, `defect`, `improvement_change`, `recurring_problem` são códigos propostos a ratificar antes da migration. Campos: objetivo/expectedResult; contexto; impacto/urgência/priorityReason; respostas de triagem com versão do formulário. Legado sem evidência fica não classificado, não é inferido pela categoria. Dúvida usa formulário curto; defeito pede passos, esperado, observado e versão; incidente pede impacto/início/contorno. Prioridade permanece low/normal/high, com justificativa humana e sem promessa SLA embutida.

### Preparação da CC-03

Adicionar comando idempotente de criação por organização/ator/operação, fingerprint e resultado persistido; mesma intenção retorna mesmo ticket, payload divergente com mesma chave é conflito. GET fornece ETag forte; mutação recebe If-Match e usa CAS. 412 informa conflito autorizado; 428 indica precondição ausente. IDs/códigos de erro futuros são propostos, não aceitos hoje por contrato. Mutação, evento, auditoria obrigatória e intenção durável compartilham transação local. UPDATE que afeta zero linhas precisa impedir evento/outbox de sucesso no SQL, não apenas detectar depois. D1 não torna Dropbox atômico.

Espera é intervalo com motivo, responsável, início/fim e próxima ação; não sexto estado e não pausa automática de SLA. Fechar exige outcome, evidência/resultado e comunicação verificável. Fechamentos sem execução (duplicado/desistência/rejeição) exigem razão própria. Reabertura preserva fechamento anterior e abre ciclo. Trabalho de mudança pendente gera aviso e decisão de atendimento, sem cancelar/aprovar/aplicar CR.

| Origem | Destino | Precondição proposta |
|---|---|---|
| new | open | triagem, fila/responsável, prioridade justificada e próximo passo |
| open | in_progress | trabalho assumido, ação definida, WIP conforme política |
| in_progress | open | redistribuição justificada e próximo responsável/fila |
| in_progress | in_review | resultado/evidência e pessoa que verifica |
| in_review | in_progress | correção/informação solicitada com motivo |
| new, open, in_progress, in_review | closed | resultado, motivo/outcome e comunicação; checar trabalho CR pendente sem cancelar/aprovar CR |
| closed | open | ator autorizado e motivo; abrir ciclo e manter fechamento anterior |

### Preparação da CC-04

ACL por usuário/grupo/ação/validade e negação no tenant; políticas administrativas de acesso são distintas das etiquetas de classificação. Privado exige concessão explícita conforme matriz ratificada. Checar autorização antes de buscar/agregar/contar e antes do download; aplicar audiência restrita da mensagem aos anexos. Revogação deve valer para sessões abertas, notificações enfileiradas, cache e exportação. Não remover privilégio nativo super_admin nem conceder bypass de privado a ticket.manage por inferência: definir exceções explícitas e auditadas. Perfil atendente é capacidade de trabalho, não obrigação de criar novo role.

### Preparação da CC-08

CR técnico atual executa operações MapConfig por projeto, com ticket_id UNIQUE. O registro geral proposto `change_record` atende propostas map_project/platform/database e se vincula a Ticket por ponte compatível; não executar SQL/código/grants do texto de um chamado. **Autoridade por tipo:** para map_project, decisão/revisão/applied_revision canônicas pertencem ao CR técnico; o registro geral só projeta com sequence/version e não cria aprovação paralela nem segunda execução. Para platform/database, decisão canônica reside no registro geral; entrega é evidência de PR/runbook/migration autorizada. Solicitação de permissão usa processo próprio de concessão, nunca Apply genérico.

Capacidades gerais propostas change_record.read/create/link/review/decide/manage pertencem à organização+ACL e não derivam de ticket.view/manage nem concessão global. Para mapa, mantêm-se também gates do projeto/save. Aprovação e aplicação devem ser explícitas; caso exista atalho “Aprovar e aplicar”, apresentar as duas ações e registrar cada gate. Hoje Apply chama ensureApproved; não alegar que separação já está implementada. Reconciliar Large Apply sem parse integral de ~90 MiB, registro canônico applied_revision e retry estável.

**0021 histórica:** trigger que fecha Ticket quando CR fica applied conflita com atendimento independente. Não portar intacta. Primeiro inventariar ledger/schema e writers. Se não aplicada, preparar desenho compatível; se aplicada, migrar comportamento com janela coordenada e preservação de journal. 0021/22/23 continuam sob gates existentes e confirmação explícita; nenhuma execução nesta PR.

Entrada pelo painel global deverá resolver contexto explícito do projeto com membership e permissões reais, sem trocar organização ativa da sessão. A concessão do painel não outorga project.view/map.edit/save. A mesma pessoa efetivamente autorizada pode navegar em organização não ativa pelo contrato futuro; outra pessoa com concessão global isolada continua sem Review/Apply.

### Matriz atual → futura por ação

| Ação | Hoje | Proposto |
|---|---|---|
| listar/ler Ticket | ticket.view organizacional | ticket.view + ACL item; filtros de dados antes de contagem |
| abrir Ticket | ticket.create; recebe new | ticket.create + triagem progressiva e idempotência; não conceder read de tudo |
| editar atributos | ticket.manage | ticket.manage + ACL de edição + If-Match |
| atribuir | PATCH exige ticket.manage | ticket.assign + ACL + responsável/grupo autorizado; revogar alcance anterior quando necessário |
| responder/nota | ticket.comment catalogada; endpoint/compositor não implementados | ticket.comment + ACL; audiência response/internal explícita; nota não é respostaSLA |
| fechar | PATCH exige ticket.manage; status-alvo validado | ticket.close + ACL + resultado/motivo/comunicação; bloqueio independente de CR |
| reabrir | PATCH ticket.manage limpa closed_at ao sair de closed | ticket.reopen_own proposta para autor ou capacidade de gestão aprovada; motivo+novo ciclo |
| anexar/baixar/remover | ACT-HTTP-05..09 | ACL ticket/mensagem/audiência mais ação; manter limites e autor/estado; reserva atômica emCC06 |
| gerir ACL/etiqueta de acesso | sem objeto privado/policy específico encontrado | capacidade administrativa distinta e auditada; etiqueta comum apenas classifica |
| revisar mudança de mapa | project.view + rota Editor + project.map.edit | mesmos gates de projeto; decisão canônica no CR; projeção geral não decide |
| aplicar mapa | review + project.save; ensureApproved pode aprovar durante Apply | aprovação explícita e Apply auditáveis; atalho combinado somente com duas ações claras; pipeline grande e revisão estável |
| revisar mudança plataforma/banco | sem registro genérico executável encontrado | change_record.read/create/link/review/decide/manage por organização+ACL; entrega por PR/runbook com autorização própria |
| ver painel global | painel não implementado; /admin super_admin-only | concessão exclusiva de super_admin, revogável, sem promover role nem herdar direitos de projeto |

## 5. Catálogo de mensagens

As mensagens ACT estão no código e são evidência do comportamento/texto atual. As PROP são texto proposto para evolução; não constam do runtime por esta PR. HTTP 422/códigos novos precisam contrato versionado na PR de implementação. Mensagens de progresso/erro devem ser anunciadas sem tomar foco indevidamente, preservar rascunho e não revelar recursos de outro tenant.

| ID/estado | Gatilho | Mensagem | Comportamento |
|---|---|---|---|
| MSG-ACT-01 / actual | REQUIRED_FIELD | Campo obrigatório ausente. | Preencher campo obrigatório; não limpar rascunho. |
| MSG-ACT-02 / actual | TICKET_NOT_FOUND | Chamado não encontrado. | Não revelar ticket de outro contexto. |
| MSG-ACT-03 / actual | TICKET_CLOSED | Não é possível anexar arquivos a um chamado concluído. | Orientar reabertura autorizada ou atendimento; não recriar automaticamente. |
| MSG-ACT-04 / actual | ATTACHMENT_COUNT_LIMIT | O chamado já possui o limite de 5 anexos. | Selecionar arquivos dentro do limite. |
| MSG-ACT-05 / actual | ATTACHMENT_TOTAL_LIMIT | Os anexos do chamado não podem ultrapassar 150 MB. | Texto atual usa MB; limite técnico157286400bytes (150MiB). |
| MSG-ACT-06 / actual | TICKET_RATE_LIMITED | Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente. | Não presumir header Retry-After: serializador Ticket não repassa retryAfter. |
| MSG-ACT-07 / actual | PARTIAL_CREATION_UI | O chamado {code} foi criado, mas {count} anexo(s) falharam. | Preservar número e repetir apenas arquivos falhos; template semanticamente equivalente à interpolação. |
| MSG-PROP-01 / proposed | TICKET_VERSION_CONFLICT | Este chamado mudou enquanto você editava. Compare a versão atual e reaplique sua alteração. | Mostrar diferença somente se ainda autorizado; preservar rascunho. |
| MSG-PROP-02 / proposed | TICKET_CREATED_WITH_UPLOADS | Chamado {code} criado. Os anexos ainda estão sendo enviados. | Anunciar sem deslocar foco; não marcar100% antes do servidor. |
| MSG-PROP-03 / proposed | TICKET_WAITING | Aguardando {motivo}. Próximo passo: {ação}. | Não prometer prazo sem fundamento; espera não implica pausaSLA. |
| MSG-PROP-04 / proposed | TICKET_OUTCOME_REQUIRED | Registre o resultado e a comunicação ao solicitante antes de concluir. | Manter status atual e os dados digitados. |
| MSG-PROP-05 / proposed | TICKET_CR_PENDING | Este chamado possui uma alteração pendente. Concluir o atendimento não cancela nem aprova essa alteração. | Exigir resultado explícito de atendimento; CR conserva gates. |
| MSG-PROP-06 / proposed | RESOURCE_ACCESS_CHANGED | Você não tem acesso a este conteúdo ou seu acesso mudou. | Limpar conteúdo sensível local; nenhuma pista sobre outrotenant. |
| MSG-PROP-07 / proposed | UPLOAD_OFFSET_CHECK | A conexão parou. Vamos conferir a parte recebida antes de continuar. | HEAD/retomada futuro emCC06; não alegar disponível hoje. |
| MSG-PROP-08 / proposed | SLA_UNCONFIGURED | Sem política de SLA definida. | due_at permanece prazo de calendário, não compromissoSLA. |
| MSG-PROP-09 / proposed | METRIC_UNAVAILABLE | Indicador indisponível para este período: falta evento elegível. | Não inferir primeira resposta pelo assignee/histórico parcial. |

## 6. Contratos de aceite e limites da CC-01

- CT-01: revisor consegue distinguir SHA funcional, default, fonte, preview e produção; rotas/enums/fontes deste inventário conciliam com checkout. SchemaD1/deploy/QA permanecem separados e sem prova implícita por CI.
- CT-02: walkthrough do protótipo verifica que solicitante/atendente identificam natureza, próximo passo, responsável e resultado; ensaio documental ou automatizado não substitui validação com pessoas reais. Registrar divergências e estado do aceite na jornada.
- CC-02/03/04/08 só avançam com contratos necessários ratificados e referências atualizadas para seu SHA. Mudança de contrato deve atualizar JSON, documentação e testes pertinentes em um lote coerente.
- Nenhuma nova migration é criada ou aplicada pela CC-01. Dependências históricas 0002/0009/0010/0020 precisam confirmação separada no banco/ambiente alvo. 0021/22/23 permanecem **migration pendente de confirmação**, sem aplicação/flag Preview/reabertura automática de gates; 0024 já existe e não pode ter número reutilizado.
- Prioridades/SLA/WIP, matriz final de grants, retenção e orçamento de desempenho exigem decisões operacionais; não inventar valores. Build/Preview/merge não comprovam essas decisões nem aplicação de schema.
- Este inventário não afirma vulnerabilidade explorada, teste de carga ou produção validada. Lacunas de atomicidade/retomada/auditoria são limites observados no recorte e cenários a verificar durante implementação.

## 7. Fontes no repositório

- `functions/_lib/ticket-center.js`: TICKET_STATUSES, validateTicketCreatePayload, validateTicketPatchPayload, createTicket, updateTicket, listTickets, ticketCenterErrorResponse.
- `functions/_lib/permissions.js`: can, organizationPermissionAllows, requireOrganizationPermission.
- `functions/_lib/project-change-requests.js`: CHANGE_REQUEST_STATUSES, publicChangeRequest, getOwnProjectChangeRequest.
- `functions/_lib/project-change-request-analysis-submission.js`: normalizeAnalysisAwareChangeRequestSubmission, submitAnalysisAwareProjectChangeRequest.
- `functions/_lib/project-change-request-review.js`: requireReviewerProject, ensureApproved, reviewProjectChangeRequestAction, applyProjectChangeRequest.
- `functions/_lib/project-change-request-inbox.js`: getTicketReviewLink, parseInboxOptions.
- `src/pages/Projects/components/ticket-types.ts`: Ticket, TicketStatus, CreateTicketPayload.
- `src/pages/Projects/components/tickets-api.ts`: listTickets, uploadAttachmentChunk.
- `migrations/0010_ticket_center.sql`: .
- `migrations/0020_project_change_requests.sql`: .

Os endpoints da seção 2 registram os arquivos exatos dos handlers. O catálogo fonte e os contratos propostos devem permanecer distinguíveis para a validação automatizada da CC-01.
