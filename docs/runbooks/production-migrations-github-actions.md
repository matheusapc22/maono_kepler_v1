# GitHub Actions — operador protegido de migrations D1

## Objetivo

Executar audit e migrations de produção sem entregar o token Cloudflare ao Codex, ao ChatGPT ou a um ambiente geral de agente.

O segredo fica exclusivamente em um GitHub Environment protegido. O job só recebe o segredo depois que as regras do environment forem satisfeitas.

Fluxo:

`Codex prepara → CI valida → GitHub Action audit → STOP → autorização humana por hash → GitHub Action apply → re-audit → apply isolado → pós-validação`

## GitHub Environment obrigatório

Crie no repositório o environment `production-d1-migrations`.

Configuração recomendada:

- Required reviewers: o proprietário/operador humano responsável pelas migrations.
- Se houver apenas um operador e ele mesmo disparará o workflow, não habilite `Prevent self-review`; com um segundo revisor confiável, prefira habilitá-lo.
- Deployment branches/tags: permitir somente a branch `main`.
- Environment secret: `MAONO_D1_MIGRATION_API_TOKEN`.
- O valor do secret é o token Cloudflare dedicado com D1 Write criado para migrations.
- Não criar esse token como repository secret e não colocá-lo em variáveis comuns.

O Account ID e o UUID do D1 já são valores públicos/pinados no operador. O único segredo necessário é o token dedicado.

## Por que o workflow vive em `main`

`workflow_dispatch` só fica disponível para execução manual quando o arquivo do workflow existe na branch padrão do repositório. O operador em `main` sempre faz checkout da branch de produto `mano_kepler_v1`, fixa seu SHA e recusa drift antes de qualquer acesso Cloudflare.

## Audit

No GitHub: Actions → `Production D1 migration operator` → Run workflow.

Use branch do workflow `main`, mode `audit`, o nome exato da migration e deixe `approval_hash` vazio.

O job protegido aguardará a aprovação do environment. Depois executará somente leitura e registrará o approval hash. O status esperado é `AWAITING EXPLICIT PRODUCTION AUTHORIZATION`; nenhuma migration é aplicada no modo audit.

## Autorização

Depois do audit, a autorização humana deve citar a migration e o approval hash exatos.

Exemplo: `Autorizo executar em produção a migration 0027_example.sql, approval <hash>, no D1 maono_maps.`

## Apply

Abra novamente o workflow, escolha mode `apply`, informe a mesma migration e os 64 caracteres do approval hash.

O job volta a aguardar a aprovação do environment. Depois reconfirma o SHA de `mano_kepler_v1`, executa novo audit read-only, recalcula o hash, bloqueia qualquer drift e só então chama o executor isolado. Ledger e integridade são pós-validados e as evidências sanitizadas ficam como artifact por 14 dias.

## Postvalidate

O modo `postvalidate` é somente leitura e pode ser usado posteriormente para confirmar ledger e integridade.

## Segurança operacional

- O workflow só aceita dispatch pelo proprietário do repositório e somente a partir de `main`.
- O token não é disponibilizado ao job de validação nem às actions de checkout/setup/upload.
- O job remoto usa o environment `production-d1-migrations`.
- O token é injetado somente nas duas etapas shell que validam/operam o Cloudflare D1.
- `actions/checkout`, `actions/setup-node` e `actions/upload-artifact` são pinadas por commit SHA.
- O SHA de `mano_kepler_v1` é fixado antes da aprovação do environment e reconferido depois.
- Mudança de SQL, Git SHA, fila pendente ou D1 invalida o approval hash.
- Artifacts removem o approval token executável e o comando de apply; preservam apenas evidências necessárias.
- O YAML nunca executa `wrangler d1 migrations apply` diretamente; o único write path é o executor isolado testado.
- Nunca copie o token para comentários, artifacts, logs, issues, prompts ou arquivos versionados.
