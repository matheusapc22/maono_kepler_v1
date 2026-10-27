# Manutenção de lint separada das subabas Admin

Base: `e47deac18888195b945a244dadb9e27c5902638f` (`mano_kepler_v1`). Branch: `chore/product-lint-maintenance`. A PR254 de Organizações permanece separada em `270b3dd9aae8aeb36d26e6c236774ff259b553b2`.

**Draft: lint global ainda falha.** Resultado local em 27/10/2026: um erro no Carto e 29 avisos, contra 109 erros e 44 avisos na base. Nenhuma regra, severidade, opção do compilador ou assertion foi relaxada. Avisos de hooks remanescentes não foram corrigidos mecanicamente.

## Implementação

- Separação de componentes TSX e módulos de hooks, contextos, tipos e funções puras. Entradas públicas `.ts` mantêm os nomes exportados; os consumidores declaram a extensão `.ts` para evitar a prioridade diferente dos resolvers. Os componentes permanecem em `.tsx`.
- Declarações para as superfícies efetivamente usadas de bibliotecas JavaScript/Flow e tipos de props, refs, ações, reducers e adaptadores Kepler. Diferenças nas declarações nativas são documentadas no ponto de integração, preservando payloads e protótipos.
- Remoção de imports, callbacks vazios e dois arquivos Dropbox sem referências; correções mecânicas de escapes, const e expressão de callback.
- Login Dropbox: executor de Promise síncrono e propagação das falhas de conta/storage, com limpeza do listener. Testes cobrem popup aberto/bloqueado e rejeições; não houve login real.
- Foursquare: escopos de OAuth no campo suportado `authorizationParams`, preservando os mesmos valores; resultado ausente de regex segue a rejeição existente de ID ausente. Nenhuma autenticação real.
- Importação: URL vazia segue a ação de erro existente; amostras toleram a ausência do reducer legado `routing`. O painel SQL usa a exportação raiz de `@kepler.gl/duckdb`, publicada pela versão 3.2.0 resolvida pelo lock versionado.
- Clustering: tipagem do contrato de CompositeLayer para as subcamadas e dos dados/hover; preservados agrupamento nativo, filtros, histerese e recibos de captura.

Os contratos de preservação continuam usando hashes históricos. A extração é invertida somente por trechos exatos para comparar os chamadores; 29 definições movidas também têm hashes AST independentes da base. Um teste comprova que mutações na política movida e no chamador são detectadas.

## Validação inicial, checkpoint eba159e3

| Gate local | Resultado |
| --- | --- |
| TypeScript aplicação | Pass; supressão Carto antiga ainda presente |
| TypeScript configuração Node/Vite | Pass |
| Regressão consolidada, 20 arquivos sequenciais | 265 pass, 0 fail, 0 skip; 83,19 s |
| Lint global | **Fail: 1 erro / 29 avisos** |
| Auditoria de mensagens com baseline estrito | Pass; baseline intacto |
| `git diff --check` | Pass |
| Build e navegador da manutenção | Não executados; janela local reservada às demais subabas |
| CI desta manutenção | A registrar após publicação; não inferir dos resultados da PR254 |

A suíte consolidada cobre sessão/ACL, gerenciador de permissões, carregamento, engine adapter, overlays, preservação de Usuários/Projects, importação, OAuth simulado e clustering com classes nativas. Testes de actions/reducers usam Redux real e fronteiras de SDK controladas; não equivalem a integração com provedor remoto. Os resultados 197, 27, 3 e 5 de execuções intermediárias se sobrepõem aos 265 e não devem ser somados.

O workflow novo executa lint global e contratos novos em jobs independentes, em toda PR para a branch de produto, sem filtro de caminhos ou `continue-on-error`. O erro restante continua falhando. Os demais workflows existentes permanecem intactos; isso não torna checks obrigatórios na proteção da branch.

## Correção da compatibilidade com a instalação de CI

O CI do checkpoint inicial falhou antes do navegador: `SqlPanel` não existe no subpath `/components` do Kepler 3.2.0, e os dados Arrow são `unknown` no schema 4.3.4. A validação local anterior usava Kepler 3.2.6 e não comprovava essa combinação. Não foi alterado `package.json`, `yarn.lock`, qualquer regra ou opção TypeScript para corrigir a falha.

Um snapshot isolado do SHA inicial foi instalado a partir de `package.json` e `yarn.lock`. A resolução gerou um package-lock local, não incluído na PR; `npm ci` materializou 1.541 pacotes, sem scripts e com um download por vez. O snapshot usa Windows/Node 24.15.0/npm 11.12.1, enquanto o CI usa Linux/Node 22.23.3/npm 10.9.9: não são ambientes idênticos. Ele reproduziu os dois erros de CI e três erros adicionais de declaração de clustering nesse layout.

As correções restauram o import público da versão resolvida, validam os batches Arrow antes de acessar seus campos e recuperam props/state/construção a partir do tipo da base real `CompositeLayer`. O construtor executado e os arrays de batches permanecem os mesmos. Entradas Arrow malformadas são rejeitadas antes de chamar o plugin ou agendar tarefas.

