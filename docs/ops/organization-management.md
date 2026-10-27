# Gestão de Organizações: integração e operação

Estado em 27/10/2026: candidato na branch `feat/admin-organizations-management`, reconciliado com `mano_kepler_v1` em `e47deac18888195b945a244dadb9e27c5902638f` após a PR 253. Publicado na PR draft #254; o CI por SHA na PR determina o resultado remoto. Lint global preexistente impede declarar pronto. Nenhum merge desta funcionalidade, deploy direto, migration remota, alteração de flags implantadas ou credencial nova.

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

- **542 regressões aprovadas, 0 falhas, 2 skips** em 44 arquivos de teste, sequencialmente. Os skips são casos Bash do operador de recuperação, incluídos no CI Linux. Cobertura de lifecycle/storage/readiness/drift/chaos/error-contract/quota, usuários/ACL/persistência e schema de chamados após o merge da PR 253. Entre esses testes, 14 integram o novo módulo com schema, sessões, permissões, Pages handler, lifecycle e quotas reais em SQLite; HTTP Dropbox é simulado.
- **TypeScript completo e build aprovados**. Vite: 11.945 módulos, 8m 3s. Flags somente no processo local do build/fixtures; nenhuma flag implantada foi alterada.
- **20 testes de navegador aprovados**: 19 no build compilado com flag ON e um no servidor dev com flag explicitamente OFF. Chromium local com um worker; quatro fluxos usam backend real da fixture. Revogação, resposta atrasada, filtros/URL, teclado/foco, toque, UTF-8 e cinco viewports inspecionados permanecem cobertos. Nenhum teste humano com leitor de tela foi realizado.
- **Lint do escopo: 10 arquivos TS/TSX, 0 erros e 0 avisos**. Os demais arquivos alterados não são cobertos pela configuração ESLint existente. Lint global anterior: **109 erros e 44 avisos** em 68 arquivos; todos os arquivos com problemas e a configuração são idênticos à base atual e à base original. Comparativo em [organization-management-lint-baseline.json](organization-management-lint-baseline.json). Não houve nova varredura global local após reconciliar a base, correção fora de escopo ou relaxamento de regras. CI mantém o lint completo em job independente, sem mascarar suas falhas. A branch não exige checks obrigatórios, conforme a auditoria de merge abaixo.
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

scripts/documentation/build-organization-manual.py gera o Markdown e o PDF com ReportLab e fontes Vera. Edição 1.5 revisada com os resultados locais, limitações e distinção entre CI, Preview e Produção. Identidade Library original e versão desconhecida seguem preservadas no registro local; não houve substituição na Library indisponível.

## Correções encontradas pelo CI inicial

O adaptador passou a usar o transporte e o catálogo de erros compartilhados, preservando status/referência para diagnóstico sem exibir mensagens remotas. Três novos testes verificam respostas de acesso, payload malformado, falha de rede e cancelamento. Os botões usam StaticLoadingText do produto, preservando o rótulo durante operações. Auditoria estrita sem drift, 70 testes de erro aprovados (com sobreposição às regressões), seis testes de loading aprovados. Não houve alteração de baseline, regras, asserts ou timeouts para obter aprovação.

## Composição das suítes de navegador

O gate geral de desenvolvimento mantém os 290 casos anteriores. Os 19 novos casos de Organizações executam integralmente no gate compilado próprio, com a flag local necessária. A descoberta foi comparada antes/depois por arquivo, linha e título: nenhum caso anterior removido; os dois arquivos novos coincidem exatamente com os 19 casos da configuração dedicada. Nenhum assert, skip ou timeout foi alterado. Essa correção trata a descoberta indevida dos novos casos pelo servidor dev sem a funcionalidade habilitada.

## Matriz de flags e gatilhos

| Condição | Cobertura |
| --- | --- |
| Interface ON e backend habilitado | 19 casos no build compilado, incluindo quatro fluxos com handlers locais reais. |
| Interface OFF | Novo caso no servidor dev com flag explicitamente false: tabela legada, ações novas ausentes, nenhum request à API de gestão ou escrita. O StrictMode faz dois lotes exatos dos quatro GETs legados. |
| API OFF | Teste existente exige 503 / ORGANIZATION_MANAGEMENT_DISABLED; não simula sucesso. |
| Descoberta | 290 casos gerais anteriores preservados + um OFF novo; os 19 ON permanecem integralmente na suíte compilada. |
| Gatilhos | Organization Management executa ON e OFF em toda PR para mano_kepler_v1, sem filtros de caminho, condições de skip ou continue-on-error; workflow_dispatch preservado. |

Auditoria de merge: o GitHub retornou `Branch not protected` para mano_kepler_v1 e nenhum ruleset. Executar o workflow automaticamente não impede merge manual com checks pendentes/falhos. Nenhuma regra de repositório foi alterada; não se afirma que o novo check é obrigatório na proteção da branch. A PR permanece draft. Esta é uma limitação real do controle de merge, separada do resultado dos testes.
