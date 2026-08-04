# Registro de incidente — mapa Kepler invisível por viewport com altura zero

**Data:** 31 de julho de 2026
**Projeto:** Maõno Maps / `maono_kepler_v1`
**Branch da correção:** `feat/kepler-visual-maono-camadas-estilos`
**Status:** corrigido e validado localmente
**Severidade:** alta — editor e visualizador carregavam o shell, mas o mapa permanecia invisível

---

## 1. Resumo do incidente

Após a integração do novo shell visual Maõno ao Kepler, a interface externa era exibida normalmente, incluindo barra lateral, painel de camadas, topbar e controles. Entretanto, o basemap permanecia totalmente preto e não apareciam controles ou elementos visuais do motor cartográfico.

O backend, as rotas, o build e os testes automatizados estavam funcionando. O defeito ocorria exclusivamente no layout calculado pelo navegador.

---

## 2. Sintomas observados

- Shell Maõno montado corretamente.
- Painel de camadas carregado.
- Rota de edição respondendo normalmente.
- APIs de contexto e configuração retornando HTTP 200.
- Kepler marcado como inicializado.
- Basemap configurado como `dark-matter`.
- Nenhum mapa visível.
- O `AutoSizer` recebia dimensões `0 × 0`.
- O canvas era criado com buffer interno padrão, mas possuía altura CSS igual a zero.
- MapLibre não era montado.
- O style do mapa não chegava a carregar.
- O botão de recolhimento do painel aparecia, mas inicialmente não recebia cliques.

---

## 3. Evidência do defeito

O diagnóstico de runtime registrou inicialmente:

```text
map-area:             largura positiva × altura positiva
screenshot-wrapper:   largura positiva × 0
kepler-container:     largura positiva × 0
panel-group:          largura positiva × 0
AutoSizer:            0 × 0
canvas CSS:           largura positiva × 0
```

Falhas registradas:

```text
CANVAS_INVALID_SIZE
MAP_LIBRARY_MISSING
STYLE_NOT_LOADED
```

Essas três falhas eram encadeadas:

```text
wrapper sem altura efetiva
→ AutoSizer mede 0 × 0
→ Kepler recebe altura zero
→ canvas CSS fica com altura zero
→ MapLibre não inicializa
→ style não é carregado
```

---

## 4. Causa raiz

A causa raiz foi a combinação entre:

1. `ScreenshotWrapper`;
2. grupos e painéis do `react-resizable-panels`;
3. wrappers posicionados de forma absoluta;
4. dimensões percentuais dependentes de pais sem altura CSS explicitamente resolvida;
5. `AutoSizer` do `react-virtualized`.

O shell externo possuía uma área visual válida, mas a cadeia interna não conseguia converter essa dimensão em uma altura utilizável pelo `AutoSizer`.

As tentativas baseadas somente em regras CSS como `height: 100%`, `inset: 0` e `min-height: 0` não foram suficientes. Em determinados níveis, `height: 100%` continuava sendo resolvido como zero.

---

## 5. Problema secundário do painel

O host do painel utilizava:

```css
pointer-events: none;
```

O painel interno restaurava `pointer-events: auto`, mas o botão de recolhimento não fazia isso. Como consequência, o botão era desenhado, mas não recebia o evento de clique.

A correção adicionou `pointer-events: auto` ao botão e ao backdrop interativo.

---

## 6. Por que os testes anteriores não detectaram o erro

Os testes existentes verificavam:

- estrutura dos componentes;
- presença de classes;
- fronteiras arquiteturais;
- contratos do Engine Adapter;
- feature flags;
- ações permitidas;
- regras CSS estáticas;
- build TypeScript e Vite.

Esses testes não executavam o layout real do navegador. Portanto, não calculavam:

- `getBoundingClientRect()`;
- altura real de wrappers flexíveis e absolutos;
- dimensões entregues ao `AutoSizer`;
- criação efetiva do canvas WebGL;
- montagem do MapLibre;
- carregamento do style.

O build e os testes estáticos podiam passar enquanto o mapa continuava invisível.

---

## 7. Solução definitiva adotada — V5

A solução abandonou o `AutoSizer` como fonte principal de dimensões.

Foi criada uma medição controlada do viewport usando `ResizeObserver`:

```text
área real do mapa
→ ResizeObserver mede largura e altura
→ dimensões positivas são armazenadas no estado
→ Kepler recebe width e height explícitos em pixels
→ Kepler só é montado quando width > 0 e height > 0
```

A implementação passou a utilizar uma viewport medida explicitamente, evitando a dependência de percentuais encadeados.

A solução também:

- preserva o redimensionamento da janela;
- reage ao recolhimento e à abertura do painel;
- mantém o canvas sincronizado com o espaço disponível;
- impede a montagem do Kepler com dimensões inválidas;
- mantém a instrumentação de diagnóstico;
- preserva o fluxo de screenshot e os painéis SQL/IA.

---

## 8. Evidência da correção

