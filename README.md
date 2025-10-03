# Maono

Este repositório contém a aplicação web (Vite + React) e uma API em Node.js que utiliza PostgreSQL via Prisma para persistir dados de usuários, projetos e camadas.

## Front-end

Os scripts originais do Vite continuam disponíveis:

```bash
# Instalação das dependências do front-end
yarn install

# Ambiente de desenvolvimento
yarn dev
```

## Back-end

A API está localizada em `server/` e utiliza PostgreSQL. Utilize o `yarn` ou `npm` de sua preferência dentro desse diretório.

### Configuração do banco

1. Crie um banco de dados PostgreSQL acessível pela aplicação.
2. Copie `server/.env.example` para `server/.env` e ajuste a variável `DATABASE_URL` com as credenciais do seu banco.

```bash
cd server
cp .env.example .env
# Edite o arquivo gerado para ajustar usuário, senha e host
```

### Instalação e geração do cliente Prisma

```bash
cd server
yarn install
# ou npm install

yarn run generate
```

### Migrações

O esquema está versionado em `server/prisma/schema.prisma` e as migrações SQL vivem em `server/prisma/migrations/`.

Para aplicar as migrações no banco configurado no `.env`, execute:

```bash
cd server
yarn run migrate
```

Em ambientes de desenvolvimento é possível utilizar o Prisma CLI diretamente:

```bash
npx prisma migrate dev --name init
```

### Executando a API

```bash
cd server
yarn run dev
```

A API ficará disponível em `http://localhost:3001` com os seguintes endpoints principais:

- `GET /health` – Verificação simples de funcionamento.
- Rotas administrativas em `/admin` para criação e atualização de usuários e projetos.
- Rotas de membros em `/members` para consultar projetos de um usuário e gerenciar camadas.

A API lê as credenciais de banco a partir de `server/.env` durante o bootstrap e inicializa uma conexão do Prisma com PostgreSQL. Em caso de falha de conexão ou erros de consulta, as rotas retornam status HTTP 500 com uma mensagem amigável.
