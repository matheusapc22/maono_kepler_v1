# Manutenção de lint separada das subabas Admin

Base: `e47deac18888195b945a244dadb9e27c5902638f` (`mano_kepler_v1`). Branch: `chore/product-lint-maintenance`. A PR254 de Organizações permanece separada em `270b3dd9aae8aeb36d26e6c236774ff259b553b2`.

**Draft: lint global ainda falha.** Resultado local em 27/10/2026: um erro no Carto e 29 avisos, contra 109 erros e 44 avisos na base. Nenhuma regra, severidade, opção do compilador ou assertion foi relaxada. Avisos de hooks remanescentes não foram corrigidos mecanicamente.

## Implementação

- Separação de componentes TSX e módulos de hooks, contextos, tipos e funções puras. Entradas `.ts` mantêm os caminhos públicos sem extensão; imports explícitos foram ajustados. Os componentes permanecem em `.tsx`.
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

## Arquivos compartilhados e integração das outras PRs

Revisar conflitos nas entradas e implementações de `src/auth/session`, `src/components/loading/LoadingProvider`, `src/components/access/OrganizationPermissionManager`, `src/pages/Projects`, `MapPanelContext` e `KeplerEngineAdapterProvider`. Não substituir versões de Usuários/Projetos pelo arquivo desta manutenção. Aplicar a separação de imports sobre a versão final de cada implementação e repetir seus contratos. O manifesto inicial foi preservado em `product-lint-maintenance-validation.json`; o atualizado está em `product-lint-ci-compatibility.json`.

Não foram alterados endpoints, migrations, ACLs, credenciais ou flags. Não houve merge, auto-merge ou operação em Produção. A branch e worktree funcional de Organizações foram preservadas.

## Bloqueio e reversão

O patch ampliado do Carto foi **rejeitado pela revisão automática de aprovação**, não aplicado e não repetido. A [proposta específica](product-lint-carto-proposal.md) identifica as mudanças de comportamento que aguardam autorização. O único erro global está nesse módulo; o arquivo conserva somente a correção mecânica de callback já feita no primeiro commit de manutenção.

Enquanto não integrada, a reversão é encerrar a PR draft mantendo o checkpoint disponível. Se integrada futuramente, reverter os commits desta manutenção em ordem inversa e validar imports/consumidores conjuntamente; não remover módulos extraídos isoladamente. Não há reversão de dados ou migration nesta frente.
