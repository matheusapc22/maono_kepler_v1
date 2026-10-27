# Gestão de Organizações: integração e operação

Estado em 27/10/2026: candidato integrado localmente em `feat/admin-organizations-management`, baseado em `381c93256d985b0ae39722128fc4ad54f17f025f` de `mano_kepler_v1`. PR ainda não publicada. Nenhum merge, deploy, migration remota, alteração de flags ou credencial nova.

## Origem

ZIP fornecido pelo usuário em Downloads: 176.092 bytes, SHA-256 `9199bc47f3ec81146c254caa75e96a6d26b2f5163058a838f4b3d3551c5026bf`. As 31 entradas passaram na verificação CRC e de caminhos. Os 30 arquivos do manifesto coincidiram em tamanho e hash. Entry points Aplicar.mjs e Criar_PR.ps1 foram inspecionados, mas não executados. Somente transformações puras revisadas e arquivos selecionados foram incorporados à worktree dedicada.

Há README, documentação e manual PDF de 14 páginas. O plano separado do handoff e a imagem de referência não estão no ZIP. Nenhuma equivalência visual com referência ausente é afirmada.

## Funcionalidade e limitações

- Indicadores globais, filtros, paginação, seleção por página e CSV protegido contra fórmulas.
- Cadastro com responsável existente, edição com versão, pausa preservando recursos, reativação e verificação explícita de armazenamento.
- Responsável principal entre proprietários ativos, sem mudar papel global. Remoção/rebaixamento do vínculo ou desativação da conta exige substituição do responsável.
- Plano e quota operacional de projetos. Limites de usuários, armazenamento e exportações não são editáveis; não há cobrança automática.
- Aprovação atômica de pedidos de plano/projetos. Outros tipos podem ser consultados e recusados, sem aprovação fictícia.
- CSV e lotes com progresso por item, idempotência vinculada ao operador e retomada explícita. Fechar a página interrompe as próximas etapas; não há worker em background.
- Documentos apenas em consulta, com encaminhamento confirmado para a área existente. Histórico começa com a migration, sem eventos retrospectivos inventados.

A API exige Super Admin e admin.panel.access, reavaliados por request/item. Operações pertencem à conta criadora. POST exige JSON, origem compatível e cabeçalho próprio. Dados administrativos não usam cache público.

## Correções da integração

1. O schema completo inclui a tabela histórica de solicitações da 0007 antes da 0042. O pacote a pressupunha e quebrava a inicialização.
2. Consultas legadas do lifecycle preservam a forma e as proteções; escrita gerencial acrescenta versão separadamente.
3. Auditoria legada registra os valores anteriores reais, sem atribuir mudanças ao ator anterior. Proteção de responsável também cobre INSERT.
4. Armazenamento pendente retorna partial. A UI permite verificação para organizações ativas pendentes. Pastas legadas incompatíveis continuam bloqueadas, sem mudança silenciosa de raiz.
5. A leitura inicial da operação não sobrepõe resultados confirmados. O shell já remonta o contexto quando identidade/permissões mudam.
6. A fixture de persistência agora devolve linhas para SELECT/RETURNING em D1 batch, conforme o contrato do banco.

## Validação local

Comando executado:

```text
node --test --test-reporter=tap tests/organization-management.test.mjs tests/organization-management-integration.test.mjs tests/organization-lifecycle.test.mjs tests/organization-lifecycle-concurrency.test.mjs tests/organization-lifecycle-wiring.test.mjs tests/project-creation-limits.test.mjs
```

**88 testes passaram, zero falhas e zero skips.** Nove casos executam sessões, permissões, Pages route, lifecycle, auditoria e quota reais sobre SQLite completo. Apenas HTTP do Dropbox é simulado. Cobrem revogação, isolamento de operadores, criação idempotente, pausa sem perda, concorrência, prontidão parcial, solicitação/quota efetiva, auditoria e migration sobre dados existentes. Schema migrado e completo coincidem; quick_check retorna ok e foreign_key_check não retorna violações.

Oito fontes TS/TSX passaram no parsing; **isso não é typecheck**. Manual revisado, renderizado e inspecionado em 14 páginas. Métricas sintéticas do pacote não comprovam integração ou desempenho.

Pendente: lint completo, TypeScript, build, regressões ampliadas, 13 casos Playwright preparados, branch/PR draft e CI do SHA remoto. Instalação/build/browser aguardam janela coordenada com a Central. Preview e Produção não foram validados.

## Migration e rollback

0042_organization_management.sql adiciona plano/quota/versão/responsável, eventos/operações e proteções SQL. Pressupõe solicitações e reservas (0007/0016), além do schema de documentos. Não houve colisão de nome no SHA-base. Recalcular o hash final antes de auditoria: o hash do SQL original do ZIP não identifica esta revisão.

Migration executada somente em SQLite isolado. Não é auditoria D1 remota. Não executar apply geral, Preview com binding real ou migration remota como efeito de build/merge. AGENTS.md continua determinando o procedimento humano em Produção.

O código usa VITE_ORGANIZATION_MANAGEMENT_V1 na compilação e ORGANIZATION_MANAGEMENT_V1 na API; criação/edição de quota requer PROJECT_QUOTA_RESERVATION_V1. Valores de fixture/CI não autorizam ativação em ambiente implantado.

Rollback de código não desfaz quotas, vínculos, pastas ou operações. Desligar flags não elimina triggers. Não há down migration destrutiva: preservar estruturas aditivas e inspecionar operações parciais antes de qualquer recuperação autorizada. Após responsáveis/quotas persistidos, as restrições continuam valendo com código antigo.

## Manual

scripts/documentation/build-organization-manual.py gera o Markdown e o PDF com ReportLab e fontes Vera. Atualizar o estado de validação e re-renderizar antes da entrega final. Identidade Library original e versão desconhecida seguem preservadas no registro local; não houve substituição na Library indisponível.