Após a V5, o diagnóstico final registrou:

```text
kepler-frame:          dimensão válida
screenshot-wrapper:    dimensão válida
connected-app-root:    dimensão válida
panel-group:           dimensão válida
measured-viewport:     dimensão válida
kepler-root:           dimensão válida
maplibre-map:          dimensão válida
maplibre-canvas:       dimensão válida
```

Canvases:

```text
canvas do Deck.gl:      dimensão interna e CSS válidas
canvas do MapLibre:     dimensão interna e CSS válidas
contexto:               WebGL2
```

Resultado final:

```text
failures: []
```

O basemap voltou a aparecer e os controles cartográficos foram montados.

---

## 9. Arquivos diretamente envolvidos

```text
package.json
src/pages/Kepler/index.tsx
src/pages/Kepler/components/maono-map-shell/maono-map-shell.css
src/pages/Kepler/components/maono-map-shell/map-layout-debug.ts
tests/maono-map-layout-hotfix.test.mjs
tests/maono-map-shell-runtime.test.mjs
tests/map-shell-overlay-integration.test.mjs
```

---

## 10. Regras obrigatórias para evitar regressão

### 10.1 Não reintroduzir `AutoSizer` no runtime principal

O runtime principal do mapa deve continuar usando dimensões explícitas fornecidas pelo `ResizeObserver`.

### 10.2 Nunca montar o Kepler com dimensões inválidas

A montagem deve exigir:

```text
width > 0
height > 0
```

### 10.3 Manter o seletor estável da viewport medida

O seletor usado pela instrumentação e pelos testes não deve ser removido sem substituição equivalente:

```text
.maono-kepler-viewport
```

### 10.4 Manter o diagnóstico de runtime

O modo:

```text
?maonoLayoutDebug=1
```

deve continuar disponível em desenvolvimento e preview.

O diagnóstico precisa verificar:

- Kepler montado;
- largura e altura do mapa;
- quantidade de canvases;
- canvases com dimensões válidas;
- Mapbox ou MapLibre montado;
- style carregado;
- contexto WebGL disponível;
- elementos bloqueando o canvas.

### 10.5 Não confiar somente em testes estáticos

Toda alteração em:

```text
index.tsx
MaonoMapRuntime.tsx
MaonoMapShell.tsx
maono-map-shell.css
MapPanelHost.tsx
```

deve incluir smoke test real no navegador.

### 10.6 Manter o botão e o backdrop clicáveis

Elementos interativos dentro de um host com `pointer-events: none` devem declarar explicitamente:

```css
pointer-events: auto;
```

### 10.7 Não usar `git add .` durante a correção

Backups, pacotes de hotfix e arquivos locais não devem ser versionados. Os arquivos devem ser adicionados explicitamente.

---

## 11. Checklist obrigatório antes de merge

```text
[ ] git diff --check sem erros
[ ] teste específico do layout aprovado
[ ] test:map-panels aprovado
[ ] build Vite aprovado
[ ] mapa visível em modo editor
[ ] mapa visível em modo viewer
[ ] painel abre e recolhe
[ ] ResizeObserver reage ao redimensionamento
[ ] MapLibre ou Mapbox aparece no DOM
[ ] canvases possuem largura e altura positivas
[ ] contexto WebGL disponível
[ ] style carregado
[ ] diagnóstico retorna failures: []
[ ] nenhuma pasta de backup ou hotfix foi incluída
```

---

## 12. Teste de navegador recomendado para evolução futura

Os testes atuais devem ser complementados por um teste E2E com navegador real, usando Playwright ou ferramenta equivalente.

Critério mínimo:

```text
abrir rota do mapa
→ aguardar .maplibregl-map ou .mapboxgl-map
→ verificar canvas visível
→ verificar largura e altura maiores que zero
→ recolher painel
→ confirmar que canvas continua válido
→ abrir painel
→ confirmar que canvas continua válido
```

Esse teste deve falhar quando o canvas estiver presente, mas com altura zero.

---

## 13. Comando de diagnóstico manual

Abrir a rota com:

```text
?maonoLayoutDebug=1
```

Executar:

```js
const snapshot =
  window.__MAONO_MAP_LAYOUT_DEBUG__?.capture("validacao-manual");

console.log({
  failures: snapshot?.failures,
  check: snapshot?.check,
  canvases: snapshot?.canvases,
  runtimeEvents: snapshot?.runtimeEvents,
});
```

Critério de aceite:

```text
failures: []
```

---

## 14. Conclusão

O incidente não foi causado por API, banco, token ou configuração do basemap. O bloqueio principal era a medição inválida da viewport do Kepler.

A correção definitiva foi substituir a dependência do `AutoSizer` por dimensões explícitas calculadas por `ResizeObserver`, mantendo a montagem do Kepler condicionada a uma área real positiva.

Este registro deve permanecer no repositório como referência obrigatória para qualquer alteração futura no shell, nos wrappers do mapa ou na estratégia de redimensionamento.
