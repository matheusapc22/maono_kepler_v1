# Codex + Cloudflare D1 — migrations de produção

## Objetivo

Permitir que o Codex prepare e audite migrations de forma autônoma, mas só escreva no D1 `maono_maps` depois de autorização humana explícita e vinculada ao conteúdo auditado.

O fluxo implementado é:

`PREPARE → LOCAL VALIDATE → AUDIT READ-ONLY → REPORT/STOP → HUMAN AUTHORIZATION → ISOLATED APPLY → POST-VALIDATE/STOP`

## Credenciais do ambiente Codex

Configure como secrets do ambiente de execução, nunca em arquivos versionados:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

O token usado para a etapa de aplicação precisa conseguir editar o D1 da conta. Use um token dedicado ao operador de migrations e conceda somente as permissões necessárias para D1. Não coloque o valor do token em `AGENTS.md`, `.env.example`, logs, relatórios ou comentários de PR.

O executor recusa um D1 cujo nome/UUID não sejam exatamente:

- `maono_maps`
- `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`

Wrangler é fixado pelo operador em `4.140.0` para evitar mudança silenciosa de comportamento entre audit e apply.

## 1. Preparar

Crie/revise a migration em `migrations/` e os testes correspondentes. Antes do audit de produção, o estado que será autorizado precisa estar commitado e o worktree precisa estar limpo.

Rode pelo menos:

```bash
npm run test:production-migration-gate
npm run build
```

Além disso, rode os testes específicos da funcionalidade cuja migration está sendo introduzida.

## 2. Audit somente leitura

```bash
npm run migration:audit:production -- --migration 0027_example.sql
```

O audit:

- calcula SHA-256 do SQL;
- fixa o Git SHA;
- exige worktree limpo;
- confirma nome e UUID do D1 remoto;
- lê o ledger `d1_migrations`;
- calcula todas as migrations locais pendentes e seu digest;
- destaca migrations anteriores ainda pendentes, sem aplicá-las;
- classifica as operações SQL e o risco;
- executa `PRAGMA quick_check` e `PRAGMA foreign_key_check`;
- captura um bookmark do D1 Time Travel;
- gera um relatório JSON local em `.tmp/production-migrations/`;
- gera `approval hash`, `approval token` e texto de autorização;
- encerra com `writesPerformed=false`.

O Codex deve mostrar esse resultado ao usuário e parar.

## 3. Autorização humana

A autorização deve ocorrer **depois** do audit e identificar a migration e o approval hash. Exemplo:

```text
Autorizo executar em produção a migration 0027_example.sql,
approval <hash>, no D1 maono_maps.
```

A autorização vale somente para o estado auditado. Alterar SQL, Git SHA, fila pendente ou alvo invalida o approval.

## 4. Aplicação isolada

Somente depois da autorização explícita, use o comando emitido pelo próprio relatório de audit. A forma é:

```bash
npm run migration:apply:production -- \
  --migration 0027_example.sql \
  --audit-report .tmp/production-migrations/audit-....json \
  --approval 'MAONO_PROD_MIGRATION_APPROVED:0027_example.sql:<approval-hash>'
```

Antes da escrita o executor repete os gates de identidade, Git SHA, SHA-256, fila/digest, integridade e captura um bookmark novo.

A etapa de escrita cria um diretório temporário contendo **somente** a migration autorizada e uma configuração Wrangler isolada apontando `migrations_dir` para esse diretório. O diretório completo `migrations/` do repositório nunca é entregue ao comando de apply.

Isso é importante porque a história do projeto pode conter migrations locais anteriores intencionalmente pendentes. Elas são exibidas no relatório, mas não são executadas por inferência.

## 5. Pós-validação automática

Depois que Wrangler retorna sucesso, o executor verifica:

- presença da migration exata no ledger remoto;
- `PRAGMA quick_check = ok`;
- zero linhas em `PRAGMA foreign_key_check`;
- bookmark capturado imediatamente antes da escrita.

O resultado é salvo em relatório JSON local.

Uma validação somente leitura também pode ser repetida depois:

```bash
npm run migration:postvalidate:production -- --migration 0027_example.sql
```

## Falhas e resultado desconhecido

Se o apply chegou a iniciar e qualquer etapa posterior falhar, não repita automaticamente. Considere `writesMayHaveOccurred=true`, preserve o bookmark e faça apenas verificação read-only até determinar o estado real do ledger e do schema.

Se qualquer dado auditado divergir antes do apply, o executor encerra com `AUDIT_DRIFT_DETECTED`; é obrigatório gerar um novo audit e obter nova autorização.

## Regra permanente

CI verde, Preview verde, PR aprovada, merge, deploy, acceptance, habilitação de feature flag ou autorização de outra migration não substituem a autorização explícita da migration atualmente auditada.
