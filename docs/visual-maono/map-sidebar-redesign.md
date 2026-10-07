# Visual Maõno: sidebar e inspetores do mapa

## Escopo

PR independente sobre `mano_kepler_v1`, base `d3c9377cdc18aa94b4e561d82b2351c8766db4a5`. Não inclui merge, deploy, migrations, backend, alterações do motor de salvamento ou ativação de flags. A aceitação remota de salvamento continua separada.

### Inventário de componentes

- `MapSidebar`, `MapShellIcon`, `MaonoMapRuntime` e estilos da shell: contorno neutro contínuo do item ativo, Home vetorial para `/projects`, uma confirmação baseada no estado existente de alterações pendentes para Home e logo, pasta desabilitada reservada a Pesquisas salvas. Ordem: Camadas → Mapa base → Pesquisas salvas → Dados → Home. O ícone de logout e as permissões dos painéis são preservados.
- `MaonoLayerPanel`: remove somente a contagem textual sob o nome do projeto. Os dois badges das abas continuam mostrando contagens reais. Mantém a ação de salvar existente e o scroll interno.
- `LayerDetailView`, `LayerInspector`, `LayerStyleEditor`: cabeçalho compacto com nome/tipo/olho/menu; remove metadados redundantes e os quatro subtítulos; mantém os controles reais e o disclosure de associação de dados.
- `FilterDetailView`: aplica o mesmo cabeçalho compacto e olho sem caixa; mantém vinculação de dataset/propriedade, filtros incompatíveis, permissões e ação de centralizar/exportar.
- `NumericInput`, `SliderNumberControl`, `numeric-control`: edição textual temporária, normalização finita, limites reais, porcentagem↔opacidade e Enter sem salvamento implícito. Aplicados também aos limites numéricos dos filtros para evitar coerção de vazio para zero.
- `layer-sidebar-accents`, `useLayerSidebarAccents`, `LayerList`, `LayerListItem`, `FilterPanel`, `filter-groups`: 15 tonalidades controladas de dourado/cinza/branco, independentes da cor cartográfica. Identidades vinculadas a IDs e compartilhadas com filtros apenas quando a associação é inequívoca.

### Identidade e compatibilidade

A identidade visual é um estado exclusivo de UI. Um registro imutável de ID/posição na paleta é mantido por organização/projeto em `sessionStorage`; acompanha reordenação, remoção/reinclusão, troca de abas e reload na mesma sessão. Novas camadas e duplicações recebem a próxima identidade. Um novo contexto de navegador pode inicializar outra sequência; quando armazenamento está indisponível, o fallback determinístico depende somente do ID. Não é gravado nenhum novo campo no JSON salvo nem no banco.

### Controles numéricos

| Controle | Intervalo mostrado | Incremento | Estado do renderer |
|---|---:|---:|---|
| Opacidade | 0–100% | 1% | 0–1 |
| Opacidade do contorno | 0–100% | 1% | 0–1 |
| Espessura | 0–100 px | 0,1 | número |
| Raio de ponto/GeoJSON | 0–100 px | 0,1 | número |
| Raio mínimo/máximo por campo | 0–500 px | 0,1 | par numérico |
| Raio de agregação | 1–500 px | 0,1 | número |
| Raio do mapa de calor | 0–100 px | 0,1 | número |

Valores salvos/digitados com precisão adicional não são arredondados apenas ao abrir o painel. Slider e caixa devem representar o mesmo número. Limites e incrementos foram conferidos contra o adapter e os tipos reais do Kepler instalado.

## Evidências e verificação

A suíte `map-sidebar-visual.spec.ts` monta a aplicação compilada e usa o renderer/reducer/serializador reais. Compara pixels do mapa a 100% e 37%, verifica a carga serializada `opacity: 0.37` e recarrega usando transporte/armazenamento HTTP sintéticos. Isso não representa aceitação de backend remoto ou de produção.

A suíte `map-numeric-controls.spec.ts` monta os componentes de produção com callbacks sintéticos para cobrir todos os controles, entrada vazia, limites, decimais, teclado e submissão. É um teste de componentes, não um teste integrado de persistência.

As duas suítes foram incluídas no gate Project Pages em Chromium, Firefox e WebKit. Evidências visuais esperadas: `visual-rail-layers.png`, `visual-rail-basemap.png`, `visual-layer-inspector.png`, `visual-filter-inspector.png`, além dos casos existentes em viewport 1280×480 e 320×480. Os artefatos da execução devem ser associados ao head exato da PR. O workflow publica um artefato pequeno `visual-maono-sidebar-<SHA>` com os resultados destas duas suítes, separado do build completo.

### Limites locais conhecidos

- O primeiro `npm run build`, sem alteração dos limites commitados de 4096/6144 MiB, foi encerrado pelo sistema por falta de memória (exit 137) após 12.101 módulos transformados. A segunda tentativa, com orçamento local de 4096 MiB e GOMAXPROCS=2, também terminou em exit 137 ao renderizar chunks. Os scripts e limites commitados não foram reduzidos; o build padrão continua obrigatório no CI.
- O navegador local apresentou restrição de IPC; o headless shell que renderiza não entregou teclado nativo nem em um HTML vazio. Testes nativos não foram enfraquecidos. A validação efetiva depende da execução CI e deve ser reportada como pendente até haver resultado.
- Nenhuma aceitação em Preview remoto/produção foi executada por esta frente. Não reutilizar os testes sintéticos como prova de persistência remota.

O estado corrente de cada gate, os links dos artefatos e a revisão independente ficam na descrição da PR. Não considerar CI pendente ou um build interrompido como sucesso.
