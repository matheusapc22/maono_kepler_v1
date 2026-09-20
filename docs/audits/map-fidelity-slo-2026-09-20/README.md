# OB-06 / OB-07 — fidelidade do viewer e observação do SLO

## Base e limites

- Produto: `mano_kepler_v1`, SHA inicial `43d35faeb0ffc4fb3ee003c97282b2476ecb253a`.
- PR #186 integrada em 2026-09-20 18:08:14 UTC. Merge não comprova deploy de Production.
- Trabalho: `audit/map-fidelity-slo-ob06-ob07-20260920`.
- Mantidos: gates, tolerâncias, dependências, restrições de Preview, operadores desligados e Change Requests fora do escopo. Nenhuma migration ou mutação remota autorizada por inferência.
- Planilha de controle: [Trabalhos obrigatórios](https://docs.google.com/spreadsheets/d/1U3vCQ-4u0pZYIEgtBHEBoDf1JAlb2ZBZVpZf8SzdLj8/edit).

## Plano registrado antes da implementação

| Etapa | Execução | Critério / dependência |
| --- | --- | --- |
| F01 | Conferir merge, branch, SHA e ferramentas disponíveis | Base fixa; não confundir Preview da PR com Production |
| F02 | Exercitar hidratação, reducer Maõno, viewer Kepler/deck.gl e serialização existentes com Golden Maps sintéticos | Camadas, filtros, dados, estilos, câmera, clustering e isócronas preservados após remontagem |
| F03 | Comparar framebuffer real antes/depois e controles negativos | Comparação exata no mesmo navegador e estilo local determinístico; canvas vazio não conta como sucesso |
| F04 | Registrar matriz para mapas reais autorizados | Depende das sessões/ambiente de OB-04; leitura de mapas existentes e gravação apenas se ambiente explicitamente permitir |
| S01 | Reconferir contrato, exportadores SQL e algoritmo de SLO existentes | 30 dias, 1.000 organizações novas ativas, 100 incidentes transitórios, metas 99,9%/5 min e 99%/60 min intactas |
| S02 | Testar sequências, fronteiras e falhas controladas relevantes | Fixtures de teste nunca usadas como observação de Production |
| S03 | Verificar disponibilidade de inventário, auditoria, cobertura e evidências independentes de integridade | Sem exportações completas: aceite pendente; sem data/owner inventado |
| S04 | Preparar coleta e fechamento operacional pelo runbook existente | Alvo e versão observados, janela UTC real, follow-up >=1 h, hashes e referências restritas |
| E01 | Registrar achados com reprodução antes de corrigir | Distinguir bug confirmado, hipótese descartada e limitação operacional |
| E02 | Rodar gates afetados, revisar diff e entregar mudanças pequenas | Preservar gates existentes; separar testes/procedimentos de eventual correção funcional |
| E03 | Atualizar controle e evidências | Código/testes concluídos separados do aceite operacional pendente |

## Disponibilidade inicial

Nenhuma sessão autorizada de QA/Preview ou configuração autenticada do Cloudflare foi encontrada no ambiente de execução. As pastas 4, 6 e 7 em Programação foram inventariadas; o ZIP da auditoria contém logs locais, sem exportações reais do SLO. Isso limita o aceite operacional, não demonstra falha do serviço. A janela de observação e os responsáveis nominais continuam por confirmar.

O procedimento de coleta permanece em [PRH-08](../../ops/product-reliability-prh08-acceptance.md); inclusive `dry-run` de operador escreve auditoria e não será usado como leitura.

## Achado reproduzido: OB07-A01

**Confirmado no validador, sem ocorrência demonstrada em Production.** Duas observações iniciais com o mesmo `incidentId`, organização e `firstFailedAt`, mas `retryable` contraditório, produziam `PASS`. O algoritmo verificava identidade/início, porém conservava a primeira classificação sem confrontar outra observação inicial. Isso permitia um relatório favorável com evidência internamente inconsistente. Não demonstra perda de dados ou indisponibilidade do serviço.

- Reprodução: `npm run test:reliability-slo`, teste `classificações iniciais contraditórias do mesmo incidente invalidam a evidência` sobre o código inicial. A fixture existente de 1.000 organizações / 101 incidentes recebe uma segunda observação inicial do incidente 101 com classificação oposta. Esperado `INVALID`; observado `PASS`.
- Correção: confrontar `retryable` quando ambas as observações são iniciais; contradição resulta em `INVALID` / exit code 2. Repetição consistente permanece válida. Uma falha permanente posterior continua sem apagar a classificação transitória inicial.
- Evidência: baseline 26/26; regressão antes 28/29, falha `PASS !== INVALID`; depois 30/30. Quatro mutantes mortos, sem timeout: contradição ignorada, amostra insuficiente aprovada, READY sem verificação física, deadline alterado.
- Hipóteses descartadas nos casos testados: ordem das linhas altera métricas; cobertura 1 ms menor passa por arredondamento; observação inicial repetida infla a coorte.

## OB-06: roteiro de aceite no ambiente autorizado

Responsável de execução: QA de mapas; aceite: produto. Nomes, sessão, ambiente e autorização de gravação ainda pendentes. Usar a versão realmente implantada (frontend/API), identificada por evidência do provedor; o SHA do merge sozinho não atende esse requisito.

| Caso | Antes de fechar | Após reabrir em nova navegação | Evidência e critério |
| --- | --- | --- | --- |
| V01 Pontos / camadas | IDs, ordem, visibilidade, colunas, contagem, cor, raio e opacidade | Mesmos dados/configuração e elementos visíveis | Configs/hashes e capturas no mesmo viewport; ocultar camada deve alterar imagem |
| V02 Filtros | Valores, tipo, campos, conjunto incluído/excluído e histograma | Mesmo resultado filtrado | Comparar IDs/contagens; ponto excluído não reaparece |
| V03 Câmera / estilo | Centro, zoom, bearing, pitch, estilo e grupos visíveis | Estado persistido restaurado | Anotar navegador, DPR, tamanho, GPU, horário e provedor de tiles |
| V04 Clustering legado / atual | Política, camada lógica única, zoom abaixo/acima dos limites e contagem | Política e transição preservadas, sem camada derivada duplicada | Capturas e contagens em cada zoom; validar flag realmente implantada |
| V05 Polígono / isócrona persistida | Geometria, dados, preenchimento, contorno, análise e vínculo do dataset | Mesma geometria e apresentação, sem regeneração necessária | Config/hashes/capturas; não chamar serviço de isócrona para regenerar evidência |
| V06 Falha de tiles / GPU | Capturar erro, rede e estado do renderer | Classificar causa antes de concluir perda de configuração | Diferença externa não é bug de persistência confirmado; erro ou canvas vazio impede aceite visual |

Sequência: registrar ator/organização/papel com identificadores sanitizados; abrir mapa existente autorizado; capturar configuração e imagem inicial; se gravação estiver autorizada, salvar e registrar revisão confirmada; fechar/remontar viewer; reabrir a mesma revisão; repetir as comparações e os controles negativos. Se gravação for proibida, executar apenas leitura/reabertura e deixar a etapa salvar→reabrir pendente. Não criar cookie nem ampliar permissões para viabilizar QA. Evidências de clientes ficam em local restrito, nunca nos fixtures do repositório.

Tiles externos, estilos hospedados, GPU física, shell Maõno completo, permissões e integração autenticada com armazenamento exigem esse aceite. O ensaio local usa o viewer Kepler, reducer/camadas Maõno, hidratação e serialização reais; substitui apenas página, basemap e dados de entrada. Catálogo de ícones não utilizado é respondido localmente. Clustering é ativado somente no servidor de teste local; nenhuma configuração implantada é alterada.

Hipótese investigada: drift dos filtros na reabertura. A comparação bruta encontrou `plotType: "histogram"` convertido para `{type: "histogram"}` e remoção de `enlarged: false` no Golden Map C0 antigo. `FilterSchemaV1.load` / `PlotTypeSchema.load` do Kepler instalado implementam essa migração. O teste exige exatamente essas mudanças e igualdade de todos os demais campos; não altera o código do produto para impedir uma migração prevista. `info.created_at` é horário da exportação, fora da configuração visual. Colunas sem vínculo (`null`) são omitidas pelo schema; todos os vínculos efetivos são exigidos. Pixels continuam sob comparação exata, sem tolerância.

## OB-07: coleta e decisão operacional

**Aceite pendente; janela real não comprovada/iniciada nesta execução.** Nenhuma amostra real foi obtida; isso não equivale a afirmar que Production teve zero eventos. Não emitir relatório de Production usando fixtures de teste ou preencher campos desconhecidos do manifesto.

1. Operação confirma responsável nominal, banco/alvo e evidência do SHA implantado. Referenciar a implantação, o período em que serviu tráfego e qualquer mudança de versão na janela; não atribuir toda a janela a um merge sem essa prova.
2. Definir `start` UTC e `end = start + 30 dias`, com cobertura verificada desde o início. Registrar a data real; não retrodatá-la para completar o prazo. Planejar coleta até pelo menos `end + 1 hora` para maturação das últimas coortes.
3. Usar os dois exportadores SQL existentes em `scripts/organization-storage/` e o comando read-only `wrangler d1 execute` do runbook. Exportar organizações e observações em JSON bruto; registrar comando, alvo, instante UTC, contagens, integridade/paginação e hashes. Nunca executar migrations ou operadores como etapa da coleta.
4. Preencher uma cópia de `reliability-evidence-manifest.example.json` apenas com fatos verificados. Inventário independente, auditoria e telemetria precisam de cobertura completa; `evidenceRef` deve apontar para prova real. Guardar exportações e dados identificáveis com acesso restrito.
5. Reconciliar as cinco verificações de tolerância zero com evidência própria: vazamento público de erro, provisionamento duplicado, perda silenciosa de dados, incidente sem rastreio e reparo manual necessário. Ausência de eventos no export não confirma nenhuma delas como zero.
6. Executar o relatório existente com `--manifest`, `--organizations`, `--audit`, `--output` novo e `--gate`. Guardar JSON, stdout/stderr, exit code e hashes. Revisar separadamente proveniência: o algoritmo valida conteúdo, não autentica origem.
7. Aceitar somente `PASS`: 30 dias, >=1.000 organizações novas ativas, >=100 incidentes transitórios, >=99,9% operacionais em <=5 min e >=99% recuperados em <=60 min, sem intervenção manual, além de cobertura e integridade completas. `FAIL` exige análise da violação; `INCONCLUSIVE` mantém aberto; `INVALID` exige corrigir/reconciliar a evidência, sem reescrevê-la para forçar aprovação.
8. Se o volume real for insuficiente, manter pendente. Não gerar organizações/incidentes artificiais nem reduzir amostras/metas para fechar o item. A planilha só recebe aceite concluído com links do relatório real e aprovação nominal de Operação/produto.

Dependências residuais: OB-04 (sessões e ambiente), prova do deploy (R25/R26), seleção de mapas reais autorizados, responsáveis nominais e dados completos da janela. O merge desta correção não encerra essas dependências.

## Matriz executada e entrega técnica

| Cobertura local | Resultado | Limite |
| --- | --- | --- |
| Pontos básicos | 67 pixels pintados; framebuffer idêntico na reabertura | Basemap local e entrada sintética |
| Clustering legado / atual | 5.124 pixels pintados em cada fixture; política/configuração e framebuffer preservados | Flag do servidor de teste; configuração implantada não aferida |
| Filtros categórico / numérico | 48 pixels pintados; valores/campos preservados; framebuffer idêntico | Migração de forma antiga do Kepler explicitamente verificada |
| Polígono | 23.976 pixels pintados; geometria, estilo e framebuffer preservados | Sem tiles externos |
| Isócrona persistida | 15.346 pixels pintados; dados/análise e framebuffer preservados | Não gera nova isócrona nem consulta provedor |
| Controles negativos de visibilidade / zoom | Ocultação zera pixels; troca cluster→pontos altera framebuffer e camadas deck | Confirma que canvas vazio ou renderer fixo não aprovam o ensaio |
| SLO / falhas de evidência | 30/30 testes; 4/4 mutantes mortos | Algoritmo, sem janela real de Production |

Execução: `npx playwright test tests/browser/map-fidelity.spec.ts --project=chromium` — **7/7**, sem alteração de timeouts, retries ou tolerâncias de pixels; `npm run test:reliability-slo` — **30/30**; `node scripts/audit-ob07-mutations.mjs` — **4/4**. Os testes novos entram no comando existente `test:reliability-browser`. A correção do relatório está coberta pelos gates existentes `test:reliability` e `test:expanded`. A validação integral da branch é feita pelos workflows da PR; seus resultados devem ser conferidos no head final, sem inferir sucesso de execuções anteriores.

Mudanças separadas: (1) validação do SLO com regressão e mutantes; (2) ensaio de viewer; (3) planejamento/evidências. Nenhuma refatoração ou atualização de dependências. Capturas e hashes estão em [evidence.json](evidence.json), [framebuffers](evidence/viewer-frames.json) e [capturas antes/depois](evidence/viewer-captures.zip). Logs comprimidos guardam também o hash do conteúdo original. Os números de pixels descrevem esta execução; o teste exige imagem não vazia e igualdade antes/depois no mesmo navegador, não um limiar entre GPUs.

**Situação:** implementação/procedimento e regressões locais concluídos. OB-06 e OB-07 permanecem com aceite operacional pendente. Não foi iniciado ciclo de observação por inferência, fabricada sessão de QA, aplicada migration, ativado operador, habilitada mutação de Preview, alterada Production ou reativado Change Request.
