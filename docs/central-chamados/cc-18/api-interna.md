# API interna — CC18 v1

Público: integrações internas e engenharia. [openapi.json](openapi.json) usa OpenAPI3.0.3, com51 caminhos e82 operações do produto. Serve como inventário HTTP e contrato dos fluxos críticos; objetos de domínio extensos mantêm schema aberto e apontam `x-domain-sources` para validação normativa. Não é SDK gerado nem promessa de campos arbitrários aceitos. Use UI/cliente do produto para políticas, ACL, CR e instrumentos complexos.

Autenticação: sessão `maono_session` gerenciada pela aplicação, no mesmo origin. Nunca colocar cookie, token ou credencial em exemplos, artifacts ou planilhas. Cada operação revalida capacidades, organização/projeto e ACL/audiência; URL, ID ou papel amplo não substituem autorização. Mutação segue a política de Preview e validação de origem do endpoint.

## Contratos que não podem ser confundidos

| Fluxo | Intenção / concorrência | Observação |
|---|---|---|
| Criação de chamado | `Idempotency-Key` com comandos ativos | Mesma chave e conteúdo retornam intenção persistida; chave presente exige readiness. |
| Comandos/edição core | `If-Match` do estado canônico | `/state` possui ETag; detalhe enriquecido não é esse recurso.412/428 preserva rascunho. |
| Conversa | `Idempotency-Key`; draft com versão quando usado | Nota interna e resposta têm audiências distintas; revisão possui token próprio. |
| Upload resumível | ETag da sessão + `Upload-Offset` | HEAD confirma offset; PATCH envia bytes; POST reconcilia commit já presente, não anexa bytes. |
| Exportação | `idempotencyKey` no JSON | Não substituir pelo header da criação de chamado; snapshot possui versão própria. |
| CR Review/Apply | Contrato do projeto | Vínculo ao chamado não concede permissão; gates históricos continuam separados. |

## Exemplos sintéticos

Somente em ambiente autorizado, com sessão já obtida pela UI. Os exemplos abaixo mostram corpos, não comandos com credenciais. Substituir IDs pelo escopo aprovado; não executar apenas por copiar o manual.

Criação estruturada (`POST /api/organizations/{id}/tickets`, comandos/triagem prontos, header `Idempotency-Key: cc18-example-intent-001`):

```json
{"subject":"Dúvida de exportação QA","description":"Preciso confirmar o formato disponível.","category":"export","demandNature":"question_request","expectedResult":"Receber orientação do formato.","context":"Exemplo sintético","impact":"individual","urgency":"flexible","triageFormVersion":1,"triageAnswers":{}}
```

Depois de timeout, repetir a mesma chave e corpo. Chave reutilizada com outro conteúdo retorna409. Mudança de payload requer uma nova intenção deliberada, após esclarecer o resultado anterior.

Resposta (`POST /api/organizations/{id}/tickets/{ticketId}/messages`, header de idempotência estável e permissões de conversa):

```json
{"kind":"response","body":"Orientação revisada para o cenário sintético.","attachmentIds":[]}
```

Exportação (`POST /api/organizations/{id}/tickets/exports`, permissão `export.create`, readiness/limites aprovados):

```json
{"idempotencyKey":"cc18-export-intent-001","from":"2026-09-01T00:00:00Z","to":"2026-09-28T00:00:00Z","asOf":"2026-09-29T00:00:00Z","report":"backlog"}
```

Resposta202 apenas cria o trabalho. Consultar estado e baixar quando pronto; reautorizar no download. `from < to <= asOf`, janela máxima366 dias, sem futuro. Relatórios incidentes/causas exigem CC13. Corpo até4096 bytes. Retry usa a rota específica com `idempotencyKey` no corpo.

## Paginação, limites e erros

Cursors são opacos e pertencem ao filtro/contexto. Não trocar org, ator ou filtros mantendo cursor anterior. Mensagens usam limit/cursor; notificações before/limit; casos/conhecimento after; exportações before. Consultar parâmetros do caminho e serviço indicado no OpenAPI. Totais autorizados não devem ser substituídos pelo tamanho da página.

Upload:5 arquivos,80MiB cada,150MiB total incluindo reservas, chunks até8MiB. O POST em `/attachments` inicia a sessão via JSON; `/attachments/uploads` é somente GET. Usar PATCH no attachment legado para uma sessão resumível gera conflito; usar o endpoint da sessão. Nenhum arquivo ACTIVE antes de finalização verificada.

400=conteúdo inválido;401=sessão;403/404=autorização/recurso;409=intenção/estado incompatível;412=token desatualizado;428=token ausente;413/429=limite;415=tipo;503=readiness/provedor. Os códigos variam por domínio. Não reduzir silenciosamente conteúdo, remover guard ou exibir SQL/caminho privado para contornar um erro.

## Manter o contrato

```sh
npm ci --prefix scripts/central-chamados/cc18 --no-audit --no-fund
npm run validate:cc18
```

O validador OpenAPI é fixado em13.1.0 num pacote isolado. O gate compara paths/métodos e hash de rotas/fábricas com a especificação, verifica vínculos40/60 e links locais. Alteração de implementação requer revisão consciente do contrato; atualizar somente o hash não é revisão funcional. CI não executa chamadas produtivas.

Para regenerar após revisar semântica, schemas e exemplos, atualizar `scripts/central-chamados/cc18/generate-openapi.mjs` e executar `node scripts/central-chamados/cc18/generate-openapi.mjs`. Revisar o diff gerado antes de validar; o gerador não descobre sozinho as regras de negócio.

## Recuperação de aplicação durável

O salvamento durável acrescenta `GET /api/projects/{slug}/change-requests/{id}/apply` para consultar estado/recibo com autorização atual do reviewer, sem alterar a organização ativa da sessão. O POST correspondente aceita o artefato aprovado, exige contrato de cliente 2 e pode responder 202 antes da publicação. A contagem atual é de 82 operações; o registro de execução original preserva as 81 existentes naquela data.
