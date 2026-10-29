# Manutenção de lint separada das subabas Admin

Base: `e47deac18888195b945a244dadb9e27c5902638f` (`mano_kepler_v1`). Branch: `chore/product-lint-maintenance`. A PR254 de Organizações permanece separada em `270b3dd9aae8aeb36d26e6c236774ff259b553b2`.

**Draft: validação local concluída; CI do novo SHA e ensaio conjunto ainda precisam de confirmação.** Lint global: zero erros e 28 avisos; TypeScript e build aprovados. O patch Carto específico foi autorizado, aceito pela revisão e aplicado. Nenhuma regra, severidade, opção do compilador ou assertion foi relaxada. As seções anteriores à validação final registram snapshots históricos, inclusive falhas e negativas já superadas.

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

## Contratos de preservação e instalação do CC07 após b7485405

Os jobs Users Access, Project Pages, Ticket Center e Foundation falharam em cinco assertions distintas: uma inversão de loading, dois hashes de Projects/sidebar e duas verificações da forma do código de clustering. A execução local anterior à correção reproduziu as cinco falhas (37 pass, 5 fail). Isso exigiu revisar o comportamento, não recalibrar hashes.

Os leitores de preservação agora aplicam a inversão exata de imports que já existia, antes das demais inversões. Os hashes históricos e seus testes de mutação permanecem iguais. A emissão JavaScript de `projects-api.ts` e `ProjectsSidebar.tsx` é idêntica à de `69abc1f`; os imports alterados eram somente de tipos.

No clustering, a revisão identificou uma diferença real adicional: a tipagem por parâmetro rest havia mudado a aridade observável do callback de três para zero. A correção mantém três parâmetros formais com os tipos nativos. A emissão JavaScript canônica do hook inteiro volta a ser idêntica à da base `e47deac`. Os testes executam o callback real e verificam aridade, identidade do payload e pedido de frame sem alterar o zoom. Também executam os dois filtros reais de camadas e compilam a entrada pública de bridge/store/hook para verificar notificações, cleanup e troca de controller. Somente o agendamento React é controlado; isso não equivale a aceite com ReactDOM ou navegador.

As duas falhas adicionais reportadas depois pelo Progressive Loading tinham a mesma omissão na preservação de Admin. Foram reproduzidas separadamente (16 pass, 2 fail). O leitor recompõe os imports antes de comparar o predecessor e antes de testar cada mutação de ACL, endpoints, concorrência, totais e retry. Os hashes e todas as assertions permanecem iguais.

Validação final desta rodada: **98 pass, zero falhas/skips**, com o commit histórico de Projects obrigatório e disponível; **9 pass** de camadas também no snapshot limpo (contagem sobreposta). A execução intermediária de 80 está contida nos 98. TypeScript passou no snapshot com Kepler 3.2.0. Lint do hook: zero erros e três avisos de dependências de hooks já existentes. O job de contratos da manutenção agora inclui esses quatro arquivos e exige histórico Git completo e baseline histórico disponível, em todas as PRs de produto.

Uma execução ampliada local de 269 testes teve **257 pass e 12 fail**, portanto não é aceite verde. As falhas restantes aparecem em project-header, projects-fallback, roadmap, ticket-document e ticket-optional: há caminhos `URL.pathname` incompatíveis com Windows e comparações diretas sensíveis ao CRLF do checkout. Esses arquivos de teste não foram ajustados para mascarar a execução. O log completo foi preservado; resultados Linux do novo SHA ainda precisam confirmar os gates. A execução do Progressive Loading no CI de `b7485405` havia reportado 231 pass/5 fail, incluindo as duas falhas Admin corrigidas e as três de Projects/loading já corrigidas; o conjunto local ampliado também incluiu testes adicionais de navegação e header.

O CC07 falhou separadamente antes do navegador com TS2614 para `SqlPanel`. Seu comando era o único workflow com `--package-lock=false`. O log antigo não registrou a versão exata instalada; não se atribui um número de versão ao runner sem essa evidência. As duas instalações locais disponíveis mostram contratos distintos: Kepler 3.2.0 exporta `SqlPanel` pela raiz; 3.2.6 o exporta pelo subpath `/components`. O import da aplicação permanece compatível com 3.2.0 do lock versionado.

