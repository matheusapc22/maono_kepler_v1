# Gestão de Organizações: integração e operação

Estado em 27/10/2026: candidato na branch `feat/admin-organizations-management`, reconciliado com `mano_kepler_v1` em `e47deac18888195b945a244dadb9e27c5902638f` após a PR 253. Preparado para PR draft nova; o CI por SHA na PR determina o resultado remoto. Lint global preexistente impede declarar pronto. Nenhum merge desta funcionalidade, deploy, migration remota, alteração de flags implantadas ou credencial nova.

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

- **533 regressões aprovadas, 0 falhas, 2 skips** em 43 arquivos de teste, sequencialmente. Os skips são casos Bash do operador de recuperação, incluídos no CI Linux. Cobertura de lifecycle/storage/readiness/drift/chaos/error-contract/quota, usuários/ACL/persistência e schema de chamados após o merge da PR 253. Entre esses testes, 14 integram o novo módulo com schema, sessões, permissões, Pages handler, lifecycle e quotas reais em SQLite; HTTP Dropbox é simulado.
- **TypeScript completo e build aprovados**. Vite: 11.945 módulos, 10m31s. Flags somente no processo local do build/fixtures; nenhuma flag implantada foi alterada.
- **18 testes de navegador aprovados**: 17 em execução completa e um teste adicional de toque. Chromium local com um worker, quatro fluxos com backend real da fixture, revogação, resposta atrasada, filtros e URL/back/forward, teclado/foco, UTF-8 e cinco viewports (1774x887, 1366x768, 1920x1080, 768x1024, 390x844). Capturas inspecionadas; a tabela usa rolagem interna em telas pequenas. Não houve teste humano com leitor de tela.
- **Lint do escopo: 8 arquivos TS/TSX, 0 erros e 0 avisos**. Os demais arquivos alterados não são cobertos pela configuração ESLint existente. Lint global anterior: **109 erros e 44 avisos** em 68 arquivos; todos os arquivos com problemas e a configuração são idênticos à base atual e à base original. Comparativo em [organization-management-lint-baseline.json](organization-management-lint-baseline.json). Não houve nova varredura global local após reconciliar a base, correção fora de escopo ou relaxamento de regras. CI mantém o lint completo em job independente e bloqueante.
- Migration sobre dados existentes e schema completo coincidem; `quick_check=ok`, sem violações em `foreign_key_check`. Apenas SQLite isolado.
- Manual PDF/Markdown revisado conforme comportamento e evidência, 14 páginas renderizadas e inspecionadas.

O resultado agregado, limites de ambiente e hashes dos logs locais estão em [organization-management-validation.json](organization-management-validation.json). CI, Preview, Produção e provedor real são evidências distintas; testes locais não comprovam esses ambientes.

### Medição local de escala

Handler real + sessão/ACL + SQLite isolado; 5 aquecimentos e 30 amostras por volume; página de 10 itens. Uma requisição e 8 statements por amostra em todos os volumes. Sem N+1 na quantidade de statements da listagem; o custo dos agregados pode crescer com os registros.

| Organizações | p50 ms | p95 ms | Linhas retornadas pelo banco | Linhas de organizações |
| --- | ---: | ---: | ---: | ---: |
| 6 | 5,98 | 8,43 | 60 | 6 |
| 50 | 3,81 | 9,05 | 64 | 10 |
| 500 | 9,26 | 20,12 | 64 | 10 |

[Resultado bruto](organization-management-benchmark.json). Cada organização tem dois projetos, três registros de arquivo (ativo/lixeira/expurgado) e um vínculo. Duas identidades distintas. Linhas retornadas incluem autenticação e agregados; não representam `rows_read` do D1, que não foi medido. Não mede carregamento completo do navegador, rede ou ambiente implantado. A prévia CSV faz validação por linha, limitada a 100; a medição é da listagem.

## Migration e rollback

0042_organization_management.sql adiciona plano/quota/versão/responsável, eventos/operações e proteções SQL. Pressupõe solicitações e reservas (0007/0016), além do schema de documentos. Não houve colisão de nome no SHA-base. Recalcular o hash final antes de auditoria: o hash do SQL original do ZIP não identifica esta revisão.

Migration executada somente em SQLite isolado. Não é auditoria D1 remota. Não executar apply geral, Preview com binding real ou migration remota como efeito de build/merge. AGENTS.md continua determinando o procedimento humano em Produção.

O código usa VITE_ORGANIZATION_MANAGEMENT_V1 na compilação e ORGANIZATION_MANAGEMENT_V1 na API; criação/edição de quota requer PROJECT_QUOTA_RESERVATION_V1. Valores de fixture/CI não autorizam ativação em ambiente implantado.

Rollback de código não desfaz quotas, vínculos, pastas ou operações. Desligar flags não elimina triggers. Não há down migration destrutiva: preservar estruturas aditivas e inspecionar operações parciais antes de qualquer recuperação autorizada. Após responsáveis/quotas persistidos, as restrições continuam valendo com código antigo. Eventos têm FK com ON DELETE RESTRICT: a exclusão física legada de uma organização com eventos pode ser impedida. A pausa permanece não destrutiva. Qualquer reversão de dados/schema exige avaliação própria e autorização; não há rollback automático que apague recursos.

## Manual

scripts/documentation/build-organization-manual.py gera o Markdown e o PDF com ReportLab e fontes Vera. Edição 1.2 revisada com os resultados locais, limitações e distinção entre CI, Preview e Produção. Identidade Library original e versão desconhecida seguem preservadas no registro local; não houve substituição na Library indisponível.
