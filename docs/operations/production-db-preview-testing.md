# Homologação Preview usando o D1 de produção

## Objetivo

Permitir que deployments Preview do Cloudflare Pages leiam o mesmo banco D1 `maono_maps` usado em produção, sem permitir que uma branch ainda não mesclada altere organizações, usuários ou projetos reais fora de um escopo QA dedicado.

A geometria continua fora do D1. Projetos de teste usam a mesma arquitetura de produção: metadados/revisões no D1 e MapConfig/GeoJSON no storage configurado para a organização QA.

## Regra de segurança

- `GET`, `HEAD` e demais leituras continuam usando dados reais.
- `POST`, `PUT`, `PATCH` e `DELETE` em domínio ficam fail-closed.
- login, logout e atualização de sessão continuam permitidos.
- mutações administrativas, de organização e endpoints Dropbox são sempre bloqueadas no Preview.
- mutações de mapas/projetos só passam quando o `organization_id` do alvo coincide com `MAONO_PREVIEW_QA_ORG_ID`.
- `MAONO_PREVIEW_MUTATIONS_ENABLED=false` bloqueia imediatamente todas as mutações de domínio do Preview.
- nenhuma migration remota deve ser executada por workflow de Preview.

## Ordem segura de implantação

1. Fazer merge da PR que introduz `functions/_middleware.js` e a política de Preview.
2. Em Production, configurar `MAONO_RUNTIME_ENV=production` (recomendado para diagnóstico; produção continua sem política de Preview).
3. Gerar o SQL da organização QA sem executá-lo automaticamente:

```bash
node scripts/preview/build-production-qa-seed.mjs --user-email=qa@example.com > /tmp/maono-preview-qa.sql
```

4. Revisar o SQL e executar manualmente no D1 de produção.
5. Consultar o ID da organização `maono-preview-qa`.
6. No ambiente **Preview** do Cloudflare Pages, configurar:

```text
MAONO_RUNTIME_ENV=preview
MAONO_PREVIEW_MUTATIONS_ENABLED=false
MAONO_PREVIEW_QA_ORG_ID=<id>
MAONO_PREVIEW_QA_ORG_SLUG=maono-preview-qa
```

7. Só depois apontar o binding `DB` do ambiente Preview para o mesmo D1 `maono_maps` usado por Production.
8. Abrir um Preview e confirmar que respostas possuem `X-Maono-Runtime-Env: preview`.
9. Testar leitura de projeto real.
10. Testar tentativa de escrita em projeto real e confirmar HTTP 403 com `PREVIEW_WRITE_OUTSIDE_QA_ORG`.
11. Testar escrita em projeto QA ainda com kill switch `false` e confirmar `PREVIEW_MUTATIONS_DISABLED`.
12. Alterar `MAONO_PREVIEW_MUTATIONS_ENABLED=true` apenas após os dois testes anteriores.
13. Criar/importar o projeto Golden QA e executar smoke tests antes de merge.

## Organização QA

Padrão sugerido:

```text
Nome: Maõno Preview QA
Slug: maono-preview-qa
Dropbox root: /Apps/MaonoKepler/preview/qa
```

Projetos:

```text
qa-geojson-golden       # permanente, leitura/render/performance
qa-smoke-<commit>       # descartável, create/save/reload/delete
```

O GeoJSON Golden deve ter manifesto com SHA-256, tamanho, feature count, bbox e tipos geométricos. Esse manifesto será adicionado quando o arquivo de referência for fornecido.

## Respostas de bloqueio

- `PREVIEW_MUTATIONS_DISABLED`: kill switch desligado.
- `PREVIEW_GLOBAL_MUTATION_DENIED`: endpoint de escrita fora do escopo permitido.
- `PREVIEW_MUTATION_SCOPE_UNRESOLVED`: não foi possível determinar a organização alvo.
- `PREVIEW_WRITE_OUTSIDE_QA_ORG`: alvo pertence a outra organização.

## Headers de diagnóstico

Respostas que passam pelo Preview recebem:

```text
X-Maono-Runtime-Env: preview
X-Maono-Preview-Write: <reason>
```

Nenhum segredo ou ID da organização QA é devolvido nesses headers.

## Migrations

Preview compartilhando o D1 de produção **não pode aplicar migrations**. Mudanças de schema continuam seguindo o fluxo controlado de produção depois do merge. O gate `scripts/preview/assert-preview-safety.mjs` falha se um workflow identificado como Preview contiver `wrangler d1 migrations apply ... --remote` ou `wrangler d1 execute ... --remote`.

## Próxima etapa: Golden GeoJSON

Depois que o GeoJSON for fornecido:

1. analisar integridade e complexidade;
2. montar o MapConfig Kepler de referência;
3. publicar o arquivo revisionado na raiz QA do storage;
4. inserir `projects`, `project_config_revisions` e `user_projects` de forma idempotente;
5. registrar manifesto da fixture;
6. adicionar smoke test browser/Preview;
7. transformar o Preview smoke em gate obrigatório antes de merge.
