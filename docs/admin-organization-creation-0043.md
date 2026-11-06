# Criação individual de organizações e migration 0043

A criação individual recebe nome, descrição, plano e `ownerEmail`. O backend calcula o hash desse pedido antes de gerar o identificador. Uma operação nova e sua reserva de sufixo, slug e pasta são gravadas no mesmo `D1Database.batch()`. Repetições da chave retornam a operação existente. Há até 12 tentativas em colisões; nenhuma delas deixa uma operação incompleta no banco. O sufixo criptográfico contém nove dígitos, inclusive zeros à esquerda; a base ocupa no máximo 54 caracteres.

`0043_organization_creation_identity.sql` acrescenta a chave canônica de nome, seus índices únicos e as reservas de identidade. Índice de sufixo e triggers impedem colisão com cadastros antigos, importações e escritas pelo lifecycle legado. O formato CSV e os slugs explícitos de operações antigas são preservados. Uma nova criação individual gera a identidade no servidor mesmo se um cliente anterior ainda enviar um slug. Nenhum identificador ou caminho antigo é reescrito.

Os nomes usam NFKC, espaços reduzidos e comparação sem distinção entre maiúsculas e minúsculas, preservando acentos. Runtime e operador importam a mesma função pura de `functions/_lib/organization-name.js`. Registros históricos mantêm `canonical_name = NULL`: toda gravação pelo lifecycle consulta também esses nomes com essa função. Novas inserções e renomeações gravam a chave sob restrição única, inclusive pelos endpoints legados. A pré-consulta da interface não substitui a restrição do banco.

## Publicação pendente de autorização

O operador protegido de 0043 já está implementado; siga o [runbook de identidade](runbooks/organization-identity-0043.md). A migration ainda depende de audit, autorização humana específica, apply isolado e pós-validação. Nenhuma dessas ações remotas foi executada nesta PR.

Para diagnóstico local de um inventário exportado, o preflight aceita:

```sh
node scripts/migrations/preflight-organization-identity.mjs inventario.json
```

O inventário deve ser um array de linhas com `id`, `name`, `slug` e `dropbox_root_path` explícitos. IDs devem ser inteiros positivos e únicos; os três campos textuais devem conter texto não vazio. Pastas ausentes ou nulas são rejeitadas, pois o schema exige `dropbox_root_path NOT NULL`. Entradas malformadas interrompem a auditoria sem emitir aprovação.

**Um array isolado não comprova completude nem autoriza produção.** O audit protegido coleta contagem, todas as linhas (inclusive pausadas), ledger e schema no mesmo snapshot, valida a correspondência e vincula seus digests ao hash da autorização e aos guards transacionais.

O relatório contém IDs e tipos de conflito, sem nomes/e-mails. Qualquer conflito canônico, numérico ou de pasta bloqueia a aplicação; a ferramenta não corrige, renomeia, move ou exclui dados. O índice SQL também recusa sufixos históricos duplicados. SQLite/D1 não fornece a normalização Unicode do JavaScript: o preflight Unicode é obrigatório, e não pode ser substituído por `lower(trim(name))`.

Siga integralmente o operador protegido e as etapas de `AGENTS.md`, incluindo auditoria, SHA-256, inventário de pendências e autorização humana específica. A referência estrutural de 0042 continua certificando exclusivamente o schema até 0042 e rejeita os novos objetos de 0043. O bootstrap funcional inclui 0043 e seu hash está fixado; o gerador de referências reconstrói 0042 antes de aplicar a fonte exata de 0043, preservando os perfis históricos e a certificação anterior.

Após audit, relatório e autorização específica, o operador aplica somente 0043 e exige pós-validação completa. Repita essa pós-validação imediatamente antes do rollout funcional: o runtime anterior pode omitir a chave canônica e permitir conflitos Unicode depois da migration. Conflitos bloqueiam a publicação e exigem decisão explícita; não há reparação automática. Uma eventual pausa de escritores depende de planejamento e autorização operacional separados.

O código gerencial retorna indisponibilidade até detectar 0043. Planeje a publicação de código e schema de forma coordenada; não use um frontend novo contra uma API antiga. Nenhuma migration remota, flag, merge ou publicação de produção integra esta PR.

## Confirmação e recuperação

O diálogo mostra apenas `UniversalLoader` durante a criação e consulta final. O sucesso exige item `succeeded`, leitura pelo `result.id`, vínculo owner ativo, correspondência com o responsável e plano do pedido, evento real de configuração inicial e armazenamento READY/ACTIVE/CONFIGURED. Depois fecha o diálogo, preserva filtros e confirma na tela principal.

Cada requisição de criação/etapa tem limite de 20 segundos e cada consulta de confirmação/retomada, 15 segundos. A expiração não cancela uma escrita do servidor: a interface mantém a tentativa e consulta a operação antes de qualquer novo avanço. Leases de cinco minutos continuam sendo respeitados. `done` com item parcial ou falho nunca é sucesso. Falha de atualização da listagem não invalida uma criação confirmada.

Referências: [transações batch do D1](https://developers.cloudflare.com/d1/worker-api/d1-database/) e [padrão WAI-ARIA de combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
