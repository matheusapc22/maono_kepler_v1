# Large CREATE — hardening, Preview acceptance e rollout

## Objetivo

Fechar o P0 de criação de projetos com MapConfig grande sem aumentar o limite inline do Worker. O caminho aprovado é:

1. CREATE pequeno continua em um único `POST /api/projects` JSON;
2. CREATE grande faz `POST /api/projects` metadata-first;
3. o projeto permanece inativo em `DRAFT/PREPARING_STORAGE`;
4. `PUT /api/projects/{slug}/config` publica a revision 1 por streaming;
5. somente depois de storage + integridade + revision publicada: `CONFIG_READY -> ACTIVE`;
6. owner, `organization_file` e quota só fecham no fluxo final;
7. o frontend só navega depois de confirmar `ACTIVE`.

## Invariantes obrigatórios

- feature flag `PROJECT_CREATE_LARGE_STREAM_V1` é `false` quando ausente ou inválida;
- Preview continua fail-closed por `MAONO_PREVIEW_MUTATIONS_ENABLED=false` fora da janela de QA;
- projetos lifecycle-managed só aparecem em listagem/acesso normal quando `lifecycle_state='ACTIVE'`;
- criação grande sempre usa `expectedRevision=0` e publica apenas revision 1;
- retry usa a mesma `idempotencyKey`;
- resposta perdida após commit não reenvia o MapConfig;
- erro retryable mantém contexto para retomada e não ativa o projeto;
- erro não-retryable libera a reserva de quota;
- `organization_file.active` permanece 0 até finalização;
- integridade de tamanho/hash é obrigatória;
- nenhum cookie, token, MapConfig ou dataset completo pode aparecer em logs/auditoria.

## Gates de CI

O workflow `Large CREATE validation` executa:

- `project-large-create-hardening.test.mjs`;
- `project-large-create-failures.test.mjs`;
- `project-large-create-regression.test.mjs`;
- `project-large-create-observability.test.mjs`;
- regressões existentes de CREATE e large SAVE;
- build TypeScript/Vite;
- teste determinístico de 94 MiB em processo Node limitado a 2 GiB.

A fixture de 94 MiB é gerada em runtime e nunca é commitada no Git.

## Pré-requisitos do Preview acceptance

Antes de qualquer mutação:

- deployment alvo deve responder `/api/health` com `runtime.runtime=preview`;
- `runtime.largeCreateStreamEnabled=true`;
- `runtime.previewMutationsEnabled=true` somente durante a janela de acceptance;
- D1 e as três credenciais Dropbox devem aparecer como configuradas no health;
- sessão dedicada deve ser Editor da organização QA;
- organização ativa: ID `9`, slug `maono-preview-qa`;
- sessão precisa de `project.create`;
- origem deve ser HTTPS Cloudflare Pages (`*.pages.dev`).

Secret recomendado para execução automatizada/local segura:

`MAONO_PREVIEW_CREATOR_SESSION_COOKIE`

O valor deve ter formato `maono_session=<valor>` e nunca deve ser colado em issue, PR, log ou chat.

## Comando de acceptance

Com a janela QA aberta e as variáveis no ambiente:

```bash
MAONO_LARGE_CREATE_ACCEPTANCE_CONFIRMATION=RUN_LARGE_CREATE_PREVIEW_ACCEPTANCE \
MAONO_PREVIEW_BASE_URL=https://<preview>.pages.dev \
MAONO_PREVIEW_CREATOR_SESSION_COOKIE='<secret>' \
MAONO_ACCEPTANCE_QA_ORG_ID=9 \
MAONO_ACCEPTANCE_QA_ORG_SLUG=maono-preview-qa \
MAONO_LARGE_CREATE_TARGET_MIB=94 \
node --experimental-strip-types scripts/large-create/preview-acceptance.mjs
```

O runner:

1. valida health/runtime/flags;
2. valida sessão Editor + QA org + `project.create`;
3. gera fixture determinística entre 90 e 100 MiB;
4. usa o mesmo classificador de transporte do frontend;
5. executa POST metadata-first;
6. comprova que o projeto ainda não aparece em `GET /api/projects`;
7. executa PUT streaming;
8. exige `ACTIVE`, revision 1 e tamanho exato;
9. repete o POST com a mesma chave e exige resposta idempotente sem revision 2;
10. baixa por `config-stream` e compara tamanho + SHA-256 com a fixture local.

No sucesso, o runner imprime apenas metadados seguros (`projectId`, `slug`, tamanho, revision, SHA-256 e indicação de cleanup).

## Ordem operacional segura

1. manter Production com `PROJECT_CREATE_LARGE_STREAM_V1=false`;
2. habilitar a flag somente no Preview;
3. confirmar `/api/health` e manter mutations ainda `false`;
4. preparar a sessão QA Editor sem expor o cookie;
5. abrir janela curta: `MAONO_PREVIEW_MUTATIONS_ENABLED=true`;
6. executar o acceptance;
7. independentemente do resultado, restaurar imediatamente `MAONO_PREVIEW_MUTATIONS_ENABLED=false`;
8. preservar projeto/evidências se houver falha; no sucesso, remover o projeto QA pela rotina administrativa segura;
9. somente com CI + Cloudflare + acceptance verdes considerar habilitar a flag em Production;
10. após ativação de Production, fazer smoke de CREATE pequeno e CREATE grande controlado.

## Rollback

O rollback operacional é somente:

`PROJECT_CREATE_LARGE_STREAM_V1=false`

Não há migration nova nesta entrega. Desabilitar a flag impede novas admissões Large CREATE e não exige rollback de banco.

## Critério de fechamento

A funcionalidade só é considerada encerrada quando:

- CI e build verdes;
- Cloudflare Preview verde;
- fixture 90–100 MiB classificada como stream;
- projeto invisível antes de ACTIVE;
- revision 1 publicada com tamanho/hash coerentes;
- replay idempotente sem projeto/revision duplicados;
- testes de timeout, integridade, quota/lifecycle e regressões verdes;
- Preview mutations restauradas para `false`;
- Production ativada de forma controlada e smoke final verde.
