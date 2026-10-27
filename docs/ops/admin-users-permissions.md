# Usuários e Permissões - funcionamento

Entrega isolada sobre `e47deac18888195b945a244dadb9e27c5902638f`, branch
`feat/admin-users-permissions`. Integração humana futura; sem merge nesta tarefa.
O PDF acompanha este guia e registra o snapshot de testes e a PR.

## Finalidade e acesso

Em `/admin?section=users`, a lista permite buscar por nome, e-mail, organização ou
perfil e filtrar por organização, perfil e situação. O editor conserva quatro áreas:
Dados do usuário, Organizações, Funcionalidades e Delegação. A aparência, densidade,
sidebar, fonte e rotas do Admin permanecem as do workspace vigente.

O acesso ao Admin continua sujeito à sessão e à ACL existente. A atribuição de
organizações por `/api/admin/users/:id/organizations/:organizationId` continua
exclusiva de Super Admin. A rota administrativa legada de vínculo conserva
`admin.panel.access` por organização. As rotas organizacionais continuam exigindo
suas permissões específicas; os testes não autorizam operações em contas reais.

## Operações existentes preservadas

- **Novo usuário:** cadastro com senha inicial validada e hash protegido.
- **Dados:** nome, e-mail, perfil e situação. Salvar valida no servidor; erro mantém
  o rascunho. Senha vazia mantém a atual; troca confirmada invalida sessões. A troca
  da própria senha conserva o fluxo de sessão invalidada.
- **Organizações:** controle explícito de vínculo e seletor Viewer/Editor/Owner.
  Uma operação em andamento bloqueia outra mutação do mesmo editor.
- **Funcionalidades:** usa `OrganizationPermissionManager` existente, com concessões,
  revogações, negações e limites da organização preservados.
- **Delegação:** catálogo e elegibilidade existentes, com controle de versão ao salvar.
  Mudança concorrente continua sujeita ao conflito de versão do serviço.
- **Excluir usuário:** confirmação e políticas existentes de autoexclusão e proteção
  de Super Admin. Histórico de chamados que impede exclusão continua impedindo-a;
  nenhuma cascata foi adicionada para contornar retenção.

## Implementado nesta entrega

O último responsável deixa de depender de uma contagem feita antes da escrita.
A condição agora participa do UPDATE/DELETE/UPSERT executado pelo SQLite. A
remoção de vínculo e a limpeza dos acessos adicionais ocorrem em batch transacional;
se houver falha na limpeza, o vínculo é restaurado pelo rollback.

A proteção cobre a rota de vínculo do editor, a rota administrativa legada, a
remoção organizacional, a atualização organizacional, a reatribuição de vínculo
existente e a desativação/exclusão global. Alterações globais consideram todas as
organizações afetadas. Um responsável inativo ou de outra organização não satisfaz
a condição. Schemas com `organization_users.active` também respeitam essa elegibilidade.

O caso bloqueado retorna 409 e explica que é necessário manter outro responsável
ativo. Para alterações compostas, todas as escritas dependentes usam a mesma
condição: conta, senha, sessões, vínculo e auditoria não recebem uma alteração
parcial quando a proteção rejeita a operação.

Na interface, exclusão, vínculo e delegação agora usam a mesma trava síncrona das
ações salvar/criar. Respostas antigas não alteram outro usuário, uma seleção
reaberta ou um componente desmontado. Troca da identidade administradora recria
o editor. Atualizações incidentais de callbacks não reinicializam o rascunho.
Uma falha de recarga após escrita confirmada é comunicada separadamente do sucesso
da escrita. Erro de leitura de vínculos não aparece simultaneamente como lista vazia.

## Salvaguardas e limites

Não há nova migration, trigger, tabela, dependência de pacote ou flag. O schema e
a ordem das migrations existentes permanecem intactos. A solução usa o contrato
transacional de [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
Não depende de um valor de `changes()` propagado entre statements; cada escrita
possui sua condição e os resultados servem para confirmar a resposta.

Os testes são locais/sintéticos: handlers reais, SQL real, adaptador de batch e
duas conexões SQLite em workers independentes. Os navegadores executam a aplicação
compilada com HTTP interceptado e origens externas bloqueadas. Isso não é aceite
em Produção nem prova do estado de migrations, Dropbox ou usuários reais.

Dados e controles de negócios já existentes não foram substituídos por um módulo
novo. Não foram criados convites, recuperação de senha por e-mail, bulk actions,
auditoria universal ou gestão de credenciais externas. As outras cinco subabas
ficam somente no [planejamento versionado](admin-subtabs-evolution.md).

## Verificação reproduzível

```sh
node --experimental-strip-types --test tests/admin-users-*.test.mjs tests/owner-retention-sqlite-workers.test.mjs tests/user-mutation.test.mjs tests/password-management.test.mjs tests/user-management-evolution.test.mjs tests/access-delegation.test.mjs tests/admin-user-organization-assignment-ui.test.mjs tests/admin-user-manager-delegation-map.test.mjs tests/ticket-command-admin-retention.test.mjs tests/admin-progressive-loading.test.mjs tests/initial-loading-presentation.test.mjs tests/projects-fallback-scope.test.mjs
npx tsc -b --pretty false
VITE_MAONO_MAP_SHELL_V1=true VITE_MAONO_LAYER_MANAGER_V1=true VITE_MAONO_MAP_OVERLAY_V1=true npm run build
npx playwright test --config=playwright.admin-users.config.ts
```

O config local reserva porta 4195, pasta de resultados própria e um worker. O
workflow Progressive Loading inclui os novos contratos e casos nos três motores.
Os testes de preservação usam inversão exata desta alteração; os hashes anteriores
continuam fixos, com canários que rejeitam remoção das salvaguardas.

## Integração pendente e reversão

A PR #254 de Organizações também altera `functions/_lib/organizations.js`. A futura
integração deve revisar os trechos compartilhados e repetir os gates de ambos os
trabalhos. O lint global preexistente deve ser resolvido na manutenção coordenada;
o resultado do lint de escopo não substitui esse gate nem autoriza declarar ready.

Antes do merge humano, revisar CI do SHA exato da PR e as limitações registradas no
PDF. Para reverter após eventual integração, reverter a PR isoladamente e repetir
os gates. Não há rollback de schema nesta entrega. A reversão reabre a corrida do
último owner: restringir as operações afetadas enquanto se prepara a correção.
