# CC-05 - conversas, notas internas e rascunhos

## Estado de execução

**DESENVOLVIMENTO FUNCIONAL CONCLUÍDO / PR #202 DRAFT / RELEASE BLOQUEADO.**

Base de produto: `mano_kepler_v1` em
`49c9a9a09cd674fcc83cb6befa340e1d5a477cc1` (merge da CC-04 / PR #200).
A implementação funcional permanece na branch `feat/cc-05-ticket-conversations` e
não equivale a ativação, migration aplicada ou acceptance em Produção.

A CC-05 agora integra os contratos de dados ao produto: autorização canônica,
leitores seguros, serviço transacional, rotas HTTP, mensagens públicas, notas
internas, revisões, rascunhos com ETag/CAS, anexos de rascunho e compositor na
Central de Chamados. A flag continua opt-in: nenhuma operação desta execução
habilita Produção ou altera as flags da CC-03/CC-04.

## Migration

**MIGRATION PENDENTE DE CONFIRMAÇÃO**

- Nome: `0028_ticket_conversations.sql`.
- Finalidade: criar `ticket_messages`, `ticket_message_revisions` e
  `ticket_drafts`; adicionar `audience`, `message_id` e `draft_id` a
  `ticket_attachments`; adicionar `audience` e `message_id` a `ticket_events`;
  criar índices, FKs e triggers de integridade, revisão append-only, retenção,
  versionamento CAS e promoção controlada de anexos.
- Banco/ambiente alvo futuro: Produção / Cloudflare D1 `maono_maps`, UUID
  `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`.
- Pré-requisito: torna-se obrigatória antes de habilitar
  `MAONO_TICKET_CONVERSATIONS_ENABLED=true` e antes do acceptance funcional da
  CC-05 em Produção.
- Estado: preparada no repositório; **não aplicada nesta execução**. Build verde,
  Preview, CI, merge ou autorização da migration 0027 não autorizam a 0028.
- Aplicação futura: somente pelo operador protegido descrito em `AGENTS.md`, com
  audit somente leitura, relatório e parada, autorização humana específica com
  migration/hash aprovado, aplicação isolada e pós-validação. **Não reaplicar
  0027 e não aplicar migrations anteriores em lote.**

O `schema.sql` foi atualizado com o snapshot de instalação nova correspondente à
0028 para que uma instalação limpa e um upgrade converjam para o mesmo contrato.

## Implementação funcional concluída

### Autorização e confidencialidade

- Catálogo canônico recebeu `ticket.note.view` e `ticket.note.create`.
- Super admin preserva o contrato global existente; owner/admin possuem acesso
  nativo organizacional; editor/viewer dependem do resolvedor granular existente.
- Nenhuma autorização deriva de autoria, solicitante, responsável, etiqueta ou
  nome de papel como atalho para nota interna.
- A ACL de objeto CC-04 e as permissões de organização são reavaliadas em cada
  request e replay idempotente; revogação fecha o acesso imediatamente.
- Leitores de anexos, downloads, eventos, detalhe e contadores filtram audiência
  mesmo quando a feature de conversas está OFF, desde que o schema 0028 exista.
  Isso evita transformar a própria flag em bypass de confidencialidade.

### Serviço, transação e idempotência

- Serviço `ticket-conversations` integrado ao D1 com detecção explícita do schema
  necessário antes de permitir escrita.
- Reuso de `ticket_commands` e `ticket_command_outbox` da Central de Chamados,
  evitando um segundo mecanismo de receipts/idempotência.
- Envio cria, no mesmo batch validado: receipt, mensagem, promoção de anexos,
  consumo do rascunho, evento classificado, audit sanitizado e intenção de outbox.
- Fingerprint do comando é SHA-256; corpo de mensagem/nota não é persistido em
  receipt, audit ou outbox.
- Replay idempotente reautoriza o recurso antes de devolver o resultado.
- Edição exige `If-Match`, motivo e incremento exato da versão; as revisões são
  criadas por triggers e permanecem append-only.

### Rascunhos e anexos

- Rascunho ativo único por usuário/organização/chamado/audiência.
- Autosave é server-side, com ETag/CAS; zero-row CAS é conflito, nunca sucesso.
- Não há persistência de corpo sensível em `localStorage` ou `sessionStorage`.
- Upload de conversa nasce com audiência `draft`, privado ao autor; só pode ser
  promovido após upload `ACTIVE`, para uma mensagem do mesmo escopo/audiência.
- Anexos legados permanecem públicos no contexto do chamado e não podem ser
  silenciosamente reclassificados como confidenciais.
- Download e exclusão de anexos fazem verificação de audiência/autorização antes
  de tocar no binário ou gerar audit público.

### API HTTP

Foram integradas rotas para:

- listar/criar mensagens;
- editar mensagem com precondição de versão;
- consultar revisões;
- listar/criar/ler/atualizar/descartar rascunhos;
- upload de anexos vinculado ao rascunho existente.

As rotas reutilizam sessão, autorização de organização, ACL do chamado e catálogo
canônico. Falhas de autorização de conteúdo interno fecham em 403/404 conforme o
contexto sem expor corpo, nome de arquivo ou existência por caminho lateral.

### Interface

O `TicketDetailDrawer` recebeu o compositor de conversa entre o ciclo de
atendimento e os anexos/histórico. A interface:

- separa visualmente `Resposta ao solicitante` de `Nota interna`;
- só oferece a aba interna quando o bundle autorizado pelo servidor permite;
- salva rascunho no servidor com estado de salvamento explícito;
- preserva o texto mais recente diante de respostas tardias e conflitos;
- permite anexar/remover arquivos no rascunho;
- permite envio idempotente, edição própria com motivo e consulta do histórico;
- descarta rascunho explicitamente;
- invalida/recarrega estado após revogação ou conflito de ETag;
- não depende de inferência de papel no cliente para liberar nota interna.

## Evidência local desta consolidação

Ambiente de validação: Node `22.16.0`, SQLite `3.49.1`, snapshot completo do
repositório proveniente do artifact do workflow da própria PR.

- `node --test tests/ticket-conversation*.test.mjs tests/ticket-conversations-integration.test.mjs`:
  **67/67 aprovados, 0 falhas**.
- `node --test tests/access-delegation.test.mjs`:
  **11/11 aprovados, 0 falhas**.
- `git diff --check`: aprovado.
- `node --check` nos módulos JS novos/alterados da CC-05: aprovado.
- Transpilação sintática TypeScript dos 7 arquivos TS/TSX alterados: **7/7**.

Cobertura executada inclui instalação nova, migration isolada, integridade/FK,
isolamento por organização, respostas públicas, notas internas, revogação,
idempotência, revisões, CAS de rascunhos, promoção de anexos, filtros de eventos,
downloads e contadores sem inferência, feature OFF segura, rotas HTTP e wiring do
compositor.

### Limites da evidência local

O artifact reproduzível não inclui `node_modules` e não possui `package-lock.json`
na raiz. Uma tentativa de instalar dependências no ambiente efêmero não concluiu
dentro da janela disponível; portanto **typecheck/build completos não são
classificados como aprovados localmente**. O CI/Preview do novo commit é o gate
remoto para instalação, typecheck/build e integração de bundling.

Uma suíte legada que usa o helper de backfill apresenta no Node 22 local um erro
`column index out of range` ligado a placeholders numerados do `node:sqlite`. O
problema ocorre no fixture anterior à CC-05 e não foi mascarado por mudança de
produção. Os testes próprios da CC-05 usam o SQL e os caminhos reais relevantes e
passaram. O CI existente continua sendo a evidência complementar para regressão.

## Gates que permanecem abertos

1. Publicar o estado consolidado da branch e observar os workflows/Preview do novo
   commit; qualquer falha real deve ser tratada antes de avançar.
2. Revisão final da PR #202 mantendo-a Draft enquanto os gates operacionais
   estiverem bloqueados.
3. **MIGRATION PENDENTE DE CONFIRMAÇÃO**: audit protegido da 0028, relatório e
   parada; autorização humana específica; aplicação isolada; pós-validação.
4. Acceptance autenticado da CC-05 em Produção com organização/usuários controlados:
   resposta pública, nota interna, revogação, duas abas/CAS, anexos, edição/revisão,
   perda de resposta e não inferência em contadores/downloads.
5. Decisão operacional específica para habilitar
   `MAONO_TICKET_CONVERSATIONS_ENABLED=true`. Não ativar por consequência de merge
   ou migration.
6. Atualizar a Planilha de Controle e registrar evidências finais. PDF de Conclusão
   Final só deve ser emitido quando o objetivo final e os gates operacionais forem
   efetivamente encerrados.

## Reconfronto com o objetivo final

A sequência anterior precisava de pivotamento: os itens CC05-01–05 que eram
pendências de implementação foram incorporados na própria PR #202, em vez de
abrir PRs paralelas que aumentariam Preview/CI e risco de divergência. Com isso, a
próxima etapa correta deixa de ser desenvolvimento funcional e passa a ser
**validação remota + migration protegida + acceptance + decisão de ativação**.

Não avançar mecanicamente para CC-06 enquanto a #202 não tiver seus gates de
migration e acceptance registrados. CC-03/CC-04 acceptance permanece conforme o
registro anterior (adiado/não aprovado); esta execução não altera triage/commands
nem reclassifica aqueles gates.
