# Visual Maõno: sidebar e inspetores do mapa

## Escopo

Esta PR reorganiza a UI do mapa e corrige suas interações de filtros e camadas. A integração preserva os mocks de navegação da PR234, os ajustes do operador de aceitação e o feedback de salvamento da PR235. O SHA da base, o head validado e os resultados finais ficam na descrição da PR.

Não introduz migrations, novos campos no documento salvo, mudanças de permissões, backend ou motor de persistência. Os arquivos de runtime de salvamento herdados da PR235 permanecem exatamente como revisados naquela frente. Configuração Cloudflare e aceitação remota de JSON/PNG são tratadas separadamente.

## Inventário de componentes

- `MapSidebar`, `MapShellIcon`, `MaonoMapRuntime` e estilos da shell: contorno neutro contínuo entre item ativo e painel, sem gap, borda dupla ou glow; somente o ícone ativo recebe dourado. Rail fixa e scroll interno. Home vetorial aponta para `/projects`; Home e logo compartilham confirmação baseada no estado existente de alterações pendentes. Ordem: Camadas → Mapa base → Pesquisas salvas → Dados → Home. Pasta desabilitada, sem dados fictícios; logout e permissões preservados.
- `MaonoLayerPanel`: remove somente a contagem textual sob o nome do projeto. Título e badges das abas mantêm suas informações reais. A ação de salvar e o scroll interno continuam disponíveis.
- `LayerDetailView`, `LayerInspector`, `LayerStyleEditor`: cabeçalho compacto com voltar/nome/tipo/olho/menu, sem metadados redundantes. Essencial, Aparência, Dimensão e agrupamento e Avançado usam dourado. Remove somente os quatro subtítulos solicitados e adota “Colorir por”. Controles reais e disclosure de associação de dados preservados.
- `FilterDetailView`: mesmo tratamento compacto, olho sem fundo/borda permanentes e títulos dourados. Preserva vinculação de dataset/propriedade, compatibilidade, permissões e centralização/exportação.
- `NumericInput`, `SliderNumberControl`, `numeric-control`: entrada textual temporária, normalização finita, limites reais, porcentagem↔opacidade e Enter sem salvamento implícito. Aplicados também aos limites numéricos dos filtros para evitar coerção de vazio para zero.
- `layer-sidebar-accents`, `useLayerSidebarAccents`, `LayerList`, `LayerListItem`, `FilterPanel`, `filter-groups`: 15 tonalidades controladas de dourado/cinza/branco, independentes da cor cartográfica, vinculadas ao ID. Filtros herdam a identidade apenas quando a associação à camada é inequívoca.
- `FilterHistogram`, `histogram-range`, `FilterValueEditor`: captura de ponteiro e arraste contínuo da faixa selecionada, inclusive em escala LOG, com campos e filtro ativo atualizados durante o gesto. Handles continuam redimensionando separadamente.
- `layer-drop-order`, `LayerList`, `LayerListItem`: inserção antes/depois conforme a metade da linha sob o cursor, indicador sobreposto e a mesma ordem aplicada ao renderer nativo.

## Identidade e compatibilidade

A identidade visual é exclusiva da UI. Um registro imutável de ID/posição na paleta é mantido por organização/projeto em `sessionStorage`; acompanha reordenação, remoção/reinclusão, troca de abas e reload na mesma sessão. Novas camadas e duplicações recebem a próxima identidade. Um novo contexto de navegador pode inicializar outra sequência; quando o armazenamento está indisponível, o fallback determinístico depende somente do ID. Nenhum novo campo é gravado no JSON salvo ou banco.

Olho visível/ativo é dourado; oculto/inativo é muted com `EyeOff`. Hover discreto e foco por teclado continuam disponíveis. As alterações equivalentes em filtros preservam suas restrições e funções existentes.

## Controles numéricos

| Controle | Intervalo mostrado | Incremento | Estado do renderer |
|---|---:|---:|---|
| Opacidade | 0–100% | 1% | 0–1 |
| Opacidade do contorno | 0–100% | 1% | 0–1 |
| Espessura | 0–100 px | 0,1 | número |
| Raio de ponto/GeoJSON | 0–100 px | 0,1 | número |
| Raio mínimo/máximo por campo | 0–500 px | 0,1 | par numérico |
| Raio de agregação | 1–500 px | 0,1 | número |
| Raio do mapa de calor | 0–100 px | 0,1 | número |

Os dois limites de raio usam entradas independentes, totalizando oito controles compartilhados. Valores salvos/digitados com precisão adicional não são arredondados apenas ao abrir ou focar o painel. Slider e caixa representam o mesmo número. Vazio temporário, blur/Enter, limites, decimais e setas têm cobertura; Enter não submete nem salva. Limites e incrementos foram conferidos contra o adapter e os tipos reais do Kepler instalado.