Os contratos adicionais de Usuários/Projects preservam os hashes históricos e as fixtures de extração: o leitor agora recompõe também a separação do módulo de permissões. O contrato de importação executa a declaração da fábrica nativa instalada e verifica a identidade do componente de upload; as verificações de seletor de arquivo, botão e click permanecem. O workflow registra versões instaladas e inclui esses contratos em toda PR de produto.

Após a correção, TypeScript app e Node/Vite passaram no snapshot limpo; **122 testes em dez arquivos passaram, zero falhas/skips**, incluindo classes nativas de clustering. Essa contagem se sobrepõe à bateria inicial de 265 e não deve ser somada. Build/navegador locais continuam aguardando a janela coordenada; novo CI precisa de confirmação própria. [Diagnóstico, logs com hashes e manifesto atualizado](product-lint-ci-compatibility.json).

O check Cloudflare `122423118649` informa apenas `Build failed`. Seu log detalhado exigiu login na aba isolada, fechada sem autenticação; a causa própria permanece desconhecida. Não se atribui ao Cloudflare a causa do GitHub Actions sem o log correspondente.

## Resolução explícita das entradas públicas

No SHA `69abc1f`, Synthetic Contracts, Ticket Center, Save Contract e Cloudflare Pages passaram. O Reliability, entretanto, falhou no bundling da fixture real de preview: o esbuild escolhe `.tsx` antes de `.ts`, enquanto o build da aplicação escolhia a entrada pública `.ts`. Os três hooks de loading acabavam lendo a implementação do componente, que já não exportava `useLoading`.

A instalação limpa reproduziu exatamente os três erros de exportação. A correção atualiza 62 imports em 52 consumidores, incluindo reexports, import dinâmico, fixtures e spec de navegador. Eles apontam às entradas `.ts` reais. Nenhum alias ou substituto de provider foi introduzido; a única fronteira simulada no teste da fixture é o preloading de rotas que já existia no spec de navegador. Não foi alterada a ordem de resolução do esbuild.

O contrato novo audita imports em `src`, `tests` e `scripts`, verifica que a forma antiga é detectada, compila as 14 entradas públicas com seus nomes exportados históricos e compila a fixture `project-preview-pipeline` com a resolução padrão. Ele integra o job de manutenção em todas as PRs de produto. Imports sem extensão para esses pares `.ts`/`.tsx` passam a ser rejeitados por esse contrato, para que a ambiguidade não reapareça.

As verificações de preservação recompõem somente os imports exatos alterados; hashes históricos, definições movidas, baselines de erros e regras ESLint permanecem intactos. A rodada de sete arquivos passou com **170 testes, zero falhas/skips**. Os quatro contratos novos também passaram na instalação limpa; essas contagens se sobrepõem. Lint dos 52 consumidores: **zero erros e quatro avisos**. Build e navegador locais completos continuam dependentes da janela coordenada; bundling da fixture não é aceite de navegador. Resultados do próximo SHA precisam ser confirmados no CI.

TypeScript passou na instalação limpa, e os quatro avisos de lint são idênticos aos desses arquivos no checkpoint anterior. A auditoria de erros foi verificada pelas funções exportadas `scanRepository`, `summarize` e `compareWithBaselineExact`, sem alterar o scanner ou o baseline. Ressalva dos registros locais anteriores: a saída vazia do CLI no Windows não comprovava a auditoria, pois sua comparação de pathname não invoca `main` nessa plataforma. Essa evidência vazia deve ser desconsiderada; o resultado verificável e os hashes estão em [product-lint-entrypoint-resolution.json](product-lint-entrypoint-resolution.json).

## Arquivos compartilhados e integração das outras PRs

Revisar conflitos nas entradas e implementações de `src/auth/session`, `src/components/loading/LoadingProvider`, `src/components/access/OrganizationPermissionManager`, `src/pages/Projects`, `MapPanelContext` e `KeplerEngineAdapterProvider`. Não substituir versões de Usuários/Projetos pelo arquivo desta manutenção. Aplicar a separação de imports sobre a versão final de cada implementação e repetir seus contratos. O manifesto inicial foi preservado em `product-lint-maintenance-validation.json`; o atualizado está em `product-lint-ci-compatibility.json`.

Não foram alterados endpoints, migrations, ACLs, credenciais ou flags. Não houve merge, auto-merge ou operação em Produção. A branch e worktree funcional de Organizações foram preservadas.

## Bloqueio e reversão

O patch ampliado do Carto foi **rejeitado pela revisão automática de aprovação**, não aplicado e não repetido. A [proposta específica](product-lint-carto-proposal.md) identifica as mudanças de comportamento que aguardam autorização. O único erro global está nesse módulo; o arquivo conserva somente a correção mecânica de callback já feita no primeiro commit de manutenção.

Enquanto não integrada, a reversão é encerrar a PR draft mantendo o checkpoint disponível. Se integrada futuramente, reverter os commits desta manutenção em ordem inversa e validar imports/consumidores conjuntamente; não remover módulos extraídos isoladamente. Não há reversão de dados ou migration nesta frente.
