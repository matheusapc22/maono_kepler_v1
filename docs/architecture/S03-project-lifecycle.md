# S03 — Project Lifecycle

Status: implementação em Draft na PR S03.

## Objetivo

A S03 transforma o lifecycle do projeto em uma autoridade explícita do Control Plane e introduz lineage imutável para revisões de configuração.

A presença de `projects.lifecycle_state` é uma fronteira irreversível do rollout:

- `lifecycle_state IS NULL`: projeto legado ainda não reconciliado;
- `lifecycle_state = ACTIVE`: projeto publicável;
- qualquer outro estado gerenciado: projeto não publicável normalmente.

O campo `projects.active` permanece apenas como projeção temporária de compatibilidade.

## Máquina de estados

```text
DRAFT
  -> PREPARING_STORAGE
       -> CONFIG_READY
            -> ACTIVE
       -> FAILED
            -> PREPARING_STORAGE

ACTIVE -> ACTIVE
```

Transições diretas que pulem invariantes são rejeitadas.

## Invariantes de ACTIVE

Um projeto gerenciado somente pode entrar em `ACTIVE` quando possui:

- `config_revision > 0`;
- `config_checksum`;
- `config_checksum_algorithm`;
- `config_storage_ref`;
- `config_schema`;
- `config_schema_version > 0`;
- `config_size_bytes > 0`.

`storage_ref` e checksum completo são internos e não fazem parte do DTO público.

## Revisões de configuração

`project_config_revisions` é o ledger das revisões.

Uma revisão segue:

```text
WRITING -> READY -> publicação do ponteiro em projects
```

A revisão `READY` não é sobrescrita por outro conteúdo. O objeto físico é versionado, por exemplo:

```text
config.kepler.r000018.json
```

O Control Plane usa uma referência opaca:

```text
project-config://84/revisions/18
```

O caminho físico Dropbox/local-D1 permanece responsabilidade do adapter.

## Integridade

O checksum de domínio é:

```text
SHA-256(bytes UTF-8 exatos persistidos)
```

em hexadecimal lowercase.

Hash, revision, object id ou ETag do provider são metadados independentes e não substituem o checksum Maõno.

O loader de projeto gerenciado verifica o checksum antes de fazer `JSON.parse()` e antes da hidratação do engine.

## Concorrência e recuperação

O editor envia `expectedConfigRevision` correspondente à revisão carregada.

A publicação usa compare-and-swap sobre `projects.config_revision` e sobre o lifecycle esperado. Um editor atrasado recebe `409 PROJECT_CONFIG_REVISION_CONFLICT`.

Se N+1 já tiver sido publicada com o mesmo checksum e somente a resposta anterior tiver se perdido, o retry é tratado como sucesso idempotente.

Falhas ao preparar uma nova revisão de um projeto `ACTIVE` não alteram o lifecycle do projeto; a revisão vigente N continua publicável.

## Preview e quota

Preview, quota e project lifecycle são domínios separados.

Exemplos válidos:

```text
project = ACTIVE
preview = FAILED
```

```text
project = FAILED
quota = PROCESSING
```

Uma falha de preview ou indisponibilidade temporária de storage durante leitura não transforma um projeto `ACTIVE` em `FAILED`.

## Feature flag

Existe uma única flag backend:

```text
PROJECT_LIFECYCLE_V1
```

Ela é somente um kill switch de admissão de novos projetos durante rollout.

Desligar a flag não pode fazer um projeto que já possui `lifecycle_state` voltar ao arquivo legado ou ao protocolo antigo de save.

## Política de consistência D1

Para a S03, o contrato operacional assume o binding D1 autoritativo usado atualmente, sem habilitar read replication no caminho crítico do lifecycle.

Enquanto a aplicação depender desta política:

- criação -> redirect -> load deve consultar o mesmo Control Plane autoritativo;
- save -> confirmação -> refresh deve ler o estado publicado pelo Control Plane;
- recovery deve consultar o estado autoritativo antes de repetir storage writes.

Se read replication for habilitada futuramente, a ativação deve vir acompanhada de D1 Sessions/bookmarks (ou outra garantia equivalente de read-your-writes) nos fluxos acima. Não habilitar read replication nesses caminhos sem esse gate.

## Rollout obrigatório

A migration e o deploy de código não são intercambiáveis. O código S03 consulta colunas criadas pela `0018_project_lifecycle.sql`.

Ordem segura:

1. criar Time Travel/bookmark do D1;
2. confirmar a lista real de migrations aplicadas;
3. aplicar **somente** `0018_project_lifecycle.sql`;
4. verificar colunas, tabela `project_config_revisions` e índices;
5. executar `PRAGMA foreign_key_check`;
6. manter leitura compatível com projetos legados (`lifecycle_state IS NULL AND active = 1`);
7. deploy do código S03;
8. iniciar reconciliação em lote pequeno para uma organização;
9. validar checksum, storage versionado, ledger e carregamento;
10. ampliar lotes gradualmente;
11. somente após `legacy active unresolved = 0`, planejar a fase CONTRACT.

**Não fazer deploy do código S03 antes da migration 0018.**

## Reconciliação legada

Endpoint operacional:

```text
POST /api/admin/project-lifecycle/reconcile
```

Características:

- Super Admin;
- organização ativa;
- lote de 1 a 25;
- cursor por `project.id`;
- idempotente;
- lê os bytes reais do objeto legado;
- valida JSON Kepler;
- calcula SHA-256 dos bytes reais;
- cria cópia versionada imutável;
- registra ledger;
- só então define `lifecycle_state = ACTIVE`.

Projetos legados `active = 0` permanecem não resolvidos e não são convertidos automaticamente em `FAILED`.

## Fronteira administrativa

A API administrativa não pode fabricar um `ACTIVE` sem as invariantes da S03.

Uma criação administrativa sem configuração cria apenas a identidade `DRAFT`.

Para projetos já gerenciados:

- `active` não pode ser usado para alterar existência/publicabilidade;
- soft-deactivate por `active = 0` é rejeitado enquanto não existir um estado de arquivamento/desativação formal no domínio;
- hard delete continua uma operação administrativa explícita.

## Fora do escopo

A S03 não implementa:

- PostGIS físico;
- dataset fingerprints/catalog espacial;
- thresholds finais do Load Guard;
- MVT;
- envelope `maono-map` completo;
- Migration Registry completo;
- troca de Dropbox por R2/S3;
- remoção imediata de `active`, `dropbox_root_path` ou demais campos legados.
