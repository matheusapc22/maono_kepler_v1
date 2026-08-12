# GATE A — Fundação estável

## Regra

A nova infraestrutura de performance só começa quando este gate estiver verde em CI, Preview e smoke de produção.

## Garantias agregadas

### Login e sessão

- login válido produz sessão autenticada;
- login inválido retorna erro AUTH determinístico;
- logout zera a sessão;
- falha transitória de infraestrutura preserva estado conhecido quando aplicável;
- troca de organização não mistura contexto entre organizações.

### Projeto e navegação

- slug + sessão + organização + modo resolvem contexto autoritativo;
- viewer/editor respeitam capacidades e permissões;
- projeto ausente ou proibido não cai em fallback de outra organização.

### Criação

- lifecycle segue `DRAFT -> PREPARING_STORAGE -> CONFIG_READY -> ACTIVE`;
- criação publicada aponta para revisão imutável válida.

### Leitura e configuração

- a revisão publicada é lida pelo repository de MapConfig;
- size/checksum/schema são validados antes do uso;
- config inválida não chega à hidratação da engine.

### Edição e revisão

- save usa expected revision;
- conflito de revisão não sobrescreve HEAD mais novo;
- publicação avança atomicamente para nova revisão.

### Erros

Todo erro público relevante preserva:

- `code`;
- `category`;
- `retryable`;
- `correlationId`.

### Observabilidade de abertura

Carregamento bem-sucedido produz exatamente o prefixo completo:

`MAP_OPEN_REQUESTED -> SESSION_RESOLVED -> PROJECT_RESOLVED -> LOAD_GUARD_STARTED -> CONFIG_REQUESTED -> CONFIG_VALIDATED -> MIGRATED -> ENGINE_HYDRATION_STARTED -> MAP_READY`.

Todos os eventos compartilham o mesmo `correlationId`. `MAP_READY` ocorre uma única vez. Em erro terminal, `MAP_READY` não é emitido.

### Privacidade

Nenhum trace contém MapConfig, GeoJSON, datasets, rows, features, coordenadas, tokens, cookies, caminhos de storage ou SQL.

## Comando de gate

```bash
npm run test:foundation-gate
```

O comando agrega a suíte funcional existente de projetos e a suíte de observabilidade S07.

## Condição de saída

GATE A PASS exige:

1. build verde;
2. `npm run test:foundation-gate` verde;
3. Cloudflare Preview verde;
4. smoke view/edit/reload/save/reload sem regressão;
5. pelo menos um trace real terminando em `MAP_READY` com nove eventos em ordem;
6. pelo menos um erro controlado terminando sem `MAP_READY` e com envelope S06 correlacionado.

Nenhuma meta de tempo absoluto é exigida neste gate. A S07 mede a baseline; otimização começa depois.
