# CC-06 — anexos confiáveis e retomada autorizada

## Estado de execução

IMPLEMENTAÇÃO FUNCIONAL CONSOLIDADA LOCALMENTE; ainda não equivale a merge, migration aplicada, Production Acceptance ou rollout.

Base de produto: `mano_kepler_v1` em `72ed1274274ef456bbc152574c9d2e55b13cf15b`.
Branch alvo: `feat/cc-06-central`.

A CC-05 foi implantada e sua migration 0028 foi aplicada/pós-validada, mas acceptance, ativação permanente e encerramento administrativo permanecem diferidos. A CC-06 não deve reclassificar esses gates como concluídos.

## Objetivo

Garantir uploads de anexos retomáveis e autorizados com:

- reserva atômica dos limites de 5 arquivos, 150 MiB por chamado e 80 MiB por arquivo;
- sessão de upload própria, distinta do attachment final e da sessão do provider;
- `HEAD`/offset/ETag para retomada após reload;
- reseleção segura pelo Dropbox Content Hash;
- recuperação de resposta perdida via `correct_offset` do Dropbox;
- finalização verificável antes de `ACTIVE`;
- compensação/reconciliação quando Dropbox e D1 divergem;
- cancelamento explícito, expiração finita e reautorização a cada operação;
- preservação da audiência dos drafts/notas internas da CC-05.

## Implementado nesta execução

### Schema e capacidade

- Migration aditiva `0029_ticket_attachment_upload_sessions.sql` preparada.
- `ticket_attachment_upload_sessions` separa lifecycle, offset, expiração, identidade e metadata do provider.
- `ticket_attachments` recebe vínculo de sessão e `provider_content_hash`.
- Trigger de reserva é a autoridade dos limites 5/150 MiB sob concorrência.
- Reservas expiradas deixam de consumir capacidade sem depender de um GET mutante.
- Lifecycle/version/offset/retention e scope de draft possuem guards no banco.

### Backend e provider

- Feature flag própria: `MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED`.
- Flag ON + schema ausente falha fechado; flag OFF conserva fluxo legado.
- Start reserva sessão + attachment PENDING em um batch D1 antes de abrir sessão Dropbox.
- IDs de sessão do Dropbox nunca são projetados para o browser.
- `HEAD` devolve offset, length, expiry e ETag com `Cache-Control: private, no-store`.
- `PATCH` exige `Upload-Offset` e `If-Match` e reautoriza ticket/audiência.
- `incorrect_offset.correct_offset` do Dropbox reconcilia resposta perdida sem duplicar bytes.
- Último chunk entra em `FINALIZING`; path/size/content hash remoto precisam corresponder antes de `ACTIVE`.
- Commit remoto sem publicação D1 entra em `RECONCILE`; POST de reconcile publica uma única vez.
- A publicação final tem guard transacional: corrida no CAS aborta attachment/event/audit sem efeito fantasma.
- Cancelamento é explícito; falha transitória não apaga a sessão retomável.

### Frontend

- Dropbox Content Hash calculado no browser em blocos de 4 MiB.
- Upload novo usa sessão resumível quando o servidor a oferece e preserva o fallback legado com flag OFF.
- Reload recupera sessões autorizadas; o usuário re-seleciona o arquivo e o hash precisa coincidir.
- Erro transitório/abort preserva a sessão; UI mostra Retomar / Cancelar envio.
- Upload de draft interno usa o mesmo mecanismo e continua subordinado ao draft/audiência/autorização atual.
- Nenhum estado da sessão é persistido em `localStorage`/`sessionStorage` e nenhum provider session id vai ao cliente.

### Test fixture hardening

O adapter SQLite dos testes foi corrigido para traduzir placeholders numerados do D1 (`?1`, `?2`, com reutilização) apenas dentro do fixture Node 22. O SQL de produção permanece inalterado. Isso recuperou as regressões CC-03/04 previamente bloqueadas por `column index out of range`.

## Evidência local

- Suite consolidada: **210/210 testes aprovados**, zero falhas/skip.
- Integração CC-06 inclui: lost append response, lost finish response, `correct_offset`, commit remoto + falha D1, reconcile único, corrida de CAS final sem efeitos fantasmas, seis starts concorrentes com apenas cinco reservas, mismatch de hash remoto, fechamento concorrente e cancelamento explícito.
- Rotas HTTP: fail-closed sem 0029, HEAD/no-store/ETag, list owner-scoped, bloqueio da rota PATCH legada e feature OFF.
- TypeScript/TSX alterado: transpile sintático do compilador TypeScript 5.x global aprovado nos cinco arquivos.
- `npm install --legacy-peer-deps` não concluiu dentro da janela local e não deixou `node_modules`; portanto **build/typecheck completo local não é classificado como aprovado**. O Product Reliability UX Gate acionado pela PR será a evidência remota de build.

## Migration

**MIGRATION PENDENTE DE CONFIRMAÇÃO**

- nome: `0029_ticket_attachment_upload_sessions.sql`
- finalidade: sessões retomáveis persistidas; vínculo/hash de provider; índices/triggers de capacidade e lifecycle;
- banco alvo futuro: D1 `maono_maps` em Produção; local/Preview somente conforme binding confirmado;
- torna-se pré-requisito antes de `MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED=true` e antes do Production Acceptance do fluxo CC-06;
- não aplicada nesta execução;
- `0020_project_change_requests.sql` permanece fora do escopo e não pode ser aplicada por lote.

Build, CI, Preview, merge ou instrução genérica de continuidade **não autorizam a 0029**.

## ADR scanner/quarentena

Ver `CC06-quarantine-scanner-adr.md`. A CC-06 cria o ponto de extensão de verificação entre `FINALIZING` e `ACTIVE`, mas **não declara malware scanning entregue** sem provider/contrato operacional próprio.

## Gates abertos

1. Publicar o estado consolidado em um único push/PR e observar CC-06 CI + regressões + Product Reliability build/browser + Preview.
2. Corrigir apenas falhas reais desses gates, evitando micro-pushes.
3. Auditar pós-PR e atualizar a Planilha de Controle/Pasta de Execução.
4. **MIGRATION PENDENTE DE CONFIRMAÇÃO**: audit protegido da 0029 → relatório/parada → autorização humana específica → apply isolado → pós-validação.
5. Production Acceptance autenticado: concorrência, reload/resume, resposta perdida, revoke/close, finalize gap, hash mismatch e draft interno.
6. Decisão operacional específica para `MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED=true`.
7. Rollout/rollback, PDF de Conclusão Final e manual/operacional quando aplicável.

## Reconfronto com o objetivo final

A arquitetura planejada continua sendo a próxima etapa correta. O risco principal do fluxo anterior — check-then-insert e offset D1 separado do commit do provider — foi substituído por reserva autoritativa no banco e reconciliação explícita. CC-07 não deve começar mecanicamente antes da auditoria pós-PR da CC-06; migration/acceptance/rollout permanecem gates separados.
