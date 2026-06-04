# Guardião de arquivos que NÃO devem ir para o Git

Este documento serve como lembrete operacional para evitar que arquivos locais, sensíveis ou temporários sejam enviados para o GitHub no projeto **Maõno Kepler / Maõno Maps**.

A regra é simples:

> Se o arquivo contém segredo, configuração local, credencial, token, senha, hash real, banco local, dump, cache ou dado temporário, ele NÃO deve ir para o Git.

---

## 1. Arquivos que NÃO devem ser commitados

### Nunca enviar para o Git

```txt
.env
.env.*
.dev.vars
wrangler.toml
update-dev-user.sql
```

### Motivo

| Arquivo | Motivo para não enviar |
|---|---|
| `.env` | Pode conter tokens, chaves, URLs privadas, credenciais e variáveis reais de ambiente. |
| `.env.*` | Variações de ambiente também podem conter segredos reais. |
| `.dev.vars` | Arquivo local usado pelo Wrangler/Cloudflare. Pode conter variáveis sensíveis. |
| `wrangler.toml` | Pode conter IDs reais de D1, nomes de projetos, configurações de deploy e ambiente. |
| `update-dev-user.sql` | Pode conter e-mail, hash real de senha e comandos locais de usuário de desenvolvimento. |

---

## 2. Arquivos que podem existir, mas apenas como exemplo

Estes arquivos podem ir para o Git porque não devem conter segredos reais:

```txt
.env.example
wrangler.toml.example
seed.example.sql
```

Regras:

- Use valores fictícios.
- Nunca coloque token real.
- Nunca coloque senha real.
- Nunca coloque hash real de usuário.
- Nunca coloque `database_id` privado se você não quiser expor essa configuração.

Exemplo seguro:

```env
DROPBOX_APP_KEY="COLOQUE_SUA_CHAVE_AQUI"
DROPBOX_APP_SECRET="COLOQUE_SEU_SECRET_AQUI"
SESSION_SECRET="TROQUE_ESSA_CHAVE_NO_AMBIENTE_REAL"
```

---

## 3. Regra para o `wrangler.toml`

O arquivo real:

```txt
wrangler.toml
```

Deve ficar apenas no computador local.

O arquivo que pode ir para o Git é:

```txt
wrangler.toml.example
```

Antes de commitar, confirme que o `wrangler.toml` real está ignorado no `.gitignore`.

---

## 4. Regra para scripts SQL locais

Scripts SQL genéricos podem ser versionados:

```txt
schema.sql
seed.example.sql
migrations/*.sql
```

Scripts SQL locais ou com dados reais não devem ser versionados:

```txt
update-dev-user.sql
sync-remote-projects-local.sql
```

Se precisar manter esses arquivos no projeto local, coloque em uma pasta ignorada, por exemplo:

```txt
.local-sql/
```

E adicione ao `.gitignore`:

```gitignore
.local-sql/
```

---

## 5. Checklist antes de cada commit

Antes de rodar `git add .`, execute:

```bash
git status --short
```

Verifique se aparecem arquivos proibidos:

```txt
.env
.env.*
.dev.vars
wrangler.toml
update-dev-user.sql
```

Se aparecerem, NÃO faça commit.

---

## 6. Comandos de segurança

### Ver arquivos que seriam enviados

```bash
git status --short
```

### Ver arquivos ignorados

```bash
git status --ignored --short
```

### Ver se algum arquivo sensível está rastreado pelo Git

```bash
git ls-files | findstr /I ".env .dev.vars wrangler.toml update-dev-user.sql"
```

No PowerShell:

```powershell
git ls-files | Select-String -Pattern "\.env|\.dev\.vars|wrangler\.toml|update-dev-user\.sql"
```

Se algum aparecer, ele já está rastreado pelo Git e precisa ser removido do versionamento.

---

## 7. Como remover do Git sem apagar do computador

Use `git rm --cached`.

```bash
git rm --cached .env
git rm --cached .dev.vars
git rm --cached wrangler.toml
git rm --cached update-dev-user.sql
```

Depois confirme:

```bash
git status --short
```

E faça commit apenas da remoção do rastreamento e do `.gitignore` atualizado.

---

## 8. Bloco recomendado no `.gitignore`

Garanta que o `.gitignore` contenha:

```gitignore
# Ambiente local / segredos
.env
.env.*
.dev.vars
*.local

# Configuração real local do Cloudflare/Wrangler
wrangler.toml

# SQL local com dados reais
update-dev-user.sql
.local-sql/

# Documentação e mapas gerados localmente
documentacao-projeto/
```

Atenção: mantenha versionado apenas:

```txt
wrangler.toml.example
seed.example.sql
```

---

## 9. Regra mental final

Antes de enviar qualquer arquivo para o Git, pergunte:

1. Este arquivo é necessário para outro dev rodar o projeto?
2. Ele contém segredo, token, senha, hash, ID real ou configuração privada?
3. Ele é só do meu computador?
4. Ele foi gerado automaticamente?

Se a resposta para 2, 3 ou 4 for **sim**, provavelmente ele não deve ir para o Git.

---

## 10. Lista rápida

### Pode ir para o Git

```txt
README.md
package.json
yarn.lock
vite.config.ts
tsconfig.json
tsconfig.app.json
tsconfig.node.json
tailwind.config.js
eslint.config.js
wrangler.toml.example
seed.example.sql
migrations/*.sql
src/**
functions/**
public/**
```

### Não deve ir para o Git

```txt
.env
.env.*
.dev.vars
wrangler.toml
update-dev-user.sql
.local-sql/**
documentacao-projeto/**
```