O CC07 passa a resolver `package.json` e `yarn.lock` numa pasta temporária, gerar um snapshot npm e materializá-lo com `npm ci`. A pasta temporária evita que a normalização de `yarn.lock` feita pelo npm altere o checkout. O job rejeita mudanças no manifesto/lock versionados, registra versões dos SDKs e preserva `package-lock.json` como artefato para reproduzir aquela execução. Alterações de `package.json` ou `yarn.lock` passam a acionar o job. Comandos de TypeScript, lint e navegador, timeout e permissões permanecem iguais. O npm usa o lock Yarn como entrada; o snapshot npm gerado não é uma nova atualização de dependências versionada nesta PR. [Comportamento documentado do npm install](https://docs.npmjs.com/cli/v10/commands/npm-install/) e [instalação pelo snapshot com npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci/).

Não houve build nem navegador local nesta rodada: a janela continuava reservada ao executor Painel. Os próximos resultados Linux/Node 22 do CI devem confirmar o fluxo CC07; TypeScript e contratos locais Windows/Node 24 não o substituem. Lint global permanece bloqueado por Carto (um erro e 29 avisos no CI de `b7485405`). [Manifesto, comparação de emissão e evidências](product-lint-contract-followup.json).

O primeiro CI desta correção, `faa182f9`, passou build, contratos de Access, Foundation e Macro C; a suíte expandida ainda estava em execução no snapshot de 21:31 UTC. O CC07 instalou 1.545 pacotes, mas a verificação de integridade detectou que `yarn.lock` havia sido normalizado no checkout (job `122480560645`). TypeScript e navegador desse job não rodaram. O isolamento foi corrigido: tanto resolução quanto `npm ci` executam agora com diretório de trabalho temporário; só a árvore `node_modules` instalada e o snapshot npm são transferidos ao checkout. A verificação `git diff --exit-code -- package.json yarn.lock` permanece, e a transferência exige ausência de `node_modules` no destino. Scripts de instalação continuam habilitados no `npm ci`; nenhum gate ou regra foi removido. Essa etapa precisa de confirmação própria no CI Linux seguinte.

## Contratos restantes da suíte expandida

A suíte expandida do job `122480561303` em `faa182f9` terminou com 3.346 pass, quatro falhas e um skip, depois de build/Foundation/Macro C aprovados. As falhas foram três leitores estruturais de legenda e uma inversão de gestão de senhas. A correção subsequente não muda código de produção: as verificações de tradução/SI leem o módulo real extraído, e a delegação ao painel nativo é verificada pela AST do JSX emitido, exigindo exatamente o spread de `props` seguido do override de `mapControls`. A formatação gerada pelo compilador e as anotações de tipos deixam de ser confundidas com mudanças de fluxo.

Dois casos adicionais executam os formatadores reais e as declarações reais do wrapper: valores SI, faixas, labels não textuais, preservação de nomes, identidade dos controles/props/callback, coordenadas persistidas, projeção inicial sem dispatch e modo de exportação. React cria os elementos reais; fronteiras de SDK e tema são controladas, sem renderização DOM nem alegação de drag/resize em navegador. A inversão de senhas agora recompõe somente as mudanças exatas da manutenção antes das verificações já existentes; mutações da guarda de concorrência continuam rejeitadas. Endpoints, criptografia, sessões, ACL, fixtures e hashes históricos não mudaram.

Os dois arquivos passaram com **39 pass, zero falhas/skips** tanto na worktree quanto no snapshot com dependências do lock. As contagens se sobrepõem. O job de contratos da manutenção inclui ambos em toda PR de produto. Não se repete TypeScript ou build por esta mudança exclusiva em testes/workflow/documentação; o próximo CI Linux confirma o conjunto. [Evidências e manifesto desta rodada](product-lint-expanded-contracts.json). CC07 no SHA `09f8f3bc` ainda aguardava runner no momento desta validação local; Carto continua bloqueado, sem nova alteração de descrição pública da PR.

## Classificação das 12 falhas locais no Windows

A comparação usou snapshots independentes da base `e47deac` e do candidato `9852f5e6`, Node 24.15.0, as mesmas dependências instaladas e o mesmo padrão CRLF do checkout (`core.autocrlf=true`). Os cinco arquivos de teste tinham bytes idênticos nas duas revisões. Ambos reproduziram **39 pass/12 fail**, com os mesmos nomes de falha; nenhuma das 12 foi introduzida pela manutenção.

| Casos | Quantidade | Causa comprovada e correção |
| --- | --- | --- |
| Preservação do header de Projects | 6 | Leitura CRLF contra blobs/hashes históricos LF; o leitor agora usa a representação LF do Git. |
| Escopo e injeção do CSS de fallback | 2 | Literal lido com CRLF divergia do hash LF e do texto normalizado pela avaliação JavaScript; o fixture normaliza somente os finais de linha. |
| Inversão dos módulos opcionais | 1 | Mesmo descompasso CRLF/LF antes da inversão exata. |
| Render inicial do Roadmap | 1 | `URL.pathname` não é caminho nativo no Windows; conversão com `fileURLToPath` e import com `pathToFileURL`. |
| Inicialização dos testes de Documentos | 1 | Mesmo erro de caminho, incluindo diretório temporário, import e separadores dos filtros existentes do esbuild. |
| Render dos módulos opcionais | 1 | `resolveDir` recebia pathname de URL; agora recebe caminho nativo. |

Não foram recalculados hashes nem removidas assertions. As mutações de CSS, seletor, endpoint, ACL e payload continuam rejeitadas. A limpeza dos diretórios temporários verifica que o destino fica no diretório esperado. Os dois filtros do esbuild em Documentos preservam o stub de preview e a exportação de teste já existentes; somente seus separadores de caminho passaram a reconhecer Windows e POSIX.

Com o mesmo ajuste de harness aplicado a ambos os snapshots, **base e candidato passaram 68/68, sem skips**. A falha de inicialização de Documentos deixa de contar como um teste falho e 18 casos antes bloqueados passam a executar: aumento líquido de 17, de 51 para 68. A repetição da rodada ampliada original passou **286/286, sem skips**, contra 257 pass/12 fail anteriormente. Esses resultados classificam e resolvem as 12 falhas locais; não demonstram, por si, integração remota ou aceite de navegador. [Comparação reproduzível, hashes dos logs e manifesto](product-lint-windows-portability.json).

Na primeira rodada, anterior ao patch Carto, TypeScript e build passaram no snapshot com dependências do lock; o Vite transformou 12.124 módulos e terminou em 11 min 39 s. Uma comparação de 587 arquivos confirmou código, fixtures e configurações correspondentes à candidata, normalizando somente finais de linha. A matriz local Progressive Loading iniciou 573 casos, com um worker e timeouts originais. A interrupção pelo usuário encerrou a sessão após **352 aprovações observadas: Chromium 191/191 e Firefox 161/191**, sem marcador de falha no log. Não houve JSON terminal nem código de saída disponível, portanto naquele momento o gate de navegador estava **incompleto**: faltavam resultados de 30 casos Firefox e dos 191 WebKit. O runner/servidor local deixou de ser encontrado na verificação posterior; não foi reiniciado. CC07, programado para depois, não foi executado. As capturas Admin 1440 e 390 px foram inspecionadas sem cortes visíveis, sem alegação de equivalência à referência visual ausente.

Naquele checkpoint, o reparo Windows ainda estava **não commitado**, sobre `9852f5e6`. Até aquele checkpoint não havia novo push nem alteração da descrição pública. O coordenador informou posteriormente CI terminal nesse SHA: 35 checks aprovados e apenas lint falho; ProjectPages terminou em 27/10/2026 às 22:50:49 UTC. Não se repetiu esse CI. A tentativa Carto com nova autorização também foi rejeitada antes de executar; o [registro da proposta](product-lint-carto-proposal.md) preserva a razão e os hashes. Naquela etapa nenhuma mudança do adaptador havia sido aplicada.

## Validação final do Carto e conclusão local no Windows

Foi aplicado somente o diff Carto aprovado, SHA-256 `4c8679bd7cbc3d643781749289b754fa27b85a30e77369b636c0f646f08987ee`. O arquivo mantém SHA-256 CRLF `2e26ee67f1f533391fa69d7eaad2621e25e57f4eebccd3021bf9e1ad336f1c6b` (LF do Git: `538247cfd2687cd3b7de0d31a770dc657823da80eebea8743e16237b3dce8fec`). Não houve edição adicional do produto nesta rodada. A base real de Provider e os argumentos do toolkit foram preservados; login/logout, recibos, privacidade e erros são cobertos por contratos isolados.

| Verificação local | Resultado |
| --- | --- |
| Lint global, regras existentes | 0 erros, 28 avisos; exit 0 |
| TypeScript, configuração existente e dependências do lock | Pass |
| Build Vite com o patch aplicado | Pass; 12.124 módulos, 7 min 46 s |
| Contratos Carto | 22/22 em cada uma das instalações Kepler 3.2.6 e 3.2.0; contagens sobrepostas |
| Contratos relacionados: providers, extração, exports e scanner | 76/76, sem skips; inclui os 22 Carto |
| SDK Carto real no Chromium | 7 verificações; construtor sem client ID, rejeição sem cliente, usuário ausente, CSV/data container nativos, FileReader e URL privada; zero requisições externas |
| Auditoria estrita de mensagens | 3.222 ocorrências, zero divergências |
| Classificação e correção das 12 falhas Windows | Base e candidato: 68/68; rodada ampliada: 286/286, sem skips |
| Continuação Firefox | 30/30, sem falhas, skips ou flaky; build anterior ao Carto |
| WebKit sobre build final, primeira execução | 126 aprovações observadas antes da desconexão + 63 pass/2 fail na continuação terminal; falhas de foco diagnosticadas abaixo |
| Foco após correção do harness, três engines | 30/30: 2 casos teclado, 2 mouse e 6 cancelamentos por engine; sem falhas, skips ou flaky |
| CC07: avisos e notificações Chromium | 15/15, sem falhas, skips ou flaky |

O scanner passou de seis para duas referências sintáticas a `error.message` no Carto porque a variável validada `message` é reutilizada. Somente essa entrada foi reduzida de 6 para 2 no baseline; não há tolerância adicional, mudança de regra ou regeneração ampla. Isso não representa remoção de quatro exposições de erro ao usuário. Os contratos verificam a propagação das mensagens esperadas e a ausência de conteúdo bruto no console.

A matriz Progressive Loading de 573 casos foi reconciliada por nome/projeto: 352 aprovações observadas antes da primeira interrupção, mais 30 Firefox em continuação terminal. WebKit preservou 126 aprovações observadas antes da desconexão; ausência de runner e porta foi confirmada antes de executar somente os 65 casos restantes, com 63 pass e duas falhas de foco. Chromium 191 e Firefox 191 usaram o build anterior ao Carto; as fases WebKit usaram o build final. **Não foi uma execução única terminal, nem houve repetição completa dos três engines após o Carto.** O CI do novo SHA deve confirmar sua própria matriz. O teste adicional do SDK real não fez OAuth, uso de conta ou gravação remota; seus ajustes de preparação e logs falhos foram preservados no relatório.

As duas falhas foram reproduzidas com captura de eventos: no WebKit deste Windows, mousedown mudou o foco do botão para o ancestral focável antes de onClick. O hook, os dois painéis e o spec anterior são idênticos aos da base; não houve build completo separado da base para esse diagnóstico. O teste misturava foco programático com ativação por mouse. A correção usa Enter para o contrato de teclado, preservando todas as assertions originais, e acrescenta dois casos de mouse que capturam a decisão nativa de foco antes de React e exigem sua preservação. Os seis casos de não roubar foco após outra interação permanecem. Não há exceção por engine, skip, timeout aumentado ou alteração do produto. A matriz focal de 30 casos passou nos três engines. A suíte completa passa a ter 579 casos, mas não foi repetida integralmente localmente. [Eventos, inversão exata do teste, comparação de fontes e resultados](product-lint-focus-validation.json).

Os seis arquivos de teste adicionados ao workflow de manutenção executam em toda PR para `mano_kepler_v1`, sem filtro de caminhos; timeout, regras e exigência do baseline histórico permanecem. A comparação Windows e os artefatos verificáveis estão em [product-lint-windows-portability.json](product-lint-windows-portability.json) e [product-lint-carto-validation.json](product-lint-carto-validation.json). Os resultados não são aceite de Preview, Produção ou integração conjunta das PRs254–261. Nenhum merge, auto-merge, migration ou flag remota foi executado.

## Arquivos compartilhados e integração das outras PRs

Revisar conflitos nas entradas e implementações de `src/auth/session`, `src/components/loading/LoadingProvider`, `src/components/access/OrganizationPermissionManager`, `src/pages/Projects`, `MapPanelContext` e `KeplerEngineAdapterProvider`. Não substituir versões de Usuários/Projetos pelo arquivo desta manutenção. Aplicar a separação de imports sobre a versão final de cada implementação e repetir seus contratos. O manifesto inicial foi preservado em `product-lint-maintenance-validation.json`; o atualizado está em `product-lint-ci-compatibility.json`.

Não foram alterados endpoints, migrations, ACLs, credenciais ou flags. Não houve merge, auto-merge ou operação em Produção. A branch e worktree funcional de Organizações foram preservadas.

## Reversão

As negativas anteriores do Carto foram superadas por autorização específica do diff e por uma nova tentativa aceita. A [identidade do patch e seu histórico](product-lint-carto-proposal.md) e a [validação local](product-lint-carto-validation.json) registram os limites. O lint local está aprovado; isso não substitui o CI do novo SHA nem autoriza este executor a fazer o merge.

Enquanto não integrada, a reversão é encerrar a PR draft mantendo o checkpoint disponível. Se integrada futuramente, reverter os commits desta manutenção em ordem inversa e validar imports/consumidores conjuntamente; não remover módulos extraídos isoladamente. Não há reversão de dados ou migration nesta frente.
