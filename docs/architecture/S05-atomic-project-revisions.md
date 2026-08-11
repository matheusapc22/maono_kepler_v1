# S05 — Revisionamento, checksum e save atômico

## Objetivo

Cada save de um projeto gerenciado pelo lifecycle cria exatamente uma revisão lógica `N+1`, preserva as revisões anteriores e só altera a revisão corrente depois que os bytes persistidos forem verificados.

```text
serialize
  ↓
validate
  ↓
candidate checksum
  ↓
reserve N+1
  ↓
write immutable revision
  ↓
read back
  ↓
verify checksum + size
  ↓
READY
  ↓
CAS publish current revision
```

A atomicidade da S05 é **atomicidade de publicação**. Dropbox e D1 não compartilham uma transação ACID. Uma revisão pode existir no storage sem estar publicada, mas o usuário só enxerga a revisão apontada pelo HEAD no D1.

## Identidade da revisão

A identidade lógica é:

```text
(project_id, revision)
```

Exemplo:

```text
project_id = 84
revision   = 43
```

Essa identidade não contém Dropbox path, Dropbox rev nem qualquer detalhe do provider. Ela será a mesma referência lógica a ser consumida futuramente por Load Guard e por materializações PostGIS.

## HEAD e histórico

`project_config_revisions` é o histórico imutável.

`projects.config_revision` é o HEAD atual.

```text
revision 41 READY
revision 42 READY
revision 43 READY  ← HEAD
revision 44 FAILED
```

`READY` não significa `CURRENT`. Uma revisão só se torna corrente quando o `UPDATE projects ... WHERE config_revision = expected` é concluído por CAS.

## Metadados autoritativos

A S05 preserva as colunas introduzidas na migration 0018:

```text
projects.config_revision          → currentRevision
projects.config_checksum          → contentHash
projects.config_checksum_algorithm
projects.config_size_bytes
projects.config_schema
projects.config_schema_version
projects.config_storage_ref
```

Não existe uma segunda coluna `current_revision`: `config_revision` continua sendo a única fonte da verdade persistida para o HEAD.

## Checksum

O hash lógico da Maõno é SHA-256 dos bytes UTF-8 exatos persistidos.

O pipeline serializa apenas uma vez. Os mesmos bytes são usados para:

- validação;
- checksum candidato;
- persistência;
- verificação pós-write.

Após o write, a revisão é relida por `MapConfigRepository.getRevision()` e seu checksum/tamanho são comparados ao candidato antes de o ledger ser marcado `READY`.

`storage_provider_hash` continua sendo metadata do provider e não substitui `config_checksum`.

## Imutabilidade

Para `mode=immutable`, `(projectId, revision)` identifica um único conteúdo.

- revisão inexistente: pode ser criada;
- mesma revisão + mesmos bytes: retry idempotente;
- mesma revisão + bytes diferentes: `MAP_CONFIG_REVISION_IMMUTABILITY_VIOLATION`.

O modo `legacy-overwrite` continua temporariamente disponível apenas para projetos com `lifecycle_state IS NULL`. Ele deve ser removido somente na fase CONTRACT, depois de `remainingLegacyActive = 0`.

## Estados do ledger

```text
WRITING → bytes ainda não confirmados
READY   → bytes existem e passaram por integridade
FAILED  → revisão não pode ser publicada
```

Falhas registram estágio específico quando aplicável:

```text
RESERVE
WRITE
VERIFY
PUBLISH
```

Falhas de serialize/validate ocorrem antes da reserva e portanto não criam uma revisão artificial no ledger.

## Concorrência

O publish usa optimistic concurrency/CAS:

```text
expected = 42
next     = 43

UPDATE projects
SET config_revision = 43, ...
WHERE config_revision = 42
```

Dois clientes que editaram a revisão 42 não podem publicar conteúdos diferentes como revisão 43. Apenas um HEAD avança; o cliente stale recebe `PROJECT_CONFIG_REVISION_CONFLICT`.

## Resposta perdida

Se a revisão 43 foi publicada, mas a resposta HTTP se perdeu, um retry com `expected=42` e o mesmo checksum reconhece que 43 já é o resultado desejado e responde de forma idempotente, sem criar a revisão 44.

## Falhas parciais

### Falha no write

```text
revision 43 → FAILED
HEAD permanece 42
```

### Checksum pós-write divergente

```text
revision 43 → FAILED / VERIFY
HEAD permanece 42
```

### Storage pronto, publish ainda não concluído

```text
revision 43 → READY
HEAD permanece 42
```

A revisão READY pode ser retomada/revalidada por retry; ela não é pública até o CAS.

## Compatibilidade futura

A referência comum das próximas camadas será `(project_id, revision)`:

```text
MapConfig revision 43
       ├── Load Guard(project_id=84, revision=43)
       └── PostGIS(source_project_id=84, source_revision=43)
```

Load Guard e PostGIS ficam fora do escopo da S05.

## Banco

A S05 não cria migration. O schema necessário já existe desde `0018_project_lifecycle.sql`.

## Fora de escopo

- chunked upload para grandes MapConfigs;
- preview/thumbnail;
- datasets;
- exports;
- Load Guard;
- PostGIS;
- remoção do fallback legado.

## Gates

A S05 deve falhar no CI se qualquer uma destas invariantes quebrar:

1. N+1 não gerar objeto distinto;
2. revisão anterior desaparecer ou mudar;
3. mesma revisão aceitar conteúdo diferente;
4. checksum pós-write não ser verificado antes do publish;
5. mismatch mover o HEAD;
6. FAILED virar HEAD;
7. CAS permitir dois vencedores;
8. retry idempotente criar revisão adicional;
9. leitura ACTIVE deixar de verificar checksum/tamanho.
