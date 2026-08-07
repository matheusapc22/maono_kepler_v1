import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildFilteredDatasetCsv } from "../src/pages/Kepler/engine-adapter/dataset-csv-serializer.ts";

const files = {
  panel: "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  list: "../src/pages/Kepler/components/maono-layer-panel/LayerList.tsx",
  item: "../src/pages/Kepler/components/maono-layer-panel/LayerListItem.tsx",
  layerDetail: "../src/pages/Kepler/components/maono-layer-panel/LayerDetailView.tsx",
  inspector: "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
  style: "../src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx",
  filters: "../src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx",
  filterDetail: "../src/pages/Kepler/components/maono-layer-panel/FilterDetailView.tsx",
  menu: "../src/pages/Kepler/components/maono-layer-panel/PanelActionMenu.tsx",
  css: "../src/pages/Kepler/components/maono-layer-panel/maono-layer-panel.css",
  csvHook: "../src/pages/Kepler/engine-adapter/dataset-csv-export.ts",
  csvSerializer: "../src/pages/Kepler/engine-adapter/dataset-csv-serializer.ts",
  datasetReader: "../src/pages/Kepler/engine-adapter/dataset-table-reader.ts",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("lista compacta substitui accordions e abre uma edição focada", () => {
  assert.doesNotMatch(source.list, /expandedLayerIds|renderLayerDetails/);
  assert.match(source.panel, /type PanelView/);
  assert.match(source.panel, /kind: "layer"/);
  assert.match(source.panel, /<LayerDetailView/);
  assert.match(source.layerDetail, /Voltar para a lista de camadas/);
  assert.match(source.css, /\.maono-detail-view/);
});

test("linha mantém somente identificação, visibilidade e menu de contexto", () => {
  assert.match(source.item, /maono-layer-row__swatch/);
  assert.match(source.item, /maono-layer-row__visibility/);
  assert.match(source.item, /<PanelActionMenu/);
  assert.doesNotMatch(source.item, /maono-layer-list__actions/);
  assert.doesNotMatch(source.item, /maono-layer-list__reorder/);
  assert.match(source.item, /Mover .* para cima/);
  assert.match(source.item, /Mover .* para baixo/);
  assert.match(source.item, /Mover para o início/);
  assert.match(source.item, /Mover para o fim/);
});

test("ações destrutivas e secundárias ficam em menu acessível por portal", () => {
  assert.match(source.menu, /createPortal/);
  assert.match(source.menu, /role="menu"/);
  assert.match(source.menu, /role="menuitem"/);
  assert.match(source.menu, /aria-haspopup="menu"/);
  assert.match(source.menu, /event\.key === "Escape"/);
  assert.match(source.menu, /Math\.max\([\s\S]*VIEWPORT_MARGIN/);
  assert.match(source.item, /label: "Duplicar"/);
  assert.match(source.item, /label: "Remover"/);
  assert.match(source.layerDetail, /Exportar dados filtrados \(CSV\)/);
});

test("estilo usa divulgação progressiva e mantém apenas o essencial aberto", () => {
  assert.match(source.style, />Essencial</);
  assert.match(source.style, /<details className="maono-detail-section">/);
  assert.match(source.style, />Aparência</);
  assert.match(source.style, />Dimensão e agrupamento</);
  assert.match(source.style, />Avançado</);
  assert.match(source.inspector, />Dados</);
  assert.doesNotMatch(source.style, /open=\{true\}/);
});

test("filtros usam lista resumida e um editor focado por vez", () => {
  assert.match(source.filters, /selectedFilterId/);
  assert.match(source.filters, /<FilterRow/);
  assert.match(source.filters, /<FilterDetailView/);
  assert.match(source.filterDetail, /<FilterValueEditor/);
  assert.match(source.filterDetail, /Centralizar resultados filtrados/);
  assert.match(source.filters, /1\. Base de dados/);
  assert.match(source.filters, /2\. Propriedade/);
});

test("exportação permanece no adapter e reutiliza o filteredIndex centralizado", () => {
  assert.match(source.csvSerializer, /findRawDataset/);
  assert.match(source.csvSerializer, /createDatasetTableReader/);
  assert.match(source.datasetReader, /filteredIndex/);
  assert.match(source.datasetReader, /filteredIndexes/);
  assert.match(source.csvSerializer, /MAX_DATASET_CSV_ROWS/);
  assert.match(source.csvSerializer, /FORMULA_PREFIX/);
  assert.match(source.csvHook, /viewLayers/);
  assert.match(source.csvHook, /viewFilters/);
  assert.doesNotMatch(source.csvSerializer, /dataContainer\.valueAt/);
  assert.doesNotMatch(source.layerDetail, /useSelector|useStore|@kepler\.gl\/actions/);
  assert.doesNotMatch(source.filterDetail, /useSelector|useStore|@kepler\.gl\/actions/);
});

test("CSV usa somente índices filtrados e neutraliza fórmulas", () => {
  const state = {
    demo: {
      keplerGl: {
        map: {
          visState: {
            datasets: {
              "data-1": {
                id: "data-1",
                fields: [{ name: "nome" }, { name: "formula" }],
                allData: [
                  ["Linha removida", "texto"],
                  ["Linha filtrada", "=2+2"],
                ],
                allIndexes: [0, 1],
                filteredIndex: [1],
              },
            },
          },
        },
      },
    },
  };

  const exported = buildFilteredDatasetCsv(state, "data-1", "Teste seguro");

  assert.equal(exported.rowCount, 1);
  assert.equal(exported.filename, "Teste-seguro-filtrado.csv");
  assert.match(exported.content, /Linha filtrada,'=2\+2/);
  assert.doesNotMatch(exported.content, /Linha removida/);
});
