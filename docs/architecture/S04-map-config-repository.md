# S04 — MapConfigRepository

## Objetivo

A S04 introduz uma porta explícita entre a camada de Application e o storage físico do MapConfig.

```text
Application
    ↓
MapConfigRepository
    ↓
DropboxMapConfigRepository
    ↓
Dropbox/local-d1 adapter
```

A aplicação não deve chamar funções específicas do Dropbox para carregar ou persistir MapConfig.

## Porta

`MapConfigRepository` possui quatro operações obrigatórias:

- `load()` — carrega a configuração lógica/publicada, incluindo fallback legado durante a fase EXPAND;
- `saveRevision()` — persiste bytes de uma configuração, em modo imutável ou overwrite legado temporário;
- `getRevision()` — carrega exatamente a revisão informada, sem fallback;
- `getMetadata()` — consulta metadata de storage sem carregar o conteúdo completo.

O repository expõe também `provider` como identificação lógica necessária ao ledger S03.

## Responsabilidades

### Application

Permanece responsável por:

- lifecycle;
- optimistic concurrency/CAS;
- reserva e publicação no ledger `project_config_revisions`;
- SHA-256 e verificação de integridade;
- parse/validação JSON;
- idempotência e recuperação de resposta perdida;
- sincronizações auxiliares do Control Plane.

### MapConfigRepository

Responsável somente por:

- localizar o objeto físico correspondente a uma referência Maõno;
- ler/gravar bytes;
- obter metadata do provider;
- normalizar erros de infraestrutura para códigos `MAP_CONFIG_*`.

### DropboxMapConfigRepository

É a implementação inicial. Somente este adapter do domínio MapConfig pode importar as primitivas de `dropbox.js`.

## Referência opaca

A S04 preserva o contrato introduzido pela S03:

```text
project-config://<projectId>/revisions/<revision>
```

A referência pertence ao domínio Maõno e não contém caminho Dropbox.

O nome físico versionado continua compatível:

```text
config.kepler.r000018.json
```

Não há migration ou alteração de schema na S04.

## Compatibilidade legada

Enquanto existirem projetos com `lifecycle_state IS NULL`, o repository suporta `legacy-overwrite` para o arquivo canônico. Projetos gerenciados usam exclusivamente `immutable`.

Quando a reconciliação S03 atingir zero projetos ACTIVE legados, o modo de overwrite poderá ser removido numa fase CONTRACT posterior.

## Fora do escopo

A S04 não abstrai:

- thumbnails/previews;
- datasets;
- exports;
- arquivos administrativos genéricos;
- quota;
- troca de Dropbox por R2/S3;
- chunked upload para arquivos grandes.

Esses domínios devem possuir portas próprias quando necessário.

## Gate arquitetural

É regressão se `project-config-service.js` ou `project-lifecycle-reconciler.js` importar `dropbox.js`.

É permitido que endpoints/serviços de preview continuem usando Dropbox até existir uma porta específica para preview.
