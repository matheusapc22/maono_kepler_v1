# S02 - Create / Edit / View definitivos

## Objetivo

Eliminar a ambiguidade entre criação de um projeto novo e abertura de um projeto já persistido.

## Contrato efetivo

- Novo projeto: `/maps/new/create`
- Projeto existente editável: `/projects/:slug/edit`
- Projeto existente somente leitura: `/projects/:slug/view`
- Entrada neutra de projeto existente: `/projects/:slug/manage`
- Compatibilidade temporária: `/projects/:slug/create` redireciona para `/projects/:slug/manage`

## Invariante

Um projeto existente nunca pode ser resolvido em `mode=create`, nunca recebe `openCreateWorkspace`, `createProject` ou `initializeMap`, e nunca deve exibir simultaneamente identidade de projeto persistido com os estados visuais `CRIAÇÃO` / `NOVO MAPA`.

## Backend

`/api/projects/:slug/map-navigation` passa a usar `project-map-navigation-service.js`, política de navegação de projeto existente versão 3.

A política consulta apenas permissões pertinentes ao projeto existente:

- `project.view`
- `project.save`
- `project.map.edit`
- `project.edit`
- `project.thumbnail.update`

`project.create` deixa de participar da decisão de navegação de um projeto existente.

`manage` resolve em ordem:

1. `editor`, quando permitido;
2. `viewer`, quando edição não é permitida;
3. bloqueio, quando visualização também não é permitida.

Uma requisição explícita `mode=create` para um projeto existente retorna `410 PROJECT_CREATE_ROUTE_DEPRECATED` e informa `/projects/:slug/manage` como rota substituta.

## Frontend

`MapManagementPage` deixa de considerar `availablePanels.create` e redireciona apenas para `edit` ou `view`.

`/projects/:slug/create` não monta mais `KeplerApp`; a rota existe somente durante a janela de compatibilidade e executa redirect `replace` para `/manage`, preservando query string.

## Criação real

O fluxo `/maps/new/create` permanece inalterado e continua usando o contexto dedicado de criação, sem `project` persistido.

## Limpeza técnica

- removida a influência de `project.create` do caminho canônico de projeto existente;
- capacidades exclusivas de criação são forçadas para `false` em contexto de projeto existente;
- endpoint passa a depender do novo serviço canônico, deixando o resolver antigo fora do caminho HTTP efetivo;
- teste de arquitetura protege rotas, prioridade `edit -> view`, status 410 e ausência de capacidades de criação.

## Compatibilidade e retirada futura

A rota `/projects/:slug/create` permanece apenas como redirect temporário. A remoção física da rota e do código legado de resolução `create` existente no serviço histórico deve ocorrer em etapa de contract/cleanup posterior, quando telemetria e logs confirmarem ausência de clientes antigos utilizando o endereço.