## Arraste do filtro e reordenação

A faixa dourada desloca o intervalo em coordenadas visuais; sua largura em tela permanece constante também em escala logarítmica. Pointer capture mantém o gesto fora do plot, com tratamento de cancelamento, perda de captura e desmontagem. Botão secundário e ponteiros adicionais não iniciam ou sequestram gestos. Campos e filtro ativo se atualizam antes de pointerup. Valores temporais preservam timestamps exatos; a tupla final é validada após essa preservação. Domínios constantes mantêm seu histograma sem permitir arraste fora dos valores reais.

DnD calcula antes/depois pela metade superior/inferior da linha. O indicador não desloca a área de hit e aparece abaixo da última linha quando esse é o destino. Há cobertura de todas as combinações de origem/destino/metade, posições adjacentes, começo/fim, no-op, cancelamento, busca e permissões. A ordem da sidebar é verificada também nos pixels e na serialização do renderer.

## Evidências e verificação

- `map-sidebar-visual.spec.ts`: aplicação compilada, reducer/renderer/serializador reais, rail/teclado/collapse, Home cancel/confirm e mapa limpo, identidade/reordenação/duplicação, títulos/olhos e opacidade real de 37% com payload `0.37` e reload. A comparação de pixels exige um baseline cartográfico já pintado e estável.
- `map-numeric-controls.spec.ts`: componentes de produção montados com callbacks sintéticos para todos os controles, vazios/decimais/limites, valores legados, teclado e ausência de submissão.
- `map-histogram-interactions.spec.ts`: mouse, touch nativo Chromium, handles, limites/escala LOG, largura visual, cancelamento/perda de captura, ponteiros alheios, timestamps e domínios constantes.
- `map-layer-reorder.spec.ts`: 32 combinações de origem/destino/metade, indicador dinâmico e saídas interrompidas usando DnD nativo sobre componentes reais.
- `map-interactions-integration.spec.ts`: filtro LOG reduz pontos no mapa antes de pointerup; camadas sobrepostas alternam dourado→azul→dourado ao reordenar/reverter; valores e ordens completos são serializados e reabertos.

O gate Project Pages executa esses casos em Chromium, Firefox e WebKit, além da suíte existente e dos casos de overflow desktop/mobile. Mantém o teste antecipado de suporte da PR235 e todos os passos da suíte completa. Os artefatos `visual-maono-interactions-<SHA>`, `map-panel-focused-evidence-<SHA>` e `visual-maono-sidebar-<SHA>` permitem inspecionar screenshots, resultados e traces associados ao head exato.

Os testes da aplicação compilada substituem apenas transporte/armazenamento HTTP e dados por fixtures sintéticos. Não são aceitação de backend remoto ou produção. Os testes de componentes não são apresentados como provas de persistência integrada.

### Limites explícitos

- Touch nativo por CDP é verificado em Chromium; os dois casos correspondentes de Firefox/WebKit ficam explicitamente ignorados. Mouse e teclado rodam nos três engines.
- WebKit 2203 suprime eventos de mouse depois de abrir seu menu de contexto nativo neste runner. O registro mostra clique direito/contextmenu sem mouseup e nenhum evento dos cliques seguintes, apesar de hit-test/foco corretos. O clique direito real/no-op e o teste independente de arraste real usam contextos limpos, preservando todas as asserções. A sequência dispensar menu→arrastar no mesmo contexto não foi validada nesse build. Não se injeta `preventDefault`, captura ou eventos primários artificiais. [Referência upstream](https://github.com/WebKit/WebKit/commit/a19b08297f53de5702b7aa7878843c40bfc08e9e).
- Firefox pode mostrar a representação completa ou arredondada a 15 algarismos significativos no input ao atualizar/remontar. Apenas essas duas representações textuais nativas são aceitas; atributos controlados, handles, payload e reload exigem igualdade numérica completa, sem tolerância.
- O build local original foi encerrado por memória (exit 137). Os limites commitados de 4096/6144 MiB foram preservados, e o build padrão é obrigatório no CI. A instalação local WebKit exigiu senha de root e foi interrompida sem credenciais. Restrições locais de fontes/teclado não foram contornadas com testes simulados.
- Lint global possui erros anteriores. A comparação com uma cópia exata da árvore-base distingue problemas preexistentes de regressões; o resultado, typecheck, agregados, revisão independente e CI ficam na descrição da PR. Nunca considerar um gate pendente, interrompido ou focado como um all-pass geral.
